import Foundation
import Testing
import TWDomain
import TWModel

/// What S10, S11 and S12 show (IN-13, #2962 AC1) against the Cordova controllers run in JavaScriptCore, the Cordova iOS
/// app's engine (NationReference/nation-golden.json, written by ios/tools/nation/generate.py with the sources' commits
/// and hashes): every label of each mode and pollutant for the production answer, the empty, malformed and failed
/// answers and other units; every warning card for the production answer in Korean and English, the empty, malformed
/// and failed answers and synthetic fields. The rules of `ng-bind-html` are ported from the Android `NationPagesTest`.
struct NationPagesTests {
    static let golden: JSONValue = {
        let url = Bundle.module.resourceURL!.appendingPathComponent("NationReference/nation-golden.json")
        return (try? JSONValue.parse(Data(contentsOf: url))) ?? .null
    }()

    @Test func goldenComesFromTheCordovaSources() throws {
        let sources = try #require(Self.golden["sources"]?.arrayValue)
        #expect(sources.compactMap { s($0["path"]) }.contains("client/www/js/controller.nation.js"))
        #expect(sources.compactMap { s($0["path"]) }.contains("client/www/js/controller.kma.special.js"))
        for source in sources {
            #expect(s(source["commit"])?.utf8.count == 40)
            #expect(s(source["sha256"])?.utf8.count == 64)
        }
        #expect(s(Self.golden["generator"])?.contains("JavaScriptCore") == true)
        #expect((Self.golden["nation"]?.arrayValue?.count ?? 0) >= 10)
        #expect((Self.golden["special"]?.arrayValue?.count ?? 0) >= 8)
    }

    /// The answer a golden case's controllers got, as the native page receives it: the corpus input, a JSON object, or
    /// nothing (a rejection, or a body that is not a JSON object, which `NationSource` fails).
    static func response(_ answer: JSONValue?) throws -> NationResponse? {
        if let input = s(answer?["input"]) { return NationResponse(json: try #require(try Corpus.read("inputs/\(input)").objectValue)) }
        guard case .object(let o)? = answer?["value"] else { return nil }
        return NationResponse(json: o)
    }

    static func expected(_ labels: JSONValue?) -> [NationLabel] {
        (labels?.arrayValue ?? []).map { l in
            NationLabel(name: s(l["name"]) ?? "", top: Int(l["top"]?.numberValue?.double ?? -1), left: Int(l["left"]?.numberValue?.double ?? -1),
                        icon: s(l["icon"]),
                        lines: (l["lines"]?.arrayValue ?? []).map { LabelLine(text: s($0["text"]) ?? "", unit: s($0["unit"]) ?? "") },
                        background: s(l["background"]) ?? Nationwide.noGrade)
        }
    }

    @Test func weatherLabelsAreTheCordovaOnes() throws {
        let cases = try #require(Self.golden["nation"]?.arrayValue)
        for c in cases {
            let name = s(c["name"]) ?? "?"
            let nation = try Self.response(c["answer"])
            let units = c["units"]?.objectValue ?? JSONObject()
            let modes = try #require(c["modes"]?.arrayValue)
            for (i, mode) in Nationwide.Mode.allCases.enumerated() {
                let native = NationPages.weather(nation, mode: mode) { s(units[$0]) }
                #expect(native == Self.expected(modes[i]), "\(name) mode \(i)")
            }
        }
    }

    @Test func airLabelsAreTheCordovaOnes() throws {
        let cases = try #require(Self.golden["nation"]?.arrayValue)
        for c in cases {
            let name = s(c["name"]) ?? "?"
            let nation = try Self.response(c["answer"])
            let airUnit = s(c["units"]?["airUnit"])
            #expect(c["airTypes"]?.arrayValue?.compactMap { s($0) } == Nationwide.airTypes, "\(name) types")
            for type in Nationwide.airTypes {
                let native = NationPages.air(nation, type: type, airUnit: airUnit)
                #expect(native == Self.expected(c["air"]?[type]), "\(name) \(type)")
            }
        }
    }

    @Test func withoutAnAnswerTheLabelsShowTheirNames() {
        for mode in Nationwide.Mode.allCases {
            let labels = NationPages.weather(nil, mode: mode) { _ in "mm" }
            #expect(labels.map(\.name) == Nationwide.weatherCities.map(\.name))
            #expect(labels.allSatisfy { $0.icon == nil && $0.lines.isEmpty && $0.background == Nationwide.noGrade })
        }
        for type in Nationwide.airTypes {
            let labels = NationPages.air(nil, type: type, airUnit: "airkorea")
            #expect(labels.map(\.name) == Nationwide.airCities.map(\.name))
            #expect(labels.allSatisfy { $0.lines.isEmpty && $0.background == Nationwide.noGrade })
        }
    }

    @Test func theTitleIsTheRegionsName() throws {
        for c in try #require(Self.golden["nation"]?.arrayValue) {
            #expect(NationPages.title("KR") == s(c["title"]))
            #expect(NationPages.title("KR") == s(c["airTitle"]))
        }
        #expect(NationPages.title("JP") == "LOC_CHINA") // as getNationName has it
        #expect(NationPages.title("CN") == "LOC_CHINA")
        #expect(NationPages.title("US") == "LOC_USA")
        #expect(NationPages.title("GB") == "LOC_UK")
        #expect(NationPages.title("FR") == nil)
        #expect(NationPages.modeKeys == [["LOC_WEATHER", "LOC_TEMP"], ["LOC_PRECIPITATION"], ["LOC_WIND_DIRECTION", "LOC_WIND_SPEED"]])
    }

    /// KmaSpecialCtrl's request is `GET /v000903/kma/special` with a 3 s timeout and JSON response type, in every case.
    @Test func theWarningRequestIsOneGetWithThreeSeconds() throws {
        for c in try #require(Self.golden["special"]?.arrayValue) {
            let requests = c["requests"]?.arrayValue ?? []
            #expect(requests.count == 1)
            #expect(s(requests.first?["method"]) == "GET")
            #expect(s(requests.first?["url"]) == "https://server/v000903/kma/special")
            #expect(requests.first?["timeout"]?.numberValue?.double == 3000)
            #expect(s(requests.first?["responseType"]) == "json")
        }
    }

