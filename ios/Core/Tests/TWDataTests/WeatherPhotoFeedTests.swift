import Foundation
import Testing
import TWData
import TWDomain
import TWModel

/// The photo feed loads like `loadWeatherPhotos` (IN-07, #2956): `_retryGetHttp`'s overlapping attempts `gap` apart,
/// the first attempt to settle deciding, one load per process, shared while it runs and repeated after a failure.
/// The attempts and their answers run on a virtual clock (moved here from the app-hosted tests, where a busy CI runner
/// stretched the real clock: the order of events, not its speed, decides every outcome).
extension ClockedDataTests {
struct WeatherPhotoFeedTests {
    static let feedBody = Data(#"[{"id":"sun-1","tags":["sun"],"twUrls":{"regular":"https://photos.test.invalid/sun-1.jpg"}}]"#.utf8)
    let url = URL(string: "https://photos.test.invalid/list.json")!

    /// A scripted server on the virtual clock: each attempt runs the next behavior; it records when attempts start
    /// (virtual milliseconds) and which were cancelled.
    final class Script: HTTPGetting, @unchecked Sendable {
        /// `failLate`: fails at `ms` and then takes `pause` of real time to throw, as a busy machine delays the failure's
        /// way back to `firstSettled` while nothing touches the clock.
        enum Behavior { case answer(Int64), fail(Int64), failLate(Int64, pause: Duration), hang }
        private let lock = NSLock()
        private let clock: VirtualClock
        private var behaviors: [Behavior]
        private var startedAt: [Int64] = []
        private var cancelledAttempts: [Int] = []

        init(_ clock: VirtualClock, _ behaviors: [Behavior]) {
            self.clock = clock
            self.behaviors = behaviors
        }

        var starts: [Int64] { lock.withLock { startedAt } }
        var attempts: Int { lock.withLock { startedAt.count } }
        var cancelled: [Int] { lock.withLock { cancelledAttempts.sorted() } }

        func get(_ url: URL) async throws -> Data {
            let (index, behavior): (Int, Behavior) = lock.withLock {
                startedAt.append(clock.elapsed)
                return (startedAt.count, behaviors.isEmpty ? .hang : behaviors.removeFirst())
            }
            do {
                switch behavior {
                case .answer(let ms):
                    try await clock.sleep(for: .milliseconds(ms))
                    return WeatherPhotoFeedTests.feedBody
                case .fail(let ms):
                    try await clock.sleep(for: .milliseconds(ms))
                    throw URLError(.notConnectedToInternet)
                case .failLate(let ms, let pause):
                    try await clock.sleep(for: .milliseconds(ms))
                    try await Task.sleep(for: pause)
                    throw URLError(.notConnectedToInternet)
                case .hang:
                    try await clock.sleep(for: .seconds(3600))
                    throw URLError(.timedOut)
                }
            } catch is CancellationError {
                lock.withLock { cancelledAttempts.append(index) }
                throw CancellationError()
            }
        }
    }

    /// Runs `firstSettled` with the production timing on `clock` until it settles. With `decidesAt` (the virtual time
    /// of the deciding answer, failure or timeout) the clock stops there until the result has arrived on the real
    /// clock (at most 10 s), so a busy machine cannot let a later attempt start meanwhile; then it moves on to `ms`, so
    /// a wrong implementation's later attempts still run and are counted.
    func settle(_ clock: VirtualClock, _ script: Script, decidesAt: Int64? = nil,
                until ms: Int64 = 60_000) async -> Result<Data, any Error> {
        let done = Done()
        let task = Task {
            let result = await firstSettled(attempts: 3, gap: .seconds(2), timeout: .seconds(20), clock: clock) {
                try await script.get(self.url)
            }
            done.set()
            return result
        }
        if let decidesAt {
            await clock.advance(to: decidesAt)
            _ = await eventually(10) { done.value }
        }
        await clock.advance(to: ms)
        return await task.value
    }

    /// Set when the load has settled.
    final class Done: @unchecked Sendable {
        private let lock = NSLock()
        private var flag = false
        var value: Bool { lock.withLock { flag } }
        func set() { lock.withLock { flag = true } }
    }

    @Test func aSlowRequestGetsTwoMoreAttemptsAGapApartAndTheFirstTimeoutDecides() async {
        let clock = VirtualClock()
        let script = Script(clock, [.hang, .hang, .hang])
        let result = await settle(clock, script, decidesAt: 20_000)
        #expect(script.starts == [0, 2000, 4000])
        if case .failure(let error) = result { #expect(error is AttemptTimeout, "the first attempt's timeout (20 s) decides") }
        else { Issue.record("expected the timeout") }
        #expect(script.cancelled == [1, 2, 3], "the attempts still running are cancelled")
    }

    @Test func aFastFailureEndsTheLoadWithoutRetrying() async {
        let clock = VirtualClock()
        let script = Script(clock, [.fail(500)])
        let result = await settle(clock, script, decidesAt: 500)
        #expect(script.starts == [0], "the failure at 0.5 s comes before the second attempt at 2 s")
        #expect((try? result.get()) == nil)
    }

    /// The load is decided when the failure reaches `firstSettled`, however long that takes on the real clock: the
    /// clock is not moved on to the second attempt's start meanwhile (CI failed `aFastFailureEndsTheLoadWithoutRetrying`
    /// with starts [0, 2000] under load).
    @Test func aFailureThatTakesRealTimeToArriveStillEndsTheLoad() async {
        let clock = VirtualClock()
        let script = Script(clock, [.failLate(500, pause: .milliseconds(200))])
        let result = await settle(clock, script, decidesAt: 500)
        #expect(script.starts == [0], "the failure decides before the second attempt at 2 s")
        #expect((try? result.get()) == nil)
    }

    @Test func theFirstAttemptToAnswerWinsAndTheOthersAreCancelled() async {
        let clock = VirtualClock()
        let script = Script(clock, [.answer(3000), .hang, .hang])
        let result = await settle(clock, script, decidesAt: 3000)
        #expect((try? result.get()) == Self.feedBody)
        #expect(script.starts == [0, 2000], "the answer at 3 s comes before the third attempt at 4 s")
        #expect(script.cancelled == [2])
    }

    @Test func aLaterAttemptCanWin() async {
        let clock = VirtualClock()
        let script = Script(clock, [.hang, .answer(500), .hang])
        let result = await settle(clock, script, decidesAt: 2500)
        #expect((try? result.get()) == Self.feedBody)
        #expect(script.starts == [0, 2000])
        #expect(script.cancelled == [1])
    }

    @Test func oneLoadIsSharedRepeatedAfterAFailureAndKeptAfterASuccess() async throws {
        let clock = VirtualClock()
        let script = Script(clock, [.fail(10), .answer(200)])
        let feed = WeatherPhotoFeed(url: url, http: script, clock: clock)
        let failed = Task { await feed.load() }
        #expect(await due(clock, within: 10) { script.attempts == 1 })
        await clock.advance(to: 1000)
        #expect(await failed.value == nil, "the first load fails")
        #expect(script.attempts == 1)
        // Two loads while one runs: both wait for the same request (the clock does not move until both started).
        let first = Task { await feed.load() }
        let second = Task { await feed.load() }
        #expect(await due(clock, within: 200) { script.attempts == 2 })
        await clock.quiesce()
        #expect(script.attempts == 2, "the second and third loads shared one request")
        await clock.advance(by: 1000)
        let (a, b) = (await first.value, await second.value)
        let photos = try #require(a)
        #expect(b?.groups["sun"]?.count == 1)
        #expect(await feed.load()?.groups["sun"]?.count == 1)
        #expect(script.attempts == 2, "a loaded feed is kept")
        #expect(photos.find(skyIcon: "sun", random: 0) == "https://photos.test.invalid/sun-1.jpg")
    }

    @Test func withoutAURLNothingIsRequested() async {
        let clock = VirtualClock()
        let script = Script(clock, [.answer(0)])
        let feed = WeatherPhotoFeed(url: nil, http: script, clock: clock)
        #expect(await feed.load() == nil)
        #expect(script.attempts == 0)
    }

    @Test func productionTimingIsTheCordovaTiming() {
        #expect(WeatherPhotoFeed.attempts == 3)
        #expect(WeatherPhotoFeed.attemptGap == .seconds(2))
        #expect(WeatherPhotoFeed.timeout == .seconds(20))
    }
}
}
