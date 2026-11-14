import Foundation
import Testing
import TWDomain
import TWModel
import TWResources

/// AirPage against the Cordova iOS S05 itself (IN-09, #2958): the text, images, grade colors, band colors and selected
/// cells of every block ios/tools/air-reference captured from the Cordova build (AirReference/<state>.json) in seven
/// states at 393x852 in Korean, the value label's position at the captured widths, and the template rules the captures
/// do not reach. Port of the Android `AirPageTest`.
struct AirPageTests {
    static let states = ["kma-seoul", "kma-seoul-pm25", "kma-seoul-station-1", "kma-seoul-o3", "kma-seoul-dark", "vc-london",
                         "kma-jeju-no-air"]
    static let gradeColors: Set<String> = ["#32a1ff", "#00c73c", "#fd9b5a", "#ff5959"]
    static let ko = catalog("ko")

    @Test(arguments: states)
    func pagesShowWhatTheCordovaPageShows(state: String) throws {
        let reference = try Self.record(state)
        let blocks = reference["blocks"]?.arrayValue ?? []
        let scope = try Self.scope(state)
        let page = AirPage(scope: scope, texts: Self.ko)
        let expected = blocks.map { b in (b["elements"]?.arrayValue ?? []).compactMap(Self.entry) }
        let actual = Self.blocks(page)
        #expect(expected.count == actual.count, "\(state): blocks \(expected.count) != \(actual.count)")
        for (i, (e, a)) in zip(expected, actual).enumerated() {
            #expect(e == a, "\(state) block \(i):\n  Cordova \(e)\n  native  \(a)")
        }
        #expect(sameText(page.title, s(reference["scope"]?["address"])), "\(state): title (`address`)")
        #expect(page.arrows == ((scope.cityCount ?? 0) > 1))
        // The scope values the template read.
        let captured = reference["scope"]
        #expect(sameText(s(captured?["aqiCode"]), scope.aqiCode), "\(state): aqiCode")
        #expect(int(captured?["stnIndex"]) == scope.stnIndex, "\(state): stnIndex")
        #expect(jsonDifference(captured?["airCodeValue"], scope.airCodeValue, "") == nil, "\(state): airCodeValue")
        #expect(jsonDifference(captured?["mainInfo"], scope.mainInfo, "") == nil, "\(state): mainInfo")
        #expect(sameText(s(captured?["hourlyChartTitle"]), scope.hourlyChartTitle), "\(state): hourlyChartTitle")
        #expect(double(captured?["headerHeight"]) == scope.metrics.headerHeight, "\(state): headerHeight")
        #expect(abs(double(captured?["bigFontSize"]) - scope.metrics.bigFontSize) < 1e-9, "\(state): bigFontSize")
    }

    @Test(arguments: states)
    func theLabelSitsWhereTheCordovaPagePutItAtTheCapturedWidths(state: String) throws {
        let gauge = try #require(try Self.record(state)["gauge"])
        let page = AirPage(scope: try Self.scope(state), texts: Self.ko)
        let left = Double((s(gauge["left"]) ?? "").replacingOccurrences(of: "px", with: "")) ?? .nan
        let x = page.gauge.labelPosition(width: double(gauge["width"]), labelWidth: double(gauge["labelWidth"]))
        #expect(abs(left - x) < 1e-9, "\(state): \(x) != \(left)")
    }

    @Test func cellsSelectAndLinksOpenTheirPages() throws {
        let page = AirPage(scope: try Self.scope("kma-seoul-station-1"), texts: Self.ko)
        #expect(page.stations?.map(\.selected) == [false, true, false])
        #expect(page.detail?.map(\.selected) == [true, false, false, false, false, false, false])
        #expect(page.detail?.map(\.code) == ["aqi", "pm25", "pm10", "o3", "no2", "co", "so2"])
        let info = try #require(page.info)
        #expect(info.first { $0.label == "대기환경기준" }?.action == .units)
        #expect(info.first { $0.label == "예보자료" }?.action == .airForecastInfo("airkorea"))
        #expect(info.first { $0.label == "예보자료" }?.text.last?.style == .linkArrow, "the link arrow")
        #expect(page.stationsTitle == "측정소 (통합대기)")
        let pm25 = AirPage(scope: try Self.scope("kma-seoul-pm25"), texts: Self.ko)
        #expect(pm25.stationsTitle == "측정소 (초미세먼지)")
        #expect(pm25.stations?.map(\.text) == ["12", "4", "11"], "a pollutant's stations show its values")
        #expect(pm25.main?.grade == false, "a pollutant's value is set at the full size")
        #expect(AirPage(scope: try Self.scope("kma-seoul"), texts: Self.ko).main?.grade == true)
    }

