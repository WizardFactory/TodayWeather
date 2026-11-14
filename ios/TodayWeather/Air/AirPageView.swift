import CoreText
import SwiftUI
import TWDomain
import TWModel

/// S05 to draw (IN-09, #2958): its model, the screen sizes, and the hourly series with its standard and `LOC_HOUR` for
/// the chart.
struct AirPageContent {
    let page: AirPage
    let metrics: ChartMetrics
    let series: AirSeries?
    let standard: AirStandard?
    let hour: String
    /// The cell taps so far (`AirScope.scrolls`): each brings the page to the top.
    var scrolls = 0

    init(scope: AirScope, texts: ChartTexts) {
        page = AirPage(scope: scope, texts: texts)
        metrics = scope.metrics
        series = scope.airChart
        standard = scope.standard
        hour = texts["LOC_HOUR"]
        scrolls = scope.scrolls
    }

    /// The blocks as the references number them: 0 the header block, 1 the gauge, then each card.
    var blocks: [AirBlock] {
        var list: [AirBlock] = [.header, .gauge]
        if page.chartTitle != nil { list.append(.chart) }
        if page.daily != nil { list.append(.daily) }
        if page.detail != nil { list.append(.detail) }
        if page.info != nil { list.append(.info) }
        if page.stations != nil { list.append(.stations) }
        return list
    }
}

enum AirBlock: Hashable {
    case header, gauge, chart, daily, detail, info, stations
}

/// What the page's taps ask for: the arrows, a detail cell's pollutant, a station, the current weather (S03) and the
/// info rows (the units page, the forecast source's description O08).
struct AirPageActions {
    var previous: () -> Void = {}
    var next: () -> Void = {}
    var code: (String) -> Void = { _ in }
    var station: (Int) -> Void = { _ in }
    var weather: () -> Void = {}
    var perform: (PageAction) -> Void = { _ in }
}

/// S05 as tab-air.html draws it (#2958): the first card with the header block (arrows, the main box) and the gauge, then
/// the hourly chart, daily forecast, detail, info and station cards, on the theme's page color. The shell's header bar
/// lies over the header block's top. A cell tap brings the page to the top (`$ionicScrollDelegate.scrollTop()`). Port of
/// the Android `AirScreen` with the Cordova iOS measures.
struct AirPageView: View {
    let content: AirPageContent
    let theme: Theme
    var actions = AirPageActions()
    /// False: the blocks at the top without a scroll view (the screenshot tests render it).
    var scrolls = true

