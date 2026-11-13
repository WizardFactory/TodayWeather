import Foundation
import Testing
@testable import TWStorage

/// The durable queue of FCM tokens not yet registered.
struct PushTokenQueueTests {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-queue-\(UUID().uuidString)")

    @Test func tokensStayInOrderOfArrivalAcrossInstances() throws {
        let url = dir.appendingPathComponent("TodayWeather/push_tokens.json")
        let queue = PushTokenQueue(url: url)
        #expect(try queue.pending().isEmpty)
        try queue.append("token-b")
        try queue.append("token-c")
        try queue.append("token-c") // the same token again right away adds nothing
        try queue.append("token-b")
        // A new instance (a later process) reads the same file.
        #expect(try PushTokenQueue(url: url).pending() == ["token-b", "token-c", "token-b"])
        try queue.removeFirst("token-c") // only the head is removed
        #expect(try queue.pending() == ["token-b", "token-c", "token-b"])
        try queue.removeFirst("token-b")
        #expect(try PushTokenQueue(url: url).pending() == ["token-c", "token-b"])
    }

    @Test func aCorruptFileCountsAsEmptyAndIsReplaced() throws {
        let url = dir.appendingPathComponent("push_tokens.json")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: url)
        let queue = PushTokenQueue(url: url)
        #expect(try queue.pending().isEmpty)
        try queue.append("token-b")
        #expect(try queue.pending() == ["token-b"])
    }

    /// Tokens compare by UTF-16 code units, as the Cordova code compares strings.
    @Test func tokensCompareByCodeUnits() throws {
        let queue = PushTokenQueue(url: dir.appendingPathComponent("push_tokens.json"))
        try queue.append("\u{E9}")
        try queue.append("e\u{301}")
        #expect(try queue.pending().count == 2)
        try queue.removeFirst("e\u{301}")
        #expect(try queue.pending().count == 2)
    }
}
