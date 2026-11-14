import Foundation
import TWData
import TWStorage

// Crash injection through the dependencies `PushSync` needs anyway (IN-04 review round 4, CODEX-IN04-7): no hook in
// the production code.

/// One operation on a dependency of `PushSync`.
enum Operation: Equatable, Sendable {
    case load, save, entries, append, acknowledge
    case send(String)
}

struct ProcessEnded: Error {}

/// The end of a simulated process: from the operation `trip` names on (counted from 1 over every operation on the
/// state store, the log and the transport), every operation fails (reads and writes throw, sends send nothing and are
/// answered nil at once). The test then discards the `PushSync` and starts a new one over the same files.
/// An operation `transient` names fails alone and the process goes on (a write or read error, CODEX-IN04-11).
final class ProcessEnd: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    private var ended = false
    private var failures = 0
    private var calm = false
    private let trip: @Sendable (Operation, Int) -> Bool
    private let transient: @Sendable (Operation, Int) -> Bool

    init(_ trip: @escaping @Sendable (Operation, Int) -> Bool = { _, _ in false },
         transient: @escaping @Sendable (Operation, Int) -> Bool = { _, _ in false }) {
        self.trip = trip
        self.transient = transient
    }

    /// No operation fails alone from now on.
    func stopFailing() { lock.withLock { calm = true } }

    /// Operations that failed alone so far.
    var transientFailures: Int { lock.withLock { failures } }

    /// Ends at operation `k` (nil: never).
    static func at(_ k: Int?) -> ProcessEnd { ProcessEnd { _, n in n == k } }

    var operations: Int { lock.withLock { count } }
    var hasEnded: Bool { lock.withLock { ended } }

    /// Ends the process now (the system ended it between operations).
    func endNow() { lock.withLock { ended = true } }

    /// False from the tripping operation on.
    func allow(_ op: Operation) -> Bool {
        lock.withLock {
            if ended { return false }
            count += 1
            if trip(op, count) { ended = true }
            if !ended && !calm && transient(op, count) {
                failures += 1
                return false
            }
            return !ended
        }
    }
}

struct EndingStore: PushStateStore {
    let inner: AppStateStore
    let end: ProcessEnd

    func load() throws -> AppState? {
        guard end.allow(.load) else { throw ProcessEnded() }
        return try inner.load()
    }

    func save(_ state: AppState) throws {
        guard end.allow(.save) else { throw ProcessEnded() }
        try inner.save(state)
    }
}

struct EndingLog: PushLogStore {
    let inner: PushReplacementLog
    let end: ProcessEnd

    func entries() throws -> [PushReplacementLog.Entry] {
        guard end.allow(.entries) else { throw ProcessEnded() }
        return try inner.entries()
    }

    func append(old: String?, new: String) throws -> PushReplacementLog.Entry {
        guard end.allow(.append) else { throw ProcessEnded() }
        return try inner.append(old: old, new: new)
    }

    func acknowledge(_ id: Int) throws {
        guard end.allow(.acknowledge) else { throw ProcessEnded() }
        try inner.acknowledge(id)
    }
}

struct EndingTransport: PushTransport {
    let inner: any PushTransport
    let end: ProcessEnd

    func start(_ request: PushRequest) -> PushReply {
        guard end.allow(.send(request.method)) else { return .finished(nil) }
        return inner.start(request)
    }
}

extension Files {
    /// A process over these files whose dependencies end as `end` says.
    func process<C: Clock<Duration>>(_ transport: any PushTransport, end: ProcessEnd, clock: C,
                                     repostDelay: Duration = .seconds(3)) -> PushSync {
        PushSync(store: EndingStore(inner: store, end: end), log: EndingLog(inner: log, end: end),
                 transport: EndingTransport(inner: transport, end: end), repostDelay: repostDelay, clock: clock,
                 context: Files.context)
    }
}

/// A deterministic random source for the property test (SplitMix64).
struct SeededRandom: RandomNumberGenerator {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