    var body: some View {
        let colors = AirColors.of(theme)
        let stack = VStack(spacing: 0) {
            Color.clear.frame(height: 0).id(AirPageView.top)
            VStack(spacing: 0) {
                AirBlockView(block: .header, content: content, theme: theme, actions: actions)
                Spacer().frame(height: WeatherMetrics.gap)
                AirBlockView(block: .gauge, content: content, theme: theme, actions: actions)
                Spacer().frame(height: WeatherMetrics.cardPadding)
            }
            .background(colors.page.card.color)
            .cardShadow()
            Spacer().frame(height: WeatherMetrics.gap)
            ForEach(content.blocks.dropFirst(2), id: \.self) { block in
                AirBlockView(block: block, content: content, theme: theme, actions: actions)
                Spacer().frame(height: WeatherMetrics.gap)
            }
        }
        Group {
            if scrolls {
                ScrollViewReader { proxy in
                    ScrollView(.vertical, showsIndicators: false) { stack }
                        .onChange(of: content.scrolls) { proxy.scrollTo(AirPageView.top, anchor: .top) }
                }
            } else {
                stack.frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .background(colors.page.page.color, ignoresSafeAreaEdges: [])
    }

    static let top = "air-top"
}

/// One block of S05. The screenshot tests render each block alone, as the references cut them.
struct AirBlockView: View {
    let block: AirBlock
    let content: AirPageContent
    let theme: Theme
    var actions = AirPageActions()
    /// The cards' sideways scroll views; false renders them at their start without a scroll view.
    var scrolls = true
    @Environment(\.sizeCategory) private var sizeCategory

    var body: some View {
        let colors = AirColors.of(theme)
        let s = TextScale(sizeCategory)
        let page = content.page
        switch block {
        case .header:
            AirHeader(page: page, metrics: content.metrics, theme: theme, colors: colors, s: s, actions: actions)
        case .gauge:
            AirGaugeView(gauge: page.gauge, colors: colors, s: s)
                .padding(.horizontal, 4)
                .accessibilityIdentifier("air-gauge")
        case .chart:
            Card(title: page.chartTitle, colors: colors.page, s: s) {
                if let series = content.series {
                    AirChartView(series: series, standard: content.standard, hour: content.hour, colors: colors)
                }
            }
            .accessibilityIdentifier("air-chart")
        case .daily:
            Card(title: page.dailyTitle, colors: colors.page, s: s) {
                AirDailyCells(cells: page.daily ?? [], colors: colors, s: s)
            }
        case .detail:
            Card(title: page.detailTitle, colors: colors.page, s: s) {
                AirCellRow(cells: page.detail ?? [], colors: colors, s: s, minimum: 110, preferred: nil, scrolls: scrolls,
                           identifier: { "air-code-\(page.detail?[$0].code ?? "")" }) { i in
                    if let code = page.detail?[i].code { actions.code(code) }
                }
            }
        case .info:
            Card(title: nil, colors: colors.page, s: s) {
                AirRows(rows: page.info ?? [], colors: colors.page, s: s, perform: actions.perform)
            }
            .accessibilityIdentifier("air-info")
        case .stations:
            Card(title: page.stationsTitle, colors: colors.page, s: s) {
                AirCellRow(cells: page.stations ?? [], colors: colors, s: s, minimum: 0, preferred: 110, scrolls: scrolls,
                           identifier: { "air-station-\($0)" }, onTap: actions.station)
            }
            .accessibilityIdentifier("air-stations")
        }
    }
}

// MARK: - The header block

/// `[md-page-header]`: at least `headerHeight` tall with 64 pt above its content (the bar, on iOS) and 5 pt below, the
/// main box (80 % wide) between the arrows, centered. Without a main box the arrows share the space around them.
private struct AirHeader: View {
    let page: AirPage
    let metrics: ChartMetrics
    let theme: Theme
    let colors: AirColors
    let s: TextScale
    let actions: AirPageActions

    var body: some View {
        GeometryReader { g in
            let width = g.size.width
            HStack(spacing: 0) {
                if let main = page.main {
                    if page.arrows { arrow(Glyphs.chevronLeft, width: width, label: "previous", action: actions.previous) }
                    AirMainBox(main: main, metrics: metrics, theme: theme, colors: colors, s: s, width: width * 0.8,
                               onWeather: actions.weather)
                        .frame(width: width * 0.8)
                    if page.arrows { arrow(Glyphs.chevronRight, width: width, label: "next", action: actions.next) }
                } else if page.arrows {
                    // Without the main box each arrow's auto margins share the free space.
                    Spacer(minLength: 0)
                    arrow(Glyphs.chevronLeft, width: width, label: "previous", action: actions.previous)
                    Spacer(minLength: 0)
                    Spacer(minLength: 0)
                    arrow(Glyphs.chevronRight, width: width, label: "next", action: actions.next)
                    Spacer(minLength: 0)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.top, WeatherMetrics.headerTop)
            .padding(.bottom, 5)
        }
        .frame(height: height)
        .background(colors.page.header.color)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 20).onEnded { value in
            // Ionic's swipe: a horizontal fling; left shows the next place.
            let dx = value.predictedEndTranslation.width
            guard abs(value.translation.width) > abs(value.translation.height) else { return }
            if dx < -60 { actions.next() } else if dx > 60 { actions.previous() }
        })
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("air-header")
    }

    /// `min-height: headerHeight`, or the content with its padding when taller (larger text).
    var height: CGFloat {
        let content = page.main.map { AirMainBox.height(main: $0, metrics: metrics, s: s, width: UIScreenWidth.value * 0.8) } ?? 0
        return max(metrics.headerHeight, WeatherMetrics.headerTop + content + 5)
    }

    /// `.main-box-arrow`: 10 % wide, the chevron (17 pt Ionicons) centered; a tap switches the place.
    private func arrow(_ glyph: String, width: CGFloat, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            CssLine(runs: [CssRun(text: glyph, size: 17, face: .ionicons)], color: colors.page.headerText)
                .frame(width: width * 0.1, height: width * 0.14 + 17)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityIdentifier("air-\(label)")
    }
}

/// `.main-box`: the title in its rounded border (17 pt medium, 12 pt padding), the grade or the pollutant's value with its
/// unit (32 pt) in the grade color, the grade line (21 pt on 24 pt lines: the grade text, the face, the advice) and the
/// current weather (`display: inline-flex`), which opens S03.
struct AirMainBox: View {
    let main: AirMain
    let metrics: ChartMetrics
    let theme: Theme
    let colors: AirColors
    let s: TextScale
    let width: CGFloat
    let onWeather: () -> Void

