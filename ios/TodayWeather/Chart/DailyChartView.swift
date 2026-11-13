import SwiftUI
import TWDomain

/// Vertical layout of the daily chart in points (`tab-dailyforecast.html`, `.chart-scroll`): weekday and date rows with
/// 2 pt padding and the height of their text (`line-height: normal`), the second row 5 pt up (`.row + .row`), then
/// the chart.
struct DailyChartLayout: Equatable {
    let nameRowHeight: Double
    let dateRowTop: Double
    let dateRowHeight: Double
    let chartTop: Double
    let contentHeight: Double

    init(_ chart: DailyChart) {
        nameRowHeight = 4 + CssText.lineHeight(chart.dayNames, size: CssText.smallTitle)
        dateRowTop = nameRowHeight - 5
        dateRowHeight = 4 + CssText.lineHeight(chart.dates, size: CssText.title)
        chartTop = dateRowTop + dateRowHeight
        contentHeight = chartTop + chart.chart.height
    }
}

/// The scrolling content of the daily chart, `chart.width` wide.
struct DailyChartContent: View {
    let chart: DailyChart
    let colors: ChartColors

    var body: some View {
        let layout = DailyChartLayout(chart)
        Canvas { context, _ in
            context.withCGContext { cg in
                func row(_ texts: [String], _ size: Double, _ top: Double) {
                    for (i, text) in texts.enumerated() {
                        let line = CssText.line([(text, size)], color: colors.label)
                        let center = (Double(i) + 0.5) * chart.columnWidth
                        CssText.draw(line, x: center - CssText.width(line) / 2,
                                     baseline: top + 2 + CssText.metrics(text, size: size).ascent, in: cg)
                    }
                }
                row(chart.dayNames, CssText.smallTitle, 0)
                row(chart.dates, CssText.title, layout.dateRowTop)
            }
            SvgDrawing.draw(chart.chart, top: layout.chartTop, colors: colors, in: &context)
        }
        .frame(width: chart.width, height: layout.contentHeight)
    }
}

/// The daily chart at a horizontal scroll offset, without a scroll view (the screenshot tests render this).
struct DailyChartFrame: View {
    let chart: DailyChart
    let offset: Double
    var colors: ChartColors = .light

    var body: some View {
        colors.background.color
            .frame(height: DailyChartLayout(chart).contentHeight)
            .overlay(alignment: .topLeading) { DailyChartContent(chart: chart, colors: colors).offset(x: -offset) }
            .clipped()
    }
}

/// The daily forecast chart of the daily tab (gate G2, #2954): scrolls horizontally and opens at the Cordova scroll
/// position (today in the third column, snapped down to a whole point). Each change of `applyCount` (one per weather
/// apply of the page, also with the same data) scrolls back to that position (``OpeningScrollView``).
struct DailyChartView: View {
    let chart: DailyChart
    var applyCount = 0
    var colors: ChartColors = .light

    var body: some View {
        let layout = DailyChartLayout(chart)
        OpeningScrollView(width: chart.width, height: layout.contentHeight, opening: chart.openingOffset,
                          applyCount: applyCount) {
            DailyChartContent(chart: chart, colors: colors)
        }
        .frame(height: layout.contentHeight)
        .background(colors.background.color)
    }
}
