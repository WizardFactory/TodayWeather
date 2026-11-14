import CryptoKit
import Foundation
import Testing
import TWModel

/// The shell references (IN-07, #2956) are complete and unchanged: every Cordova iOS capture, its records and manifest
/// under TodayWeatherTests/ShellReference, and the recorded WebView languages, are listed in
/// provenance/shell-captures.json with the hash of their bytes, and no unlisted capture sits next to them (the
/// tolerances are maintained with the tests and not listed).
struct ShellReferenceProvenanceTests {
    @Test func shellCapturesAreTheRecordedFiles() throws {
        let record = try JSONValue.parse(Data(contentsOf: Corpus.iosDir.appendingPathComponent("provenance/shell-captures.json")))
        let entries = try #require(record["files"]?.arrayValue)
        var listed = Set<String>()
        for e in entries {
            let path = try #require(e["path"]?.stringValue)
            listed.insert(path)
            let data = try Data(contentsOf: Corpus.iosDir.appendingPathComponent(path))
            let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            #expect(hash == e["sha256"]?.stringValue, "\(path)")
        }
        let dir = Corpus.iosDir.appendingPathComponent("TodayWeatherTests/ShellReference")
        let present = try FileManager.default.contentsOfDirectory(atPath: dir.path)
            .filter { $0 != "shell-tolerances.json" && ($0.hasSuffix(".png") || $0.hasSuffix(".json")) }
            .map { "TodayWeatherTests/ShellReference/\($0)" }
        #expect(listed == Set(present + ["Core/Tests/TWDomainTests/ShellReference/languages.json"]))
        // Two languages, four themes: per theme 4 tabs x (tabs, header, status bar) + menu + menu status bar + record.
        #expect(present.count == 2 * 4 * (4 * 3 + 2 + 1) + 2 * 1 + 1, "\(present.count) files")
        #expect(record["build"]?["commit"]?.stringValue?.utf8.count == 40)
    }
}
