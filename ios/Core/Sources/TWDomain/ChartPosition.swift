import Foundation
import TWModel

/// Initial horizontal scroll of the charts (`getTodayPosition` in controller.forecastctrl.js); port of Kotlin
/// `ChartPosition`.
public enum ChartPosition {
    public static let tabletWidth = 640.0

    /// Column width of both charts: a seventh of the body, at most 60 points.
    public static func columnWidth(_ bodyWidth: Double) -> Double { min(bodyWidth / 7, 60) }

    /// Offset in points for [chartType] "short" (hourly: one column before the current hour) or "mid" (daily: today
    /// in the third column) for a converted place weather [city].
    public static func todayOffset(_ chartType: String, bodyWidth: Double, city: JSONObject) -> Double {
        let colWidth = columnWidth(bodyWidth)
        var index = 0.0
        if JSString.equal(chartType, "short") {
            guard case .array(let timeChart) = city["timeChart"], timeChart.count > 1 else { return 0 }
            // The Cordova code compares timeChart[1].length (undefined for an object) with the tablet width, which is
            // never true, so it always continues here (anomaly A49).
            index = Js.number(timeChart[1].objectValue?["currentIndex"])
            index = index >= 1 ? index - 1 : 0
            return colWidth * index
        }
        if JSString.equal(chartType, "mid") {
            if bodyWidth >= tabletWidth { return 0 }
            guard case .array(let dayChart) = city["dayChart"], let first = dayChart.first?.objectValue,
                  case .array(let values) = first["values"] else { return 0 }
            let today = city["currentWeather"]?.objectValue?["today"]?.objectValue
            if let todayIndex = today?["index"], Js.present(todayIndex) {
                index = Js.number(todayIndex)
            } else {
                for i in values.indices.reversed() where Js.looseEquals(values[i].objectValue?["fromToday"], 0) {
                    index = Double(i)
                    break
                }
            }
            index = index >= 2 ? index - 2 : 0
            return colWidth * index
        }
        return colWidth * index
    }
}
