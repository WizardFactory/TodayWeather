import CryptoKit
import Foundation
import Testing
import TWModel

/// The saved places references (IN-11, #2960) are complete and unchanged: every Cordova iOS capture, record, the manifest
/// and the served responses under TodayWeatherTests/PlacesReference are listed in provenance/places-captures.json with
/// the hash of their bytes, and no unlisted capture sits next to them (the tolerances are maintained with the tests).
struct PlacesReferenceProvenanceTests {
    @Test func placesCapturesAreTheRecordedFiles() throws {
        let record = try JSONValue.parse(Data(contentsOf: Corpus.iosDir.appendingPathComponent("provenance/places-captures.json")))
        let entries = try #require(record["files"]?.arrayValue)
        var listed = Set<String>()
        for e in entries {
            let path = try #require(e["path"]?.stringValue)
            listed.insert(path)
            let data = try Data(contentsOf: Corpus.iosDir.appendingPathComponent(path))
            let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            #expect(hash == e["sha256"]?.stringValue, "\(path)")
        }
        let dir = "TodayWeatherTests/PlacesReference"
        let present = try FileManager.default.contentsOfDirectory(atPath: Corpus.iosDir.appendingPathComponent(dir).path)
            .filter { !$0.hasSuffix("tolerances.json") && ($0.hasSuffix(".png") || $0.hasSuffix(".json")) }
            .map { "\(dir)/\($0)" }
        #expect(listed == Set(present))
        #expect(record["build"]?["commit"]?.stringValue?.utf8.count == 40)
        // S02's sources in the built app are the client files of the build commit (the stylesheets are generated; the
        // build rewrites index.html and the locales, as for the other captures).
        let pageSources = ["tab-search.html", "controller.searchctrl.js", "controller.tabctrl.js", "service.weatherinfo.js",
                           "service.weatherutil.js", "service.push.js", "town.js", "powered_by_google_on_white.png"]
        for source in record["pageSources"]?.arrayValue ?? [] {
            let file = source["file"]?.stringValue ?? ""
            if pageSources.contains(where: { file.hasSuffix("/" + $0) }) {
                #expect(source["matchesClient"]?.boolValue == true, "\(file)")
            }
        }
    }
}