    static func valueSize(_ main: AirMain, _ metrics: ChartMetrics) -> CGFloat {
        main.grade ? metrics.bigFontSize * 0.55 : metrics.bigFontSize
    }

    static func valueRuns(_ main: AirMain, _ metrics: ChartMetrics) -> [CssRun] {
        [CssRun(text: main.value, size: valueSize(main, metrics))] + (main.unit.isEmpty ? [] : [CssRun(text: main.unit, size: 32)])
    }

    static func height(main: AirMain, metrics: ChartMetrics, s: TextScale, width: CGFloat) -> CGFloat {
        let title = CssLine.metrics([CssRun(text: main.title, size: s(17))])
        let value = CssLine.metrics(valueRuns(main, metrics), strut: valueSize(main, metrics))
        let lines = AirGradeLine.lines(main, s: s, width: width).count
        return title.ascent + title.descent + 2 + value.ascent + value.descent + CGFloat(lines) * s(24)
            + AirWeatherRow.height(main.weather, s: s)
    }

    var body: some View {
        let text = colors.page.headerText
        let grade = AirColors.css(main.color) ?? text
        VStack(spacing: 0) {
            CssLine(runs: [CssRun(text: main.title, size: s(17), weight: .medium)], color: colors.titleText)
                .padding(.horizontal, 12)
                .padding(1)
                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(colors.titleBorder.color, lineWidth: 1))
            CssLine(runs: Self.valueRuns(main, metrics), color: grade, strut: Self.valueSize(main, metrics))
                .frame(width: width)
            AirGradeLine(main: main, grade: grade, text: text, s: s, width: width)
            AirWeatherRow(weather: main.weather, theme: theme, text: text, s: s)
                .contentShape(Rectangle())
                .onTapGesture(perform: onWeather)
                .accessibilityAddTraits(.isButton)
                .accessibilityIdentifier("air-weather")
        }
    }
}

/// `.main-box-air-summary` of the grade: the grade text, the face (24 pt, `vertical-align: bottom`, the line's full
/// height) and the advice, centered on 24 pt lines and broken where CoreText breaks them (the face as wide as its glyph).
struct AirGradeLine: View {
    let main: AirMain
    let grade: CssColor
    let text: CssColor
    let s: TextScale
    let width: CGFloat

    /// A line's pieces: text, or the face.
    enum Piece: Equatable { case text(String), face }