    /// The parsed list and the cards: the native page parses a list as KmaSpecialCtrl does (`Warnings.parse`) and shows
    /// its cards; it shows no card for a failure or anything but a list (B12 of the Android plan: the Cordova page
    /// repeats an object's values, the server always sends a list).
    @Test func warningCardsAreTheCordovaOnes() throws {
        let cases = try #require(Self.golden["special"]?.arrayValue)
        for c in cases {
            let name = "\(s(c["name"]) ?? "?") \(s(c["locale"]) ?? "?")"
            var answer: JSONValue?
            if let input = s(c["answer"]?["input"]) { answer = try Corpus.read("inputs/\(input)") } else { answer = c["answer"]?["value"] }
            if c["error"]?.boolValue == true {
                #expect(c["status"] != nil, "\(name): an error status")
                #expect(WarningCards.cards(nil).isEmpty, "\(name)")
                continue
            }
            let parsed = Warnings.parse(answer ?? .null, languageTag: s(c["locale"]) ?? "ko-KR", timeZoneId: "Asia/Seoul")
            #expect(parsed == (c["specialList"] ?? .null), "\(name): parseSpecialData")
            let cards = WarningCards.cards(parsed)
            guard let expected = c["cards"]?.arrayValue else {
                #expect(cards.isEmpty, "\(name): no card for \(parsed.jsonText.prefix(40))")
                continue
            }
            #expect(cards.count == expected.count, "\(name): cards")
            for (card, e) in zip(cards, expected) {
                #expect(card.heading == s(e["heading"]), "\(name): heading")
                #expect(card.imageUrl == s(e["imageUrl"]), "\(name): image")
                #expect(card.note == (e["note"]?.boolValue == true), "\(name): note")
                let situations = (e["situations"]?.arrayValue ?? []).map {
                    WarningSituation(title: s($0["title"]) ?? "", lines: ($0["lines"]?.arrayValue ?? []).compactMap { s($0) })
                }
                #expect(card.situations == situations, "\(name): situations")
                #expect(card.comment == BoundHtml.lines(e["commentHtml"]), "\(name): comment")
            }
        }
    }

