import Foundation
import Testing
import TWData

/// `PushReply` resumes every waiter exactly once (review CODEX-IN04-3: no continuation leaks or double resumes).
struct PushReplyTests {
    @Test func everyWaiterGetsTheFirstStatus() async {
        let reply = PushReply()
        async let a = reply.status
        async let b = reply.status
        try? await Task.sleep(for: .milliseconds(20))
        reply.finish(200)
        reply.finish(500) // ignored
        #expect(await a == 200)
        #expect(await b == 200)
        #expect(await reply.status == 200, "a waiter after the reply gets it at once")
        #expect(reply.isFinished)
    }

    @Test func aCancelledWaiterGetsNilAndTheReplyStillArrives() async {
        let reply = PushReply()
        let waiter = Task { await reply.status }
        try? await Task.sleep(for: .milliseconds(20))
        waiter.cancel()
        #expect(await waiter.value == nil)
        let cancelledFirst = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return await reply.status
        }
        #expect(await cancelledFirst.value == nil)
        reply.finish(200)
        #expect(await reply.status == 200)
    }

    /// The clock of the timing tests: sleepers resume once, at their deadline or on cancellation.
    @Test func virtualClockSleepersResumeOnce() async throws {
        let clock = VirtualClock()
        let early = Task { try await clock.sleep(until: .init(offset: .seconds(1)), tolerance: nil) }
        let late = Task { try await clock.sleep(until: .init(offset: .seconds(5)), tolerance: nil) }
        let cancelled = Task { try await clock.sleep(until: .init(offset: .seconds(9)), tolerance: nil) }
        #expect(await eventually { clock.sleeperCount == 3 })
        clock.advance(to: .seconds(2))
        try await early.value
        cancelled.cancel()
        await #expect(throws: CancellationError.self) { try await cancelled.value }
        #expect(clock.sleeperCount == 1)
        clock.advance(to: .seconds(5))
        try await late.value
        try await clock.sleep(until: .init(offset: .seconds(1)), tolerance: nil) // passed: returns at once
        #expect(clock.sleeperCount == 0)
    }
}
