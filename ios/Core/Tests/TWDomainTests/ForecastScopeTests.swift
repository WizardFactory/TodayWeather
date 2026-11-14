import Foundation
import Testing
import TWDomain
import TWModel
import TWResources

/// ForecastScope against the scope of the Cordova ForecastCtrl (Corpus/forecast.json, written by the Cordova code;
/// `ios/tools/corpus/compare_jsc.py` found the file byte-identical under JavaScriptCore): each visit opens a page with
/// its first place and applies the others as swipes; every value the templates read must match after every apply,
/// including the values an apply leaves from an earlier place. Port of the Android `ForecastScopeTest` (IN-08, #2957).
struct ForecastScopeTests {
    @Test func visitsMatchForecastCtrl() throws {
        let golden = try Corpus.read("forecast.json")
        let visits = try #require(golden["visits"]?.arrayValue)
        #expect(visits.count == 58)
        for visit in visits {
            let name = "\(s(visit["name"]) ?? "") \(s(visit["type"]) ?? "")"
            let places = visit["places"]?.arrayValue ?? []
            let records = try places.map { try CorpusPlaces.record($0) }
            let units = visit["units"]
            var scope = ForecastScope(
                type: s(visit["type"]) == "mid" ? .mid : .short,
                metrics: ChartMetrics(bodyWidth: double(visit["width"]), bodyHeight: double(visit["height"]), iOS: false),
                fahrenheit: s(units?["temperatureUnit"]) == "F",
                photoTheme: s(visit["theme"]) == "photo",
                yesterday: try yesterday(s(visit["lang"]) == "en" ? "en" : "ko"),
                expandShortChart: visit["expandShortChart"]?.boolValue)
            func hasPush(_ i: Int) -> Bool { places[i]["hasPush"]?.boolValue == true }
            let applied = visit["applied"]?.arrayValue ?? []
            let opened = scope.open(records.first, enabledCount: records.count, hasPush: !records.isEmpty && hasPush(0))
            #expect(opened == !records.isEmpty, "\(name): opened")
            check(applied[0], scope, records, "\(name) #0")
            for i in records.indices.dropFirst() {
                scope.apply(records[i], hasPush: hasPush(i))
                check(applied[i], scope, records, "\(name) #\(i)")
            }
        }
    }

