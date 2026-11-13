import CoreText
import SwiftUI
import TWDomain

/// Draws a chart scene as WebKit draws the Cordova SVG with the theme's colors: elements in document order,
/// coordinates in points with the scene's top at `top`; elements at NaN positions are skipped, as the browser ignores
/// invalid attributes. Port of the Android `SvgDrawing`.
@MainActor
enum SvgDrawing {
    static func draw(_ svg: Svg, top: Double, colors: ChartColors, in context: inout GraphicsContext) {
        for node in svg.children { draw(node, top: top, colors: colors, in: &context) }
    }

    private static func finite(_ values: Double...) -> Bool { values.allSatisfy { !$0.isNaN && !$0.isInfinite } }

    private static func draw(_ node: SvgNode, top: Double, colors: ChartColors, in context: inout GraphicsContext) {
        switch node {
        case .group(let g):
            for child in g.children { draw(child, top: top, colors: colors, in: &context) }
        case .rect(let r):
            guard finite(r.x, r.y, r.width, r.height) else { return }
            let rect = CGRect(x: r.x, y: r.y + top, width: r.width, height: r.height)
            if r.cls == "chart-bar" { context.fill(Path(rect), with: .color(colors.bar.color)) }
            // current-rect is transparent but in the old theme, where its 1 px stroke has the fill's color.
            if r.cls == "current-rect", let c = colors.currentRect {
                context.fill(Path(rect), with: .color(c.color))
                context.stroke(Path(rect), with: .color(c.color), lineWidth: 1)
            }
        case .line(let l):
            let style: (CssColor, Double)
            switch l.cls {
            case "guide-vivid-line": style = (colors.guideVivid, 0.6)
            case "guide-line": style = (colors.guide, 0.3)
            default: return
            }
            guard finite(l.x1, l.y1, l.x2, l.y2) else { return }
            var path = Path()
            path.move(to: CGPoint(x: l.x1, y: l.y1 + top))
            path.addLine(to: CGPoint(x: l.x2, y: l.y2 + top))
            context.stroke(path, with: .color(style.0.color.opacity(style.1)), lineWidth: 1)
        case .image(let m):
            // Scene geometry is theme-independent; artwork follows the page's theme.
            var href = m.href
            if href.hasPrefix(HourlyChart.weatherImages + "/") {
                href = colors.weatherImages + href.dropFirst(HourlyChart.weatherImages.count)
            } else if href.hasPrefix(HourlyChart.iconImages + "/") {
                href = colors.iconImages + href.dropFirst(HourlyChart.iconImages.count)
            }
            guard finite(m.x, m.y, m.width, m.height), let image = ChartImages.shared[href] else { return }
            var c = context
            // An invalid rotate() (undefined angle) is ignored by the browser.
            if let r = m.rotation, finite(r.angle, r.cx, r.cy) {
                c.translateBy(x: r.cx, y: r.cy + top)
                c.rotate(by: .degrees(r.angle))
                c.translateBy(x: -r.cx, y: -(r.cy + top))
            }
            c.draw(image.interpolation(.high).antialiased(true), in: CGRect(x: m.x, y: m.y + top, width: m.width, height: m.height))
        case .text(let t):
            drawText(t, top: top, colors: colors, in: &context)
        case .path(let p):
            let style: (CssColor, Double)
            if p.cls.hasSuffix("line-today") { style = (colors.lineToday, 2) }
            else if p.cls.hasSuffix("line-yesterday") { style = (colors.lineYesterday, 1) }
            else { return }
            let points = p.points.filter { finite($0.x, $0.y) }
            guard points.count >= 2 else { return }
            var path = Path()
            path.move(to: CGPoint(x: points[0].x, y: points[0].y + top))
            for q in points.dropFirst() { path.addLine(to: CGPoint(x: q.x, y: q.y + top)) }
            context.stroke(path, with: .color(style.0.color),
                           style: StrokeStyle(lineWidth: style.1, lineCap: .butt, lineJoin: .miter, miterLimit: 4))
        case .circle(let c):
            let fill: CssColor, stroke: CssColor
            if c.cls.contains("circle-today-current") {
                (fill, stroke) = (colors.circleTodayCurrent, colors.circleTodayCurrentStroke)
            } else if c.cls.contains("circle-yesterday") {
                (fill, stroke) = (colors.circleYesterday, colors.circleYesterday)
            } else if c.cls.contains("circle-today") {
                (fill, stroke) = (colors.circleToday, colors.circleToday)
            } else {
                return
            }
            guard finite(c.cx, c.cy, c.r) else { return }
            let disc = Path(ellipseIn: CGRect(x: c.cx - c.r, y: c.cy + top - c.r, width: c.r * 2, height: c.r * 2))
            // A fill and a 2 px stroke: the disc reaches r + 1.
            context.fill(disc, with: .color(fill.color))
            context.stroke(disc, with: .color(stroke.color), lineWidth: 2)
        }
    }

    /// Fill and font size of an SVG text class; nil for classes the charts do not draw.
    static func textStyle(_ cls: String, _ colors: ChartColors) -> (CssColor, Double)? {
        switch cls {
        case "chart-text": return (colors.text, CssText.chartText)
        case "chart-sub-text": return (colors.text, CssText.subText)
        case "text-today-current": return (colors.valueTextCurrent, CssText.chartText)
        case "text-today", "text-yesterday", "text-yesterday-current": return (colors.valueText, CssText.chartText)
        default: return nil
        }
    }

    private static func drawText(_ t: SvgText, top: Double, colors: ChartColors, in context: inout GraphicsContext) {
        guard let (color, size) = textStyle(t.cls, colors) else { return }
        // A tspan class sets 10 px units; the daily chart's font-size attribute is invalid and inherits.
        var runs = [(t.text, size)]
        if let s = t.tspan { runs.append((s.text, s.cls == "chart-unit-text" ? CssText.unitText : size)) }
        guard runs.contains(where: { !$0.0.isEmpty }) else { return }
        let baseline = (t.y ?? 0) + (t.dy ?? 0)
        guard finite(baseline, t.x) else { return }
        let line = CssText.line(runs, color: color)
        // text-anchor: middle centers the whole text, tspan included, on x; y + dy is the baseline.
        let x = t.x - CssText.width(line) / 2
        context.withCGContext { cg in CssText.draw(line, x: x, baseline: baseline + top, in: cg) }
    }
}
