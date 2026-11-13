import Foundation
import TWModel

/// Port of `WeatherUtil.convertWeatherData` (client/www/js/service.weatherutil.js; Kotlin `WeatherConverter`):
/// turns a v000903 `/weather/.../coord` response into the place weather the screens read (currentWeather,
/// timeTable, timeChart, dayChart, air data, source). Values pass through unchanged, as in the Cordova app.
public enum WeatherConverter {
    /// Where the Cordova code throws a TypeError, which convertWeatherData catches and answers with null.
    private struct JsTypeError: Error {}

    /// Thrown where the Cordova code throws for a null response (it does not catch it).
    public struct NullWeatherData: Error {}

    /// Returns nil where the Cordova code returns null (a response it cannot parse).
    public static func convert(_ response: JSONValue) throws -> JSONObject? {
        if response.isNull { throw NullWeatherData() }
        let data: JSONObject
        do {
            if case .object(let o) = response, case .string(let source) = o["source"], JSString.equal(source, "KMA") {
                data = try parseKma(o)
            } else {
                data = try parseWorld(response)
            }
        } catch is JsTypeError {
            return nil
        }
        guard case .object(let r) = response else { return data }
        var out = data
        for key in ["name", "address", "country", "location"] where r.contains(key) {
            out[key] = r[key]
        }
        return out
    }

    private static func parseKma(_ weather: JSONObject) throws -> JSONObject {
        var midDays: [JSONValue]?
        if case .object(let mid) = weather["midData"] { midDays = mid["dailyData"]?.arrayValue }
        let mid = try parseDaily(midDays)
        var current: JSONValue = Js.truthy(weather["current"]) ? weather["current"]! : .object(JSONObject())
        current = withToday(current, mid)
        let short = try parseHourly(weather["short"], worldFallback: false)
        var out = JSONObject()
        out["currentWeather"] = current
        out["timeTable"] = .array(short.table)
        out["timeChart"] = .array(short.chart)
        out["dayChart"] = dayChart(mid, current)
        putAir(&out, weather)
        out["source"] = .string("KMA")
        return out
    }

    private static func parseWorld(_ weather: JSONValue) throws -> JSONObject {
        guard let obj = weather.objectValue, case .array(let daily) = obj["daily"] else { throw JsTypeError() }  // daily.forEach
        let mid = try parseDaily(daily)
        let short = try parseHourly(obj["hourly"], worldFallback: true)
        var current = try worldCurrent(obj["thisTime"])
        current = withToday(current, mid)
        var out = JSONObject()
        out["currentWeather"] = current
        out["timeTable"] = .array(short.table)
        out["timeChart"] = .array(short.chart)
        out["dayChart"] = dayChart(mid, current)
        if obj.contains("pubDate") {
            let pubDate = obj["pubDate"]!
            if pubDate.isNull { throw JsTypeError() }
            if case .object(let p) = pubDate, p.contains("VC") { out["source"] = .string("VC") }
        }
        putAir(&out, obj)
        return out
    }

    private static func putAir(_ out: inout JSONObject, _ weather: JSONObject) {
        if let v = weather["airInfo"], Js.truthy(v) { out["airInfo"] = v }
        if let v = weather["airInfoList"], Js.truthy(v) { out["airInfoList"] = v }
    }

    /// `_parseWorldCurrentWeather`: thisTime[1] with yesterday = thisTime[0].
    private static func worldCurrent(_ thisTime: JSONValue?) throws -> JSONValue {
        func at(_ i: Int) throws -> JSONValue? {
            guard let thisTime else { throw JsTypeError() }
            switch thisTime {
            case .array(let a): return i < a.count ? a[i] : nil
            case .object(let o): return o[String(i)]
            case .null: throw JsTypeError()
            default: return nil
            }
        }
        guard let current = try at(1), !current.isNull else { throw JsTypeError() }
        guard case .object(let c) = current else { return current }
        let yesterday = try at(0)
        if let yesterday { return .object(c.setting("yesterday", yesterday)) }
        return .object(c.removing("yesterday"))
    }

    private struct Daily {
        let table: [JSONValue]
        let displayItemCount: Int
        let today: JSONValue?
        let valid: Bool
    }

