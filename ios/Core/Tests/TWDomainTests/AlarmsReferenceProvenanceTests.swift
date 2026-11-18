import CryptoKit
import Foundation
import Testing
import TWModel

/// The S09 references (IN-14, #2963) are complete and unchanged: every Cordova iOS capture, record, the manifest and the
/// served response under TodayWeatherTests/AlarmsReference are listed in provenance/alarms-captures.json with the hash of
/// their bytes, and no unlisted capture sits next to them (the tolerances are maintained with the tests).
struct AlarmsReferenceProvenanceTests {
    @Test func alarmsCapturesAreTheRecordedFiles() throws {
        let record = try JSONValue.parse(Data(contentsOf: Corpus.iosDir.appendingPathComponent("provenance/alarms-captures.json")))
        let entries = try #require(record["files"]?.arrayValue)
        var listed = Set<String>()
        for e in entries {
            let path = try #require(e["path"]?.stringValue)
            listed.insert(path)
            let data = try Data(contentsOf: Corpus.iosDir.appendingPathComponent(path))
            let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            #expect(hash == e["sha256"]?.stringValue, "\(path)")
        }
        let dir = "TodayWeatherTests/AlarmsReference"
        let present = try FileManager.default.contentsOfDirectory(atPath: Corpus.iosDir.appendingPathComponent(dir).path)
            .filter { !$0.hasSuffix("tolerances.json") && ($0.hasSuffix(".png") || $0.hasSuffix(".json")) }
            .map { "\(dir)/\($0)" }
        #expect(listed == Set(present))
        #expect(record["build"]?["commit"]?.stringValue?.utf8.count == 40)
        // S09's tracked sources in the built app are the client files of the build commit (the stylesheets and the Bower
        // libraries are generated; the build rewrites index.html and the locales, as for the other captures).
        let tracked = ["setting-push.html", "controller.push.js", "service.push.js", "service.firebase.js", "controller.tabctrl.js",
                       "service.weatherinfo.js", "service.weatherutil.js", "app.js"]
        var checked = 0
        for source in record["pageSources"]?.arrayValue ?? [] {
            let file = source["file"]?.stringValue ?? ""
            if tracked.contains(where: { file.hasSuffix("/" + $0) }) {
                checked += 1
                #expect(source["matchesClient"]?.boolValue == true, "\(file)")
            }
        }
        #expect(checked == tracked.count)
    }
}