    /// The pieces in order: the lead and a space, the face, then a space and the advice (HTML white space collapsed).
    static func pieces(_ main: AirMain) -> [Piece] {
        var out: [Piece] = []
        if !main.lead.isEmpty { out.append(.text(main.lead + " ")) }
        out.append(.face)
        if let advice = main.advice { out.append(.text(" " + advice)) }
        return out
    }

    static func lines(_ main: AirMain, s: TextScale, width: CGFloat) -> [[Piece]] {
        let face = "\u{FFFC}"
        let text = pieces(main).map { if case .text(let t) = $0 { t } else { face } }.joined()
        let font = CTFontCreateUIFontForLanguage(.system, s(21), nil)!
        let attributed = NSMutableAttributedString(string: text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
        if let range = text.range(of: face) {
            let material = MaterialIcons.font.map { CTFontCreateCopyWithAttributes($0, 24, nil, nil) } ?? font
            attributed.addAttribute(NSAttributedString.Key(kCTFontAttributeName as String), value: material,
                                    range: NSRange(range, in: text))
            attributed.replaceCharacters(in: NSRange(range, in: text), with: main.glyph)
        }
        let full = attributed.string
        let units = Array(full.utf16)
        let typesetter = CTTypesetterCreateWithAttributedString(attributed)
        let glyphUnits = Array(main.glyph.utf16)
        var out: [[Piece]] = []
        var start = 0
        while start < units.count {
            let count = CTTypesetterSuggestLineBreak(typesetter, start, Double(width))
            let end = min(units.count, start + max(count, 1))
            var line: [Piece] = []
            var buffer: [UInt16] = []
            var i = start
            while i < end {
                if !glyphUnits.isEmpty, i + glyphUnits.count <= end, Array(units[i..<(i + glyphUnits.count)]) == glyphUnits {
                    if !buffer.isEmpty { line.append(.text(String(decoding: buffer, as: UTF16.self))) }
                    buffer = []
                    line.append(.face)
                    i += glyphUnits.count
                } else {
                    buffer.append(units[i])
                    i += 1
                }
            }
            var tail = String(decoding: buffer, as: UTF16.self)
            while tail.hasSuffix(" ") { tail.removeLast() }
            if !tail.isEmpty { line.append(.text(tail)) }
            if case .text(let first)? = line.first, first.hasPrefix(" ") {
                let trimmed = String(first.drop { $0 == " " })
                line[0] = .text(trimmed)
                if trimmed.isEmpty { line.removeFirst() }
            }
            out.append(line)
            start = end
        }
        return out.isEmpty ? [[]] : out
    }

    var body: some View {
        let size = s(21), lineHeight = s(24)
        let m = CssLine.metrics([CssRun(text: "가", size: size)])
        // The text's baseline in the line (its box centered on the line); the face's box is the line's full height
        // (`vertical-align: bottom`, line-height 24px) with the Material font's box centered in it.
        let textBaseline = (lineHeight - (m.ascent + m.descent)) / 2 + m.ascent
        let face = MaterialIcons.font.map { (ceil(CTFontGetAscent($0)), ceil(CTFontGetDescent($0))) } ?? (24, 0)
        let faceBaseline = (lineHeight - (face.0 + face.1)) / 2 + face.0
        let lines = Self.lines(main, s: s, width: width)
        // Drawn with CoreText, as WebKit sets each piece on its own baseline: SwiftUI's baseline offsets move the whole
        // line.
        Canvas { context, canvas in
            for (row, line) in lines.enumerated() {
                let pieces = line.map { piece -> (CTLine, CGFloat) in
                    switch piece {
                    case .face:
                        let font = MaterialIcons.font ?? CssText.font(24)
                        return (CTLineCreateWithAttributedString(NSAttributedString(string: main.glyph, attributes: [
                            NSAttributedString.Key(kCTFontAttributeName as String): font,
                            NSAttributedString.Key(kCTForegroundColorAttributeName as String): grade.cgColor,
                        ])), faceBaseline)
                    case .text(let t):
                        return (CssText.line([(t, size)], color: text), textBaseline)
                    }
                }
                let total = pieces.reduce(0) { $0 + CssText.width($1.0) }
                var x = (canvas.width - total) / 2
                let top = CGFloat(row) * lineHeight
                context.withCGContext { cg in
                    for (ct, baseline) in pieces {
                        CssText.draw(ct, x: x, baseline: top + baseline, in: cg)
                        x += CssText.width(ct)
                    }
                }
            }
        }
        .frame(width: width, height: lineHeight * CGFloat(lines.count))
        .accessibilityElement()
        .accessibilityLabel([main.lead, main.advice ?? ""].filter { !$0.isEmpty }.joined(separator: " "))
    }
}

/// The current weather (`display: inline-flex`): the sky image (24 pt) standing on the baseline of a 21 pt line with
/// `line-height: 24px` (the line's descent under it), and `weather t1h˚` on a 24 pt line, centered beside it.
private struct AirWeatherRow: View {
    let weather: AirWeather
    let theme: Theme
    let text: CssColor
    let s: TextScale

