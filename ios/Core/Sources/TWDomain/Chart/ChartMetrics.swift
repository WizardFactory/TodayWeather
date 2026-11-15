import Foundation

/// Chart sizes from the screen size in points, as the Cordova forecast screen computes them (`initSize` in
/// controller.tabctrl.js; `init`, `getShortTableHeight`, `getMidTableHeight` and `applyWeatherData` in
/// controller.forecastctrl.js). Port of Kotlin `ChartMetrics`, with the iOS branch of `initSize`.
///
/// `bodyWidth` and `bodyHeight` are `screen.width` and `screen.height`: the screen size in points. `iOS` is
/// `ionic.Platform.isIOS()`: on iOS `initSize` subtracts a 20 pt status bar from the header's content height, which
/// changes `bigFontSize` and the chart heights. The app always passes true; false reproduces the Cordova Android
/// build, whose captured scenes the tests also check.
public struct ChartMetrics: Sendable {
    public let bodyWidth: Double
    public let bodyHeight: Double
    public let iOS: Bool

    /// `colWidth`: a seventh of the body, at most 60.
    public let columnWidth: Double
    /// `smallImageSize`: icons in both charts.
    public let iconSize: Double
    /// `headerHeight`: the minimum height of the weather pages' header block, bar included.
    public let headerHeight: Double
    /// `bigFontSize`: the header's temperature; the chart heights grow with it.
    public let bigFontSize: Double

    public init(bodyWidth: Double, bodyHeight: Double, iOS: Bool = true) {
        self.bodyWidth = bodyWidth
        self.bodyHeight = bodyHeight
        self.iOS = iOS
        columnWidth = ChartPosition.columnWidth(bodyWidth)
        iconSize = columnWidth - columnWidth * 0.2 * 2
        let headerRatio: Double
        if bodyHeight < 600 { headerRatio = 2.0 / 5 } else if bodyHeight < 840 { headerRatio = 3.0 / 8 } else { headerRatio = 5.0 / 12 }
        headerHeight = bodyHeight * headerRatio < 192 ? 192 : bodyHeight * headerRatio
        let contentWidth = bodyWidth * 0.8
        var contentHeight = headerHeight - 44 - 5 // header bar 44, bottom padding 5
        if iOS { contentHeight -= 20 } // status bar 20
        contentHeight -= 24 * 3 // line-height 24
        let big = contentWidth / 4 < contentHeight * 0.9 ? contentWidth / 4 : contentHeight * 0.9
        bigFontSize = big < 142.1 ? big : 142.1
    }

    /// `bigImageSize`: the header's sky image.
    public var bigImageSize: Double { bigFontSize * 0.9 }

    /// Rows above the hourly lines for `displayItemCount` (0 or undefined: 3).
    public func shortTableHeight(_ displayItemCount: Double) -> Double {
        let count = displayItemCount.isNaN || displayItemCount == 0 ? 3 : displayItemCount
        var value = 0.0
        if count >= 1 { value += iconSize }
        if count >= 2 { value += 15 }
        if count >= 3 { value += 13 }
        return value
    }

    /// Rows above the daily bars for the `displayItemCount` bit set (0 or undefined: 7).
    public func midTableHeight(_ displayItemCount: Double) -> Double {
        let count = displayItemCount.isNaN || displayItemCount == 0 ? 7 : Js.int32(displayItemCount)
        var value = 17 + iconSize
        value += count & 4 != 0 ? iconSize : iconSize / 2
        if count & 2 != 0 { value += 15 }
        if count & 1 != 0 { value += 13 }
        return value
    }

    public func hourlyChartHeight(_ displayItemCount: Double) -> Double {
        let h = shortTableHeight(displayItemCount) + bigFontSize * 2
        return h < 300 ? h : 300
    }

    /// Margin, icon, text, icon, text, margin.
    public var detailChartHeight: Double { 12 * 2 + iconSize * 2 + 15 * 2 }

    public func dailyChartHeight(_ displayItemCount: Double) -> Double {
        let h = midTableHeight(displayItemCount) + bigFontSize * 1.5
        return h < 300 ? h : 300
    }
}

extension Js {
    /// ECMAScript ToInt32, as the bitwise operators apply it.
    static func int32(_ d: Double) -> Int {
        if d.isNaN || d.isInfinite { return 0 }
        let m = d.rounded(.towardZero).truncatingRemainder(dividingBy: 4_294_967_296)
        let u = m < 0 ? m + 4_294_967_296 : m
        return Int(Int32(bitPattern: UInt32(u)))
    }
}