    @Test func valuesShowAsTheyCameAndZeroOnlyInTheStationsAsADash() throws {
        // Tokyo under airnow: so2 0 and the decimals as sent (no toFixed).
        var tokyo = AirScope(metrics: ChartMetrics(bodyWidth: 393, bodyHeight: 852), airUnit: "airnow", zone: Self.seoulZone)
        tokyo.open(try Self.city("vc-tokyo", ["name": "도쿄", "address": "일본 도쿄", "country": "JP"]), code: "so2", enabledCount: 1,
                   hasPush: false)
        let page = AirPage(scope: tokyo, texts: Self.ko)
        #expect(page.main?.value == "0")
        #expect(page.main?.unit == "ppm")
        #expect(page.gauge.label == "0")
        #expect(page.detail?.map(\.text) == ["31", "5.98", "7.65", "0.034", "0.013", "0.209", "0"])
        #expect(page.gauge.bands.count == 6, "airnow has six grades")
        #expect(page.gauge.bands.dropFirst().first?.bound == "~ 0.75", "A17 kept")
        #expect(page.stations == nil, "no stations overseas")
        #expect(page.chartTitle == nil)
        #expect(page.daily == nil)
        // A station whose value is 0 shows "-" there; the main box shows 0.
        var seoul = try Self.seoul()
        var list = try #require(seoul["airInfoList"]?.arrayValue)
        var first = try #require(list[0].objectValue)
        var last = try #require(first["last"]?.objectValue)
        last["pm25Value"] = 0
        first["last"] = .object(last)
        list[0] = .object(first)
        seoul["airInfoList"] = .array(list)
        var zero = AirScope(metrics: ChartMetrics(bodyWidth: 393, bodyHeight: 852), airUnit: "airkorea", zone: Self.seoulZone)
        zero.open(seoul, code: "pm25", enabledCount: 1, hasPush: false)
        let zeroPage = AirPage(scope: zero, texts: Self.ko)
        #expect(zeroPage.main?.value == "0")
        #expect(zeroPage.stations?.map(\.text) == ["-", "4", "11"])
    }

    @Test func aPlaceWithoutAirShowsOnlyTheScaleOnAFreshVisitAndKeepsTheLastAirAfterASwipe() throws {
        let fresh = AirPage(scope: try Self.scope("kma-jeju-no-air"), texts: Self.ko)
        #expect(fresh.main == nil)
        #expect(fresh.chartTitle == nil && fresh.daily == nil && fresh.detail == nil && fresh.info == nil && fresh.stations == nil)
        #expect(fresh.gauge.bands.count == 4)
        #expect(fresh.gauge.label == "")
        #expect(fresh.title == "이도2동")
        // A swipe from Seoul's second station to it changes only the title and the station (the apply stops at the missing
        // observation): the rest is Seoul's.
        var scope = try Self.scope("kma-seoul-station-1")
        scope.applyEvent(try Self.noAir(), enabledCount: 2, hasPush: false)
        let swiped = AirPage(scope: scope, texts: Self.ko)
        #expect(swiped.title == "이도2동")
        #expect(swiped.main?.value == "좋음")
        #expect(swiped.gauge.label == "47", "한강대로's value stays")
        #expect(swiped.stations?.map(\.selected) == [true, false, false], "the first station is selected again")
    }

    // MARK: - The captured states

    static let seoulZone = TimeZone(identifier: "Asia/Seoul")!

    /// The visit of `state` at 393x852 in Seoul's zone: the places capture.js added, then its link code or tap.
    static func scope(_ state: String) throws -> AirScope {
        var scope = AirScope(metrics: ChartMetrics(bodyWidth: 393, bodyHeight: 852), airUnit: "airkorea", zone: seoulZone)
        switch state {
        case "vc-london": scope.open(try london(), code: nil, enabledCount: 2, hasPush: false)
        case "kma-jeju-no-air": scope.open(try noAir(), code: nil, enabledCount: 3, hasPush: false)
        case "kma-seoul-o3": scope.open(try seoul(), code: "o3", enabledCount: 1, hasPush: false)
        default: scope.open(try seoul(), code: nil, enabledCount: 1, hasPush: false)
        }
        if state == "kma-seoul-pm25" { scope.setCode("pm25") }
        if state == "kma-seoul-station-1" { scope.setStation(1) }
        return scope
    }

    static func seoul() throws -> JSONObject {
        try city("kma-seoul", ["name": "회현동", "address": "대한민국 서울특별시 중구 회현동", "country": "KR"])
    }

    static func london() throws -> JSONObject { try city("vc-london", ["name": "런던", "address": "영국 런던", "country": "GB"]) }

    /// 연동 (kma-jeju) without its stations and observation, as capture.js adds it.
    static func noAir() throws -> JSONObject {
        var c = try city("kma-jeju", ["name": "연동", "address": "대한민국 제주특별자치도 제주시 연동", "country": "KR"])
        c["airInfoList"] = nil
        var cw = try #require(c["currentWeather"]?.objectValue)
        cw["arpltn"] = nil
        c["currentWeather"] = .object(cw)
        return c
    }

    /// A place as capture.js `addPlace` saves it: the place's own fields, then every field of the converted response
    /// over them (the response's name included).
    static func city(_ fixture: String, _ own: [String: String]) throws -> JSONObject {
        var city = JSONObject()
        for k in ["name", "address", "country"] { if let v = own[k] { city[k] = .string(v) } }
        city["currentPosition"] = .bool(false)
        let converted = try #require(try WeatherConverter.convert(Corpus.read("inputs/\(fixture).json")))
        for (k, v) in converted { city[k] = v }
        return city
    }

