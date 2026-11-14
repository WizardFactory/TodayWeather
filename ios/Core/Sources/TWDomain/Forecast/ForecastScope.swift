import Foundation
import TWModel

/// The two pages of ForecastCtrl: S03 (`short`, /tab/forecast) and S04 (`mid`, /tab/dailyforecast).
public enum ForecastType: Sendable, Equatable {
    case short
    case mid
}

/// The scope of ForecastCtrl (controller.forecastctrl.js) for one visit of a weather page: `init` when the page opens,
/// then `applyWeatherData` for each place the visit shows, in order. The pages are not cached (`cache: false`), so a
/// visit starts afresh. A Swift nil stands for an unset value (undefined) and `.null` for null, as in `Js`. Port of the
/// Android `ForecastScope`, checked against the corpus (`forecast.json`, the controller itself run for 58 visits).
///
/// Values an apply does not reach keep what an earlier place set, as on the Cordova page: `applyWeatherData` returns
/// early for a place without a daily chart, stops at the first error (a place without current weather keeps the
/// previous summary and lists), and assigns `source` only when the place has one. `ForecastPage` renders the scope.
public struct ForecastScope: Sendable {
    public let type: ForecastType
    public let metrics: ChartMetrics
    /// The temperature unit is °F (`Units.getUnit('temperatureUnit')`), as the next apply and `getTemp` read it.
    public var fahrenheit: Bool
    /// The photo theme (`settingsInfo.theme`), as the next apply reads it.
    public var photoTheme: Bool
    private let yesterday: YesterdayText

    /// `expand`: the hourly chart's detail rows (`expandShortChart`, default false).
    public var expand: Bool

    /// `cityCount`: the enabled places when the page opened (the arrows show above one).
    public private(set) var cityCount: Int?
    public private(set) var hasPush: Bool?
    public private(set) var currentPosition: JSONValue?
    public private(set) var address: JSONValue?
    public private(set) var source: JSONValue?
    public private(set) var photo: JSONValue?
    public private(set) var timeWidth: Double?
    public private(set) var dayWidth: Double?
    public private(set) var currentWeather: JSONValue?
    public private(set) var hourlyAqiForecast: [JSONValue]?
    public private(set) var dailyAqiForecast: JSONValue?
    public private(set) var airForecastPubdate: JSONValue?
    public private(set) var airForecastSource: JSONValue?
    public private(set) var updateTime: String?
    public private(set) var chartShortHeight: Double?
    public private(set) var chartShortDetailHeight: Double?
    public private(set) var chartMidHeight: Double?
    public private(set) var showDetailWeather = false
    public private(set) var summary: JSONValue?
    /// Nil when deleted: `delete $scope.summaryAir` for a place without one.
    public private(set) var summaryAir: JSONValue?
    public private(set) var diffTempStr: String?
    public private(set) var timeTable: JSONValue?
    public private(set) var timeChart: JSONValue?
    public private(set) var dayChart: JSONValue?

    /// The place the charts draw: the chart arrays with the current weather of the apply that assigned them, since the
    /// chart directives redraw when their arrays change.
    public private(set) var chartPlace: JSONObject?

    /// Complete applies so far: each sets the charts' `scrollLeft` back to today's position (the charts' `applyCount`).
    public private(set) var scrolls = 0

    public init(type: ForecastType, metrics: ChartMetrics, fahrenheit: Bool, photoTheme: Bool, yesterday: YesterdayText,
                expandShortChart: Bool?) {
        self.type = type
        self.metrics = metrics
        self.fahrenheit = fahrenheit
        self.photoTheme = photoTheme
        self.yesterday = yesterday
        expand = expandShortChart ?? false
    }

    /// `init`: false when no place is enabled (Cordova opens the start popup instead).
    @discardableResult
    public mutating func open(_ city: JSONObject?, enabledCount: Int, hasPush: Bool) -> Bool {
        if enabledCount == 0 { return false }
        cityCount = enabledCount
        apply(city, hasPush: hasPush)
        return true
    }

