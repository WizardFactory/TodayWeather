import Foundation
import Testing
import TWData
import TWModel
import TWStorage

/// The network between the app and the legacy server for the property test: the server applies requests in the order
/// they were sent (one client, one server); replies come back in any order, and a reply can be lost after the server
/// applied the request. When a process ends, the server still applies a prefix of what it had sent; the rest is lost.
final class FIFONetwork: @unchecked Sendable {
    struct Sent {
        let process: Int
        let request: PushRequest
        let reply: PushReply
        var status: Int?
        var applied = false
        var lost = false
        var replied = false
    }

    struct Link: PushTransport {
        let network: FIFONetwork
        let process: Int
        func start(_ request: PushRequest) -> PushReply { network.send(request, from: process) }
    }

    private let lock = NSLock()
    private var sent: [Sent] = []
    let server: ServerModel
    /// A first token's list post was lost after its replacement had been answered (the signature of CODEX-IN04-4).
    private(set) var firstTokenPostLostAfterItsReplacement = false

    init(server: ServerModel) { self.server = server }

    func transport(_ process: Int) -> any PushTransport { Link(network: self, process: process) }

    func send(_ request: PushRequest, from process: Int) -> PushReply {
        let reply = PushReply()
        lock.withLock { sent.append(Sent(process: process, request: request, reply: reply)) }
        return reply
    }

    var unapplied: [Int] { lock.withLock { sent.indices.filter { !sent[$0].applied && !sent[$0].lost } } }
    var unreplied: [Int] { lock.withLock { sent.indices.filter { sent[$0].applied && !sent[$0].replied } } }
    var isIdle: Bool { unapplied.isEmpty && unreplied.isEmpty }
    var requests: [PushRequest] { lock.withLock { sent.map(\.request) } }

    /// Every request as `pN METHOD token → status` (applied), `→ lost` or `→ waiting`, for a failure's trace.
    var log: [String] {
        lock.withLock {
            sent.map { s in
                let r = s.request
                let token = r.method == "POST" ? r.body[0]?["fcmToken"]?.stringValue
                    : (r.body["newToken"]?.stringValue).map { n in "\(r.body["oldToken"]?.stringValue ?? "null")→\(n)" }
                    ?? r.body["fcmToken"]?.stringValue
                let fate = s.applied ? "\(s.status.map(String.init) ?? "?")" : s.lost ? "lost" : "waiting"
                return "p\(s.process) \(r.method) \(token ?? "-") → \(fate)"
            }
        }
    }

    /// The server applies the oldest request it has not applied.
    @discardableResult
    func applyNext() -> Bool {
        let next: Int? = lock.withLock { sent.indices.first { !sent[$0].applied && !sent[$0].lost } }
        guard let next else { return false }
        let request = lock.withLock { sent[next].request }
        let status = server.apply(request)
        lock.withLock {
            sent[next].applied = true
            sent[next].status = status
        }
        return true
    }

    /// The reply of applied request `i`: its status, or nil when the reply is lost.
    func reply(_ i: Int, delivered: Bool) {
        let s: Sent? = lock.withLock {
            guard sent[i].applied, !sent[i].replied else { return nil }
            sent[i].replied = true
            return sent[i]
        }
        s?.reply.finish(delivered ? s?.status : nil)
    }

    /// Process `p` ended: the server still applies its next `applying` requests in order; the rest are lost, and no
    /// reply reaches the process any more.
    func end(_ p: Int, applying: Int) {
        for _ in 0..<applying {
            guard let next = unapplied.first, lock.withLock({ sent[next].process == p }) else { break }
            applyNext()
        }
        let finished: [PushReply] = lock.withLock {
            var out: [PushReply] = []
            for i in sent.indices where sent[i].process == p {
                if !sent[i].applied && !sent[i].lost {
                    sent[i].lost = true
                    let r = sent[i].request
                    if r.method == "POST", let token = r.body[0]?["fcmToken"]?.stringValue,
                       sent.contains(where: { $0.replied && $0.request.method == "PUT"
                           && ($0.request.body["oldToken"] == .null || $0.request.body["oldToken"] == "") && $0.request.body["newToken"]?.stringValue == token }) {
                        firstTokenPostLostAfterItsReplacement = true
                    }
                    out.append(sent[i].reply)
                } else if sent[i].applied && !sent[i].replied {
                    sent[i].replied = true
                    out.append(sent[i].reply)
                }
            }
            return out
        }
        for r in finished { r.finish(nil) }
    }
}

