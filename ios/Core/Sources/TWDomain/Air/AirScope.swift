import Foundation
import TWModel

/// `airChart` of S05: the 24 slots of the selected pollutant's hourly series (12 before the current hour, the current
/// one, 11 after it; a slot the series lacks has only a date) and the standard's chart maximum for it (nil when the
/// standard has none). A slot is a row of the series as it came; nil is a slot the apply did not reach.
public struct AirSeries: Sendable, Equatable {
    public let data: [JSONValue?]
    public let maxValue: Double?

    public init(data: [JSONValue?], maxValue: Double?) {
        self.data = data
        self.maxValue = maxValue
    }
}

/// The scope of AirCtrl (controller.air.js) for one visit of S05 (/tab/air, `cache: false`): `open` is `init` with the
/// pollutant of the link (`?code=`), `apply` `_applyWeatherData` for the selected place's record, `setCode` and
/// `setStation` the taps on a detail or station cell, and `applyEvent` TabCtrl's `applyEvent` (a swipe or a load), which
/// returns to the first station. `airUnit` is the air standard (TabCtrl's `setAirUnit`), which a change on the units
/// page replaces while the visit goes on (`changeAirUnitEvent`); `zone` the device's time zone, in which a missing chart
/// slot is dated. Port of the Android `AirScope` (AN-09), checked against the corpus (`air.json`, the controller itself
/// run for 32 visits).
///
/// `_applyWeatherData` runs in one `try`: at the first value it cannot read it stops, and everything it has not reached
/// keeps what an earlier place set, as on the Cordova page. A Swift nil stands for an unset value (undefined) and `.null`
/// for null, as in `Js`.
public struct AirScope: Sendable {
    public let metrics: ChartMetrics
    public let zone: TimeZone

    public var airUnit: String? {
        didSet { standard = AirQuality.standard(airUnit) }
    }

    /// TabCtrl's `aqiStandard` and `aqiMaxValue`; nil for an unknown standard.
    public private(set) var standard: AirStandard?

    /// The selected pollutant (`aqiCode`); nil when the fallback of a missing value found none.
    public private(set) var aqiCode: String?
    public private(set) var airCodeName: String?
    public private(set) var mainName: String?
    public private(set) var stnIndex = 0

    public private(set) var address: JSONValue?
    public private(set) var currentPosition: JSONValue?
    public private(set) var hasPush: Bool?
    public private(set) var cityCount: Int?

    /// The shown observation (`airInfo`): the station's `last`, or the place's `currentWeather.arpltn`.
    public private(set) var airInfo: JSONValue?
    public private(set) var currentWeather: JSONValue?
    public private(set) var airCodeGrade: JSONValue?
    public private(set) var airCodeValue: JSONValue?
    public private(set) var airCodeStr: JSONValue?
    public private(set) var mainInfo: JSONValue?
    public private(set) var airCodeActionGuide: JSONValue?
    public private(set) var forecastPubdate: JSONValue?
    public private(set) var forecastSource: JSONValue?

    /// The detail cells (`_getAQIList`).
    public private(set) var aqiList: [JSONValue]?

    /// The station cells: each station's name, and its grade, value (`-` when falsy) and grade text for the pollutant.
    public private(set) var stnList: [JSONObject]?
    public private(set) var dayForecast: [JSONValue]?
    public private(set) var airChart: AirSeries?
    public private(set) var hourlyChartTitle: String?
    public private(set) var chartAirHeight: Double?

    /// `$ionicScrollDelegate.scrollTop()` calls: a cell tap brings the page to the top.
    public private(set) var scrolls = 0

    private struct Place: Sendable {
        let city: JSONObject?
        let enabledCount: Int
        let hasPush: Bool
    }

    private var place: Place?

    public init(metrics: ChartMetrics, airUnit: String?, zone: TimeZone = .current) {
        self.metrics = metrics
        self.zone = zone
        self.airUnit = airUnit
        standard = AirQuality.standard(airUnit)
    }

