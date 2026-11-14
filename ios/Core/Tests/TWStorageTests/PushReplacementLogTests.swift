import Foundation
import Testing
@testable import TWStorage

/// The durable log of token replacements (IN-04 review round 3).
struct PushReplacementLogTests {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-log-\(UUID().uuidString)")
    var url: URL { dir.appendingPathComponent("TodayWeather/push_replacements.json") }

    @Test func entriesKeepIncreasingIdsAcrossInstances() throws {
        let log = PushReplacementLog(url: url)
        #expect(try log.entries().isEmpty)
        #expect(try log.append(old: "token-a", new: "token-b").id == 1)
        #expect(try log.append(old: "token-b", new: "token-c").id == 2)
        #expect(try log.append(old: nil, new: "token-d").id == 3)
        // A new instance (a later process) reads the same file.
        #expect(try PushReplacementLog(url: url).entries() == [
            .init(id: 1, old: "token-a", new: "token-b"), .init(id: 2, old: "token-b", new: "token-c"),
            .init(id: 3, old: nil, new: "token-d"),
        ])
        let text = try String(contentsOf: url, encoding: .utf8)
        #expect(text.hasPrefix(#"{"nextId":4,"dropped":0,"entries":[{"id":1,"old":"token-a","new":"token-b","acked":false}"#))
    }

    /// A reply acknowledges exactly its id; entries leave only as an acknowledged prefix, so what is left is a
    /// suffix of the hops sent, ending with the newest.
    @Test func acknowledgedEntriesLeaveOnlyAsAPrefix() throws {
        let log = PushReplacementLog(url: url)
        try log.append(old: "token-a", new: "token-b")
        try log.append(old: "token-b", new: "token-c")
        try log.append(old: "token-c", new: "token-b")
        try log.acknowledge(3)
        #expect(try log.entries().map(\.id) == [1, 2, 3])
        #expect(try log.entries().map(\.acked) == [false, false, true])
        try log.acknowledge(1)
        #expect(try log.entries().map(\.id) == [2, 3])
        try log.acknowledge(9) // unknown: nothing
        try log.acknowledge(2)
        #expect(try log.entries().isEmpty)
        #expect(try log.append(old: "token-b", new: "token-e").id == 4, "ids never repeat")
    }

    @Test func theLogKeepsAtMostItsCapacityAndCountsWhatItDrops() throws {
        let log = PushReplacementLog(url: url)
        for i in 0..<(PushReplacementLog.capacity + 3) { try log.append(old: "t\(i)", new: "t\(i + 1)") }
        let c = try log.contents()
        #expect(c.entries.count == PushReplacementLog.capacity)
        #expect(c.dropped == 3)
        #expect(c.entries.first?.id == 4)
        #expect(c.entries.last?.new == "t\(PushReplacementLog.capacity + 3)")
    }

    @Test func aCorruptFileCountsAsEmptyAndIsReplaced() throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: url)
        let log = PushReplacementLog(url: url)
        #expect(try log.entries().isEmpty)
        try log.append(old: nil, new: "token-b")
        #expect(try log.entries().map(\.new) == ["token-b"])
    }

    /// Tokens compare by UTF-16 code units, as the Cordova code compares strings.
    @Test func tokensCompareByCodeUnits() {
        #expect(PushReplacementLog.Entry(id: 1, old: nil, new: "\u{E9}") != PushReplacementLog.Entry(id: 1, old: nil, new: "e\u{301}"))
    }
}