    @Test func productionCardsShowTheirTimesInTheWebViewsLanguage() throws {
        let special = try Corpus.read("inputs/special.json")
        let ko = WarningCards.cards(Warnings.parse(special, languageTag: "ko-KR", timeZoneId: "Asia/Seoul"))
        let en = WarningCards.cards(Warnings.parse(special, languageTag: "en-US", timeZoneId: "Asia/Seoul"))
        #expect(ko.first?.heading == "기상특보 2026. 11. 8. 오전 12:00:00")
        #expect(en.first?.heading == "기상특보 11/8/2026 12:00:00 AM")
        #expect(ko.count == 3)
        #expect(ko.first?.comment == ["o 없음"])
    }

    @Test func theNoteShowsForNumericTypesOneAndTwo() {
        func note(_ type: JSONValue) -> Bool {
            WarningCards.cards(.array([.object(JSONObject([("type", type), ("comment", .string("c"))]))])).first?.note ?? false
        }
        #expect(note(.number(1)) && note(.number(2)) && note(.number(JSONNumber(text: "1.0"))))
        // Strict equality: a string type, other numbers, null and booleans hide it.
        #expect(![JSONValue.string("1"), .number(3), .number(4), .null, .bool(true)].contains { note($0) })
    }

    @Test func noCardForAnythingButAList() {
        for answer in [nil, JSONValue.null, .string("x"), .object(JSONObject()), .number(1)] {
            #expect(WarningCards.cards(answer).isEmpty)
        }
        #expect(WarningCards.cards(.array([])).isEmpty)
    }

    @Test func missingFieldsShowNothing() throws {
        // `{{undefined}}` is empty; an item without info or situations has no lines; a missing comment no span.
        let list = JSONValue.array([.object(JSONObject([("situationList", .array([.object(JSONObject())]))]))])
        let card = try #require(WarningCards.cards(list).first)
        #expect(card.heading == "")
        #expect(card.situations == [WarningSituation(title: "", lines: [])])
        #expect(card.comment.isEmpty)
        #expect(!card.note)
        #expect(card.imageUrl == nil)
    }

    @Test func numericEntitiesDecodeAsTheHtmlParserDoes() {
        func lines(_ html: String) -> [String] { BoundHtml.lines(.string(html)) }
        // Outside Unicode, zero, a surrogate and an overflowing number become U+FFFD.
        #expect(lines("a &#1114112; b &#x110000; c &#0; d &#xD800; e &#99999999999;") == ["a \u{FFFD} b \u{FFFD} c \u{FFFD} d \u{FFFD} e \u{FFFD}"])
        // 0x80-0x9F follow windows-1252 where it has a character, as the HTML parser's table does.
        #expect(lines("&#128; &#x82; &#159; &#129;") == ["\u{20AC} \u{201A} \u{0178} \u{0081}"])
        #expect(lines("&#xAC00; &#128512;") == ["\u{AC00} \u{1F600}"])
    }

    @Test func boundHtmlIsWhatSanitizeLeaves() {
        func lines(_ html: String) -> [String] { BoundHtml.lines(.string(html)) }
        #expect(lines("a<br>b") == ["a", "b"])
        #expect(lines("a<br><br>b") == ["a", "", "b"])
        #expect(lines("a<br>") == ["a"], "a final <br> makes no empty line")
        #expect(lines("a<br><br>") == ["a", ""])
        #expect(lines("  a \t\n b  ") == ["a b"], "white space collapses")
        #expect(lines("&lt;참고사항&gt; &amp; &quot;x&quot;") == ["<참고사항> & \"x\""])
        #expect(lines("<b>bold</b><script>alert(1)</script><!-- c -->") == ["bold"])
        #expect(lines("<기온 현황과 전망>") == ["<기온 현황과 전망>"], "a < before Korean is text")
        #expect(lines("a&nbsp; b") == ["a\u{A0} b"], "a no-break space stays")
        #expect(lines("x<BR/>y") == ["x", "y"])
        #expect(BoundHtml.lines(nil).isEmpty)
        #expect(BoundHtml.lines(.null).isEmpty)
        #expect(BoundHtml.lines(.string("a\n<b>b</b>\n\nc".replacingOccurrences(of: "\n", with: "<br>"))) == ["a", "b", "", "c"])
    }
}