    /// `init`: the pollutant of the link (`?code=`), else the overall index; false when no place is enabled.
    @discardableResult
    public mutating func open(_ city: JSONObject?, code: String?, enabledCount: Int, hasPush: Bool) -> Bool {
        setMainAqiCode(code.map { $0.isEmpty ? "aqi" : $0 } ?? "aqi")
        place = Place(city: city, enabledCount: enabledCount, hasPush: hasPush)
        if enabledCount == 0 { return false }
        applyWeatherData()
        return true
    }

    /// `_applyWeatherData` for the selected place's record (`city` nil: no place at the selected index).
    public mutating func apply(_ city: JSONObject?, enabledCount: Int, hasPush: Bool) {
        place = Place(city: city, enabledCount: enabledCount, hasPush: hasPush)
        applyWeatherData()
    }

    /// `applyEvent`: back to the first station, then the apply.
    public mutating func applyEvent(_ city: JSONObject?, enabledCount: Int, hasPush: Bool) {
        stnIndex = 0
        apply(city, enabledCount: enabledCount, hasPush: hasPush)
    }

    /// `setMainAqiCode(code)`: a detail cell's pollutant, applied to the place last applied; the page goes to the top.
    public mutating func setCode(_ code: String?) {
        setMainAqiCode(code)
        applyWeatherData()
        scrolls += 1
    }

    /// `setStation(index)`: a station cell, applied to the place last applied; the page goes to the top.
    public mutating func setStation(_ index: Int) {
        stnIndex = index
        applyWeatherData()
        scrolls += 1
    }

    private mutating func setMainAqiCode(_ code: String?) {
        aqiCode = code
        airCodeName = AirQuality.codeName(code ?? "undefined")
        mainName = Self.isAqi(code) ? "LOC_AIR_STATUS" : airCodeName
    }

    private mutating func applyWeatherData() {
        guard let p = place else { return }
        // `trackException`: the values not reached keep what an earlier apply set.
        try? applyOrStop(p.city, enabledCount: p.enabledCount, hasPush: p.hasPush)
    }

