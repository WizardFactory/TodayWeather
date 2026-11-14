import Foundation
import Testing
import TWData
import TWModel
import TWStorage

/// A virtual clock (IN-08): sleeps wait until `advance` reaches their deadline or their task is cancelled. Every
/// continuation is resumed exactly once: by `advance` (removed from `sleepers` under the lock first) or by the
/// cancellation handler (which finds it there, or marks the id so the sleep that has not registered yet throws at once).
final class VirtualClock: AppClock, @unchecked Sendable {
    private let lock = NSLock()
    private var ms: Int64 = 0
    private var nextID = 0
    private var sleepers: [Int: (deadline: Int64, continuation: CheckedContinuation<Void, any Error>)] = [:]
    private var cancelledBeforeWaiting: Set<Int> = []
    private var activity = 0
    /// A fixed wall-clock start: 2026-11-14 00:00 UTC.
    let start = Date(timeIntervalSince1970: 1_794_614_400)

    var now: Date { start.addingTimeInterval(Double(elapsed) / 1000) }
    /// Milliseconds since the start.
    var elapsed: Int64 { lock.withLock { ms } }
    var pendingSleeps: Int { lock.withLock { sleepers.count } }
    /// The earliest deadline of a waiting sleep, in milliseconds.
    var nextDeadline: Int64? { lock.withLock { sleepers.values.map(\.deadline).min() } }

    func sleep(for duration: Duration) async throws {
        let (seconds, atto) = duration.components
        let length = seconds * 1000 + atto / Int64(1e15) // attoseconds per millisecond
        let (id, deadline): (Int, Int64) = lock.withLock {
            nextID += 1
            activity += 1
            return (nextID, ms + length)
        }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                enum Action { case wait, resume, cancel }
                let action: Action = lock.withLock {
                    if cancelledBeforeWaiting.remove(id) != nil { return .cancel }
                    if deadline <= ms { return .resume }
                    sleepers[id] = (deadline, continuation)
                    return .wait
                }
                switch action {
                case .wait: break
                case .resume: continuation.resume()
                case .cancel: continuation.resume(throwing: CancellationError())
                }
            }
        } onCancel: {
            let continuation: CheckedContinuation<Void, any Error>? = lock.withLock {
                activity += 1
                if let sleeper = sleepers.removeValue(forKey: id) { return sleeper.continuation }
                cancelledBeforeWaiting.insert(id)
                return nil
            }
            continuation?.resume(throwing: CancellationError())
        }
    }

    /// Moves the time to `target` ms, waking the sleepers in deadline order and letting the woken tasks run (and sleep
    /// again) at each deadline before going on.
    func advance(to target: Int64) async {
        await quiesce()
        while true {
            let woken: [CheckedContinuation<Void, any Error>]? = lock.withLock {
                guard let next = sleepers.values.map(\.deadline).min(), next <= target else { return nil }
                ms = max(ms, next)
                let due = sleepers.filter { $0.value.deadline <= next }
                for id in due.keys { sleepers[id] = nil }
                activity += 1
                return due.sorted { $0.key < $1.key }.map(\.value.continuation)
            }
            guard let woken else { break }
            for c in woken { c.resume() }
            await quiesce()
        }
        lock.withLock { ms = max(ms, target) }
        await quiesce()
    }

    func advance(by delta: Int64) async { await advance(to: elapsed + delta) }

    /// Waits (on the real clock) until no task starts or ends a sleep for a while: the woken work has run.
    func quiesce() async {
        var stable = 0
        var last = -1
        while stable < 8 {
            await Task.yield()
            try? await Task.sleep(for: .milliseconds(2))
            let now = lock.withLock { activity }
            if now == last { stable += 1 } else { stable = 0; last = now }
        }
    }

    /// Marks other activity (a request starting or ending), so `quiesce` waits for its consequences.
    func touch() { lock.withLock { activity += 1 } }
}