    /// `_parseMidTownWeather` / `_parseWorldDailyWeather`.
    private static func parseDaily(_ days: [JSONValue]?) throws -> Daily {
        guard let days else { return Daily(table: [], displayItemCount: 0, today: nil, valid: false) }
        var count = 0
        var today: JSONValue = .null
        var table: [JSONValue] = []
        for (index, day) in days.enumerated() {
            if day.isNull { throw JsTypeError() }  // data.fromToday on a null row
            var data = day
            if case .object(let o) = data, Js.looseEquals(o["fromToday"], 0) {
                data = .object(o.setting("index", .number(index)))
                today = data
            }
            var c = 0
            if case .object(let d) = data {
                let am = d["skyAm"], pm = d["skyPm"]
                if (Js.present(am) || Js.present(pm)) && !Js.looseEquals(am, pm) && Js.truthy(am) && Js.truthy(pm) { c |= 4 }
                if Js.truthy(d["pop"]) && Js.greater(d["pop"], 0) && Js.greaterOrEqual(d["fromToday"], 0) { c |= 2 }
                if rainy(d) { c |= 1 }
            }
            if c > count { count = c }
            table.append(data)
        }
        return Daily(table: table, displayItemCount: count, today: today, valid: true)
    }

    private static func rainy(_ d: JSONObject) -> Bool {
        ["rn1", "r06", "s06"].contains { Js.truthy(d[$0]) && Js.greater(d[$0], 0) }
    }

    /// `_parseShortTownWeather` (KMA) / `_parseWorldHourlyWeather` (world): timeTable and the two chart series.
    private static func parseHourly(_ list: JSONValue?, worldFallback: Bool) throws -> (table: [JSONValue], chart: [JSONValue]) {
        guard case .array(let list) = list else { return ([], []) }
        var currentIndex: Int? = worldFallback ? nil : -1
        var count = 0
        for (index, item) in list.enumerated() {
            if item.isNull { throw JsTypeError() }  // tempObject.currentIndex on a null row
            guard case .object(let o) = item else { continue }
            if Js.truthy(o["currentIndex"]) { currentIndex = index }
            if Js.greater(o["fromToday"], -2) {
                var c = 0
                if Js.present(o["skyIcon"]) { c += 1 }
                if Js.truthy(o["pop"]) && Js.greater(o["pop"], 0) { c += 1 }
                if count == 2 && rainy(o) { c += 1 }
                if c > count { count = c }
            }
        }
        let current = currentIndex ?? list.count - 1
        let n = list.count
        let table = slice(list, 8, n)
        let yesterday = slice(list, 0, n - 8).map { wrap("yesterday", $0) }
        let today = slice(list, 8, n).map { wrap("today", $0) }
        let chart: [JSONValue] = [
            .object(JSONObject([("name", "yesterday"), ("values", .array(yesterday))])),
            .object(JSONObject([("name", "today"), ("values", .array(today)), ("currentIndex", .number(current - 8)),
                                ("displayItemCount", .number(count))])),
        ]
        return (table, chart)
    }

    private static func wrap(_ name: String, _ value: JSONValue) -> JSONValue {
        .object(JSONObject([("name", .string(name)), ("value", value)]))
    }

    /// `Array.prototype.slice(start, end)` with JavaScript's negative-index rules.
    private static func slice(_ list: [JSONValue], _ start: Int, _ end: Int) -> [JSONValue] {
        let n = list.count
        func norm(_ i: Int) -> Int { i < 0 ? max(n + i, 0) : min(i, n) }
        let s = norm(start), e = norm(end)
        return s >= e ? [] : Array(list[s..<e])
    }

    /// `currentForecast.today = midTownWeather.today`; undefined removes the key, as JSON serialization does.
    private static func withToday(_ current: JSONValue, _ mid: Daily) -> JSONValue {
        guard case .object(let c) = current else { return current }
        return mid.valid ? .object(c.setting("today", mid.today ?? .null)) : .object(c.removing("today"))
    }

    private static func dayChart(_ mid: Daily, _ current: JSONValue) -> JSONValue {
        var o = JSONObject()
        o["values"] = .array(mid.table)
        if let t1h = current.objectValue?["t1h"] { o["temp"] = t1h }
        o["displayItemCount"] = .number(mid.displayItemCount)
        return .array([.object(o)])
    }
}
