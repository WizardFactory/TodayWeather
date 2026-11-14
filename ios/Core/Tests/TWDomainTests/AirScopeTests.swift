import Foundation
import Testing
@testable import TWDomain
import TWModel

/// AirScope against the scope of the Cordova AirCtrl (Corpus/air.json `visits`, written by the Cordova code; the
/// JavaScriptCore comparison of `ios/tools/corpus/compare_jsc.py` found the file identical in each visit's zone): each
/// visit opens S05 with its code on its place, then taps cells and applies places as the page does; every value the
/// template reads must match after each step, including the values an apply leaves from an earlier place, the grade
/// colors and faces of every cell and the 24 slots of the hourly series. Port of the Android `AirScopeTest` (IN-09,
/// #2958), with station switching and the page without air data checked on their own.
struct AirScopeTests {
    @Test func visitsMatchAirCtrl() throws {
        let golden = try Corpus.read("air.json")
        let visits = try #require(golden["visits"]?.arrayValue)
        #expect(visits.count == 32)
        var steps = 0
        for visit in visits {
            let name = s(visit["name"]) ?? ""
            let places = visit["places"]?.arrayValue ?? []
            let records = try places.map { try CorpusPlaces.record($0) }
            let zone = try #require(TimeZone(identifier: s(visit["zone"]) ?? ""))
            var scope = AirScope(metrics: ChartMetrics(bodyWidth: double(visit["width"]), bodyHeight: double(visit["height"]), iOS: false),
                                 airUnit: arg(visit["units"]?["airUnit"])?.stringValue, zone: zone)
            func hasPush(_ i: Int) -> Bool { places.indices.contains(i) && places[i]["hasPush"]?.boolValue == true }
            func record(_ i: Int) -> JSONObject? { records.indices.contains(i) ? records[i] : nil }
            var index = int(visit["index"])
            let applied = visit["applied"]?.arrayValue ?? []
            let opened = scope.open(record(index), code: arg(visit["code"])?.stringValue, enabledCount: records.count,
                                    hasPush: hasPush(index))
            #expect(opened == !records.isEmpty, "\(name): opened")
            check(applied[0], scope, records, "\(name) open")
            for (i, a) in (visit["actions"]?.arrayValue ?? []).enumerated() {
                let action = s(a[0]) ?? "", value = a[1]
                switch action {
                case "apply":
                    index = int(value)
                    scope.applyEvent(record(index), enabledCount: records.count, hasPush: hasPush(index))
                case "code": scope.setCode(s(value))
                case "station": scope.setStation(int(value))
                default: Issue.record("unknown action \(action)")
                }
                check(applied[i + 1], scope, records, "\(name) \(action) \(value?.jsonText ?? "")")
            }
            steps += applied.count
        }
        #expect(steps == 97)
    }

