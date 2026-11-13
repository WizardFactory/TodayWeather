import Foundation
import TWModel

/// Translated catalog strings of the charts (`LOC_*` keys); a missing key shows itself, as `$translate` does.
public struct ChartTexts: Sendable {
    private let strings: [String: String]

    public init(_ strings: [String: String]) { self.strings = strings }

    public subscript(key: String) -> String { strings[key] ?? key }

    /// The keys the charts show.
    public static let keys = [
        "LOC_HOUR", "LOC_THIS_DAY_TEMP", "LOC_PREVIOUS_DAY_TEMP",
        "LOC_A_COUPLE_OF_DAYS_AGO", "LOC_THE_DAY_BEFORE_YESTERDAY", "LOC_YESTERDAY", "LOC_TODAY", "LOC_TOMORROW",
        "LOC_THE_DAY_AFTER_TOMORROW", "LOC_TWO_DAYS_AFTER_TOMORROW", "LOC_FROM_TODAY",
        "LOC_SUN", "LOC_MON", "LOC_TUE", "LOC_WED", "LOC_THU", "LOC_FRI", "LOC_SAT",
    ]
}

/// A day label of the hourly header: `left` edge in points from the start of the scrolling content.
public struct DayLabel: Sendable, Equatable {
    public let text: String
    public let left: Double
}

/// The hourly forecast chart of the Cordova forecast tab (`tab-forecast.html` with `ngShortChart` and
/// `ngShortDetailChart` in app.js): the header (day and hour labels), the temperature chart, the pinned legend, the
/// detail rows and the opening scroll offset. `width` is `timeWidth`. Port of Kotlin `chart/HourlyChart.kt`.
public struct HourlyChart: Sendable {
    public let columnWidth: Double
    public let width: Double
    public let dayLabels: [DayLabel]
    public let hourLabels: [String]
    public let chart: Svg
    public let detail: Svg
    public let legendToday: String
    public let legendYesterday: String
    public let openingOffset: Double

    public static let weatherImages = "img/weather_default"
    public static let iconImages = "img/icons_default"

    /// Builds the chart for a converted place (WeatherConverter: `timeTable`, `timeChart`, `currentWeather`), with the
    /// unit labels of the units settings. Nil when the place has no `timeChart` with a today series (the Cordova
    /// directive throws there and draws nothing).
    public static func build(place: JSONObject, metrics: ChartMetrics, texts: ChartTexts, precipUnit: String,
                             windUnit: String) -> HourlyChart? {
        let timeTable = place["timeTable"]?.arrayValue ?? []
        guard let timeChart = place["timeChart"]?.arrayValue, timeChart.count > 1 else { return nil }
        let current = place["currentWeather"]?.objectValue ?? JSONObject()
        let c = metrics.columnWidth
        let width = c * Double(timeTable.count)
        let today = timeChart[1].objectValue ?? JSONObject()
        let dic = Js.number(today["displayItemCount"])
        return HourlyChart(
            columnWidth: c,
            width: width,
            dayLabels: dayLabels(timeTable, c, texts),
            // Angular's `value.time + strHour` drops an undefined operand.
            hourLabels: timeTable.map { t in (t["time"].map { Js.string($0) } ?? "") + texts["LOC_HOUR"] },
            chart: chart(timeChart, current, metrics, width, metrics.hourlyChartHeight(dic), precipUnit),
            detail: detail(timeChart, metrics, width, metrics.detailChartHeight, windUnit),
            legendToday: texts["LOC_THIS_DAY_TEMP"],
            legendYesterday: texts["LOC_PREVIOUS_DAY_TEMP"],
            openingOffset: ChartPosition.todayOffset("short", bodyWidth: metrics.bodyWidth, city: place))
    }