    @Test func helpersMatchTabCtrl() throws {
        let helpers = try #require(try Corpus.read("forecast.json")["helpers"])
        func cases(_ name: String) -> [JSONValue] { helpers[name]?.arrayValue ?? [] }
        func arg(_ c: JSONValue) -> JSONValue? { c["undefinedArg"]?.boolValue == true ? nil : c["args"]?[0] }
        func expected(_ c: JSONValue) -> String? { c["expected"].flatMap { $0.isNull ? nil : s($0) } }
        for c in cases("getDayString") { #expect(ForecastFormat.dayString(arg(c)) == expected(c), "getDayString \(c)") }
        for c in cases("dayToString") { #expect(ForecastFormat.dayName(arg(c), full: false) == expected(c), "dayToString \(c)") }
        for c in cases("dayToFullString") { #expect(ForecastFormat.dayName(arg(c), full: true) == expected(c), "dayToFullString \(c)") }
        for c in cases("convertMMDD") { #expect(jsonDifference(c["expected"], ForecastFormat.mmdd(arg(c)), "") == nil, "convertMMDD \(c)") }
        for c in cases("convertDD") { #expect(jsonDifference(c["expected"], ForecastFormat.dd(arg(c)), "") == nil, "convertDD \(c)") }
        for c in cases("currentAirUnitStr") {
            #expect(ForecastFormat.airUnitKey(arg(c)?.stringValue) == expected(c), "airUnitStr \(c)")
        }
        let pollen = cases("pollen")
        #expect(!pollen.isEmpty)
        for c in pollen {
            let rows = ForecastFormat.pollenRows(arg(c)?.objectValue)
            guard let popup = c["expected"], !popup.isNull else {
                #expect(rows == nil, "pollen \(c)")
                continue
            }
            #expect(s(popup["title"]) == "LOC_POLLEN_RISK")
            #expect(s(popup["okText"]) == "LOC_CLOSE")
            let want = (popup["rows"]?.arrayValue ?? []).map { r in
                PollenRow(labelKey: s(r["labelKey"])!, gradeLabel: Js.display(r["gradeLabel"]), infoKey: s(r["infoKey"])!,
                          adviceKey: s(r["adviceKey"])!)
            }
            #expect(rows == want, "pollen \(c)")
        }
    }

    @Test func placeSelectionMatchesWeatherInfo() throws {
        let cases = try #require(try Corpus.read("forecast.json")["cityIndex"]?.arrayValue)
        #expect(cases.count == 28)
        for c in cases {
            let count = int(c["count"])
            let disabled = (0..<count).map { $0 == 0 && c["firstDisabled"]?.boolValue == true }
            let from = int(c["from"])
            let name = "count \(count), first disabled \(disabled[0]), from \(from)"
            #expect(PlaceIndex.enabledCount(disabled) == int(c["enabled"]), "\(name): enabled")
            if from < 0 {
                #expect(PlaceIndex.first(disabled, current: 0) == int(c["first"]), "\(name): first")
            } else {
                #expect(PlaceIndex.next(disabled, current: from) == int(c["next"]), "\(name): next")
                #expect(PlaceIndex.previous(disabled, current: from) == int(c["previous"]), "\(name): previous")
            }
        }
    }

    private func check(_ expected: JSONValue, _ scope: ForecastScope, _ records: [JSONObject], _ name: String) {
        func same(_ key: String, _ actual: JSONValue?) {
            #expect(jsonDifference(expected[key], actual, key) == nil, "\(name): \(key) \(expected[key]?.jsonText ?? "nil") != \(actual?.jsonText ?? "nil")")
        }
        func number(_ key: String, _ actual: Double?) {
            let e = expected[key]?.numberValue?.double
            if let e, let actual {
                #expect(abs(e - actual) < 1e-9, "\(name): \(key) \(e) != \(actual)")
            } else {
                #expect(e == nil && actual == nil, "\(name): \(key) \(String(describing: e)) != \(String(describing: actual))")
            }
        }
        // `<field>Of`: which record's array or object the scope holds (the Kotlin test compares identity); the value
        // must be that record's.
        func of(_ key: String, _ field: String, _ actual: JSONValue?) {
            if let index = expected[key]?.numberValue.map({ Int($0.double) }) {
                #expect(jsonDifference(records[index][field], actual, field) == nil, "\(name): \(key) \(index)")
            } else {
                #expect(actual == nil, "\(name): \(key) nil")
            }
        }
        same("address", scope.address)
        same("currentPosition", scope.currentPosition)
        #expect(expected["hasPush"]?.boolValue == scope.hasPush, "\(name): hasPush")
        same("source", scope.source)
        same("photo", scope.photo)
        #expect(expected["cityCount"]?.numberValue.map { Int($0.double) } == scope.cityCount, "\(name): cityCount")
        number("timeWidth", scope.timeWidth)
        number("dayWidth", scope.dayWidth)
        of("currentWeatherOf", "currentWeather", scope.currentWeather)
        of("timeTableOf", "timeTable", scope.timeTable)
        of("timeChartOf", "timeChart", scope.timeChart)
        of("dayChartOf", "dayChart", scope.dayChart)
        same("hourlyAqiForecast", scope.hourlyAqiForecast.map { .array($0) })
        same("dailyAqiForecast", scope.dailyAqiForecast)
        same("airForecastPubdate", scope.airForecastPubdate)
        same("airForecastSource", scope.airForecastSource)
        #expect(sameText(s(expected["updateTime"]), scope.updateTime), "\(name): updateTime")
        number("chartShortHeight", scope.chartShortHeight)
        number("chartShortDetailHeight", scope.chartShortDetailHeight)
        number("chartMidHeight", scope.chartMidHeight)
        #expect(expected["showDetailWeather"]?.boolValue == scope.showDetailWeather, "\(name): showDetailWeather")
        same("summary", scope.summary)
        #expect(expected["hasSummaryAir"]?.boolValue == (scope.summaryAir != nil), "\(name): hasSummaryAir")
        same("summaryAir", scope.summaryAir)
        #expect(sameText(s(expected["diffTempStr"]), scope.diffTempStr), "\(name): diffTempStr")
        number("headerHeight", scope.metrics.headerHeight)
        number("bigFontSize", scope.metrics.bigFontSize)
        number("bigImageSize", scope.metrics.bigImageSize)
        number("smallImageSize", scope.metrics.iconSize)
        #expect(expected["expand"]?.boolValue == scope.expand, "\(name): expand")
        let cw = scope.currentWeather?.objectValue
        let shown = Js.truthy(scope.currentWeather)
        #expect(sameText(expected["temp"].map(Js.display), shown ? scope.temp(cw?["t1h"]) : nil), "\(name): temp")
        #expect(sameText(expected["feelsLike"].map(Js.display), shown ? scope.temp(cw?["sensorytem"]) : nil), "\(name): feelsLike")
        #expect(expected["showHourlyAqiForecast"]?.boolValue == scope.showHourlyAqiForecast(), "\(name): showHourlyAqiForecast")
        if scope.type == .mid {
            #expect(expected["hasDustForecast"]?.boolValue == scope.hasDustForecast(), "\(name): hasDustForecast")
            let values = scope.dayChart?.arrayValue?.first?.objectValue?["values"]?.arrayValue
            #expect(expected["dailyDetail"]?.arrayValue?.map { $0.boolValue == true } == values?.map { scope.checkDailyDetailWeather($0) },
                    "\(name): dailyDetail")
            let three = expected["threeDays"]
            #expect(three?["pop"]?.boolValue == scope.hasPropertyInThreeDays(["pop"]), "\(name): pop")
            #expect(three?["ultrvGrade"]?.boolValue == scope.hasPropertyInThreeDays(["ultrvGrade"]), "\(name): ultrvGrade")
            #expect(three?["rain"]?.boolValue == scope.hasPropertyInThreeDays(["pty", "rn1", "r06", "s06"]), "\(name): rain")
        }
    }

    /// The imported catalog strings (TWResources), as the app reads them.
    private func yesterday(_ catalog: String) throws -> YesterdayText {
        let bundle = try #require(TWResources.strings(catalog: catalog))
        func get(_ key: String) -> String { bundle.localizedString(forKey: key, value: "<missing>", table: nil) }
        return YesterdayText(same: get("LOC_SAME_AS_YESTERDAY"), than: get("LOC_THAN_YESTERDAY"))
    }
}

/// The places of the corpus visits (forecast.json): what the generator's `cityRecord` builds for each. Port of the
/// Android `CorpusPlaces`.
enum CorpusPlaces {
    static let weatherFields = ["currentWeather", "timeTable", "timeChart", "dayTable", "dayChart", "source", "airInfo",
                                "airInfoList"]

    /// The converted response's truthy weather fields and the place's own fields, with the case's mutations.
    static func record(_ place: JSONValue) throws -> JSONObject {
        let input = try Corpus.read("inputs/\(s(place["fixture"])!).json")
        let converted = try #require(try WeatherConverter.convert(input))
        var fields: [(String, JSONValue)] = []
        for f in weatherFields { if let v = converted[f], Js.truthy(v) { fields.append((f, v)) } }
        let own = place["place"]?.objectValue ?? JSONObject()
        for k in ["name", "address", "country", "location"] { if let v = own[k], !v.isNull { fields.append((k, v)) } }
        fields.append(("currentPosition", .bool(own["currentPosition"]?.boolValue == true)))
        if let photo = own["photo"], !photo.isNull { fields.append(("photo", photo)) }
        var city = JSONValue.object(JSONObject(fields))
        for m in place["mutations"]?.arrayValue ?? [] {
            city = try mutate(city, (m["path"]?.arrayValue ?? [])[...], m)
        }
        return try #require(city.objectValue)
    }

    private static func mutate(_ value: JSONValue, _ path: ArraySlice<JSONValue>, _ m: JSONValue) throws -> JSONValue {
        let key = try #require(path.first)
        let last = path.count == 1
        let delete = s(m["op"]) == "delete"
        switch value {
        case .object(let o):
            let k = try #require(key.stringValue)
            if last && delete { return .object(o.removing(k)) }
            return .object(o.setting(k, last ? try #require(m["value"]) : try mutate(try #require(o[k]), path.dropFirst(), m)))
        case .array(var a):
            let i = int(key)
            if last && delete {
                a.remove(at: i)
            } else {
                a[i] = last ? try #require(m["value"]) : try mutate(a[i], path.dropFirst(), m)
            }
            return .array(a)
        default:
            Issue.record("cannot mutate \(value.jsonText) at \(path)")
            return value
        }
    }
}
