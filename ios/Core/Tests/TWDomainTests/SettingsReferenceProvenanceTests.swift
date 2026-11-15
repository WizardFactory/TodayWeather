import CryptoKit
import Foundation
import Testing
import TWModel

/// The settings references (IN-12, #2961) are complete and unchanged: every Cordova iOS capture, record, the manifest and
/// the served °F response under TodayWeatherTests/SettingsReference, and the capture's golden
/// Core/Tests/TWDataTests/Golden/settings-capture.json, are listed in provenance/settings-captures.json with the hash of
/// their bytes, and no unlisted capture sits next to them (the tolerances are maintained with the tests and not listed).
struct SettingsReferenceProvenanceTests {
    @Test func settingsCapturesAreTheRecordedFiles() throws {
        let record = try JSONValue.parse(Data(contentsOf: Corpus.iosDir.appendingPathComponent("provenance/settings-captures.json")))
        let entries = try #require(record["files"]?.arrayValue)
        var listed = Set<String>()
        for e in entries {
            let path = try #require(e["path"]?.stringValue)
            listed.insert(path)
            let data = try Data(contentsOf: Corpus.iosDir.appendingPathComponent(path))
            let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            #expect(hash == e["sha256"]?.stringValue, "\(path)")
        }
        let dir = "TodayWeatherTests/SettingsReference"
        let present = try FileManager.default.contentsOfDirectory(atPath: Corpus.iosDir.appendingPathComponent(dir).path)
            .filter { !$0.hasSuffix("tolerances.json") && ($0.hasSuffix(".png") || $0.hasSuffix(".json")) }
            .map { "\(dir)/\($0)" }
        #expect(listed == Set(present + ["Core/Tests/TWDataTests/Golden/settings-capture.json"]))
        #expect(record["build"]?["commit"]?.stringValue?.utf8.count == 40)
        // The page sources the capture ran are the tracked client files of the build commit (the stylesheet is generated).
        for source in record["pageSources"]?.arrayValue ?? [] where source["tracked"]?.boolValue == true {
            #expect(source["matchesClient"]?.boolValue == true, "\(source["file"]?.stringValue ?? "")")
        }
    }
}
