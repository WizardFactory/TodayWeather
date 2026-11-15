import Foundation
import TWModel

/// The daily forecast chart of the Cordova daily tab (`tab-dailyforecast.html` with `ngMidChart` in app.js): weekday
/// and date header, the chart and the opening scroll offset. `width` is `dayWidth`. Port of Kotlin
/// `chart/DailyChart.kt`.
public struct DailyChart: Sendable {
    public let columnWidth: Double
    public let width: Double
    public let dayNames: [String]
    public let dates: [String]
    public let chart: Svg
    public let openingOffset: Double

    /// Nil when the place has no `dayChart` (the Cordova directive throws there and draws nothing).
    public static func build(place: JSONObject, metrics: ChartMetrics, texts: ChartTexts, precipUnit: String) -> DailyChart? {
        guard let dayCharts = place["dayChart"]?.arrayValue, let first = dayCharts.first else { return nil }
        let dayChart = first.objectValue ?? JSONObject()
        let values = (dayChart["values"]?.arrayValue ?? []).map { $0.objectValue ?? JSONObject() }
        let c = metrics.columnWidth
        let width = c * Double(values.count) < metrics.bodyWidth ? metrics.bodyWidth : c * Double(values.count)
        let height = metrics.dailyChartHeight(Js.number(dayChart["displayItemCount"]))
        return DailyChart(
            columnWidth: c,
            width: width,
            dayNames: values.map { v in
                let n = Js.number(v["dayOfWeek"])
                guard !n.isNaN, n > -1, n < Double(dayNames.count) else { return "" }
                return texts[dayNames[Int(n)]]
            },
            dates: values.map { v in Js.present(v["date"]) ? substr(Js.string(v["date"]), 6, 2) : "" },
            chart: chart(dayChart, values, metrics, width, height, precipUnit),
            openingOffset: ChartPosition.todayOffset("mid", bodyWidth: metrics.bodyWidth, city: place))
    }

    private static let dayNames = ["LOC_SUN", "LOC_MON", "LOC_TUE", "LOC_WED", "LOC_THU", "LOC_FRI", "LOC_SAT"]

    private static func chart(_ dayChart: JSONObject, _ values: [JSONObject], _ metrics: ChartMetrics, _ width: Double,
                              _ height: Double, _ precipUnit: String) -> Svg {
        let marginTop = 18 + metrics.midTableHeight(Js.number(dayChart["displayItemCount"]))
        let marginBottom = 18.0
        let textTop = 5.0
        let s = metrics.iconSize
        let band = D3.band(0, width, values.count)
        let y = D3.Linear(D3.min(values.map { d3Value($0["tmn"]) }), D3.max(values.map { d3Value($0["tmx"]) }),
                          height - marginBottom, marginTop)
        let todayIndex = values.firstIndex { strictNumber($0["fromToday"], 0) }

        var nodes: [SvgNode] = []
        nodes.append(.rect(SvgRect(cls: "current-rect", x: todayIndex.map { band * Double($0) } ?? 0, y: 0,
                                   width: band - 0.5, height: height)))
        let guides = values.indices.map { i in
            SvgNode.line(SvgLine(cls: "guide-line", x1: band * Double(i) + 0.5, y1: 0, x2: band * Double(i) + 0.5, y2: height))
        }
        let bars = values.enumerated().map { (i, d) in
            SvgNode.rect(SvgRect(cls: "chart-bar", x: band * Double(i) + band / 2 - 1, y: y(Js.number(d["tmx"])), width: 2,
                                 height: y(Js.number(d["tmn"])) - y(Js.number(d["tmx"]))))
        }
        nodes.append(.group(SvgGroup(cls: "bar-group", children: guides + bars)))
        for (i, d) in values.enumerated() {
            let am = d["skyAm"]
            let pm = d["skyPm"]
            let x = band * Double(i) + (band - s) / 2
            let sameOrMissing = Js.looseEquals(am, pm) || !Js.present(am) || !Js.present(pm)
            let iconsBottom = s + (sameOrMissing ? s / 3 : s)
            let popShown = Js.greaterOrEqual(d["fromToday"], 0) && Js.truthy(d["pop"])
            let precip = HourlyChart.precipValue(d)
            var children: [SvgNode] = []
            if Js.present(am) {
                children.append(.image(SvgImage(cls: "skyAm", href: "\(HourlyChart.weatherImages)/\(Js.string(am)).png", x: x,
                                                y: 2 + (Js.looseEquals(am, pm) || !Js.present(pm) ? s / 3 : 0), width: s, height: s)))
            }
            if !(Js.looseEquals(am, pm) || !Js.present(pm)) {
                children.append(.image(SvgImage(cls: "skyPm", href: "\(HourlyChart.weatherImages)/\(Js.string(pm)).png", x: x,
                                                y: !Js.present(am) ? 2 + s / 3 : s, width: s, height: s)))
            }
            let center = band * Double(i) + band / 2
            children.append(.text(SvgText(cls: "chart-text", x: center, y: iconsBottom + 14, dy: nil,
                                          text: popShown ? text(d["pop"]) : "",
                                          tspan: Tspan(text: popShown ? "%" : "", cls: "chart-unit-text"))))
            // The tspan's class went to a font-size attribute (app.js), so the unit is 13 px like its text.
            children.append(.text(SvgText(cls: "chart-sub-text", x: center, y: iconsBottom + 2 + (popShown ? 15 : 0) + 10, dy: nil,
                                          text: HourlyChart.precipText(precip),
                                          tspan: Tspan(text: precip != nil ? precipUnit : "", fontSizeAttr: "chart-unit-text"))))
            nodes.append(.group(SvgGroup(cls: "day-table", children: children)))
        }
        nodes.append(.group(SvgGroup(cls: "bar-max-value", children: values.enumerated().map { (i, d) in
            .text(SvgText(cls: "chart-text", x: band * Double(i) + band / 2, y: y(Js.number(d["tmx"])) - marginTop - textTop,
                          dy: marginTop, text: Js.numberToString(Js.round(Js.number(d["tmx"]))) + "˚"))
        })))
        nodes.append(.group(SvgGroup(cls: "bar-min-value", children: values.enumerated().map { (i, d) in
            .text(SvgText(cls: "chart-text", x: band * Double(i) + band / 2, y: y(Js.number(d["tmn"])), dy: marginBottom,
                          text: Js.numberToString(Js.round(Js.number(d["tmn"]))) + "˚"))
        })))
        nodes.append(.circle(SvgCircle(cls: "circle circle-today-current", cx: todayIndex.map { band * Double($0) + band / 2 } ?? 0,
                                       cy: y(Js.number(dayChart["temp"])), r: 5)))
        return Svg(width: width, height: height, children: nodes)
    }
}