    /// Station switching (manual page 12): a station cell shows that station's values in the main box, the gauge, the
    /// detail and info cards, keeps the pollutant, and a load or swipe (`applyEvent`) returns to the first station.
    @Test func stationsSwitchTheShownValues() throws {
        let seoul = try CorpusPlaces.record(.object(JSONObject([("fixture", "kma-seoul"), ("place", .object(JSONObject([
            ("name", "회현동"), ("address", "대한민국 서울특별시 중구 회현동"), ("country", "KR")])))])))
        let stations = try #require(seoul["airInfoList"]?.arrayValue)
        #expect(stations.count == 3)
        var scope = AirScope(metrics: ChartMetrics(bodyWidth: 393, bodyHeight: 852), airUnit: "airkorea",
                             zone: try #require(TimeZone(identifier: "Asia/Seoul")))
        scope.open(seoul, code: nil, enabledCount: 1, hasPush: false)
        #expect(scope.stnIndex == 0)
        expectJSON(stations[0]["last"], scope.airInfo, "station 0")
        for i in [1, 2, 0] {
            scope.setStation(i)
            #expect(scope.stnIndex == i)
            expectJSON(stations[i]["last"], scope.airInfo, "station \(i)")
            expectJSON(stations[i]["last"]?["aqiValue"], scope.airCodeValue, "station \(i) value")
            expectJSON(stations[i]["forecastSource"], scope.forecastSource, "station \(i) source")
        }
        scope.setCode("pm25")
        scope.setStation(2)
        #expect(scope.aqiCode == "pm25", "the pollutant stays")
        expectJSON(stations[2]["last"]?["pm25Value"], scope.airCodeValue, "station 2 pm25")
        #expect(scope.scrolls == 5, "each tap brings the page to the top")
        scope.applyEvent(seoul, enabledCount: 1, hasPush: false)
        #expect(scope.stnIndex == 0, "a load returns to the first station")
        expectJSON(stations[0]["last"]?["pm25Value"], scope.airCodeValue, "station 0 pm25")
        let page = AirPage(scope: scope, texts: AirPageTests.ko)
        #expect(page.stations?.map(\.selected) == [true, false, false])
    }

    /// A response without air data (no stations, no observation) shows only the grade scale on a fresh visit: no main
    /// box value, chart, daily, detail, info or station card.
    @Test func withoutAirDataOnlyTheScaleShows() throws {
        var jeju = try CorpusPlaces.record(.object(JSONObject([("fixture", "kma-jeju"), ("place", .object(JSONObject([
            ("name", "연동"), ("address", "대한민국 제주특별자치도 제주시 연동"), ("country", "KR")])))])))
        jeju["airInfoList"] = nil
        jeju["airInfo"] = nil
        var cw = try #require(jeju["currentWeather"]?.objectValue)
        cw["arpltn"] = nil
        jeju["currentWeather"] = .object(cw)
        for airUnit in ["airkorea", "airkorea_who", "airnow", "aqicn"] {
            var scope = AirScope(metrics: ChartMetrics(bodyWidth: 393, bodyHeight: 852), airUnit: airUnit)
            scope.open(jeju, code: nil, enabledCount: 1, hasPush: false)
            let page = AirPage(scope: scope, texts: AirPageTests.ko)
            #expect(page.main == nil && page.chartTitle == nil && page.daily == nil && page.detail == nil && page.info == nil
                    && page.stations == nil, "\(airUnit): only the scale")
            #expect(page.gauge.bands.count == (airUnit.hasPrefix("airkorea") ? 4 : 6), "\(airUnit): the scale")
            #expect(page.gauge.label == "", "\(airUnit): no value")
            #expect(page.title == "연동")
        }
    }

    /// The chart's missing slots are dated in the device's zone with local wall-clock arithmetic (`setHours`).
    @Test func missingSlotsAreDatedInTheDeviceZone() throws {
        let seoul = try #require(TimeZone(identifier: "Asia/Seoul"))
        let newYork = try #require(TimeZone(identifier: "America/New_York"))
        let s1 = AirScope(metrics: ChartMetrics(bodyWidth: 393, bodyHeight: 852), airUnit: "airkorea", zone: seoul)
        #expect(s1.slotDate("2026-11-08 00:00", 0) == "2026-11-07 12:00")
        #expect(s1.slotDate("2026-11-08  05:30", 23) == "2026-11-08 16:30", "a run of white space is one T")
        #expect(s1.slotDate("2026-11-08 05:00", 0) == "2026-11-07 17:00")
        #expect(s1.slotDate("2026-11-08 24:00", 12) == "2026-11-09 00:00", "24:00 is the next day")
        #expect(s1.slotDate("bad", 3) == "NaN-aN-aN aN:aN")
        let s2 = AirScope(metrics: ChartMetrics(bodyWidth: 393, bodyHeight: 852), airUnit: "airkorea", zone: newYork)
        // 2026-03-08 02:00 does not exist in New York: the wall clock moves forward by the gap.
        #expect(s2.slotDate("2026-03-08 12:00", 2) == "2026-03-08 03:00")
        #expect(s2.slotDate("2026-03-08 12:00", 1) == "2026-03-08 01:00")
    }