    private mutating func applyOrStop(_ city: JSONObject?, enabledCount: Int, hasPush: Bool) throws {
        guard let cityData = city else { throw Stopped() }
        let cityValue = JSONValue.object(cityData)
        let name = cityData["name"]
        address = Js.truthy(name) ? name : .string(AddressFormat.shorten(cityData["address"]?.stringValue))

        let list = cityData["airInfoList"]
        let station: JSONValue?
        if Js.truthy(list) {
            station = try Self.prop(list, String(stnIndex))
        } else if Js.truthy(cityData["airInfo"]) {
            station = cityData["airInfo"]
        } else {
            station = .object(JSONObject())
        }
        let stationLast = try Self.prop(station, "last")
        let latest = Js.truthy(stationLast) ? stationLast : try Self.prop(try Self.prop(cityValue, "currentWeather"), "arpltn")
        let code = aqiCode
        if try Self.hasOwn(latest, Self.key(code, "Value")), !Js.present(try Self.prop(latest, Self.key(code, "Value"))),
           try Self.hasOwn(station, "pollutants"),
           !Js.present(try Self.prop(try Self.prop(station, "pollutants"), code ?? "undefined")) {
            // Skips a pollutant without a value: the first with one, the overall index last.
            var found: String?
            for p in Self.fallback {
                // `latestAirInfo[p + 'Value'] != undefined || airInfo.pollutants[aqiCode] != undefined` (the old code).
                let hasValue = Js.present(try Self.prop(latest, "\(p)Value"))
                if try hasValue || Js.present(try Self.prop(try Self.prop(station, "pollutants"), code ?? "undefined")) {
                    found = p
                    break
                }
            }
            setMainAqiCode(found)
        }
        let selected = aqiCode

        currentWeather = cityData["currentWeather"]
        self.hasPush = hasPush
        currentPosition = cityData["currentPosition"]
        airInfo = latest
        airCodeGrade = try Self.prop(latest, Self.key(selected, "Grade"))
        let value = try Self.prop(latest, Self.key(selected, "Value"))
        airCodeValue = Js.present(value) ? value : .string("-")
        airCodeStr = try Self.prop(latest, Self.key(selected, "Str"))
        if Self.isAqi(selected) {
            mainInfo = Js.truthy(airCodeStr) ? airCodeStr : .string("-")
            airCodeStr = .string("")
        } else {
            mainInfo = airCodeValue
        }
        airCodeActionGuide = try Self.prop(latest, Self.key(selected, "ActionGuide"))
        cityCount = enabledCount

        stnList = nil
        dayForecast = nil
        airChart = nil

        if cityData.contains("airInfo") || cityData.contains("airInfoList") {
            forecastPubdate = try Self.prop(station, "forecastPubDate")
            forecastSource = try Self.prop(station, "forecastSource")
            aqiList = AirQuality.pollutantList(latest?.objectValue ?? JSONObject(), try Self.prop(station, "pollutants")?.objectValue)
            if try Self.hasOwn(station, "pollutants") {
                let pollutant = try Self.prop(try Self.prop(station, "pollutants"), selected ?? "undefined")
                if Js.truthy(pollutant), let pollutant { try series(pollutant, latest: latest, code: selected) }
            }
            if cityData.contains("airInfoList") {
                guard let stations = cityData["airInfoList"]?.arrayValue else { throw Stopped() }
                stnList = try stations.map { s in
                    let last = try Self.prop(s, "last")
                    var o = JSONObject()
                    if let n = try Self.prop(last, "stationName") { o["stationName"] = n }
                    if let g = try Self.prop(last, Self.key(selected, "Grade")) { o["grade"] = g }
                    let v = try Self.prop(last, Self.key(selected, "Value"))
                    o["value"] = Js.truthy(v) ? v : .string("-")
                    if let str = try Self.prop(last, Self.key(selected, "Str")) { o["str"] = str }
                    return o
                }
            }
        } else {
            aqiList = AirQuality.pollutantList(latest?.objectValue ?? JSONObject(), nil)
        }
        chartAirHeight = 100
    }

    /// The hourly series of the selected `pollutant`, its title and its daily rows (cut to four below 360 pt).
    private mutating func series(_ pollutant: JSONValue, latest: JSONValue?, code: String?) throws {
        guard let rows = try Self.prop(pollutant, "hourly")?.arrayValue else { throw Stopped() }
        var index = -1
        for (i, row) in rows.enumerated() {
            let date = try Self.prop(row, "date")
            if Js.greaterOrEqual(date, try Self.prop(latest, "dataTime")) {
                index = i
                break
            }
        }
        hourlyChartTitle = index == rows.count - 1 ? "LOC_HOURLY_AQI_INFORMATION" : "LOC_HOURLY_AQI_FORECAST"
        guard let std = standard else { throw Stopped() }
        let maxValue = code.flatMap { c in std.maxValue.first { JSString.equal($0.key, c) }?.value }
        var slots = [JSONValue?](repeating: nil, count: 24)
        airChart = AirSeries(data: slots, maxValue: maxValue)
        for i in 0..<24 {
            let at = index - 12 + i
            let row = rows.indices.contains(at) ? rows[at] : nil
            if Js.present(row) {
                slots[i] = row
            } else {
                let current = rows.indices.contains(index) ? rows[index] : nil
                guard case .string(let date)? = try Self.prop(current, "date") else { throw Stopped() }
                slots[i] = .object(JSONObject([("date", .string(slotDate(date, i)))]))
            }
            // The scope holds the array from the start: slots filled before a stop stay.
            airChart = AirSeries(data: slots, maxValue: maxValue)
        }
        if case .array(let daily)? = try Self.prop(pollutant, "daily") {
            dayForecast = metrics.bodyWidth < 360 ? Array(daily.prefix(4)) : daily
        }
    }

