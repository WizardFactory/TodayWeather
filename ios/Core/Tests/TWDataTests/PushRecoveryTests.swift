import Foundation
import Testing
import TWData
import TWModel
import TWStorage

/// Crash recovery of token replacements against a model of the legacy server (IN-04 review rounds 3–4,
/// CODEX-IN04-4..7): the oracle is the server's records. Requests reach the server only when the test delivers them;
/// a process ends through its dependencies (`ProcessEnd`), and a new `PushSync` then runs over the same files.
struct PushRecoveryTests {
    struct Run {
        let server: ServerModel
        let files: Files
        let operations: Int
    }

    /// Process 1 on the Cordova timeline: stored token A, the server's records under A; the open at 0 s gets token B
    /// from FCM, token C arrives at 1 s, the list post at 3 s, token B again at 4 s. Its requests reach the server in
    /// the order they were sent (without `seed` all at once after each event, with `seed` a random number of them
    /// after each event). It ends at operation `endAt` (nil: never); of the requests it sent and the server has not
    /// got, a prefix is then delivered and the rest lost (without `seed` all lost). Process 2 then starts, opens with
    /// FCM's token B, and its requests are delivered in send order.
    static func run(endAt: Int?, seed: UInt64?) async throws -> Run {
        let files = Files()
        try files.seed(token: "token-a")
        let server = seededServer(token: "token-a")
        var rng = SeededRandom(seed: seed ?? 0)
        let clock = VirtualClock()
        let first = DeliveredServerTransport(server: server)
        let end = ProcessEnd.at(endAt)
        let p1 = files.process(first, end: end, clock: clock)
        func deliverSome() {
            let pending = first.pending
            let n = seed == nil ? pending.count : Int.random(in: 0...pending.count, using: &rng)
            for i in pending.prefix(n) { first.deliver(i) }
        }
        let open = Task { await p1.open { "token-b" } }
        _ = await eventually { let started = await p1.openStarts == 1; return started || end.hasEnded }
        deliverSome()
        clock.advance(to: .seconds(1))
        await p1.tokenArrived("token-c")
        deliverSome()
        clock.advance(to: .seconds(3))
        _ = await eventually { let posted = await p1.reposts == 1; return posted || end.hasEnded }
        deliverSome()
        clock.advance(to: .seconds(4))
        await p1.tokenArrived("token-b")
        if end.hasEnded {
            // The server still gets a prefix of what the ended process sent, in send order (the live-send model:
            // Cordova's concurrent requests are applied in the order they were sent).
            let pending = first.pending
            let reached = seed == nil ? 0 : Int.random(in: 0...pending.count, using: &rng)
            for (n, i) in pending.enumerated() {
                if n < reached { first.deliver(i) } else { first.drop(i) }
            }
        } else {
            for i in first.pending { first.deliver(i) }
        }
        _ = await eventually { await p1.pendingReplies == 0 }
        clock.advance(to: .seconds(60))
        _ = await open.value

        let second = DeliveredServerTransport(server: server)
        let p2 = files.sync(second)
        await p2.start()
        // In send order: the legacy store's `PUT` and upsert do not commute (a list post applied before the
        // replacement it followed leaves two documents per record), so live sends are applied as sent, the model of
        // `PushPropertyTests`.
        await openPumped(p2, second, token: "token-b")
        return Run(server: server, files: files, operations: end.operations)
    }

    static func expectConverged(_ run: Run, _ label: String) {
        #expect(run.server.issues(newest: "token-b").isEmpty, "\(run.server.issues(newest: "token-b"))")
        #expect(run.files.logEntries.isEmpty, "\(label): log \(run.files.logEntries)")
        #expect(run.files.storedToken == "token-b", "\(label): state token")
    }

    /// Ending process 1 at every operation on its state store, log and transport (reads, the log append, the state
    /// write, each send, each acknowledgement), restarting and delivering everything gives the outcome without the
    /// crash: every record once under the final token, an empty log and the final token in the state.
    @Test func everyCrashPointConverges() async throws {
        let clean = try await Self.run(endAt: nil, seed: nil)
        Self.expectConverged(clean, "without a crash")
        #expect(clean.operations >= 20, "operations: \(clean.operations)")
        for k in 1...clean.operations {
            Self.expectConverged(try await Self.run(endAt: k, seed: nil), "ended at operation \(k)")
        }
    }

