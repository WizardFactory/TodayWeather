import CryptoKit
import Foundation
import Testing
import TWModel

/// The air page references (IN-09, #2958) are complete and unchanged: every Cordova iOS block capture, the manifest and
/// the served responses under TodayWeatherTests/AirReference, and the records under Core/Tests/TWDomainTests/AirReference,
/// are listed in provenance/air-captures.json with the hash of their bytes, and no unlisted capture sits next to them.
/// The tolerances are maintained with the tests, and `air-scale.json` carries its own sources (ios/tools/air/generate.py).
struct AirReferenceProvenanceTests {
    @Test func airCapturesAreTheRecordedFiles() throws {
        let record = try JSONValue.parse(Data(contentsOf: Corpus.iosDir.appendingPathComponent("provenance/air-captures.json")))
        let entries = try #require(record["files"]?.arrayValue)
        var listed = Set<String>()
        for e in entries {
            let path = try #require(e["path"]?.stringValue)
            listed.insert(path)
            let data = try Data(contentsOf: Corpus.iosDir.appendingPathComponent(path))
            let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            #expect(hash == e["sha256"]?.stringValue, "\(path)")
        }
        var present: [String] = []
        for dir in ["TodayWeatherTests/AirReference", "Core/Tests/TWDomainTests/AirReference"] {
            present += try FileManager.default.contentsOfDirectory(atPath: Corpus.iosDir.appendingPathComponent(dir).path)
                .filter { !$0.hasSuffix("tolerances.json") && $0 != "air-scale.json" && ($0.hasSuffix(".png") || $0.hasSuffix(".json")) }
                .map { "\(dir)/\($0)" }
        }
        #expect(listed == Set(present))
        #expect(record["build"]?["commit"]?.stringValue?.utf8.count == 40)
        // The page sources the capture ran are the tracked client files of the build commit (the stylesheet is generated).
        for source in record["pageSources"]?.arrayValue ?? [] where source["tracked"]?.boolValue == true {
            #expect(source["matchesClient"]?.boolValue == true, "\(source["file"]?.stringValue ?? "")")
        }
    }
}
