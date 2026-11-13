import Foundation
import Testing
@testable import TWStorage

/// The durable queue of FCM tokens until their replacement is answered.
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
        try queue.markSent("token-b", over: "token-a") // the oldest unsent entry of the token
        try queue.markSent("token-c", over: "token-b")
        #expect(try PushTokenQueue(url: url).entries() == [
            .init(token: "token-b", sent: .over("token-a")), .init(token: "token-c", sent: .over("token-b")),
            .init(token: "token-b"),
        ])
        try queue.remove("token-b", sent: true)
        #expect(try queue.entries() == [.init(token: "token-c", sent: .over("token-b")), .init(token: "token-b")])
        try queue.remove("token-b", sent: true) // no sent entry of token-b left: nothing removed
        try queue.markSent("token-b", over: nil)
        #expect(try PushTokenQueue(url: url).entries() == [.init(token: "token-c", sent: .over("token-b")),
                                                           .init(token: "token-b", sent: .over(nil))])
        let text = try String(contentsOf: url, encoding: .utf8)
        #expect(text == #"{"tokens":[{"token":"token-c","sentOver":"token-b"},{"token":"token-b","sentOver":null}]}"#)
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
        try queue.remove("e\u{301}", sent: false)
        #expect(try queue.pending() == ["\u{E9}"])
    }
}