    /// Random crash points, random delivery timing in process 1 (in send order), random loss of what process 1 sent
    /// before it ended (a prefix still reaches the server), then process 2: the server always converges to one
    /// document per record.
    @Test func randomCrashesAndDeliveryOrdersConverge() async throws {
        let bound = try await Self.run(endAt: nil, seed: nil).operations
        var rng = SeededRandom(seed: 2953)
        for _ in 0..<150 {
            let seed = rng.next()
            let k = Int.random(in: 1...(bound + 5), using: &rng)
            Self.expectConverged(try await Self.run(endAt: k, seed: seed), "seed \(seed), ended at operation \(k)")
        }
    }

    // MARK: - The reviewer's reproductions

    /// CODEX-IN04-6, -12, -13, -14: the server holds the records under B, the log A→B, B→C, C→B (state B). The
    /// recovery sends no replacement again and removes nothing: only the list post with the newest token B, one
    /// document per record under B.
    @Test func codexIn04_12_theRecoveryOnlyPostsTheNewestToken() async throws {
        let files = Files()
        try files.seed(token: "token-b")
        let server = seededServer(token: "token-b")
        try files.log.append(old: "token-a", new: "token-b")
        try files.log.append(old: "token-b", new: "token-c")
        try files.log.append(old: "token-c", new: "token-b")
        let transport = DeliveredServerTransport(server: server)
        let sync = files.sync(transport)
        await sync.start()
        #expect(await eventually { transport.pending.count == 1 })
        try await Task.sleep(for: .milliseconds(30))
        #expect(await pump(transport, sync))
        #expect(summary(transport.requests) == ["POST token-b"])
        #expect(server.issues(newest: "token-b").isEmpty, "\(server.issues(newest: "token-b"))")
        #expect(files.logEntries.isEmpty)
    }

    /// CODEX-IN04-4: a first token B was logged and stored, and the process ended before its list post. A process
    /// start alone (no open) recovers it: the list with B (no other token to remove).
    @Test func codexIn04_4_firstTokenRecoveryPostsTheListWithoutAnOpen() async throws {
        let files = Files()
        try files.seed(token: nil)
        let server = ServerModel()
        let first = DeliveredServerTransport(server: server)
        let p1 = files.process(first, end: ProcessEnd { op, _ in op == .send("POST") }, clock: ContinuousClock())
        await p1.tokenArrived("token-b")
        #expect(first.requests.map(\.request.method) == ["PUT"], "the list post never left")
        first.dropAll()
        let transport = DeliveredServerTransport(server: server)
        let p2 = files.sync(transport)
        await p2.start()
        #expect(await pump(transport, p2))
        #expect(summary(transport.requests) == ["POST token-b"])
        #expect(server.issues(newest: "token-b").isEmpty, "\(server.issues(newest: "token-b"))")
        #expect(files.storedToken == "token-b")
        #expect(files.logEntries.isEmpty)
    }

