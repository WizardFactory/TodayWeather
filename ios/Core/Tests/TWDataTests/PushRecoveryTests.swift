import Foundation
import Testing
import TWData
import TWModel
import TWStorage

/// Counts the steps of a `PushSync` and ends the process after step `crashAt` (nil: never).
final class CrashPlan: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    let crashAt: Int?

    init(crashAt: Int?) { self.crashAt = crashAt }

    var steps: Int { lock.withLock { count } }

    func hook(_ step: PushSync.Step) -> Bool {
        lock.withLock {
            count += 1
            return count == crashAt
        }
    }
}

/// Crash recovery of token replacements against a model of the legacy server (IN-04 review round 3,
/// CODEX-IN04-4..5): the oracle is the server's records, not the requests alone.
struct PushRecoveryTests {
    enum Replies: String, CaseIterable, Sendable {
        /// Each reply at once.
        case atOnce
        /// Every reply held until the end of process 1, then answered newest first.
        case newestFirst
        /// The first replacement reaches the server but its reply is lost (nil); the others answer in order.
        case firstReplyLost
    }

    struct Run {
        let server: ServerModel
        let files: Files
        let steps: Int
    }

    /// Process 1 on the Cordova timeline: the app was stored with token A and the server holds its records under A;
    /// the open at 0 s gets token B from FCM, token C arrives at 1 s, the list post at 3 s, token B again at 4 s.
    /// It ends after step `crashAt` (nil: it does not). Process 2 then starts and opens with FCM's token B, and every
    /// reply arrives.
    static func run(crashAt: Int?, replies: Replies) async throws -> Run {
        let files = Files()
        try files.seed(token: "token-a")
        let server = seededServer(token: "token-a")
        let plan = CrashPlan(crashAt: crashAt)
        let clock = VirtualClock()
        let first = ScriptedServerTransport(server: server, answerAtOnce: { _ in replies == .atOnce })
        let p1 = PushSync(store: files.store, log: files.log, transport: first, clock: clock,
                          crash: { plan.hook($0) }, context: Files.context)
        let open = Task { await p1.open { "token-b" } }
        _ = await eventually { let started = await p1.openStarts == 1; let stopped = await p1.stopped; return started || stopped }
        clock.advance(to: .seconds(1))
        await p1.tokenArrived("token-c")
        clock.advance(to: .seconds(3))
        _ = await eventually { let posted = await p1.reposts == 1; let stopped = await p1.stopped; return posted || stopped }
        clock.advance(to: .seconds(4))
        await p1.tokenArrived("token-b")
        switch replies {
        case .atOnce: break
        case .newestFirst:
            for i in first.requests.indices.reversed() { first.answer(i) }
        case .firstReplyLost:
            for i in first.requests.indices { first.answer(i, status: i == 0 ? .some(nil) : .none) }
        }
        #expect(await eventually { await p1.pendingReplies == 0 })
        _ = await open.value

        let second = ScriptedServerTransport(server: server)
        let p2 = files.sync(second)
        await p2.start()
        _ = await p2.open { "token-b" }
        #expect(await eventually { await p2.pendingReplies == 0 })
        return Run(server: server, files: files, steps: plan.steps)
    }

    static func expectConverged(_ run: Run, _ label: String) {
        #expect(run.server.tokens == ["token-b"], "\(label): tokens on the server \(run.server.keys)")
        #expect(run.server.records == ["ios/1/1", "ios/1/2"], "\(label): each record once \(run.server.keys)")
        #expect(run.files.logEntries.isEmpty, "\(label): log \(run.files.logEntries)")
        #expect(run.files.storedToken == "token-b", "\(label): state token")
    }

    /// For every step boundary of process 1 (log append, state write, send, reply, list post) and each reply
    /// pattern: ending the process there, restarting and letting every reply arrive gives the outcome without the
    /// crash, every record once under the final token, an empty log and the final token in the state.
    @Test(arguments: Replies.allCases)
    func everyCrashPointConverges(replies: Replies) async throws {
        let clean = try await Self.run(crashAt: nil, replies: replies)
        Self.expectConverged(clean, "\(replies) without a crash")
        #expect(clean.steps >= 10, "the timeline has its steps: \(clean.steps)")
        for k in 1...clean.steps {
            Self.expectConverged(try await Self.run(crashAt: k, replies: replies), "\(replies), crash after step \(k)")
        }
    }