    /// `new Date(date.replace(/\s+/g, 'T'))` moved by `setHours(getHours() - 12 + i)` in the device's zone and printed
    /// as `YYYY-MM-DD HH:mm`: JavaScriptCore's date reading (`Warnings.jsDate`) and local wall-clock arithmetic (a time a
    /// daylight-saving change skips moves forward; one in an overlap is the earlier instant).
    func slotDate(_ date: String, _ i: Int) -> String {
        guard let millis = Warnings.jsDate(.string(Self.replacingWhiteSpace(date, "T")), zone: zone) else { return "NaN-aN-aN aN:aN" }
        let day: Int64 = 86_400_000
        func local(_ t: Int64) -> (days: Int64, inDay: Int64) {
            let l = t + Int64(zone.secondsFromGMT(for: Date(timeIntervalSince1970: Double(t) / 1000))) * 1000
            let days = l >= 0 ? l / day : (l - day + 1) / day
            return (days, l - days * day)
        }
        let (days, inDay) = local(millis)
        let hour = inDay / 3_600_000
        let moved = days * day + (hour - 12 + Int64(i)) * 3_600_000 + inDay % 3_600_000
        let t = Warnings.localToUTC(moved, zone: zone)
        let (d2, in2) = local(t)
        let (y, m, d) = Warnings.civilFromDays(Int(d2))
        func pad(_ n: Int64) -> String { String(("0" + String(n)).suffix(2)) }
        return "\(y)-\(pad(Int64(m)))-\(pad(Int64(d))) \(pad(in2 / 3_600_000)):\(pad(in2 / 60_000 % 60))"
    }

    private struct Stopped: Error {}

    private static let fallback = ["pm25", "pm10", "o3", "no2", "co", "so2", "aqi"]

    private static func isAqi(_ code: String?) -> Bool { code.map { JSString.equal($0, "aqi") } ?? false }

    /// `aqiCode + suffix`: an unset code reads `undefined…`.
    private static func key(_ code: String?, _ suffix: String) -> String { (code ?? "undefined") + suffix }

    /// `value[key]`: undefined for a number or boolean, a code unit of a string; reading from undefined or null stops
    /// the apply.
    private static func prop(_ value: JSONValue?, _ key: String) throws -> JSONValue? {
        guard let value, !value.isNull else { throw Stopped() }
        switch value {
        case .object(let o): return o[key]
        case .array(let a):
            guard let i = arrayIndex(key), i < a.count else { return nil }
            return a[i]
        case .string(let s):
            let units = Array(s.utf16)
            guard let i = arrayIndex(key), i < units.count else { return nil }
            return .string(String(decoding: [units[i]], as: UTF16.self))
        default: return nil
        }
    }

    /// `value.hasOwnProperty(key)`; stops for undefined and null.
    private static func hasOwn(_ value: JSONValue?, _ key: String) throws -> Bool {
        guard let value, !value.isNull else { throw Stopped() }
        switch value {
        case .object(let o): return o.contains(key)
        case .array(let a): return key == "length" || arrayIndex(key).map { $0 < a.count } == true
        case .string(let s): return key == "length" || arrayIndex(key).map { $0 < s.utf16.count } == true
        default: return false
        }
    }

    /// A canonical array index (`"0"`, `"12"`), as a property key of an array or string.
    private static func arrayIndex(_ key: String) -> Int? {
        guard let i = Int(key), i >= 0, String(i) == key else { return nil }
        return i
    }

    /// `s.replace(/\s+/g, with)`: each run of JavaScript white space or line terminators.
    static func replacingWhiteSpace(_ s: String, _ with: String) -> String {
        var out = ""
        var inSpace = false
        for scalar in s.unicodeScalars {
            if isJsWhiteSpace(scalar) {
                if !inSpace { out += with }
                inSpace = true
            } else {
                out.unicodeScalars.append(scalar)
                inSpace = false
            }
        }
        return out
    }

    private static func isJsWhiteSpace(_ c: Unicode.Scalar) -> Bool {
        switch c.value {
        case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        case 0x2000...0x200A: return true
        default: return false
        }
    }
}