    /// The image's line: above the baseline the image or the strut's ascent with half the leading, below it the strut's
    /// descent with half the leading; at least the text's line.
    static func height(_ weather: AirWeather, s: TextScale) -> CGFloat {
        let m = CssLine.metrics([CssRun(text: "가", size: s(21))])
        let half = (s(24) - (m.ascent + m.descent)) / 2
        return max(max(24, half + m.ascent) + half + m.descent, s(24))
    }

    var body: some View {
        let m = CssLine.metrics([CssRun(text: "가", size: s(21))])
        let half = (s(24) - (m.ascent + m.descent)) / 2
        let above = max(24, half + m.ascent)
        let height = Self.height(weather, s: s)
        HStack(spacing: 0) {
            ThemeImage(image: weather.image, theme: theme, height: 24)
                .padding(.top, above - 24)
                .frame(height: height, alignment: .top)
            CssLine(runs: [CssRun(text: weather.text + (weather.degree ? "˚" : ""), size: s(21))], color: text)
                .offset(y: half)
                .frame(height: s(24), alignment: .top)
                .frame(height: height)
        }
        .frame(height: height)
    }
}

// MARK: - The gauge

/// `.air-std-table`: the value label (bold 15 pt in a rounded border in the grade color, its pointer under it) placed by
/// `getLabelPosition` from the label's and the gauge's widths in whole points (`offsetWidth`), over the standard's bands
/// (a 2 pt top border in the grade's color, its name and `~ bound`, cut with an ellipsis when too long). The label's line
/// holds it on the 15 pt strut's baseline: its text on that baseline, or, empty, its bottom.
struct AirGaugeView: View {
    let gauge: AirGauge
    let colors: AirColors
    let s: TextScale

    var body: some View {
        GeometryReader { g in
            let layout = Self.layout(gauge, s: s, width: g.size.width)
            let color = AirColors.css(gauge.color) ?? CssColor(0xFFFFFF)
            ZStack(alignment: .topLeading) {
                label(color, width: layout.labelWidth)
                    .offset(x: layout.x, y: layout.labelTop)
                HStack(spacing: 0) {
                    ForEach(Array(gauge.bands.enumerated()), id: \.offset) { _, band in
                        let inner = g.size.width / CGFloat(max(gauge.bands.count, 1)) - 2
                        VStack(alignment: .leading, spacing: 0) {
                            (WeatherColors.grade(band.color) ?? colors.page.text).color.frame(height: 2)
                            CssLine(runs: [CssRun(text: Self.fit(band.label, size: s(15), width: inner), size: s(15))],
                                    color: colors.page.text)
                            CssLine(runs: [CssRun(text: Self.fit(band.bound, size: s(15), width: inner), size: s(15))],
                                    color: colors.page.text)
                        }
                        .frame(width: inner, alignment: .leading)
                        .clipped()
                        .padding(.horizontal, 1)
                    }
                }
                .offset(y: layout.row)
            }
        }
        .frame(height: Self.layout(gauge, s: s, width: 0).height)
    }