    private func check(_ expected: JSONValue, _ scope: AirScope, _ records: [JSONObject], _ name: String) {
        func same(_ key: String, _ actual: JSONValue?) {
            #expect(jsonDifference(expected[key], actual, key) == nil,
                    "\(name): \(key) \(expected[key]?.jsonText ?? "nil") != \(actual?.jsonText ?? "nil")")
        }
        func number(_ key: String, _ actual: Double?) {
            let e = expected[key]?.numberValue?.double
            if let e, let actual {
                #expect(abs(e - actual) < 1e-9, "\(name): \(key) \(e) != \(actual)")
            } else {
                #expect(e == nil && actual == nil, "\(name): \(key) \(String(describing: e)) != \(String(describing: actual))")
            }
        }
        func string(_ key: String, _ actual: String?) {
            #expect(sameText(s(arg(expected[key])), actual), "\(name): \(key) \(s(expected[key]) ?? "nil") != \(actual ?? "nil")")
        }
        // `<value>Of`: where the generator found the object (the Kotlin test compares identity); the value there must be
        // the scope's.
        func of(_ key: String, _ actual: JSONValue?) {
            guard let path = s(arg(expected[key])) else {
                #expect(actual == nil, "\(name): \(key) nil")
                return
            }
            let parts = path.split(separator: "/").map(String.init)
            var value: JSONValue? = Int(parts[0]).map { .object(records[$0]) }
            for p in parts.dropFirst() { value = Int(p).map { value?[$0] } ?? value?[p] }
            #expect(value != nil && jsonDifference(value, actual, key) == nil, "\(name): \(key) \(path)")
        }
        same("address", scope.address)
        same("currentPosition", scope.currentPosition)
        #expect(expected["hasPush"]?.boolValue == scope.hasPush, "\(name): hasPush")
        #expect(expected["cityCount"]?.numberValue.map { Int($0.double) } == scope.cityCount, "\(name): cityCount")
        string("aqiCode", scope.aqiCode)
        string("airCodeName", scope.airCodeName)
        string("mainName", scope.mainName)
        #expect(int(expected["stnIndex"]) == scope.stnIndex, "\(name): stnIndex")
        of("airInfoOf", scope.airInfo)
        of("currentWeatherOf", scope.currentWeather)
        same("airCodeGrade", scope.airCodeGrade)
        same("airCodeValue", scope.airCodeValue)
        same("airCodeStr", scope.airCodeStr)
        same("mainInfo", scope.mainInfo)
        same("airCodeActionGuide", scope.airCodeActionGuide)
        string("unit", AirQuality.codeUnit(scope.aqiCode ?? "undefined"))
        string("mainColor", AirQuality.gradeColor(scope.standard, scope.airCodeGrade, nil))
        string("labelColor", AirQuality.gradeColor(scope.standard, scope.airCodeGrade, "white"))
        string("face", AirQuality.sentimentIcon(scope.airUnit, scope.airCodeGrade))
        same("forecastPubdate", scope.forecastPubdate)
        same("forecastSource", scope.forecastSource)
        same("aqiList", scope.aqiList.map { .array($0.map { cell(scope, $0.objectValue ?? JSONObject(), nil) }) })
        same("stnList", scope.stnList.map { .array($0.map { cell(scope, $0, nil) }) })
        same("dayForecast", scope.dayForecast.map { .array($0.map { cell(scope, $0.objectValue ?? JSONObject(), "white") }) })
        let chart = expected["airChart"]
        #expect((chart == nil || chart?.isNull == true) == (scope.airChart == nil), "\(name): airChart")
        if let chart, !chart.isNull, let series = scope.airChart {
            #expect(chart["maxValue"]?.numberValue?.double == series.maxValue, "\(name): maxValue")
            let data = chart["data"]?.arrayValue ?? []
            #expect(data.count == series.data.count, "\(name): slots")
            for (i, (e, a)) in zip(data, series.data).enumerated() {
                #expect(jsonDifference(e.isNull ? nil : e, a, "slot \(i)") == nil, "\(name): slot \(i) \(e.jsonText) != \(a?.jsonText ?? "nil")")
            }
        }
        string("hourlyChartTitle", scope.hourlyChartTitle)
        number("chartAirHeight", scope.chartAirHeight)
        #expect(int(expected["scrolls"]) == scope.scrolls, "\(name): scrolls")
        number("bodyWidth", scope.metrics.bodyWidth)
        number("headerHeight", scope.metrics.headerHeight)
        number("bigFontSize", scope.metrics.bigFontSize)
    }

    /// A cell with the face and color the template gives it (`getSentimentIcon`, `grade2Color(grade[, default])`).
    private func cell(_ scope: AirScope, _ o: JSONObject, _ defaultColor: String?) -> JSONValue {
        .object(o.setting("face", .string(AirQuality.sentimentIcon(scope.airUnit, o["grade"])))
            .setting("color", .string(AirQuality.gradeColor(scope.standard, o["grade"], defaultColor))))
    }
}