/// The SDK's current token as `open()` reads it: the read takes as long as the test lets it, and returns FCM's token
/// at the moment it ends. The continuation is resumed exactly once.
final class ProviderRead: @unchecked Sendable {
    private let lock = NSLock()
    private var waiter: CheckedContinuation<String?, Never>?
    private var result: String??

    var isWaiting: Bool { lock.withLock { waiter != nil } }
    var isDone: Bool { lock.withLock { result != nil } }

    func value() async -> String? {
        await withCheckedContinuation { c in
            let ready: String?? = lock.withLock {
                if let result { return result }
                waiter = c
                return nil
            }
            if let ready { c.resume(returning: ready) }
        }
    }

    func resolve(_ token: String?) {
        let w: CheckedContinuation<String?, Never>? = lock.withLock {
            guard result == nil else { return nil }
            result = .some(token)
            defer { waiter = nil }
            return waiter
        }
        w?.resume(returning: token)
    }
}

final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    var isSet: Bool { lock.withLock { value } }
    func set() { lock.withLock { value = true } }
}

/// The property test over every event source (IN-04 review rounds 5–6): token changes and their callbacks at any time
/// (also during the open's token read and during a recovery), a launch with or without FCM's callback, blank callbacks
/// and reads (ignored by Cordova), single failed reads and writes of the state and the log in a process that goes on,
/// the open's read latency, first tokens over nil or "" and replacements,
/// replies in any order (lost ones and the 403 of a replacement without an old token), and process ends at any
/// operation, over up to three processes; the last one runs until nothing moves (it may never be opened). Oracle:
/// every record once on the server under the newest token FCM gave, an empty log, and that token in the state.
struct PushPropertyTests {
    struct Outcome {
        let seed: UInt64
        let failures: [String]
        let raceDuringOpenRead: Bool
        let firstTokenPostLost: Bool
        let trace: [String]
    }

    /// Token values the Cordova callback ignores (`token.trim().length === 0`).
    static let blanks = ["", " \t", "\u{3000}", "\n"]

    static func settle(_ sync: PushSync) async {
        for _ in 0..<4 {
            await Task.yield()
            _ = await sync.isRecovering
        }
        try? await Task.sleep(for: .milliseconds(1))
    }