    /// `#aqistd-label`: the bordered value (10 pt each side) and, under it, the `.line` whose 1 pt right border ends half
    /// the label's width in.
    private func label(_ color: CssColor, width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Group {
                if gauge.label.isEmpty {
                    Color.clear.frame(width: 0, height: 0)
                } else {
                    CssLine(runs: [CssRun(text: gauge.label, size: s(15), weight: .bold)], color: color)
                }
            }
            .padding(.horizontal, 10)
            .padding(1)
            .frame(width: width, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(color.color, lineWidth: 1))
            color.color.frame(width: 1, height: 8).padding(.leading, width / 2)
        }
        .frame(width: width, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(gauge.label)
        .accessibilityIdentifier("air-label")
    }

    struct Layout {
        let labelWidth: CGFloat
        let x: CGFloat
        let labelTop: CGFloat
        /// The bands' top: the label's line height.
        let row: CGFloat
        let height: CGFloat
    }

    static func layout(_ gauge: AirGauge, s: TextScale, width: CGFloat) -> Layout {
        let strut = CssLine.metrics([CssRun(text: "", size: s(15))])
        let text = CssLine.metrics([CssRun(text: gauge.label, size: s(15), weight: .bold)])
        let labelWidth = boldWidth(gauge.label, size: s(15)) + 22
        let labelHeight = (gauge.label.isEmpty ? 2 : text.ascent + text.descent + 2) + 8
        let baseline = gauge.label.isEmpty ? labelHeight : 1 + text.ascent
        let above = max(strut.ascent, baseline)
        let below = max(strut.descent, labelHeight - baseline)
        let x = gauge.labelPosition(width: width.rounded(), labelWidth: labelWidth.rounded())
        let band = 2 + 2 * (strut.ascent + strut.descent)
        return Layout(labelWidth: labelWidth, x: x, labelTop: above - baseline, row: above + below, height: above + below + band)
    }

    /// The width of `text` in the bold system font (`font-weight: 700`).
    static func boldWidth(_ text: String, size: CGFloat) -> CGFloat {
        guard !text.isEmpty else { return 0 }
        let regular = CTFontCreateUIFontForLanguage(.system, size, nil)!
        let bold = CTFontCreateCopyWithSymbolicTraits(regular, size, nil, .traitBold, .traitBold) ?? regular
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): bold]))
        return CTLineGetTypographicBounds(line, nil, nil, nil)
    }

    /// `text-overflow: ellipsis`: the text cut to `width` with `…`.
    static func fit(_ text: String, size: CGFloat, width: CGFloat) -> String {
        if CssLine.width([CssRun(text: text, size: size)]) <= width + 0.01 { return text }
        var chars = Array(text)
        while !chars.isEmpty {
            chars.removeLast()
            let candidate = String(chars) + "…"
            if CssLine.width([CssRun(text: candidate, size: size)]) <= width + 0.01 { return candidate }
        }
        return ""
    }
}

// MARK: - Cards

/// `.rowgroup-vspacing-aqi-box` of the daily forecast: equal cells, each the day (15 pt), 5 pt, the 32 pt face on its
/// 37 pt line and the grade text (17 pt) in the grade color (white without a grade, as `grade2Color(grade, 'white')`).
private struct AirDailyCells: View {
    let cells: [AirCell]
    let colors: AirColors
    let s: TextScale

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in
                AirCellContent(cell: cell, colors: colors, s: s, heading: colors.page.text)
                    .frame(maxWidth: .infinity)
            }
        }
    }
}

/// A cell's heading (15 pt), 5 pt, the 32 pt face on its line and the text (17 pt), centered, in the grade color.
struct AirCellContent: View {
    let cell: AirCell
    let colors: AirColors
    let s: TextScale
    let heading: CssColor