    /// `isNextDay` and `getDayPosition` (controller.forecastctrl.js), not in the last two columns.
    private static func dayLabels(_ timeTable: [JSONValue], _ c: Double, _ texts: ChartTexts) -> [DayLabel] {
        var labels: [DayLabel] = []
        var previousDate: JSONValue?
        for (index, element) in timeTable.enumerated() {
            if index >= timeTable.count - 2 { continue }
            let value = element.objectValue ?? JSONObject()
            let date = value["date"]
            if Js.looseEquals(value["time"], 24) && index == 0 { continue }
            if Js.present(previousDate) && Js.looseEquals(previousDate, date) { continue }
            previousDate = date
            let day = Js.number(value["fromToday"])
            let key = day >= -3 && day <= 3 ? dayFromToday[Int(day + 3)] : dayFromToday.last!
            let d = Js.string(date)
            let column = Js.greater(value["time"], 0) ? index - 1 : index
            let left = c / 2 + Double(column) * c
            labels.append(DayLabel(text: texts[key] + " " + substr(d, 4, 2) + "." + substr(d, 6, 2), left: left))
        }
        return labels
    }

    private static let dayFromToday = [
        "LOC_A_COUPLE_OF_DAYS_AGO", "LOC_THE_DAY_BEFORE_YESTERDAY", "LOC_YESTERDAY", "LOC_TODAY", "LOC_TOMORROW",
        "LOC_THE_DAY_AFTER_TOMORROW", "LOC_TWO_DAYS_AFTER_TOMORROW", "LOC_FROM_TODAY",
    ]