    /// CODEX-IN04-4 (round 3): the process ends after the log took B←A and before the state did. The next process
    /// derives B and recovers the entry (the list with B; A's documents stay, as Cordova leaves them); the next token
    /// C is replaced over B.
    @Test func codexIn04_4_endBetweenLogAndStateCompletesTheTransition() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let server = seededServer(token: "token-a")
        let p1 = files.process(DeliveredServerTransport(server: server), end: ProcessEnd { op, _ in op == .save },
                               clock: ContinuousClock())
        #expect(await p1.tokenArrived("token-b").isEmpty, "nothing sent")
        #expect(files.storedToken == "token-a")
        let transport = DeliveredServerTransport(server: server)
        let p2 = files.sync(transport)
        await p2.start()
        #expect(files.storedToken == "token-b", "the state completes the transition")
        #expect(await pump(transport, p2))
        #expect(summary(transport.requests) == ["POST token-b"])
        await p2.tokenArrived("token-c")
        await openPumped(p2, transport, token: "token-c")
        #expect(transport.requests.map { replacement($0.request) }.filter { !$0.isEmpty } == [["token-c", "token-b"]])
        #expect(server.issues(newest: "token-c").isEmpty, "\(server.issues(newest: "token-c"))")
        #expect(files.logEntries.isEmpty)
    }

    /// CODEX-IN04-5: B←A (lost), C←B and D←C in flight; D←C answers first and the process ends. Its reply
    /// acknowledged its own entry and entries leave only as an acknowledged prefix, so the next process recovers all
    /// three with the list with D; the records end once under D.
    @Test func codexIn04_5_repliesAcknowledgeTheirOwnEntry() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let server = seededServer(token: "token-a")
        let first = DeliveredServerTransport(server: server)
        let p1 = files.sync(first)
        for token in ["token-b", "token-c", "token-d"] { await p1.tokenArrived(token) }
        #expect(first.requests.count == 3)
        first.deliver(2) // D←C answers first
        #expect(await eventually { files.logEntries.map(\.acked) == [false, false, true] })
        // Process 1 ends here: B←A never reaches the server and its other replies never reach process 1.
        let second = DeliveredServerTransport(server: server)
        let p2 = files.sync(second)
        await p2.start()
        #expect(await pump(second, p2))
        #expect(summary(second.requests) == ["POST token-d"])
        await openPumped(p2, second, token: "token-d")
        #expect(server.issues(newest: "token-d").isEmpty, "\(server.issues(newest: "token-d"))")
        #expect(files.logEntries.isEmpty)
        #expect(files.storedToken == "token-d")
        first.dropAll() // the simulated process 1 is still in memory: no task stays suspended
        #expect(await eventually { await p1.pendingReplies == 0 })
    }

    /// A value that held the records before and comes back is not replaced onto (the move could join documents still
    /// under it): B←A fails, B is registered by a list post, then A again is recovered with the list with A, one
    /// document per record under A (B's documents stay, as in Cordova).
    @Test func aReturningTokenIsPostedNotReplacedOnto() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let server = seededServer(token: "token-a")
        let transport = DeliveredServerTransport(server: server)
        let sync = files.sync(transport)
        await sync.tokenArrived("token-b")
        // The replacement B←A fails: A's documents stay (as in Cordova), and a later list post registers B.
        #expect(await eventually { transport.pending.count == 1 })
        transport.drop(0)
        server.apply(PushRegistration.postList(PushState(type: "ios", fcmToken: "token-b", records: Files.records),
                                               context: Files.context(AppState())!))
        await sync.tokenArrived("token-a")
        #expect(await pump(transport, sync))
        #expect(summary(transport.requests) == ["PUT token-b", "POST token-a"], "no PUT onto A's documents")
        #expect(server.issues(newest: "token-a").isEmpty, "\(server.issues(newest: "token-a"))")
        #expect(files.storedToken == "token-a")
        #expect(files.logEntries.isEmpty)
    }

    /// CODEX-IN04-4 (round 5): a recovered entry is acknowledged only when the recovery's requests replied; a process
    /// that ends before the list post's reply leaves the entry, and the next process recovers it again, a start alone
    /// included.
    @Test func codexIn04_4_aRecoveredEntryWaitsForItsListPost() async throws {
        let files = Files()
        try files.seed(token: "token-b")
        try files.log.append(old: nil, new: "token-b")
        let server = ServerModel()
        let first = DeliveredServerTransport(server: server)
        let end = ProcessEnd()
        let p1 = files.process(first, end: end, clock: ContinuousClock())
        await p1.start()
        #expect(await eventually { first.requests.count == 1 })
        try await Task.sleep(for: .milliseconds(50))
        #expect(files.logEntries.map(\.acked) == [false], "not acknowledged while the list post waits")
        end.endNow() // the process ends; its list post never reached the server
        first.drop(0)
        let second = DeliveredServerTransport(server: server)
        let p2 = files.sync(second)
        await p2.start()
        #expect(await pump(second, p2))
        #expect(summary(second.requests) == ["POST token-b"])
        #expect(server.issues(newest: "token-b").isEmpty, "\(server.issues(newest: "token-b"))")
        #expect(files.logEntries.isEmpty)
    }

    /// CODEX-IN04-8: the open reads the token from the SDK while token C arrives through the callback; the read then
    /// returns the older B. The value is dropped (an observation was handled during the read), so nothing reverts to B.
    @Test func codexIn04_8_aTokenReadDuringACallbackIsDropped() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let server = seededServer(token: "token-a")
        let transport = DeliveredServerTransport(server: server)
        let sync = files.sync(transport)
        let read = ProviderRead()
        let open = Task { await sync.open { await read.value() } }
        #expect(await eventually { read.isWaiting })
        await sync.tokenArrived("token-c")
        read.resolve("token-b")
        for _ in 0..<20 {
            #expect(await pump(transport, sync))
            try await Task.sleep(for: .milliseconds(5))
        }
        let outcome = await open.value
        #expect(outcome?.requests.map(\.method) == ["POST"], "only the list post: \(String(describing: outcome?.requests))")
        #expect(transport.requests.compactMap { r -> [String?]? in
            let x = replacement(r.request)
            return x.isEmpty ? nil : x
        } == [["token-c", "token-a"]])
        #expect(server.issues(newest: "token-c").isEmpty, "\(server.issues(newest: "token-c"))")
        #expect(files.storedToken == "token-c")
        #expect(files.logEntries.isEmpty)
    }

    /// CODEX-IN04-9: a stored token "" is no token (Cordova's `!fcmToken`), in a recovery as on the normal path. The
    /// first token B over "" was logged and the process ended before its list post; a start alone recovers it with the
    /// list with B and removes nothing ("" names no token).
    @Test func codexIn04_9_anEmptyStoredTokenRecoversAsAFirstToken() async throws {
        let files = Files()
        try files.seed(token: "")
        let server = ServerModel()
        let first = DeliveredServerTransport(server: server)
        let p1 = files.process(first, end: ProcessEnd { op, _ in op == .send("POST") }, clock: ContinuousClock())
        await p1.tokenArrived("token-b")
        #expect(first.requests.map { replacement($0.request) } == [["token-b", ""]], "the list post never left")
        first.dropAll()
        let transport = DeliveredServerTransport(server: server)
        let p2 = files.sync(transport)
        await p2.start()
        #expect(await pump(transport, p2))
        #expect(summary(transport.requests) == ["POST token-b"])
        #expect(server.issues(newest: "token-b").isEmpty, "\(server.issues(newest: "token-b"))")
        #expect(files.storedToken == "token-b")
        #expect(files.logEntries.isEmpty)
    }

    /// CODEX-IN04-10: a blank token callback is ignored (Cordova's `token.trim().length === 0`), so it is no
    /// observation either: the open's SDK read B that overlapped it is kept.
    @Test func codexIn04_10_aBlankCallbackDoesNotDropTheRead() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let server = seededServer(token: "token-a")
        let transport = DeliveredServerTransport(server: server)
        let sync = files.sync(transport)
        let read = ProviderRead()
        let open = Task { await sync.open { await read.value() } }
        #expect(await eventually { read.isWaiting })
        #expect(await sync.tokenArrived(" \t").isEmpty)
        read.resolve("token-b")
        for _ in 0..<20 {
            #expect(await pump(transport, sync))
            try await Task.sleep(for: .milliseconds(5))
        }
        _ = await open.value
        #expect(transport.requests.compactMap { r -> [String?]? in
            let x = replacement(r.request)
            return x.isEmpty ? nil : x
        } == [["token-b", "token-a"]])
        #expect(server.issues(newest: "token-b").isEmpty, "\(server.issues(newest: "token-b"))")
        #expect(files.storedToken == "token-b")
        #expect(files.logEntries.isEmpty)
    }

    /// CODEX-IN04-11: server and state at B, log A→B, B→C, C→B (only the last answered). The open's start of the
    /// recovery fails once (the log cannot be read) and the open gets C. The new hop C←B is not sent on its own: the
    /// next event starts the recovery, which handles it with the others (the list with C), and the list post that
    /// falls due waits for it. Records end once under C.
    @Test func codexIn04_11_aRecoveryThatCouldNotStartHoldsNewHopsBack() async throws {
        let files = Files()
        try files.seed(token: "token-b")
        for (old, new) in [("token-a", "token-b"), ("token-b", "token-c"), ("token-c", "token-b")] {
            _ = try files.log.append(old: old, new: new)
        }
        try files.log.acknowledge(3)
        let server = seededServer(token: "token-b")
        let transport = DeliveredServerTransport(server: server)
        let reads = OperationCounter()
        // The open reads the log for its state, then for the recovery: that second read fails once.
        let failsOnce = ProcessEnd(transient: { op, _ in op == .entries && reads.next() == 2 })
        let sync = PushSync(store: files.store, log: EndingLog(inner: files.log, end: failsOnce), transport: transport,
                            repostDelay: .zero, context: Files.context)
        await openPumped(sync, transport, token: "token-c")
        #expect(failsOnce.transientFailures == 1)
        let sent = summary(transport.requests)
        #expect(!sent.contains { $0.hasPrefix("PUT") }, "no replacement on its own: \(sent)")
        #expect(!sent.isEmpty && sent.allSatisfy { $0 == "POST token-c" }, "\(sent)")
        #expect(server.issues(newest: "token-c").isEmpty, "\(server.issues(newest: "token-c"))")
        #expect(files.storedToken == "token-c")
        #expect(files.logEntries.isEmpty)
    }

    /// CODEX-IN04-12: no stored token (nil or ""), first token B: the PUT (403) and the list post B, which the server
    /// applies without the reply arriving; then C over B, applied and answered. The process ends with the log
    /// [B over none (open), C over B (answered)]. A start alone recovers without posting B again: only the list with
    /// C, so the records stay one document each under C, also after an open with C.
    @Test(arguments: [nil, ""] as [String?])
    func codexIn04_12_aFirstTokenRecoveryPostsOnlyTheNewestToken(_ none: String?) async throws {
        let files = Files()
        try files.seed(token: none)
        let server = ServerModel()
        let first = DeliveredServerTransport(server: server)
        let p1 = files.sync(first)
        await p1.tokenArrived("token-b")
        #expect(first.requests.map(\.request.method) == ["PUT", "POST"])
        first.deliver(0)                     // the 403
        server.apply(first.requests[1].request) // the list post B reaches the server, its reply does not
        await p1.tokenArrived("token-c")
        #expect(await eventually { first.pending.count == 2 })
        first.deliver(2)                     // C over B, applied and answered
        #expect(await eventually { files.logEntries.map(\.acked) == [false, true] })
        // Process 1 ends here.
        let second = DeliveredServerTransport(server: server)
        let p2 = files.sync(second)
        await p2.start()
        #expect(await pump(second, p2))
        #expect(summary(second.requests) == ["POST token-c"])
        #expect(server.issues(newest: "token-c").isEmpty, "\(server.issues(newest: "token-c"))")
        #expect(files.logEntries.isEmpty)
        await openPumped(p2, second, token: "token-c")
        #expect(server.issues(newest: "token-c").isEmpty, "\(server.keys)")
        #expect(files.storedToken == "token-c")
        first.dropAll()
    }

    /// While a recovery runs, a new token is logged and recovered after the entries before it (the list with C), and
    /// the list post that falls due waits for the recovery.
    @Test func eventsDuringARecoveryWaitTheirTurn() async throws {
        let files = Files()
        try files.seed(token: "token-b")
        let server = seededServer(token: "token-a")
        try files.log.append(old: "token-a", new: "token-b")
        let transport = DeliveredServerTransport(server: server)
        let sync = files.sync(transport)
        await sync.start()
        #expect(await eventually { transport.pending.count == 1 })
        #expect(await sync.tokenArrived("token-c").isEmpty, "recovered in its turn")
        let open = Task { await sync.open { "token-c" } }
        _ = await eventually { await sync.reposts == 1 }
        #expect(transport.pending.count == 1, "still only the recovery's first post")
        for _ in 0..<50 {
            #expect(await pump(transport, sync))
            try await Task.sleep(for: .milliseconds(5))
        }
        _ = await open.value
        #expect(summary(transport.requests) ==
                ["POST token-b", "POST token-c", "POST token-c"])
        #expect(server.issues(newest: "token-c").isEmpty, "\(server.issues(newest: "token-c"))")
        #expect(files.logEntries.isEmpty)
    }
}

/// Counts calls: 1, 2, 3 …
final class OperationCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    func next() -> Int { lock.withLock { count += 1; return count } }
}

/// `METHOD token` of each request: the new token of a replacement, the token of a list post.
func summary(_ sent: [DeliveredServerTransport.Sent]) -> [String] {
    sent.map { s in
        let r = s.request
        let token = r.method == "POST" ? r.body[0]?["fcmToken"]?.stringValue : r.body["newToken"]?.stringValue
            ?? r.body["fcmToken"]?.stringValue
        return "\(r.method) \(token ?? "-")"
    }
}
