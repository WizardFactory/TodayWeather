import Foundation
import Testing
import TWData
import TWModel
import TWStorage

/// A clock the test moves (`advance(to:)`). Each sleeper is resumed exactly once: when the clock reaches its deadline,
/// at once when the deadline has passed, or with `CancellationError` when its task is cancelled.
final class VirtualClock: Clock, @unchecked Sendable {
    struct Instant: InstantProtocol {
        let offset: Duration
        func advanced(by duration: Duration) -> Instant { Instant(offset: offset + duration) }
        func duration(to other: Instant) -> Duration { other.offset - offset }
        static func < (a: Instant, b: Instant) -> Bool { a.offset < b.offset }
    }

    private struct Sleeper {
        let deadline: Instant
        let continuation: CheckedContinuation<Void, Error>
    }

    private let lock = NSLock()
    private var current = Instant(offset: .zero)
    private var sleepers: [UUID: Sleeper] = [:]

    var now: Instant { lock.withLock { current } }
    var minimumResolution: Duration { .zero }
    var sleeperCount: Int { lock.withLock { sleepers.count } }

    func sleep(until deadline: Instant, tolerance: Duration?) async throws {
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
                let ready: Result<Void, Error>? = lock.withLock {
                    if Task.isCancelled { return .failure(CancellationError()) }
                    if deadline <= current { return .success(()) }
                    sleepers[id] = Sleeper(deadline: deadline, continuation: c)
                    return nil
                }
                if let ready { c.resume(with: ready) }
            }
        } onCancel: {
            let sleeper = lock.withLock { sleepers.removeValue(forKey: id) }
            sleeper?.continuation.resume(throwing: CancellationError())
        }
    }

    /// Moves the clock to `offset` (never back) and resumes the sleepers that are due, earliest first.
    func advance(to offset: Duration) {
        let due: [Sleeper] = lock.withLock {
            if offset > current.offset { current = Instant(offset: offset) }
            let ids = sleepers.filter { $0.value.deadline <= current }.sorted { $0.value.deadline < $1.value.deadline }
            return ids.map { sleepers.removeValue(forKey: $0.key)! }
        }
        for s in due { s.continuation.resume() }
    }
}

/// Records each request with the clock's time when it was started. The reply of a method in `fail` is nil (the
/// request did not complete), others 200; a method in `delays` is answered that long after it was sent, by a task
/// this transport owns (`finishAll()` waits for them).
final class TimedTransport: PushTransport, @unchecked Sendable {
    struct Sent {
        let at: Duration
        let request: PushRequest
        let reply: PushReply
    }

    private let lock = NSLock()
    private var sent: [Sent] = []
    private var answers: [Task<Void, Never>] = []
    let clock: VirtualClock
    let fail: Set<String>
    let delays: [String: Duration]

    init(clock: VirtualClock, fail: Set<String> = [], delays: [String: Duration] = [:]) {
        self.clock = clock
        self.fail = fail
        self.delays = delays
    }

    var requests: [Sent] { lock.withLock { sent } }

    func start(_ request: PushRequest) -> PushReply {
        let reply = PushReply()
        let now = clock.now
        let status: Int? = fail.contains(request.method) ? nil : 200
        lock.withLock { sent.append(Sent(at: now.offset, request: request, reply: reply)) }
        if let delay = delays[request.method], delay > .zero {
            let clock = clock
            let task = Task {
                try? await clock.sleep(until: now.advanced(by: delay), tolerance: nil)
                reply.finish(status)
            }
            lock.withLock { answers.append(task) }
        } else {
            reply.finish(status)
        }
        return reply
    }

    /// Waits for every delayed answer (the clock must have passed them, or they wait).
    func finishAll() async {
        for task in lock.withLock({ answers }) { await task.value }
    }
}

/// Records requests and answers each at once (`status`, nil: did not complete).
final class RecordingTransport: PushTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var sent: [PushRequest] = []
    let status: Int?

    init(status: Int? = 200) { self.status = status }

    var requests: [PushRequest] { lock.withLock { sent } }

    func start(_ request: PushRequest) -> PushReply {
        lock.withLock { sent.append(request) }
        return .finished(status)
    }
}

/// Takes requests and answers none until `answerAll()`: the process "ends" with the requests in flight. A test
/// answers them before it returns, so no task stays suspended.
final class HangingTransport: PushTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var sent: [(PushRequest, PushReply)] = []

    var requests: [PushRequest] { lock.withLock { sent.map(\.0) } }

    func start(_ request: PushRequest) -> PushReply {
        let reply = PushReply()
        lock.withLock { sent.append((request, reply)) }
        return reply
    }

    func answerAll(_ status: Int?) {
        for (_, reply) in lock.withLock({ sent }) { reply.finish(status) }
    }
}

/// Polls `condition` every 5 ms (real time) until it holds, at most `seconds`; false when it never did.
func eventually(seconds: Double = 10, _ condition: () async -> Bool) async -> Bool {
    let end = Date().addingTimeInterval(seconds)
    while Date() < end {
        if await condition() { return true }
        try? await Task.sleep(for: .milliseconds(5))
    }
    return await condition()
}