/// A server double for the weather requests: each attempt (in the order they arrive) takes the next behavior, or the
/// behavior for its URL; it records the virtual time, URL and headers of every attempt and which were cancelled.
final class ScriptedWeatherHTTP: WeatherHTTP, @unchecked Sendable {
    enum Behavior {
        /// The body after `ms`.
        case answer(Int64, Data)
        /// An error status after `ms`.
        case fail(Int64, Int)
        /// No answer (until cancelled).
        case hang
    }

    struct Attempt {
        let at: Int64
        let url: URL
        let headers: [String: String]
    }

    private let lock = NSLock()
    private let clock: VirtualClock
    private var queue: [Behavior]
    private let byURL: (URL) -> Behavior?
    private var recorded: [Attempt] = []
    private var cancelledIndices: [Int] = []

    init(clock: VirtualClock, _ queue: [Behavior] = [], byURL: @escaping (URL) -> Behavior? = { _ in nil }) {
        self.clock = clock
        self.queue = queue
        self.byURL = byURL
    }

    var attempts: [Attempt] { lock.withLock { recorded } }
    var cancelled: [Int] { lock.withLock { cancelledIndices } }

    func enqueue(_ behaviors: Behavior...) { lock.withLock { queue += behaviors } }

    func get(_ url: URL, headers: [String: String]) async throws -> Data {
        let (index, behavior): (Int, Behavior) = lock.withLock {
            recorded.append(Attempt(at: clock.elapsed, url: url, headers: headers))
            let b = byURL(url) ?? (queue.isEmpty ? .hang : queue.removeFirst())
            return (recorded.count, b)
        }
        clock.touch()
        do {
            switch behavior {
            case .answer(let ms, let body):
                try await clock.sleep(for: .milliseconds(ms))
                clock.touch()
                return body
            case .fail(let ms, let status):
                try await clock.sleep(for: .milliseconds(ms))
                clock.touch()
                throw URLSessionGet.StatusError(status: status)
            case .hang:
                try await clock.sleep(for: .seconds(3600))
                throw URLError(.timedOut)
            }
        } catch is CancellationError {
            lock.withLock { cancelledIndices.append(index) }
            clock.touch()
            throw CancellationError()
        }
    }
}

/// An in-memory state file for the `AppStateHolder`.
final class MemoryStore: AppStateSaving, @unchecked Sendable {
    private let lock = NSLock()
    private var saved: [AppState] = []
    var last: AppState? { lock.withLock { saved.last } }
    func save(_ state: AppState) throws { lock.withLock { saved.append(state) } }
}

/// The corpus responses (copied from android/ into ios/Core/Tests/TWDomainTests/Corpus by import_corpus.py), read from
/// the repository's ios/ directory: `kma-seoul`, `vc-london`, …
enum WeatherFixtures {
    static let corpus = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("TWDomainTests/Corpus/inputs")

    static func body(_ name: String) throws -> Data { try Data(contentsOf: corpus.appendingPathComponent("\(name).json")) }

    static func golden() throws -> JSONValue {
        let url = try #require(Bundle.module.url(forResource: "weather-timed", withExtension: "json", subdirectory: "Golden"))
        return try JSONValue.parse(Data(contentsOf: url))
    }
}

let seoul = Place(currentPosition: false, disable: false, name: "회현동", address: "대한민국 서울특별시 중구 회현동", country: "KR",
                  location: Location(lat: 37.56, long: 126.98))
let london = Place(currentPosition: false, disable: false, name: "런던", address: "영국 런던", country: "GB",
                   location: Location(lat: 51.51, long: -0.13))
let koreanUnits = UnitSettings.defaults(region: "KR")

/// Waits on the real clock until `condition` holds (at most `seconds`).
@MainActor
func eventually(_ seconds: Double = 5, _ condition: () -> Bool) async -> Bool {
    let end = Date().addingTimeInterval(seconds)
    while Date() < end {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(5))
    }
    return condition()
}
