import CoreText
import SwiftUI
import TWDomain

/// S05's hourly air chart (ngAirChart) across the card, `height` pt high (`chartAirHeight`): the scene `AirChart.build`
/// makes for the card's width, drawn with `Canvas` as WebKit draws the Cordova SVG (IN-09, #2958). Port of the Android
/// `AirChartView`. The Cordova chart kept the width it was first drawn at; this one follows the card when the window
/// changes. It keeps the Cordova sizes at larger text, as the weather charts do.
struct AirChartView: View {
    let series: AirSeries
    let standard: AirStandard?
    let hour: String
    let colors: AirColors
    var height: Double = 100

    var body: some View {
        GeometryReader { g in
            let chart = AirChart.build(series, standard: standard, hour: hour, width: g.size.width, height: height)
            AirChartCanvas(chart: chart, colors: colors)
        }
        .frame(height: height)
        .accessibilityElement()
        .accessibilityLabel("chart")
    }
}

/// The chart's SVG in document order: each tick's 1 pt line (the current hour's 2 pt line reaching the top) and its 13 pt
/// label centered on it, `dy` 0.71 em under y 9 with the date 1.065 em under that; the axis line; then the bars, which
/// cover the axis, in the grade color (the class color without one) at the other hours' opacity. The axis is crisp
/// (`shape-rendering: crispEdges`): whole device pixels.
struct AirChartCanvas: View {
    let chart: AirChart
    let colors: AirColors
    @Environment(\.displayScale) private var scale

    var body: some View {
        Canvas { context, _ in
            let d = Double(max(scale, 1))
            let bottom = chart.bottom
            let em = 13.0
            // A crisp line `w` pt wide centered on `at` pt: its whole device pixels, in points; an edge halfway between two
            // pixels goes to the upper one, as WebKit snaps it (the 1 pt axis at y 65 covers device rows 193 to 195).
            func crisp(_ at: Double, _ w: Double) -> (Double, Double) {
                ((at * d - w * d / 2 - 0.5).rounded(.up) / d, (w * d).rounded() / d)
            }
            for tick in chart.ticks {
                let (x, w) = crisp(tick.x, tick.current ? 2 : 1)
                let top = tick.current ? 0 : bottom
                let y0 = (top * d).rounded() / d
                let y1 = ((bottom + 6) * d).rounded() / d
                context.fill(Path(CGRect(x: x, y: y0, width: w, height: y1 - y0)), with: .color(colors.axis.color))
                let baseline = bottom + 9 + 0.71 * em
                label(tick.label, x: tick.x, baseline: baseline, in: &context)
                if let date = tick.date { label(date, x: tick.x, baseline: baseline + 1.065 * em, in: &context) }
            }
            if let start = chart.domainStart, let end = chart.domainEnd {
                let (y, h) = crisp(bottom, 1)
                let x0 = (start * d).rounded() / d, x1 = (end * d).rounded() / d
                context.fill(Path(CGRect(x: x0, y: y, width: x1 - x0, height: h)), with: .color(colors.axis.color))
            }
            for bar in chart.bars {
                guard [bar.x, bar.y, bar.width, bar.height].allSatisfy({ !$0.isNaN }), bar.height > 0 else { continue }
                let fill = WeatherColors.grade(bar.fill) ?? colors.bar
                context.fill(Path(CGRect(x: bar.x, y: bar.y, width: bar.width, height: bar.height)),
                             with: .color(fill.color.opacity(bar.current ? 1 : colors.blurry)))
            }
        }
    }

    /// `text-anchor: middle`: the 13 pt text centered on `x` with its baseline at `baseline`.
    private func label(_ text: String, x: Double, baseline: Double, in context: inout GraphicsContext) {
        guard !text.isEmpty else { return }
        let line = CssText.line([(text, 13)], color: colors.axisText)
        let left = x - CssText.width(line) / 2
        context.withCGContext { cg in CssText.draw(line, x: left, baseline: baseline, in: cg) }
    }
}