    static func run(seed: UInt64) async throws -> Outcome {
        var rng = SeededRandom(seed: seed)
        var trace: [String] = []
        let files = Files()
        let firstToken = Bool.random(using: &rng)
        // No token is nil or "" (Cordova's `!fcmToken`; a migrated "" stays "", CODEX-IN04-9).
        let initial: String? = firstToken ? (Bool.random(using: &rng) ? nil : "") : "token-a"
        try files.seed(token: initial)
        let server = firstToken ? ServerModel() : seededServer(token: "token-a")
        let network = FIFONetwork(server: server)
        var fcm: String? = firstToken ? nil : "token-a"
        var changes = 0
        var race = false
        let processes = Int.random(in: 1...3, using: &rng)
        trace.append("first token: \(firstToken) (stored \(initial.map { "\"\($0)\"" } ?? "nil")), processes: \(processes)")
        var total = processes
        var p = 0
        while p < total {
            defer { p += 1 }
            let last = p == total - 1
            // Single reads and writes of the state and the log may fail while the process goes on (CODEX-IN04-11);
            // in the last process only before it runs until nothing moves. A last process that had such failures
            // is followed by one more launch without them (the next start recovers what waits).
            let failureRate = p < processes ? [0, 10, 25, 50].randomElement(using: &rng)! : 0
            let failing: Set<Int> = Set((1...200).filter { _ in Int.random(in: 0..<100, using: &rng) < failureRate })
            let endAt = Int.random(in: 1...80, using: &rng)
            let end = ProcessEnd({ _, n in !last && n == endAt }, transient: { op, n in
                failing.contains(n) && op != .send("PUT") && op != .send("POST")
            })
            if !failing.isEmpty { trace.append("p\(p): \(failureRate)% of reads and writes fail alone") }
            let clock = VirtualClock()
            var now = Duration.zero
            let sync = files.process(network.transport(p), end: end, clock: clock)
            // FCM may call the token callback with its current token at a launch; otherwise only the open's read
            // gives it (Cordova's `getToken`), so then the last process opens and its read returns a token.
            let launchCallback = Bool.random(using: &rng)
            var callbacks: [String] = launchCallback ? fcm.map { [$0] } ?? [] : []
            let readMayBeBlank = !last || launchCallback
            var read: ProviderRead?
            var openTask: Task<PushSync.Outcome?, Never>?
            let openDone = Flag()
            // The SDK's value is taken somewhere between the start and the end of the read: FCM's token then.
            var tokenAtReadStart: String?
            func readValue(_ rng: inout SeededRandom) -> String? {
                switch Int.random(in: readMayBeBlank ? 0..<5 : 1..<5, using: &rng) {
                case 0: Self.blanks.randomElement(using: &rng)
                case 1, 2: tokenAtReadStart
                default: fcm
                }
            }
            let opens = Bool.random(using: &rng) || (last && !launchCallback)
            func startOpen() async {
                let r = ProviderRead()
                read = r
                tokenAtReadStart = fcm
                openTask = Task {
                    let o = await sync.open { await r.value() }
                    openDone.set()
                    return o
                }
                _ = await eventually(seconds: 2) { r.isWaiting || openDone.isSet }
                trace.append("p\(p): open, reading the token")
            }
            trace.append("p\(p): log \(files.logEntries.map { "\($0.id):\($0.old ?? "-")→\($0.new)\($0.acked ? " acked" : "")" }), state \(files.storedToken ?? "nil")")
            await sync.start()
            trace.append("p\(p): start (opens: \(opens), launch callback: \(launchCallback))")
            for _ in 0..<Int.random(in: 6...28, using: &rng) where !end.hasEnded {
                switch Int.random(in: 0..<10, using: &rng) {
                case 0 where changes < 4:
                    let pool: [String] = ["token-b", "token-c", "token-d", "token-a"]
                    let next: String = pool.filter { $0 != fcm }.randomElement(using: &rng)!
                    fcm = next
                    changes += 1
                    callbacks.append(next)
                    trace.append("p\(p): FCM token \(next)")
                case 1 where !callbacks.isEmpty:
                    let token = callbacks.removeFirst()
                    let starts = await sync.openStarts
                    let duringRead = read != nil && starts == 0 && !openDone.isSet
                    if duringRead { race = true }
                    trace.append("p\(p): callback \(token)\(duringRead ? " during the open's read" : "")")
                    await sync.tokenArrived(token)
                case 2 where opens && openTask == nil:
                    await startOpen()
                case 3 where read?.isDone == false:
                    let value = readValue(&rng)
                    trace.append("p\(p): the read returns \(value ?? "nil")")
                    read?.resolve(value)
                case 8:
                    // A blank token callback, which Cordova ignores (CODEX-IN04-10).
                    let blank = Self.blanks.randomElement(using: &rng)!
                    callbacks.append(blank)
                    trace.append("p\(p): FCM blank \(blank.debugDescription)")
                case 4:
                    now += .milliseconds(Int.random(in: 300...2500, using: &rng))
                    clock.advance(to: now)
                case 5:
                    if network.applyNext() { trace.append("p\(p): server applies \(network.requests.count) sent") }
                case 6, 7:
                    if let i = network.unreplied.randomElement(using: &rng) {
                        let delivered = Int.random(in: 0..<5, using: &rng) > 0
                        network.reply(i, delivered: delivered)
                    }
                default:
                    break
                }
                await Self.settle(sync)
            }
            if !last {
                end.endNow()
                let applying = Int.random(in: 0...4, using: &rng)
                network.end(p, applying: applying)
                trace.append("p\(p): ends (\(end.operations) operations, \(end.transientFailures) failed alone; the server still applies up to \(applying))")
                read?.resolve(readValue(&rng))
                clock.advance(to: .seconds(3600))
                if let openTask { _ = await openTask.value }
                continue
            }
            // The last process runs until nothing moves; one that opens and has not yet opens now.
            end.stopFailing()
            if opens && openTask == nil { await startOpen() }
            for _ in 0..<400 {
                read?.resolve(readValue(&rng))
                while !callbacks.isEmpty {
                    let token = callbacks.removeFirst()
                    let starts = await sync.openStarts
                    let duringRead = read != nil && starts == 0 && !openDone.isSet
                    if duringRead { race = true }
                    trace.append("p\(p): callback \(token)\(duringRead ? " during the open's read" : "")")
                    await sync.tokenArrived(token)
                }
                now += .seconds(10)
                clock.advance(to: now)
                while network.applyNext() {}
                // A launch added to complete what was left gets every reply.
                for i in network.unreplied {
                    network.reply(i, delivered: p >= processes || Int.random(in: 0..<5, using: &rng) > 0)
                }
                await Self.settle(sync)
                let recovering = await sync.isRecovering
                let replies = await sync.pendingReplies
                if network.isIdle, !recovering, replies == 0, openTask == nil || openDone.isSet { break }
            }
            if let openTask { _ = await openTask.value }
            // A last process that had single failures, or that leaves entries for the next start (a recovery
            // request that did not succeed), is followed by one more launch (at most four more in all).
            let leaves = !files.logEntries.isEmpty
            if (end.transientFailures > 0 || leaves) && total < processes + 4 {
                end.endNow()
                network.end(p, applying: 0)
                trace.append("p\(p): ends after \(end.transientFailures) failed alone\(leaves ? ", leaving the log" : ""); one more launch follows")
                total += 1
            }
        }

        var failures: [String] = []
        if let token = fcm {
            if server.tokens != [token] { failures.append("server tokens \(server.tokens.sorted()), expected [\(token)]") }
            if server.records != ["ios/1/1", "ios/1/2"] { failures.append("records \(server.keys.map(\.description).sorted())") }
        } else if !server.keys.isEmpty {
            failures.append("records without a token \(server.keys)")
        }
        if !files.logEntries.isEmpty { failures.append("log \(files.logEntries.map { "\($0.id):\($0.old ?? "-")→\($0.new)" })") }
        let expected = fcm ?? initial
        if files.storedToken != expected {
            failures.append("state token \(files.storedToken ?? "nil"), expected \(expected ?? "nil")")
        }
        if !failures.isEmpty { trace += ["requests:"] + network.log }
        return Outcome(seed: seed, failures: failures, raceDuringOpenRead: race,
                       firstTokenPostLost: network.firstTokenPostLostAfterItsReplacement, trace: trace)
    }

    /// Seeds `TW_PUSH_SEED_START` ..< start + `TW_PUSH_SEEDS` (default 150); with `TW_PUSH_REPORT` the outcome of every
    /// failing seed is written there as JSON.
    @Test func everyInterleavingConverges() async throws {
        let env = ProcessInfo.processInfo.environment
        let count = env["TW_PUSH_SEEDS"].flatMap(Int.init) ?? 150
        let start = env["TW_PUSH_SEED_START"].flatMap(UInt64.init) ?? 1
        var failed: [Outcome] = []
        for seed in start..<(start + UInt64(count)) {
            let outcome = try await Self.run(seed: seed)
            if !outcome.failures.isEmpty { failed.append(outcome) }
        }
        if let path = env["TW_PUSH_REPORT"] {
            let report: [[String: Any]] = failed.map {
                ["seed": $0.seed, "failures": $0.failures, "raceDuringOpenRead": $0.raceDuringOpenRead,
                 "firstTokenPostLostAfterItsReplacement": $0.firstTokenPostLost, "trace": $0.trace]
            }
            let summary: [String: Any] = ["seeds": count, "start": start, "failed": failed.count,
                                          "withRaceDuringOpenRead": failed.filter(\.raceDuringOpenRead).count,
                                          "withFirstTokenPostLost": failed.filter(\.firstTokenPostLost).count,
                                          "failures": report]
            try JSONSerialization.data(withJSONObject: summary, options: [.prettyPrinted, .sortedKeys])
                .write(to: URL(fileURLWithPath: path))
        }
        #expect(failed.isEmpty, "\(failed.count) of \(count) seeds diverge: \(failed.prefix(3).map { "seed \($0.seed): \($0.failures)" })")
    }
}
