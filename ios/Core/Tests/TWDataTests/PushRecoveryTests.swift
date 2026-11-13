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
    /// after each event). It ends at operation `endAt` (nil: never); requests it sent and the server has not got are
    /// then delivered or lost (without `seed` lost). Process 2 then starts, opens with FCM's token B, and its requests
    /// are delivered (with `seed` in a random order among those waiting).
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
            for i in first.pending {
                if seed != nil && Bool.random(using: &rng) { first.deliver(i) } else { first.drop(i) }
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
        var pickRng = SeededRandom(seed: (seed ?? 0) &+ 1)
        await openPumped(p2, second, token: "token-b") { pending in
            seed == nil ? pending[0] : pending.randomElement(using: &pickRng)!
        }
        return Run(server: server, files: files, operations: end.operations)
    }

    static func expectConverged(_ run: Run, _ label: String) {
        #expect(run.server.tokens == ["token-b"], "\(label): tokens on the server \(run.server.keys)")
        #expect(run.server.records == ["ios/1/1", "ios/1/2"], "\(label): each record once \(run.server.keys)")
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
    /// before it ended, and random delivery order in process 2: the server always converges.
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

    /// CODEX-IN04-6: the server holds the records under B, the log A→B, B→C, C→B. The replay sends one entry at a
    /// time, the next when the previous reply arrived, so the server applies them in order and the records stay under
    /// B; with all three at once the server could apply 1, 3, 2 and end at C.
    @Test func codexIn04_6_replayIsSequential() async throws {
        let files = Files()
        try files.seed(token: "token-b")
        let server = seededServer(token: "token-b")
        try files.log.append(old: "token-a", new: "token-b")
        try files.log.append(old: "token-b", new: "token-c")
        try files.log.append(old: "token-c", new: "token-b")
        let transport = DeliveredServerTransport(server: server)
        let sync = files.sync(transport)
        await sync.start()
        var order: [[String?]] = []
        for _ in 0..<10 {
            _ = await eventually { if !transport.pending.isEmpty { return true }; return await !sync.isReplaying }
            let pending = transport.pending
            if pending.isEmpty { break }
            #expect(pending.count == 1, "one replacement in flight at a time: \(pending.count)")
            order.append(replacement(transport.requests[pending.last!].request))
            transport.deliver(pending.last!)
        }
        #expect(order == [["token-b", "token-a"], ["token-c", "token-b"], ["token-b", "token-c"]])
        #expect(server.tokens == ["token-b"], "\(server.keys)")
        #expect(server.records == ["ios/1/1", "ios/1/2"])
        #expect(files.logEntries.isEmpty)
    }

    /// CODEX-IN04-4: a first token B was logged and stored, and the process ended before its list post. A process
    /// start alone (no open) replays it as Cordova's first-token path does: the replacement, then the list with B.
    @Test func codexIn04_4_firstTokenReplayPostsTheListWithoutAnOpen() async throws {
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
        #expect(transport.requests.map(\.request.method) == ["PUT", "POST"])
        #expect(server.tokens == ["token-b"])
        #expect(server.records == ["ios/1/1", "ios/1/2"])
        #expect(files.storedToken == "token-b")
        #expect(files.logEntries.isEmpty)
    }

    /// CODEX-IN04-4 (round 3): the process ends after the log took B←A and before the state did. The next process
    /// derives B, replays B←A, and the next token C is sent over B.
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
        await p2.tokenArrived("token-c")
        await openPumped(p2, transport, token: "token-c")
        #expect(transport.requests.map { replacement($0.request) }.filter { !$0.isEmpty } ==
                [["token-b", "token-a"], ["token-c", "token-b"]])
        #expect(server.tokens == ["token-c"], "\(server.keys)")
        #expect(server.records == ["ios/1/1", "ios/1/2"])
        #expect(files.logEntries.isEmpty)
    }

    /// CODEX-IN04-5: B←A (lost), C←B and B←C in flight; B←C answers first and the process ends. Its reply
    /// acknowledged its own entry and entries leave only as an acknowledged prefix, so the next process replays all
    /// three in order and the records end under B once.
    @Test func codexIn04_5_repliesAcknowledgeTheirOwnEntry() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let server = seededServer(token: "token-a")
        let first = DeliveredServerTransport(server: server)
        let p1 = files.sync(first)
        for token in ["token-b", "token-c", "token-b"] { await p1.tokenArrived(token) }
        first.deliver(2) // B←C answers first
        #expect(await eventually { files.logEntries.map(\.acked) == [false, false, true] })
        // Process 1 ends here: B←A never reaches the server and its other replies never reach process 1.
        let second = DeliveredServerTransport(server: server)
        let p2 = files.sync(second)
        await p2.start()
        #expect(await pump(second, p2))
        #expect(second.requests.map { replacement($0.request) } ==
                [["token-b", "token-a"], ["token-c", "token-b"], ["token-b", "token-c"]])
        await openPumped(p2, second, token: "token-b")
        #expect(server.tokens == ["token-b"], "\(server.keys)")
        #expect(server.records == ["ios/1/1", "ios/1/2"])
        #expect(files.logEntries.isEmpty)
        #expect(files.storedToken == "token-b")
        first.dropAll() // the simulated process 1 is still in memory: no task stays suspended
        #expect(await eventually { await p1.pendingReplies == 0 })
    }

    /// CODEX-IN04-4 (round 5): a first-token unit is complete only when its replacement (403) and its list post both
    /// replied; a process that ends after the 403 and before the post's reply leaves the entry, and the next process
    /// sends the unit again, a start alone included.
    @Test func codexIn04_4_firstTokenUnitEndsWithItsListPost() async throws {
        let files = Files()
        try files.seed(token: "token-b")
        try files.log.append(old: nil, new: "token-b")
        let server = ServerModel()
        let first = DeliveredServerTransport(server: server)
        let end = ProcessEnd()
        let p1 = files.process(first, end: end, clock: ContinuousClock())
        await p1.start()
        #expect(await eventually { first.requests.count == 2 })
        first.deliver(0) // the 403 of PUT(null→B)
        try await Task.sleep(for: .milliseconds(50))
        #expect(files.logEntries.map(\.acked) == [false], "not acknowledged while the list post waits")
        end.endNow() // the process ends; its list post never reached the server
        first.drop(1)
        let second = DeliveredServerTransport(server: server)
        let p2 = files.sync(second)
        await p2.start()
        #expect(await pump(second, p2))
        #expect(second.requests.map(\.request.method) == ["PUT", "POST"])
        #expect(server.tokens == ["token-b"])
        #expect(server.records == ["ios/1/1", "ios/1/2"])
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
        #expect(server.tokens == ["token-c"])
        #expect(server.records == ["ios/1/1", "ios/1/2"])
        #expect(files.storedToken == "token-c")
        #expect(files.logEntries.isEmpty)
    }

    /// While a replay runs, a new token is logged and sent by the replay after the entries before it, and the list
    /// post that falls due waits for the replay.
    @Test func eventsDuringAReplayWaitTheirTurn() async throws {
        let files = Files()
        try files.seed(token: "token-b")
        let server = seededServer(token: "token-a")
        try files.log.append(old: "token-a", new: "token-b")
        let transport = DeliveredServerTransport(server: server)
        let sync = files.sync(transport)
        await sync.start()
        #expect(await eventually { transport.pending.count == 1 })
        #expect(await sync.tokenArrived("token-c").isEmpty, "sent by the replay in its turn")
        let open = Task { await sync.open { "token-c" } }
        _ = await eventually { await sync.reposts == 1 }
        #expect(transport.pending.count == 1, "still only the first replacement")
        for _ in 0..<50 {
            #expect(await pump(transport, sync))
            try await Task.sleep(for: .milliseconds(5))
        }
        _ = await open.value
        #expect(transport.requests.map { "\($0.request.method) \(replacement($0.request))" } ==
                [#"PUT [Optional("token-b"), Optional("token-a")]"#, #"PUT [Optional("token-c"), Optional("token-b")]"#,
                 "POST []"])
        #expect(server.tokens == ["token-c"])
        #expect(server.records == ["ios/1/1", "ios/1/2"])
        #expect(files.logEntries.isEmpty)
    }
}
