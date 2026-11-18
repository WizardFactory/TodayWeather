import CryptoKit
import Foundation
import Testing
import TWModel

/// The size and language matrix references (IN-18 part 2, #2967) are complete and unchanged (CODEX-IN18P2-2): every
/// capture, record and manifest under TodayWeatherTests/MatrixReference is listed in provenance/matrix-captures.json with
/// the hash of its bytes, and nothing unlisted sits next to them (the tolerances are maintained with the tests and not
/// listed). A deleted, changed or added reference fails here, in CI's package tests.
struct MatrixReferenceProvenanceTests {
    @Test func matrixCapturesAreTheRecordedFiles() throws {
        let record = try JSONValue.parse(Data(contentsOf: Corpus.iosDir.appendingPathComponent("provenance/matrix-captures.json")))
        let entries = try #require(record["files"]?.arrayValue)
        #expect(entries.count > 100, "\(entries.count) listed files")
        var listed = Set<String>()
        for e in entries {
            let path = try #require(e["path"]?.stringValue)
            #expect(listed.insert(path).inserted, "\(path) listed once")
            let data = try Data(contentsOf: Corpus.iosDir.appendingPathComponent(path))
            let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            #expect(hash == e["sha256"]?.stringValue, "\(path)")
        }
        let dir = "TodayWeatherTests/MatrixReference"
        let present = try FileManager.default.contentsOfDirectory(atPath: Corpus.iosDir.appendingPathComponent(dir).path)
            .filter { !$0.hasSuffix("tolerances.json") && ($0.hasSuffix(".png") || $0.hasSuffix(".json")) }
            .map { "\(dir)/\($0)" }
        #expect(listed.filter { $0.hasPrefix(dir + "/") } == Set(present), "the files under \(dir)")
        #expect(record["build"]?["commit"]?.stringValue?.utf8.count == 40)
    }
}
