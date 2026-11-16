import CryptoKit
import Foundation
import Testing
import TWDomain
import TWModel

/// The nationwide and warning references (IN-13, #2962) are complete and unchanged: every Cordova iOS capture, record and
/// the manifest under TodayWeatherTests/NationReference are listed in provenance/nation-captures.json with the hash of
/// their bytes, and no unlisted capture sits next to them (the tolerances are maintained with the tests and not listed).
/// The capture served the corpus inputs these tests and NationPagesTests read.
struct NationReferenceProvenanceTests {
    @Test func nationCapturesAreTheRecordedFiles() throws {
        let record = try JSONValue.parse(Data(contentsOf: Corpus.iosDir.appendingPathComponent("provenance/nation-captures.json")))
        let entries = try #require(record["files"]?.arrayValue)
        var listed = Set<String>()
        for e in entries {
            let path = try #require(e["path"]?.stringValue)
            listed.insert(path)
            let data = try Data(contentsOf: Corpus.iosDir.appendingPathComponent(path))
            let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            #expect(hash == e["sha256"]?.stringValue, "\(path)")
        }
        let dir = "TodayWeatherTests/NationReference"
        let present = try FileManager.default.contentsOfDirectory(atPath: Corpus.iosDir.appendingPathComponent(dir).path)
            .filter { !$0.hasSuffix("tolerances.json") && ($0.hasSuffix(".png") || $0.hasSuffix(".json")) }
            .map { "\(dir)/\($0)" }
        #expect(listed == Set(present))
        #expect(record["build"]?["commit"]?.stringValue?.utf8.count == 40)
        for source in record["pageSources"]?.arrayValue ?? [] where source["tracked"]?.boolValue == true {
            #expect(source["matchesClient"]?.boolValue == true, "\(source["file"]?.stringValue ?? "")")
        }
    }

    private static let refs = Corpus.iosDir.appendingPathComponent("TodayWeatherTests/NationReference")

    private static func record(_ state: String) throws -> JSONValue {
        try JSONValue.parse(Data(contentsOf: refs.appendingPathComponent("nation-\(state).json")))
    }

    private static func tag(_ part: JSONValue) -> String { part["tag"]?.stringValue ?? "" }
    private static func text(_ part: JSONValue) -> String { part["text"]?.stringValue ?? "" }

    /// A drawn label's value lines: its inner divs with their own text after the name's, and its units' spans.
    private static func drawn(_ label: JSONValue) -> (values: [String], units: [String], icon: String?) {
        let parts = label["parts"]?.arrayValue ?? []
        let divs = parts.filter { tag($0) == "div" && !text($0).isEmpty }.map(text)
        let spans = parts.filter { tag($0) == "span" && !text($0).isEmpty }.map(text)
        let src = parts.first { tag($0) == "img" }?["src"]?.stringValue
        let icon = src.map { (($0 as NSString).lastPathComponent as NSString).deletingPathExtension }
        return (Array(divs.dropFirst()), spans, icon)
    }

    /// What the Cordova build drew from the served answers is what the native page model gives: every label's name,
    /// icon file and values in each mode and tab, and every card's heading and lines.
    @Test func capturedLabelsAndCardsAreTheNativeOnes() throws {
        let nation = NationResponse(json: try #require(try Corpus.read("inputs/nation.json").objectValue))
        let units: [String: String] = ["precipitationUnit": "mm", "windSpeedUnit": "m/s"]
        for (i, state) in ["nation-weather", "nation-rain", "nation-wind"].enumerated() {
            let mode = try #require(Nationwide.Mode(rawValue: i))
            let native = NationPages.weather(nation, mode: mode) { units[$0] }
            let labels = try #require(try Self.record(state)["labels"]?.arrayValue)
            #expect(labels.count == native.count, "\(state)")
            for (d, n) in zip(labels, native) {
                let (values, spans, icon) = Self.drawn(d)
                #expect(d["name"]?.stringValue == n.name, "\(state) name")
                #expect(icon == n.icon, "\(state) \(n.name) icon")
                #expect(values == n.lines.map(\.text), "\(state) \(n.name) values")
                #expect(spans == n.lines.map(\.unit).filter { !$0.isEmpty }, "\(state) \(n.name) units")
            }
        }
        for type in Nationwide.airTypes {
            let native = NationPages.air(nation, type: type, airUnit: "airkorea")
            let labels = try #require(try Self.record("nation-air-\(type)")["labels"]?.arrayValue)
            #expect(labels.count == native.count)
            for (d, n) in zip(labels, native) {
                let background = n.background.replacingOccurrences(of: ",", with: ", ")
                #expect(d["name"]?.stringValue == n.name)
                #expect(Self.drawn(d).values == n.lines.map(\.text), "\(type) \(n.name) value")
                #expect(d["style"]?["background"]?.stringValue == background, "\(type) \(n.name) color")
            }
        }
        let special = try Corpus.read("inputs/special.json")
        let cards = WarningCards.cards(Warnings.parse(special, languageTag: "ko-KR", timeZoneId: "Asia/Seoul"))
        let drawnCards = try #require(try Self.record("warnings")["cards"]?.arrayValue)
        #expect(drawnCards.count == cards.count)
        for (d, c) in zip(drawnCards, cards) {
            let h2 = (d["parts"]?.arrayValue ?? []).first { Self.tag($0) == "h2" }.map(Self.text)
            #expect(h2 == c.heading, "the card's heading with its time as the WKWebView printed it")
            // The card's text as the WebView lays it out holds the comment's lines (`ng-bind-html`) and the situations.
            let text = d["text"]?.stringValue ?? ""
            for line in c.comment where !line.isEmpty { #expect(text.contains(line), "comment line \(line)") }
            for s in c.situations { #expect(text.contains(s.title)) }
        }
        for state in ["warnings-empty", "warnings-failed"] {
            #expect(try Self.record(state)["cards"]?.arrayValue?.isEmpty == true, "\(state): no card")
        }
        for state in ["nation-weather-failed", "nation-air-failed", "nation-weather-empty"] {
            let labels = try #require(try Self.record(state)["labels"]?.arrayValue)
            #expect(labels.allSatisfy { Self.drawn($0).icon == nil && Self.drawn($0).values.isEmpty }, "\(state): names only")
        }
    }
}