    var body: some View {
        let color = AirColors.css(cell.color) ?? colors.page.text
        VStack(spacing: 0) {
            CssLine(runs: [CssRun(text: cell.heading, size: s(15))], color: heading)
            Spacer().frame(height: 5)
            GlyphText(glyph: cell.glyph, size: 32, color: color)
                .frame(height: WeatherMetrics.aqiGlyphLine - 17 + s(17), alignment: .top)
            CssLine(runs: [CssRun(text: cell.text, size: s(17))], color: color, strut: s(17))
        }
    }

    static func width(_ cell: AirCell, s: TextScale) -> CGFloat {
        max(CssLine.width([CssRun(text: cell.heading, size: s(15))]), CssLine.width([CssRun(text: cell.text, size: s(17))]), 32)
    }

    static func height(_ s: TextScale) -> CGFloat {
        let h15 = CssLine.metrics([CssRun(text: "가", size: s(15))]), h17 = CssLine.metrics([CssRun(text: "가", size: s(17))])
        return h15.ascent + h15.descent + 5 + WeatherMetrics.aqiGlyphLine - 17 + s(17) + h17.ascent + h17.descent
    }
}

/// `.card-scroll` with `.rowgroup-hspacing-box`: cells 10 pt apart and from the edges (`border-spacing`), each at least
/// `minimum` (its border included) and wider for longer texts, stretched to the card when they do not fill it
/// (`min-width: 100%`), scrolling sideways otherwise; stations take `preferred` (`width: 110px`) and can shrink to their
/// content. A cell has a 1 pt rounded border, 5 pt padding above and below, a gray background when selected; a tap
/// selects it.
struct AirCellRow: View {
    let cells: [AirCell]
    let colors: AirColors
    let s: TextScale
    let minimum: CGFloat
    let preferred: CGFloat?
    let scrolls: Bool
    let identifier: (Int) -> String
    let onTap: (Int) -> Void

    /// The cells' widths in a card `available` wide (Android `Cells`, the auto table layout).
    static func widths(_ cells: [AirCell], s: TextScale, minimum: CGFloat, preferred: CGFloat?, available: CGFloat) -> [CGFloat] {
        let n = CGFloat(cells.count)
        guard n > 0 else { return [] }
        let least = cells.map { max(minimum, AirCellContent.width($0, s: s) + 2) }
        let natural = least.map { max($0, preferred ?? 0) }
        let total = natural.reduce(0, +) + 10 * (n + 1)
        let extra = total < available ? (available - total) / n : 0
        let capacity = natural.reduce(0, +) - least.reduce(0, +)
        let shrink = capacity > 0 ? min(max((total - available) / capacity, 0), 1) : 0
        return natural.enumerated().map { i, w in w + extra - (w - least[i]) * shrink }
    }

    var body: some View {
        let height = AirCellContent.height(s) + 12
        GeometryReader { g in
            let widths = Self.widths(cells, s: s, minimum: minimum, preferred: preferred, available: g.size.width)
            let row = HStack(spacing: 10) {
                ForEach(Array(cells.enumerated()), id: \.offset) { i, cell in
                    Button { onTap(i) } label: {
                        AirCellContent(cell: cell, colors: colors, s: s, heading: colors.page.text)
                            .frame(width: widths[i], height: height)
                            .background(cell.selected ? colors.selected.color : Color.clear,
                                        in: RoundedRectangle(cornerRadius: 4))
                            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(colors.cellBorder.color, lineWidth: 1))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(cell.selected ? .isSelected : [])
                    .accessibilityIdentifier(identifier(i))
                }
            }
            .padding(.horizontal, 10)
            if scrolls {
                ScrollView(.horizontal, showsIndicators: false) { row }
            } else {
                row
            }
        }
        .frame(height: height)
    }
}
