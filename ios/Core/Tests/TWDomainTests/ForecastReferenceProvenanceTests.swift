import CryptoKit
import Foundation
import Testing
import TWModel

/// The weather page references (IN-08, #2957) are complete and unchanged: every Cordova iOS block capture, the manifest and
/// the served responses under TodayWeatherTests/ForecastReference, and the element records under
/// Core/Tests/TWDomainTests/ForecastReference, are listed in provenance/forecast-captures.json with the hash of their
/// bytes, and no unlisted capture sits next to them (the tolerances are maintained with the tests and not listed).
struct ForecastReferenceProvenanceTests {
    @Test func forecastCapturesAreTheRecordedFiles() throws {
        let record = try JSONValue.parse(Data(contentsOf: Corpus.iosDir.appendingPathComponent("provenance/forecast-captures.json")))
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
        for dir in ["TodayWeatherTests/ForecastReference", "Core/Tests/TWDomainTests/ForecastReference"] {
            present += try FileManager.default.contentsOfDirectory(atPath: Corpus.iosDir.appendingPathComponent(dir).path)
                .filter { !$0.hasSuffix("tolerances.json") && ($0.hasSuffix(".png") || $0.hasSuffix(".json")) }
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