    /// `applyWeatherData` for the selected place's record (`city` nil: no place at the selected index).
    public mutating func apply(_ city: JSONObject?, hasPush: Bool) {
        guard let city, city["address"]?.isNull != true else { return }
        guard let dayCharts = city["dayChart"]?.arrayValue else { return }
        guard let firstDay = dayCharts.first, !firstDay.isNull else { return }

        self.hasPush = hasPush
        currentPosition = city["currentPosition"]
        let name = city["name"]
        address = Js.truthy(name) ? name : .string(AddressFormat.shorten(city["address"]?.stringValue))
        if Js.truthy(city["source"]) { source = city["source"] }
        if photoTheme { photo = city["photo"] }

        let c = metrics.columnWidth
        guard let times = Self.length(city["timeTable"]) else { return }
        timeWidth = c * times
        guard let days = Self.length(firstDay.objectValue?["values"]) else { return }
        dayWidth = c * days < metrics.bodyWidth ? metrics.bodyWidth : c * days

        currentWeather = city["currentWeather"]
        hourlyAqiForecast = nil
        dailyAqiForecast = nil
        airForecastPubdate = nil
        airForecastSource = nil
        let airInfoList = city["airInfoList"]
        let airInfo = Js.truthy(airInfoList) ? airInfoList?.arrayValue?.first : nil
        let pollutants = airInfo?.objectValue?["pollutants"]
        let aqi = pollutants?.objectValue?["aqi"]
        if Js.truthy(airInfo) && Js.truthy(pollutants) && Js.truthy(aqi), let info = airInfo?.objectValue {
            airForecastPubdate = info["forecastPubDate"]
            airForecastSource = info["forecastSource"]
            let latest: JSONValue?
            if Js.truthy(info["last"]) {
                latest = info["last"]
            } else if Self.isObject(currentWeather) {
                latest = currentWeather?.objectValue?["arpltn"]
            } else {
                return
            }
            let hourly = aqi?.objectValue?["hourly"]
            if Js.truthy(hourly) {
                guard let rows = hourly?.arrayValue else { return }
                var kept: [JSONValue] = []
                for row in rows {
                    if row.isNull { return }
                    if !Self.isObject(latest) { return }
                    let dataTime = latest?.objectValue?["dataTime"]
                    if Js.greaterOrEqual(row.objectValue?["date"], dataTime) { kept.append(row) }
                }
                hourlyAqiForecast = Array(kept.prefix(4))
            }
            let daily = aqi?.objectValue?["daily"]
            if Js.truthy(daily) {
                if metrics.bodyWidth < 360 {
                    guard let list = daily?.arrayValue else { return }
                    dailyAqiForecast = .array(Array(list.prefix(4)))
                } else {
                    dailyAqiForecast = daily
                }
            }
        }
        updateTime = UpdateTime.of(currentWeather)

        if type == .short {
            let timeChart = city["timeChart"]
            if !Self.isObject(timeChart) { return }
            let today = timeChart?.arrayValue.flatMap { $0.count > 1 ? $0[1] : nil }
            if !Self.isObject(today) { return }
            chartShortHeight = metrics.hourlyChartHeight(Js.number(today?.objectValue?["displayItemCount"]))
            chartShortDetailHeight = metrics.detailChartHeight
        }
        if type == .mid {
            chartMidHeight = metrics.dailyChartHeight(Js.number(firstDay.objectValue?["displayItemCount"]))
        }

        showDetailWeather = true
        if !Self.isObject(currentWeather) { return }
        let cw = currentWeather?.objectValue
        summary = Js.truthy(cw?["summaryWeather"]) ? cw?["summaryWeather"] : cw?["summary"]
        summaryAir = Js.truthy(cw?["summaryAir"]) ? cw?["summaryAir"] : nil
        let yesterdayValue = cw?["yesterday"]
        diffTempStr = ForecastText.diffTodayYesterday(
            cw?["t1h"], Js.truthy(yesterdayValue) ? (yesterdayValue?.objectValue ?? JSONObject()) : nil,
            fahrenheit: fahrenheit, text: yesterday)
        if type == .short {
            timeTable = city["timeTable"]
            timeChart = city["timeChart"]
        }
        if type == .mid { dayChart = city["dayChart"] }
        var place: [(String, JSONValue)] = []
        if let timeTable { place.append(("timeTable", timeTable)) }
        if let timeChart { place.append(("timeChart", timeChart)) }
        if let dayChart { place.append(("dayChart", dayChart)) }
        if let cw { place.append(("currentWeather", .object(cw))) }
        chartPlace = JSONObject(place)
        // A complete apply scrolls both charts to today's position 300 ms later (`getTodayPosition`), the same data too.
        scrolls += 1
    }