    // MARK: - The reviewer's reproductions (round 3)

    /// CODEX-IN04-4: the process ends after the log took B←A and before the state did. The next process completes
    /// the transition (state B), sends B←A again, and the next token C is sent over B, so the list post finds the
    /// records under C only.
    @Test func codexIn04_4_crashBetweenLogAndStateCompletesTheTransition() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let server = seededServer(token: "token-a")
        let p1 = PushSync(store: files.store, log: files.log, transport: ScriptedServerTransport(server: server),
                          clock: ContinuousClock(), crash: { $0 == .logAppended }, context: Files.context)
        #expect(await p1.tokenArrived("token-b").isEmpty, "nothing sent before the crash")
        #expect(files.storedToken == "token-a")
        let transport = ScriptedServerTransport(server: server)
        let p2 = files.sync(transport)
        await p2.start()
        #expect(files.storedToken == "token-b", "the state completes the transition")
        await p2.tokenArrived("token-c")
        _ = await p2.open { "token-c" }
        #expect(await eventually { await p2.pendingReplies == 0 })
        #expect(transport.requests.map { replacement($0.request) }.filter { !$0.isEmpty } ==
                [["token-b", "token-a"], ["token-c", "token-b"]])
        #expect(server.tokens == ["token-c"], "\(server.keys)")
        #expect(server.records == ["ios/1/1", "ios/1/2"])
        #expect(files.logEntries.isEmpty)
    }

    /// CODEX-IN04-4: a first token B; the process ends after its replacement was sent and before its list post. The
    /// next process sends the replacement again and its open posts the list under B.
    @Test func codexIn04_4_firstTokenCrashBeforeItsListPost() async throws {
        let files = Files()
        try files.seed(token: nil)
        let server = ServerModel()
        let p1 = PushSync(store: files.store, log: files.log, transport: ScriptedServerTransport(server: server),
                          clock: ContinuousClock(), crash: { $0 == .requestStarted }, context: Files.context)
        #expect(await p1.tokenArrived("token-b").map(\.method) == ["PUT"], "the list post never left")
        #expect(server.keys.isEmpty)
        let transport = ScriptedServerTransport(server: server)
        let p2 = files.sync(transport)
        await p2.start()
        _ = await p2.open { "token-b" }
        #expect(await eventually { await p2.pendingReplies == 0 })
        #expect(transport.requests.map(\.request.method) == ["PUT", "POST"])
        #expect(server.tokens == ["token-b"])
        #expect(server.records == ["ios/1/1", "ios/1/2"])
        #expect(files.storedToken == "token-b")
        #expect(files.logEntries.isEmpty)
    }

    /// CODEX-IN04-5: B←A (lost on the way), C←B and B←C in flight; B←C answers first and the process ends. The reply
    /// acknowledged its own entry (3), not the oldest entry of token B, and entries leave only as an acknowledged
    /// prefix, so the next process replays B←A, C←B and B←C and the records end under B once.
    @Test func codexIn04_5_repliesAcknowledgeTheirOwnEntry() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let server = seededServer(token: "token-a")
        let first = ScriptedServerTransport(server: server, deliver: { r in
            !(r.method == "PUT" && r.body["oldToken"]?.stringValue == "token-a")
        }, answerAtOnce: { _ in false })
        let p1 = files.sync(first)
        for token in ["token-b", "token-c", "token-b"] { await p1.tokenArrived(token) }
        first.answer(2)
        #expect(await eventually { files.logEntries.map(\.acked) == [false, false, true] })
        // Process 1 ends here; its other replies never reach it.
        let second = ScriptedServerTransport(server: server)
        let p2 = files.sync(second)
        await p2.start()
        #expect(second.requests.map { replacement($0.request) } ==
                [["token-b", "token-a"], ["token-c", "token-b"], ["token-b", "token-c"]])
        _ = await p2.open { "token-b" }
        #expect(await eventually { await p2.pendingReplies == 0 })
        #expect(server.tokens == ["token-b"], "\(server.keys)")
        #expect(server.records == ["ios/1/1", "ios/1/2"])
        #expect(files.logEntries.isEmpty)
        #expect(files.storedToken == "token-b")
        first.answerAll() // the simulated process 1 is still in memory: no task stays suspended
        #expect(await eventually { await p1.pendingReplies == 0 })
        #expect(files.logEntries.isEmpty)
    }
}
