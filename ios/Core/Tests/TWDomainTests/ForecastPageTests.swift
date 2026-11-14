import Foundation
import Testing
import TWDomain
import TWModel
import TWResources

/// ForecastPage against the Cordova iOS pages themselves (IN-08, #2957): the text, images and grade colors of every block
/// that ios/tools/forecast-reference captured from the Cordova build (ForecastReference/<page>.json) for 회현동 alone and
/// 런던 added after it, in Korean at 393x852; then the template rules the captures do not reach. Port of the Android
/// `ForecastPageTest`.
struct ForecastPageTests {
    static let gradeColors: Set<String> = ["#32a1ff", "#00c73c", "#fd9b5a", "#ff5959"]
    let ko = Self.catalog("ko")
    let units = PageUnits(temperature: "C", windSpeed: "m/s", pressure: "hPa", distance: "km", precipitation: "mm", air: "airkorea")

    @Test(arguments: ["kma-seoul-hourly", "kma-seoul-daily", "vc-london-hourly", "vc-london-daily"])
    func pagesShowWhatTheCordovaPagesShow(page: String) throws {
        let reference = try Self.record(page)
        let blocks = reference["blocks"]?.arrayValue ?? []
        let fixture = page.hasPrefix("vc-london") ? "vc-london" : "kma-seoul"
        let model = try self.page(page.hasSuffix("daily") ? .mid : .short, try Self.city(fixture), cityCount: fixture == "vc-london" ? 2 : 1)
        // Block 1 is the chart (IN-05 compares its scene).
        let expected = blocks.enumerated().filter { $0.offset != 1 }.map { _, b in
            (b["elements"]?.arrayValue ?? []).compactMap(Self.entry)
        }
        let actual = [header(model)] + cards(model)
        #expect(expected.count == actual.count, "\(page): blocks \(expected.count) != \(actual.count)")
        for (i, (e, a)) in zip(expected, actual).enumerated() {
            #expect(e == a, "\(page) block \(i == 0 ? 0 : i + 1):\n  Cordova \(e)\n  native  \(a)")
        }
        #expect(model.title == s(reference["header"]?["title"]?["text"]) || page.hasSuffix("daily"), "\(page) title")
        #expect(model.arrows == (fixture == "vc-london"))
    }

    @Test func rowsFollowTheTemplateConditions() throws {
        // Zero hides visibility, pressure, feels like and rain (truthiness); UV grade 0 still shows (!= undefined).
        var zero = try Self.city("kma-seoul")
        var cw = try #require(zero["currentWeather"]?.objectValue)
        for (k, v) in [("visibility", JSONValue.number(0)), ("hPa", .number(0)), ("sensorytem", .number(0)), ("rn1", .number(0)),
                       ("dspls", .number(61)), ("dsplsStr", .string("보통")), ("reh", .number(0)), ("wdd", .null)] {
            cw[k] = v
        }
        zero["currentWeather"] = .object(cw)
        let rows = try #require(try page(.short, zero, cityCount: 1).detailWeather)
        let images = rows.map(\.image.name)
        #expect(!images.contains("visibility.png") && !images.contains("pressure.png") && !images.contains("feels_like.png")
                && !images.contains("precipitation.png"))
        #expect(rows.first { $0.image.name == "discomport_index.png" }?.text == [TextRun("불쾌지수 보통 "), TextRun("(61)", .sub)])
        #expect(rows[2].image.name == "humidity_00.png", "reh 0 uses the 00 image")
        #expect(rows.first { $0.image.name == "wind.png" }?.text == [TextRun("바람 2.3"), TextRun("m/s", .small)], "null wdd collapses")