    /// `loadWeatherPhotosEvent`: the feed gave the selected place a photo; in the photo theme the page takes it, without
    /// an apply (the charts stay where they are). Nothing for a place without an address or a daily chart.
    public mutating func photoLoaded(_ city: JSONObject?) {
        guard photoTheme, let city, city["address"]?.isNull != true else { return }
        guard let dayChart = city["dayChart"], !dayChart.isNull else { return }
        photo = city["photo"]
    }

    /// `getTemp(temp)`: "" without a value, rounded in °F, otherwise the value as it came.
    public func temp(_ value: JSONValue?) -> String {
        guard let value, !value.isNull else { return "" }
        if fahrenheit { return Js.numberToString(Js.round(Js.number(value))) }
        return Js.display(value)
    }

    /// `showHourlyAqiForecast()`: more than one row.
    public func showHourlyAqiForecast() -> Bool { (hourlyAqiForecast?.count ?? 0) > 1 }

    /// `hasDustForecast()` (S04): the daily AQI list, else today's row has a dust forecast. False where it throws.
    public func hasDustForecast() -> Bool {
        if Js.truthy(dailyAqiForecast) { return true }
        guard let values = dayValues() else { return false }
        for day in values.reversed() {
            if day.isNull { return false }
            if let o = day.objectValue, Js.looseEquals(o["fromToday"], 0) { return o.contains("dustForecast") }
        }
        return false
    }

    /// `checkDailyDetailWeather(day)` (S04): yesterday, today and tomorrow.
    public func checkDailyDetailWeather(_ day: JSONValue?) -> Bool {
        let fromToday = day?.objectValue?["fromToday"]
        return Js.looseEquals(fromToday, -1) || Js.looseEquals(fromToday, 0) || Js.looseEquals(fromToday, 1)
    }

    /// `hasPropertyInThreeDays(names)` (S04): any of `names` truthy in today's daily row (`currentWeather.today.index`)
    /// or its neighbors. False where the Cordova expression throws.
    public func hasPropertyInThreeDays(_ names: [String]) -> Bool {
        guard let today = currentWeather?.objectValue?["today"]?.objectValue else { return false }
        if !Js.truthy(currentWeather) { return false }
        let index = today["index"]
        if !Js.present(index) { return false }
        guard let charts = dayChart?.arrayValue, let first = charts.first, !first.isNull else { return false }
        let table = first.objectValue?["values"]
        if !Js.truthy(table) { return false }
        guard let rows = table?.arrayValue else { return false }
        // nil where `obj[name]` of undefined or null throws.
        func has(_ row: JSONValue?) -> Bool? {
            guard let row, !row.isNull else { return nil }
            guard let o = row.objectValue else { return false }
            return names.contains { Js.truthy(o[$0]) }
        }
        func at(_ i: Double) -> JSONValue? {
            i == i.rounded(.down) && i >= 0 && i < Double(rows.count) ? rows[Int(i)] : nil
        }
        let i = Js.number(index)
        guard let here = has(at(i)) else { return false }
        if here { return true }
        if i > 0 {
            guard let before = has(at(i - 1)) else { return false }
            if before { return true }
        }
        if i < Double(rows.count - 1) {
            // A string index concatenates ("7" + 1 is "71"), which finds no row.
            let next: JSONValue? = index?.stringValue != nil ? nil : at(i + 1)
            guard let after = has(next) else { return false }
            if after { return true }
        }
        return false
    }

    func dayValues() -> [JSONValue]? {
        guard let first = dayChart?.arrayValue?.first, !first.isNull else { return nil }
        return first.objectValue?["values"]?.arrayValue
    }

    /// `x.length`: arrays and strings (UTF-16 units); nil where reading it throws (undefined or null).
    private static func length(_ value: JSONValue?) -> Double? {
        guard let value, !value.isNull else { return nil }
        switch value {
        case .array(let a): return Double(a.count)
        case .string(let s): return Double(s.utf16.count)
        default: return .nan
        }
    }

    /// Whether reading a property of `value` works (anything but undefined and null).
    private static func isObject(_ value: JSONValue?) -> Bool { value.map { !$0.isNull } ?? false }
}