    /// `ngShortChart`.
    private static func chart(_ timeChart: [JSONValue], _ current: JSONObject, _ metrics: ChartMetrics, _ width: Double,
                              _ height: Double, _ precipUnit: String) -> Svg {
        let series = timeChart.map { $0.objectValue ?? JSONObject() }
        let today = series[1]
        var dic = Js.number(today["displayItemCount"])
        if dic.isNaN || dic == 0 { dic = 3 }
        let tableHeight = metrics.shortTableHeight(dic)
        let marginTop = 12 + tableHeight
        let textTop = 5 - tableHeight
        let marginBottom = 12.0
        let s = metrics.iconSize
        let values = series.map { ($0["values"]?.arrayValue ?? []).map { $0.objectValue ?? JSONObject() } }
        let band = D3.band(0, width, values[0].count)
        let ci = Js.number(today["currentIndex"])

        let currentTime = current["time"]
        let currentTemp = d3Value(current["t1h"])
        let liveTime = current["liveTime"]
        let sharp = (liveTime?.isNull == true || Js.looseEquals(.string(Js.string(currentTime) + "00"), liveTime)) &&
            Js.number(currentTime).truncatingRemainder(dividingBy: 3) == 0

        let y = D3.Linear(
            D3.min(values.map { list in lessThan(D3.min(list.map { d3Value(value($0)["t3h"]) }), currentTemp) }),
            D3.max(values.map { list in greaterThan(D3.max(list.map { d3Value(value($0)["t3h"]) }), currentTemp) }),
            height - marginBottom, marginTop)

        var nodes: [SvgNode] = []
        nodes.append(.rect(SvgRect(cls: "current-rect", x: band * ci + band / 2 + 0.5, y: 0, width: band - 0.5, height: height)))
        for (i, d) in values[1].enumerated() {
            let x = band * Double(i) + band / 2 + 0.5
            nodes.append(.line(SvgLine(cls: guideClass(d), x1: x, y1: 0, x2: x, y2: height)))
        }
        for (i, d) in values[1].enumerated() where i != 0 { // the first column's table is removed
            let v = value(d)
            let precip = precipValue(v)
            var subY = 12.0
            if dic >= 1 { subY += s }
            if dic >= 2 { subY += 15 }
            let x = band * Double(i)
            nodes.append(.group(SvgGroup(cls: "hourly-table", children: [
                .image(SvgImage(cls: nil, href: "\(weatherImages)/\(Js.string(v["skyIcon"])).png", x: x - s / 2, y: 0,
                                width: s, height: s)),
                .text(SvgText(cls: "chart-text", x: x, y: dic >= 1 ? s + 12 : nil, dy: nil, text: text(v["pop"]),
                              tspan: Tspan(text: "%", cls: "chart-unit-text"))),
                .text(SvgText(cls: "chart-sub-text", x: x, y: subY - 3, dy: nil, text: precipText(precip),
                              tspan: Tspan(text: precip != nil ? precipUnit : "", cls: "chart-unit-text"))),
            ])))
        }
        for (k, s1) in series.enumerated() {
            let name = Js.string(s1["name"])
            let list = values[k]
            // The line gets the current temperature between the current and the next column (not on the hour).
            var linePoints = list.map { Js.number(value($0)["t3h"]) }
            let cv = JSString.equal(name, "today") ? current : current["yesterday"]?.objectValue
            if !sharp { linePoints.insert(Js.number(cv?["t1h"]), at: spliceIndex(ci + 1, linePoints.count)) }
            let path = linePoints.enumerated().map { (i, t) -> (x: Double, y: Double) in
                let di = Double(i)
                let x: Double
                if !sharp && di == ci + 1 {
                    x = band * di - band / 2 + band / 2
                } else if !sharp && di > ci + 1 {
                    x = band * (di - 1) + band / 2
                } else {
                    x = band * di + band / 2
                }
                return (x, y(t))
            }
            let circles = list.enumerated().map { (i, d) in
                SvgNode.circle(SvgCircle(cls: "circle-\(name)", cx: band * Double(i) + band / 2, cy: y(Js.number(value(d)["t3h"])), r: 10))
            }
            let pointY: Double
            if JSString.equal(name, "today") {
                pointY = y(Js.number(current["t1h"]))
            } else if JSString.equal(name, "yesterday") {
                pointY = y(Js.number(current["yesterday"]?.objectValue?["t1h"]))
            } else {
                pointY = .nan
            }
            let point = SvgCircle(cls: "point circle-\(name)-current", cx: band * (ci + (sharp ? 0 : 0.5)) + band / 2,
                                  cy: pointY, r: sharp ? 10 : 5)
            let labels = list.enumerated().map { (i, d) -> SvgNode in
                let t3h = Js.number(value(d)["t3h"])
                return .text(SvgText(cls: sharp && Double(i) == ci + 1 ? "text-\(name)-current" : "text-\(name)",
                                     x: band * Double(i) + band / 2, y: y(t3h) - marginBottom + textTop, dy: marginTop,
                                     text: Js.numberToString(Js.round(t3h))))
            }
            nodes.append(.group(SvgGroup(cls: "line-group", children: [
                .path(SvgPath(cls: "line line-\(name)", points: path)),
                .group(SvgGroup(cls: "line-point", children: circles)),
                .circle(point),
                .group(SvgGroup(cls: "line-value", children: labels)),
            ])))
        }
        return Svg(width: width, height: height, children: nodes)
    }