        // The pollen row opens the popup with the types present.
        var pollen = try Self.city("kma-seoul")
        var pcw = try #require(pollen["currentWeather"]?.objectValue)
        var today = try #require(pcw["today"]?.objectValue)
        today["pollenGrade"] = 2; today["pollenStr"] = "높음"; today["flowerPineGrade"] = 2; today["flowerPineStr"] = "높음"
        pcw["today"] = .object(today)
        pollen["currentWeather"] = .object(pcw)
        let row = try #require(try page(.short, pollen, cityCount: 1).detailWeather?.first { $0.pollen != nil })
        #expect(row.text == [TextRun("꽃가루 위험도: 높음")])
        #expect(row.pollen == [PollenRow(labelKey: "LOC_POLLEN_PINE", gradeLabel: "높음", infoKey: "LOC_POLLEN_PINE_INFO",
                                         adviceKey: "LOC_POLLEN_ADVICE_2")])

        // KHAI -1 hides its value; a string value empties its whole text (toFixed is not a function).
        var khai = try Self.city("kma-seoul")
        var kcw = try #require(khai["currentWeather"]?.objectValue)
        var arpltn = try #require(kcw["arpltn"]?.objectValue)
        arpltn["khaiValue"] = -1; arpltn["pm25Value"] = "4"
        kcw["arpltn"] = .object(arpltn)
        khai["currentWeather"] = .object(kcw)
        let air = try #require(try page(.short, khai, cityCount: 1).detailAir)
        #expect(air.first { $0.label == "통합대기" }?.text == [TextRun("좋음", color: "#32a1ff")])
        #expect(air.first { $0.label == "초미세먼지" }?.text == [TextRun("좋음", color: "#32a1ff")])
    }

    @Test func linksEndWithTheirArrow() throws {
        let rows = try #require(try page(.short, try Self.city("kma-seoul"), cityCount: 1).detailAir)
        for label in ["대기환경기준", "예보자료"] {
            let text = try #require(rows.first { $0.label == label }?.text)
            #expect(text.first?.style == .link)
            #expect(text.last == TextRun("\u{F3D3}", .linkArrow), "\(label): `.colgroup-box a:after`")
            #expect(text.first?.text.hasSuffix(" ") == true, "\(label): the space before the arrow stays")
        }
        #expect(rows.first { $0.label == "대기환경기준" }?.action == .units)
        #expect(rows.first { $0.label == "예보자료" }?.action == .airForecastInfo("airkorea"))
    }

    @Test func aPlaceWithoutWeatherKeepsThePreviousPage() throws {
        var scope = scope(.short)
        scope.open(try Self.city("kma-seoul"), enabledCount: 2, hasPush: false)
        var london = try Self.city("vc-london")
        london["currentWeather"] = nil
        scope.apply(london, hasPush: false)
        let page = ForecastPage(scope: scope, units: units, texts: ko)
        #expect(page.title == "런던")
        #expect(page.hero == nil, "no current weather: no header weather")
        #expect(page.detailWeather?[0].text.first?.text == "어제보다 -2.3˚", "Seoul's comparison stays (Cordova stops at the error)")
        #expect(page.attribution == .visualCrossing)
    }

    // MARK: - Helpers

    private func header(_ page: ForecastPage) -> [String] {
        guard let hero = page.hero else { return [] }
        return ["text:\(hero.temperature)", "text:˚", "img:\(hero.sky.name)", "text:\(hero.summary)"]
            + (hero.summaryAir.map { ["text:\($0)"] } ?? [])
    }

    private func cards(_ page: ForecastPage) -> [[String]] {
        var cards: [[String]] = []
        func glyph(_ g: String, _ color: String?) -> String { "glyph:\(g)" + (color.map { "@\($0)" } ?? "") }
        // An element's own text is trimmed in the captures; the link arrow is a pseudo-element.
        func runs(_ runs: [TextRun]) -> [String] {
            runs.compactMap { r in
                let t = r.text.trimmingCharacters(in: .whitespaces)
                if t.isEmpty || r.style == .linkArrow { return nil }
                switch r.style {
                case .small, .subSmall: return "small:\(t)"
                case .sub: return "sub:\(t)"
                default: return "text:\(t)" + (r.color.map { "@\($0)" } ?? "")
                }
            }
        }
        func cell(_ c: AqiCell) -> [String] {
            ["text:\(c.heading)", glyph(c.glyph, c.color), "text:\(c.grade)" + (c.color.map { "@\($0)" } ?? "")]
        }
        if let cells = page.hourlyAqi { cards.append(["title:\(page.hourlyAqiTitle)"] + cells.flatMap(cell)) }
        if let cells = page.currentAir { cards.append(cells.flatMap { cell($0) + runs($0.value) }) }
        if let rows = page.detailWeather {
            cards.append(["title:\(ko["LOC_DETAIL_WEATHER"])"] + rows.flatMap { ["img:\($0.image.name)"] + runs($0.text) })
        }
        if let rows = page.detailAir {
            cards.append(["title:\(ko["LOC_DETAIL_AQI"])"] + rows.flatMap { ["text:\($0.label)", glyph($0.glyph, $0.color)] + runs($0.text) })
        }
        if let aqi = page.dailyAqi { cards.append(["title:\(aqi.title)"] + (aqi.cells ?? []).flatMap(cell)) }
        if let days = page.dayDetails {
            // Built step by step: Swift 6.3 (Xcode 26.6) cannot type-check the nested concatenation in time.
            var card: [String] = ["title:\(ko["LOC_DETAIL_WEATHER"])"]
            for d in days {
                card.append("text:\(d.title)")
                for row in d.rows {
                    card.append("img:\(row.image.name)")
                    card += runs(row.value)
                    card.append("sub:\(row.label)")
                }
            }
            cards.append(card)
        }
        if page.attribution != nil { cards.append(["text:\(Attribution.visualCrossingText)"]) }
        return cards
    }

    /// A captured element as the model names it; colors only where the page sets a grade color. Glyph-only elements
    /// (the arrows' `ion-*` spans) are left out.
    static func entry(_ e: JSONValue) -> String? {
        let tag = s(e["tag"]) ?? "", cls = s(e["cls"]) ?? "", text = s(e["text"]) ?? ""
        let color = hex(s(e["color"]) ?? "")
        if tag == "img" { return "img:" + (s(e["src"]) ?? "").split(separator: "/").last.map(String.init)! }
        if tag == "i" && cls.contains("material-icons") {
            return "glyph:\(text)" + (color != "#000000" && color != "#444444" ? "@\(color)" : "")
        }
        if text.isEmpty { return nil }
        if cls == "card-title" { return "title:\(text)" }
        if tag == "small" { return "small:\(text)" }
        if cls.contains("sub-text") { return "sub:\(text)" }
        return "text:\(text)" + (gradeColors.contains(color) ? "@\(color)" : "")
    }

    static func hex(_ rgb: String) -> String {
        let n = rgb.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
        guard n.count >= 3 else { return "" }
        return String(format: "#%02x%02x%02x", n[0], n[1], n[2])
    }

    private func page(_ type: ForecastType, _ city: JSONObject, cityCount: Int) throws -> ForecastPage {
        var scope = scope(type)
        scope.open(city, enabledCount: cityCount, hasPush: false)
        return ForecastPage(scope: scope, units: units, texts: ko)
    }

    private func scope(_ type: ForecastType) -> ForecastScope {
        ForecastScope(type: type, metrics: ChartMetrics(bodyWidth: 393, bodyHeight: 852), fahrenheit: false, photoTheme: false,
                      yesterday: YesterdayText(same: ko["LOC_SAME_AS_YESTERDAY"], than: ko["LOC_THAN_YESTERDAY"]),
                      expandShortChart: false)
    }

    /// The captures' places: the converted response with the saved place's own fields (capture.js `addPlace`).
    static func city(_ fixture: String) throws -> JSONObject {
        let converted = try #require(try WeatherConverter.convert(Corpus.read("inputs/\(fixture).json")))
        var city = JSONObject()
        for (k, v) in converted where Js.truthy(v) { city[k] = v }
        let own: [(String, String)] = fixture == "kma-seoul"
            ? [("name", "회현동"), ("address", "대한민국 서울특별시 중구 회현동"), ("country", "KR")]
            : [("name", "런던"), ("address", "영국 런던"), ("country", "GB")]
        for (k, v) in own { city[k] = .string(v) }
        city["currentPosition"] = .bool(false)
        return city
    }

    static func record(_ page: String) throws -> JSONValue {
        let url = Bundle.module.resourceURL!.appendingPathComponent("ForecastReference/\(page).json")
        return try JSONValue.parse(Data(contentsOf: url))
    }

    /// The imported catalog (TWResources) with English, then the key, as fallbacks.
    static func catalog(_ code: String) -> ChartTexts {
        let bundles = [TWResources.strings(catalog: code), TWResources.strings(catalog: "en")].compactMap { $0 }
        var strings: [String: String] = [:]
        for key in ForecastPage.keys + ChartTexts.keys {
            for b in bundles {
                let v = b.localizedString(forKey: key, value: "\u{1}", table: nil)
                if v != "\u{1}" { strings[key] = v; break }
            }
        }
        return ChartTexts(strings)
    }
}
