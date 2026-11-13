import SwiftUI
import TWDomain

/// Vertical layout of the hourly chart in points, from the Cordova template and styles (`tab-forecast.html`,
/// `.chart-scroll`): day labels in a 14 pt row, hour labels in a row 5 pt up from that row's 5 pt margin
/// (`.row + .row`), with 2 pt padding and the height of their text (`line-height: normal`); the chart; separators;
/// the detail rows; the 24 pt expander row, which ends 10 pt below the wrapper (`margin-bottom: -10px`).
struct HourlyChartLayout: Equatable {
    let hourRowTop = 14.0
    let hourRowHeight: Double
    let chartTop: Double
    let firstSeparator: Double
    let detailTop: Double
    let secondSeparator: Double
    let expanderTop: Double
    let contentHeight: Double
    let wrapperHeight: Double

    init(_ chart: HourlyChart, expanded: Bool) {
        hourRowHeight = 4 + CssText.lineHeight(chart.hourLabels, size: CssText.title)
        chartTop = hourRowTop + hourRowHeight
        firstSeparator = chartTop + chart.chart.height
        detailTop = firstSeparator + 1
        secondSeparator = detailTop + (expanded ? chart.detail.height : 0)
        expanderTop = secondSeparator + 1
        contentHeight = expanderTop + 24
        wrapperHeight = contentHeight - 10
    }
}

/// The scrolling content of the hourly chart: header rows, chart, separators and detail rows, `chart.width` wide.
struct HourlyChartContent: View {
    let chart: HourlyChart
    let expanded: Bool
    let colors: ChartColors

    var body: some View {
        let layout = HourlyChartLayout(chart, expanded: expanded)
        Canvas { context, size in
            context.withCGContext { cg in
                for label in chart.dayLabels {
                    // `.day-title`: absolutely positioned at its left edge, text-align left, at the row's top.
                    let line = CssText.line([(label.text, CssText.dayTitle)], color: colors.label)
                    CssText.draw(line, x: label.left, baseline: CssText.metrics(label.text, size: CssText.dayTitle).ascent, in: cg)
                }
                for (i, text) in chart.hourLabels.enumerated() {
                    // `.chart-title`: a column with 2 pt padding, text centered.
                    let line = CssText.line([(text, CssText.title)], color: colors.label)
                    let center = (Double(i) + 0.5) * chart.columnWidth
                    let baseline = layout.hourRowTop + 2 + CssText.metrics(text, size: CssText.title).ascent
                    CssText.draw(line, x: center - CssText.width(line) / 2, baseline: baseline, in: cg)
                }
            }
            SvgDrawing.draw(chart.chart, top: layout.chartTop, colors: colors, in: &context)
            separator(layout.firstSeparator, size.width, &context)
            if expanded { SvgDrawing.draw(chart.detail, top: layout.detailTop, colors: colors, in: &context) }
            separator(layout.secondSeparator, size.width, &context)
        }
        .frame(width: chart.width, height: layout.contentHeight)
    }

    private func separator(_ top: Double, _ width: Double, _ context: inout GraphicsContext) {
        context.fill(Path(CGRect(x: 0, y: top, width: width, height: 1)), with: .color(colors.separator.color.opacity(0.3)))
    }
}

/// The parts of the hourly chart that stay in place while it scrolls: the legend (`.chart-label`: 10 pt from the
/// right, at the chart height minus 10 pt) and the expander glyph, centered in the visible width.
struct HourlyChartPinned: View {
    let chart: HourlyChart
    let expanded: Bool
    let colors: ChartColors

    var body: some View {
        let layout = HourlyChartLayout(chart, expanded: expanded)
        Canvas { context, size in
            context.withCGContext { cg in
                let rows = [(chart.legendToday, colors.legendToday), (chart.legendYesterday, colors.legendYesterday)]
                    .map { (CssText.line([($0.0, CssText.legend)], color: colors.label), $0.1, $0.0) }
                // Shrink-to-fit: margin 5, border 13, padding 5, the text, margin 5.
                let width = (rows.map { CssText.width($0.0) }.max() ?? 0) + 28
                let box = CGRect(x: size.width - 10 - width, y: chart.chart.height - 10, width: width, height: 41)
                // border-radius 5%: elliptical corners of 5 % of the width and of the height.
                cg.addPath(Path(roundedRect: box, cornerSize: CGSize(width: box.width * 0.05, height: box.height * 0.05)).cgPath)
                cg.setFillColor(colors.legendBox.cgColor)
                cg.fillPath()
                for (i, row) in rows.enumerated() {
                    let top = box.minY + 5 + Double(i) * 18
                    cg.setFillColor(row.1.cgColor)
                    cg.fill(CGRect(x: box.minX + 5, y: top, width: 13, height: 13))
                    // The row is 13 pt high; its text starts at the top with the line box's ascent.
                    CssText.draw(row.0, x: box.minX + 23, baseline: top + CssText.metrics(row.2, size: CssText.legend).ascent, in: cg)
                }
                MaterialIcons.draw(expanded ? "expand_less" : "expand_more", x: (size.width - 24) / 2, top: layout.expanderTop,
                                   color: colors.expander, in: cg)
            }
        }
        .frame(height: layout.wrapperHeight)
        .allowsHitTesting(false)
    }
}