    /// `ngShortDetailChart`.
    private static func detail(_ timeChart: [JSONValue], _ metrics: ChartMetrics, _ width: Double, _ height: Double,
                               _ windUnit: String) -> Svg {
        let margin = 12.0
        let textTop = 12.0
        let s = metrics.iconSize
        let series = timeChart.map { $0.objectValue ?? JSONObject() }
        let values = series.map { ($0["values"]?.arrayValue ?? []).map { $0.objectValue ?? JSONObject() } }
        let band = D3.band(0, width, values[0].count)
        let ci = Js.number(series[1]["currentIndex"])
        var nodes: [SvgNode] = []
        nodes.append(.rect(SvgRect(cls: "current-rect", x: band * ci + band / 2 + 0.5, y: 0, width: band - 0.5, height: height)))
        for (i, d) in values[1].enumerated() {
            let x = band * Double(i) + band / 2 + 0.5
            nodes.append(.line(SvgLine(cls: guideClass(d), x1: x, y1: 0, x2: x, y2: margin)))
        }
        for (i, d) in values[1].enumerated() {
            let v = value(d)
            let cx = band * Double(i) + band / 2
            let reh: String
            if Js.truthy(v["reh"]) {
                let n = Js.number(v["reh"])
                reh = Js.numberToString(n - n.truncatingRemainder(dividingBy: 10))
            } else {
                reh = "00"
            }
            nodes.append(.group(SvgGroup(cls: "hourly-table", children: [
                .image(SvgImage(cls: nil, href: "\(iconImages)/wind_direction.png", x: cx - s / 2, y: margin / 2, width: s, height: s,
                                rotation: Rotation(angle: angle(v["vec"]), cx: cx, cy: (margin + s) / 2))),
                .text(SvgText(cls: "chart-text", x: cx, y: margin / 2 + s + textTop, dy: nil, text: text(v["wsd"]),
                              tspan: Tspan(text: windUnit, cls: "chart-unit-text"))),
                .image(SvgImage(cls: nil, href: "\(iconImages)/humidity_\(reh).png", x: cx - s / 2,
                                y: margin / 2 + s + textTop + margin, width: s, height: s)),
                .text(SvgText(cls: "chart-text", x: cx, y: margin / 2 + s * 2 + textTop + margin + textTop, dy: nil,
                              text: text(v["reh"]), tspan: Tspan(text: "%", cls: "chart-unit-text"))),
            ])))
        }
        return Svg(width: width, height: height, children: nodes)
    }

    private static func guideClass(_ d: JSONObject) -> String {
        strictNumber(value(d)["time"], 24) ? "guide-vivid-line" : "guide-line"
    }

    /// `rn1`, `s06` or `r06`, the first that is truthy.
    static func precipValue(_ v: JSONObject) -> JSONValue? {
        for key in ["rn1", "s06", "r06"] where Js.truthy(v[key]) { return v[key] }
        return nil
    }

    /// `rn1`, `s06` or `r06` as the chart shows it: rounded from 10 up.
    static func precipText(_ value: JSONValue?) -> String {
        guard let value else { return "" }
        let n = Js.number(value)
        return n >= 10 ? Js.numberToString(Js.round(n)) : text(value)
    }

    private static func angle(_ vec: JSONValue?) -> Double {
        guard let vec, !vec.isNull else { return .nan }
        return Js.number(vec)
    }
}

/// A value object's `value` (timeChart entries are `{name, value}`).
private func value(_ o: JSONObject) -> JSONObject { o["value"]?.objectValue ?? JSONObject() }

/// A value as `d3.min`/`d3.max` see it: nil for undefined and null, which they skip.
func d3Value(_ e: JSONValue?) -> Double? {
    guard let e, !e.isNull else { return nil }
    return Js.number(e)
}

/// `textContent` of a D3 `.text(v)`: null and undefined give "", anything else JavaScript ToString.
func text(_ e: JSONValue?) -> String {
    guard let e, !e.isNull else { return "" }
    return Js.string(e)
}

/// `a === b` for a number literal.
func strictNumber(_ e: JSONValue?, _ b: Double) -> Bool {
    if case .number(let n) = e { return n.double == b }
    return false
}

/// `minT3h < currentTemp ? minT3h : currentTemp` (undefined compares false).
private func lessThan(_ a: Double?, _ other: Double?) -> Double? {
    if let a, let other, a < other { return a }
    return other
}

private func greaterThan(_ a: Double?, _ other: Double?) -> Double? {
    if let a, let other, a > other { return a }
    return other
}

/// `String.prototype.substr(start, length)` on UTF-16 code units.
func substr(_ s: String, _ start: Int, _ length: Int) -> String {
    let units = Array(s.utf16)
    if start >= units.count { return "" }
    return String(decoding: units[start..<min(units.count, start + length)], as: UTF16.self)
}

/// `Array.prototype.splice` start index for `start` in a list of `size`.
private func spliceIndex(_ start: Double, _ size: Int) -> Int {
    if start.isNaN { return 0 }
    if start >= Double(size) { return size }
    if start <= -Double(size) { return 0 }
    if start < 0 { return size + Int(start) }
    return Int(start)
}
