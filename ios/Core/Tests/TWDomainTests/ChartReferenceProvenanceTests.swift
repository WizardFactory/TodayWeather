import CryptoKit
import Foundation
import Testing
import TWModel

/// The chart references are complete and unchanged: every copied Android scene (provenance/chart-reference.json) and
/// every Cordova iOS capture with its manifest and tolerances (provenance/chart-captures.json) is listed with the hash
/// of its bytes, and no unlisted file sits next to them.
struct ChartReferenceProvenanceTests {
    private func sha256(_ url: URL) throws -> String {
        SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
    }

    private func files(_ dir: String, _ extensions: Set<String>) -> Set<String> {
        let root = Corpus.iosDir.appendingPathComponent(dir)
        let items = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)?.compactMap { $0 as? URL } ?? []
        return Set(items.filter { extensions.contains($0.pathExtension) }.map {
            dir + "/" + $0.path.dropFirst(root.path.count + 1)
        })
    }

    private func record(_ name: String) throws -> JSONValue {
        try JSONValue.parse(Data(contentsOf: Corpus.iosDir.appendingPathComponent("provenance/\(name)")))
    }

    @Test func androidScenesAreTheRecordedCopies() throws {
        let entries = try #require(try record("chart-reference.json")["files"]?.arrayValue)
        #expect(entries.count == 19)
        var listed = Set<String>()
        for e in entries {
            let output = try #require(e["output"]?.stringValue)
            listed.insert(output)
            #expect(try sha256(Corpus.iosDir.appendingPathComponent(output)) == e["output_sha256"]?.stringValue, "\(output)")
            #expect(e["source_sha256"]?.stringValue == e["output_sha256"]?.stringValue, "\(output) is a byte copy")
            #expect(e["commit"]?.stringValue?.utf8.count == 40, "\(output) commit")
        }
        #expect(listed == files("Core/Tests/TWDomainTests/ChartReference/android", ["json", "png"]))
    }

    @Test func iOSCapturesAreTheRecordedFiles() throws {
        let provenance = try record("chart-captures.json")
        let entries = try #require(provenance["files"]?.arrayValue)
        var listed = Set<String>()
        for e in entries {
            let path = try #require(e["path"]?.stringValue)
            listed.insert(path)
            #expect(try sha256(Corpus.iosDir.appendingPathComponent(path)) == e["sha256"]?.stringValue, "\(path)")
        }
        let present = files("Core/Tests/TWDomainTests/ChartReference/ios", ["json", "png"])
            .union(files("TodayWeatherTests/ChartReference", ["json", "png"]))
            .subtracting(["TodayWeatherTests/ChartReference/tolerances.json"]) // maintained with the tests
        #expect(listed == present)
        // The Cordova chart sources inside the captured build are the client/ files of the recorded commit.
        for source in provenance["chartSources"]?.arrayValue ?? [] where source["tracked"]?.boolValue == true {
            #expect(source["matchesClient"]?.boolValue == true, "\(source["file"]?.stringValue ?? "?")")
        }
        let sizes = try #require(provenance["sizes"]?.objectValue)
        #expect(sizes.keys == ["375x667", "393x852", "440x956"])
    }
}
