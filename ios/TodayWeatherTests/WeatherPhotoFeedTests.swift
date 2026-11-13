import Foundation
import Testing
import TWData
import TWDomain
import TWModel

/// The photo feed loads like `loadWeatherPhotos` (IN-07, #2956): `_retryGetHttp`'s overlapping attempts `gap` apart,
/// the first attempt to settle deciding, one load per process, shared while it runs and repeated after a failure.
/// The attempt gap is shortened (the production value is 2 s) so the timing runs on the real clock.
struct WeatherPhotoFeedTests {
    static let feedBody = Data(#"[{"id":"sun-1","tags":["sun"],"twUrls":{"regular":"https://photos.test.invalid/sun-1.jpg"}}]"#.utf8)

    /// A scripted server: each attempt runs the next behavior; it records when attempts start and which were cancelled.
    final class Script: HTTPGetting, @unchecked Sendable {
        enum Behavior { case answer(Duration), fail(Duration), hang }
        private let lock = NSLock()
        private var behaviors: [Behavior]
        private(set) var started: [ContinuousClock.Instant] = []
        private(set) var cancelled: [Int] = []
        let zero = ContinuousClock.now

        init(_ behaviors: [Behavior]) { self.behaviors = behaviors }

        var attempts: Int { lock.withLock { started.count } }
        var startOffsets: [Duration] { lock.withLock { started.map { $0 - zero } } }
        var cancelledAttempts: [Int] { lock.withLock { cancelled } }

        func get(_ url: URL) async throws -> Data {
            let (index, behavior): (Int, Behavior) = lock.withLock {
                started.append(.now)
                return (started.count, behaviors.isEmpty ? .hang : behaviors.removeFirst())
            }
            do {
                switch behavior {
                case .answer(let after):
                    try await Task.sleep(for: after)
                    return WeatherPhotoFeedTests.feedBody
                case .fail(let after):
                    try await Task.sleep(for: after)
                    throw URLError(.notConnectedToInternet)
                case .hang:
                    try await Task.sleep(for: .seconds(3600))
                    throw URLError(.timedOut)
                }
            } catch is CancellationError {
                lock.withLock { cancelled.append(index) }
                throw CancellationError()
            }
        }
    }

    let url = URL(string: "https://photos.test.invalid/list.json")!

    @Test func aSlowRequestGetsTwoMoreAttemptsAGapApart() async {
        let script = Script([.hang, .hang, .hang])
        let result = await firstSettled(attempts: 3, gap: .milliseconds(200), timeout: .milliseconds(900)) {
            try await script.get(self.url)
        }
        #expect(script.attempts == 3)
        let offsets = script.startOffsets.map { Double($0.components.attoseconds) / 1e18 + Double($0.components.seconds) }
        #expect(offsets.count == 3 && offsets[1] >= 0.19 && offsets[2] >= 0.39, "\(offsets)")
        #expect((try? result.get()) == nil)
        if case .failure(let error) = result { #expect(error is AttemptTimeout, "the first attempt's timeout decides") }
    }

    @Test func aFastFailureEndsTheLoadWithoutRetrying() async {
        let script = Script([.fail(.milliseconds(20))])
        let result = await firstSettled(attempts: 3, gap: .milliseconds(300), timeout: .seconds(5)) { try await script.get(self.url) }
        #expect(script.attempts == 1)
        #expect((try? result.get()) == nil)
    }

    @Test func theFirstAttemptToAnswerWinsAndTheOthersAreCancelled() async {
        let script = Script([.answer(.milliseconds(500)), .hang, .hang])
        let result = await firstSettled(attempts: 3, gap: .milliseconds(300), timeout: .seconds(5)) { try await script.get(self.url) }
        #expect((try? result.get()) == Self.feedBody)
        #expect(script.attempts == 2, "the second attempt started at 300 ms; the third never did")
        #expect(script.cancelledAttempts == [2])
    }

    @Test func oneLoadIsSharedRepeatedAfterAFailureAndKeptAfterASuccess() async throws {
        let script = Script([.fail(.milliseconds(10)), .answer(.milliseconds(200))])
        let feed = WeatherPhotoFeed(url: url, http: script, gap: .seconds(5), timeout: .seconds(5))
        #expect(await feed.load() == nil, "the first load fails")
        #expect(script.attempts == 1)
        async let first = feed.load()
        async let second = feed.load()
        let (a, b) = await (first, second)
        #expect(script.attempts == 2, "the second and third loads shared one request")
        let photos = try #require(a)
        #expect(b?.groups["sun"]?.count == 1)
        #expect(await feed.load()?.groups["sun"]?.count == 1)
        #expect(script.attempts == 2, "a loaded feed is kept")
        #expect(photos.find(skyIcon: "sun", random: 0) == "https://photos.test.invalid/sun-1.jpg")
    }

    @Test func withoutAURLNothingIsRequested() async {
        let script = Script([.answer(.zero)])
        let feed = WeatherPhotoFeed(url: nil, http: script)
        #expect(await feed.load() == nil)
        #expect(script.attempts == 0)
    }

    @Test func productionTimingIsTheCordovaTiming() {
        #expect(WeatherPhotoFeed.attempts == 3)
        #expect(WeatherPhotoFeed.attemptGap == .seconds(2))
        #expect(WeatherPhotoFeed.timeout == .seconds(20))
    }
}