/// The hourly chart at a horizontal scroll offset, without a scroll view: what the scroll view shows at `offset`.
/// The screenshot tests render this composition; ``HourlyChartView`` puts the same content in a scroll view.
struct HourlyChartFrame: View {
    let chart: HourlyChart
    let expanded: Bool
    let offset: Double
    var colors: ChartColors = .light

    var body: some View {
        // The content and the pinned parts are overlays, so the frame takes the proposed (visible) width.
        colors.background.color
            .frame(height: HourlyChartLayout(chart, expanded: expanded).wrapperHeight)
            .overlay(alignment: .topLeading) {
                HourlyChartContent(chart: chart, expanded: expanded, colors: colors).offset(x: -offset)
            }
            .overlay(alignment: .topLeading) { HourlyChartPinned(chart: chart, expanded: expanded, colors: colors) }
            .clipped()
    }
}

/// The hourly forecast chart of the forecast tab (gate G2, #2954): scrolls horizontally and opens at the Cordova
/// scroll position (one column before the current hour, snapped down to a whole point as WebKit's `scrollLeft`); the
/// legend and the expander stay in place. The detail rows show when `expanded`; a tap on the expander row calls
/// `onToggleExpanded` (Cordova `clickExpander`, which also stores `expandShortChart`).
struct HourlyChartView: View {
    let chart: HourlyChart
    let expanded: Bool
    var colors: ChartColors = .light
    var onToggleExpanded: () -> Void = {}

    var body: some View {
        let layout = HourlyChartLayout(chart, expanded: expanded)
        ZStack(alignment: .topLeading) {
            colors.background.color
            OpeningScrollView(width: chart.width, height: layout.contentHeight, opening: chart.openingOffset) {
                HourlyChartContent(chart: chart, expanded: expanded, colors: colors)
            }
            HourlyChartPinned(chart: chart, expanded: expanded, colors: colors)
            // The whole 24 pt row is the expander, as the Cordova `ng-click` element.
            Color.clear
                .frame(height: 24)
                .contentShape(Rectangle())
                .offset(y: layout.expanderTop)
                .onTapGesture(perform: onToggleExpanded)
                .accessibilityElement()
                .accessibilityAddTraits(.isButton)
                .accessibilityIdentifier("chart-expander")
        }
        .frame(height: layout.wrapperHeight, alignment: .topLeading)
        .clipped()
    }
}

/// A horizontal scroll view whose content starts at `opening` points, snapped down to a whole point as WebKit's
/// `scrollLeft` is (and limited by the content's end, as the browser limits it). A new `opening` scrolls again, as the
/// Cordova app sets `scrollLeft` after every apply. iOS 17 has no offset-based scroll position, so a marker view at the
/// offset is the scroll target.
struct OpeningScrollView<Content: View>: View {
    let width: Double
    let height: Double
    let opening: Double
    @ViewBuilder let content: () -> Content

    static func scrollPosition(_ opening: Double) -> Double { max(0, floor(opening)) }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                ZStack(alignment: .topLeading) {
                    content()
                    HStack(spacing: 0) {
                        Color.clear.frame(width: Self.scrollPosition(opening), height: 1)
                        Color.clear.frame(width: 1, height: 1).id(Marker.opening)
                    }
                }
                .frame(width: width, height: height, alignment: .topLeading)
            }
            .onAppear { proxy.scrollTo(Marker.opening, anchor: .leading) }
            .onChange(of: opening) { proxy.scrollTo(Marker.opening, anchor: .leading) }
        }
    }

    private enum Marker: Hashable { case opening }
}