    static func record(_ name: String) throws -> JSONValue {
        try JSONValue.parse(Data(contentsOf: Bundle.module.resourceURL!.appendingPathComponent("AirReference/\(name).json")))
    }

    // MARK: - Element lists

    /// The page model's blocks as the captures list their elements.
    static func blocks(_ page: AirPage) -> [[String]] {
        func graded(_ prefix: String, _ text: String, _ color: String?) -> String {
            "\(prefix):\(text)" + (color.flatMap { gradeColors.contains($0) ? "@\($0)" : nil } ?? "")
        }
        func cell(_ c: AirCell, bordered: Bool) -> [String] {
            (bordered ? [c.selected ? "cell:selected" : "cell"] : [])
                + ["text:\(c.heading)", graded("glyph", c.glyph, c.color)] + (c.text.isEmpty ? [] : [graded("text", c.text, c.color)])
        }
        var blocks: [[String]] = []
        var header: [String] = page.arrows ? ["arrow:left"] : []
        if let m = page.main {
            header += ["text:\(m.title)", graded("text", m.value, m.color)]
            if !m.unit.isEmpty { header.append(graded("text", m.unit, m.color)) }
            if !m.lead.isEmpty { header.append("text:\(m.lead)") }
            header.append(graded("glyph", m.glyph, m.color))
            if let advice = m.advice { header.append("text:\(advice)") }
            header += ["img:\(m.weather.image.name)", "text:\(m.weather.text)"]
            if m.weather.degree { header.append("text:˚") }
        }
        if page.arrows { header.append("arrow:right") }
        blocks.append(header)
        let labelColor = page.gauge.color.hasPrefix("#") ? page.gauge.color : "#ffffff"
        blocks.append(["label:\(page.gauge.label)@\(labelColor)"]
                      + page.gauge.bands.flatMap { ["band:\($0.color)", "text:\($0.label)", "text:\($0.bound)"] })
        if let title = page.chartTitle { blocks.append(["title:\(title)"]) }
        if let cells = page.daily { blocks.append(["title:\(page.dailyTitle)"] + cells.flatMap { cell($0, bordered: false) }) }
        if let cells = page.detail { blocks.append(["title:\(page.detailTitle)"] + cells.flatMap { cell($0, bordered: true) }) }
        if let rows = page.info {
            blocks.append(rows.flatMap { r in
                ["text:\(r.label)", graded("glyph", r.glyph, r.color)]
                    + r.text.filter { $0.style != .linkArrow }.compactMap { t in
                        let trimmed = t.text.trimmingCharacters(in: .whitespaces)
                        return trimmed.isEmpty ? nil : "text:\(trimmed)"
                    }
            })
        }
        if let cells = page.stations { blocks.append(["title:\(page.stationsTitle)"] + cells.flatMap { cell($0, bordered: true) }) }
        return blocks
    }

    /// A captured element as the model names it; grade colors only where the page sets them. The chart's SVG is
    /// AirChartTests'.
    static func entry(_ e: JSONValue) -> String? {
        let tag = s(e["tag"]) ?? "", cls = s(e["cls"]) ?? "", text = s(e["text"]) ?? ""
        let color = ForecastPageTests.hex(s(e["color"]) ?? "")
        let grade = gradeColors.contains(color) ? "@\(color)" : ""
        if ["svg", "text", "tspan", "line", "path", "g", "rect"].contains(tag) { return nil }
        if tag == "img" { return "img:" + ((s(e["src"]) ?? "").split(separator: "/").last.map(String.init) ?? "") }
        if cls.contains("ion-chevron-left") { return "arrow:left" }
        if cls.contains("ion-chevron-right") { return "arrow:right" }
        if tag == "i" && cls.contains("material-icons") { return "glyph:\(text)\(grade)" }
        if tag == "td" {
            guard (s(e["borderTop"]) ?? "").hasPrefix("1px") else { return nil }
            return cls.contains("selected") ? "cell:selected" : "cell"
        }
        if cls == "outline" { return "label:\(text)@\(color)" }
        if cls == "air-std" {
            let border = (s(e["borderTop"]) ?? "").split(separator: " ", maxSplits: 1).last.map(String.init) ?? ""
            return "band:" + ForecastPageTests.hex(border)
        }
        if text.isEmpty { return nil }
        if cls == "card-title" { return "title:\(text)" }
        return "text:\(text)\(grade)"
    }

    /// The imported catalog (TWResources) with English, then the key, as fallbacks.
    static func catalog(_ code: String) -> ChartTexts {
        let bundles = [TWResources.strings(catalog: code), TWResources.strings(catalog: "en")].compactMap { $0 }
        var strings: [String: String] = [:]
        for key in AirPage.keys + ForecastPage.keys + ChartTexts.keys {
            for b in bundles {
                let v = b.localizedString(forKey: key, value: "\u{1}", table: nil)
                if v != "\u{1}" { strings[key] = v; break }
            }
        }
        return ChartTexts(strings)
    }
}
