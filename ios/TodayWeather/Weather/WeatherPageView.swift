import CoreText
import SwiftUI
import TWDomain
import TWResources

/// A weather page to draw: its model and the charts built for the same scope (IN-08, #2957).
struct WeatherPageContent {
    let type: ForecastType
    let page: ForecastPage
    let metrics: ChartMetrics
    let hourly: HourlyChart?
    let daily: DailyChart?
    /// The visit's complete applies (`ForecastScope.scrolls`): each brings the charts back to today's position.
    var scrolls = 0
    var expanded = false
    /// The photo theme's picture of the place (`[photo-url]`), nil without one.
    var photo: URL? = nil

    init(scope: ForecastScope, units: PageUnits, texts: ChartTexts, photo: URL? = nil) {
        type = scope.type
        page = ForecastPage(scope: scope, units: units, texts: texts)
        metrics = scope.metrics
        let place = scope.chartPlace ?? .init()
        hourly = scope.type == .short && page.showChart
            ? HourlyChart.build(place: place, metrics: scope.metrics, texts: texts, precipUnit: units.precipitation ?? "",
                                windUnit: units.windSpeed ?? "")
            : nil
        daily = scope.type == .mid
            ? DailyChart.build(place: place, metrics: scope.metrics, texts: texts, precipUnit: units.precipitation ?? "")
            : nil
        scrolls = scope.scrolls
        expanded = scope.expand
        self.photo = scope.photoTheme ? photo : nil
    }

    /// The blocks as the references number them: 0 the header block, 1 the chart, then each card and the attribution.
    var blocks: [WeatherBlock] {
        var list: [WeatherBlock] = [.header, .chart]
        if page.hourlyAqi != nil { list.append(.hourlyAqi) }
        if page.currentAir != nil { list.append(.currentAir) }
        if page.detailWeather != nil { list.append(.detailWeather) }
        if page.detailAir != nil { list.append(.detailAir) }
        if page.dailyAqi != nil { list.append(.dailyAqi) }
        if page.dayDetails != nil { list.append(.dayDetails) }
        if page.attribution != nil { list.append(.attribution) }
        return list
    }
}

enum WeatherBlock: Hashable {
    case header, chart, hourlyAqi, currentAir, detailWeather, detailAir, dailyAqi, dayDetails, attribution
}

/// What the page's taps ask for.
struct WeatherPageActions {
    var toggleExpanded: () -> Void = {}
    var previous: () -> Void = {}
    var next: () -> Void = {}
    var perform: (PageAction) -> Void = { _ in }
}

/// S03 (Hourly) or S04 (Daily) as tab-forecast.html and tab-dailyforecast.html draw them (#2957): the first card with
/// the header block (photo, arrows, temperature, sky image, summary) and the chart, then the cards and the data-source
/// notice, on the theme's page color. The shell's header bar lies over the header block's top. Port of the Android
/// `WeatherPage` with the Cordova iOS measures.
struct WeatherPageView: View {
    let content: WeatherPageContent
    let theme: Theme
    var actions = WeatherPageActions()
    /// False: the blocks at the top without a scroll view (the screenshot tests render it, as `HourlyChartFrame`).
    var scrolls = true
    @Environment(\.sizeCategory) private var sizeCategory

    var body: some View {
        let colors = WeatherColors.of(theme, daily: content.type == .mid)
        let stack = VStack(spacing: 0) {
            VStack(spacing: 0) {
                WeatherBlockView(block: .header, content: content, theme: theme, actions: actions)
                Spacer().frame(height: WeatherMetrics.gap)
                WeatherBlockView(block: .chart, content: content, theme: theme, actions: actions)
                Spacer().frame(height: WeatherMetrics.cardPadding)
            }
            .background(colors.card.color)
            .cardShadow()
            Spacer().frame(height: WeatherMetrics.gap)
            ForEach(content.blocks.dropFirst(2), id: \.self) { block in
                WeatherBlockView(block: block, content: content, theme: theme, actions: actions)
                if block != .attribution { Spacer().frame(height: WeatherMetrics.gap) }
            }
        }
        Group {
            if scrolls {
                ScrollView(.vertical, showsIndicators: false) { stack }
            } else {
                stack.frame(maxHeight: .infinity, alignment: .top)
            }
        }
        // Not into the safe area: the shell lays the page out under its own status bar color.
        .background(colors.page.color, ignoresSafeAreaEdges: [])
    }
}

extension View {
    /// `.card { box-shadow: 0 1px 1px rgba(0, 0, 0, .1) }`: a soft line under a card.
    func cardShadow() -> some View {
        overlay(alignment: .bottom) {
            Color.black.opacity(0.08).frame(height: 1).offset(y: 1)
        }
    }
}

/// One block of a weather page. The screenshot tests render each block alone, as the references cut them.
struct WeatherBlockView: View {
    let block: WeatherBlock
    let content: WeatherPageContent
    let theme: Theme
    var actions = WeatherPageActions()
    /// The chart's horizontal offset when rendered without a scroll view (nil: the live scroll view).
    var chartOffset: Double? = nil
    @Environment(\.sizeCategory) private var sizeCategory

    var body: some View {
        let colors = WeatherColors.of(theme, daily: content.type == .mid)
        let s = TextScale(sizeCategory)
        let page = content.page
        switch block {
        case .header:
            HeaderBlock(page: page, metrics: content.metrics, theme: theme, colors: colors, photo: content.photo, s: s,
                        actions: actions)
        case .chart:
            chart(colors)
        case .hourlyAqi:
            Card(title: page.hourlyAqiTitle, colors: colors, s: s, action: { actions.perform(.airInfo("aqi")) }) {
                AqiTable(cells: page.hourlyAqi ?? [], colors: colors, s: s, perform: nil)
            }
        case .currentAir:
            Card(title: nil, colors: colors, s: s) {
                AqiTable(cells: page.currentAir ?? [], colors: colors, s: s, perform: actions.perform)
            }
        case .detailWeather:
            Card(title: page.detailWeatherTitle, colors: colors, s: s) {
                WeatherRows(rows: page.detailWeather ?? [], theme: theme, colors: colors, s: s, perform: actions.perform)
            }
        case .detailAir:
            Card(title: page.detailAirTitle, colors: colors, s: s) {
                AirRows(rows: page.detailAir ?? [], colors: colors, s: s, perform: actions.perform)
            }
        case .dailyAqi:
            if let aqi = page.dailyAqi {
                Card(title: aqi.title, colors: colors, s: s) {
                    if let cells = aqi.cells {
                        AqiTable(cells: cells, colors: colors, s: s, perform: nil)
                            .contentShape(Rectangle())
                            .onTapGesture { actions.perform(.airInfo("aqi")) }
                    }
                    if let rows = aqi.legacyRows { DustRows(rows: rows, colors: colors, s: s, perform: actions.perform) }
                }
            }
        case .dayDetails:
            Card(title: page.detailWeatherTitle, colors: colors, s: s) {
                DayCells(days: page.dayDetails ?? [], theme: theme, colors: colors, s: s, scrolls: chartOffset == nil)
            }
        case .attribution:
            if let attribution = page.attribution {
                AttributionView(attribution: attribution, colors: colors, s: s) { actions.perform(.url(attribution.url)) }
            }
        }
    }

    /// The chart block: the IN-05 charts in the theme's colors, zoomed with the text size (the columns are a seventh of
    /// the screen, so the chart grows as a whole and scrolls further).
    @ViewBuilder private func chart(_ colors: WeatherColors) -> some View {
        if content.type == .short, let hourly = content.hourly {
            if let offset = chartOffset {
                HourlyChartFrame(chart: hourly, expanded: content.expanded, offset: offset, colors: colors.chart)
            } else {
                HourlyChartView(chart: hourly, expanded: content.expanded, applyCount: content.scrolls, colors: colors.chart,
                                onToggleExpanded: actions.toggleExpanded)
            }
        } else if content.type == .mid, let daily = content.daily {
            if let offset = chartOffset {
                DailyChartFrame(chart: daily, offset: offset, colors: colors.chart)
            } else {
                DailyChartView(chart: daily, applyCount: content.scrolls, colors: colors.chart)
            }
        }
    }
}

// MARK: - The header block

/// `[md-page-header]`: at least `headerHeight` tall with 64 pt above its content (the bar, on iOS) and 5 pt below (22 pt
/// in the photo theme), the photo under it, and the main box (80 % wide) between the arrows, centered.
private struct HeaderBlock: View {
    let page: ForecastPage
    let metrics: ChartMetrics
    let theme: Theme
    let colors: WeatherColors
    let photo: URL?
    let s: TextScale
    let actions: WeatherPageActions

    var body: some View {
        GeometryReader { g in
            let width = g.size.width
            ZStack {
                if let photo { PhotoBox(url: photo) }
                HStack(spacing: 0) {
                    if page.arrows { arrow(Glyphs.chevronLeft, width: width, label: "previous", action: actions.previous) }
                    MainBox(page: page, metrics: metrics, theme: theme, colors: colors, s: s, width: width * 0.8,
                            perform: actions.perform)
                        .frame(width: width * 0.8)
                    if page.arrows { arrow(Glyphs.chevronRight, width: width, label: "next", action: actions.next) }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.top, WeatherMetrics.headerTop)
                .padding(.bottom, colors.headerBottom)
            }
        }
        .frame(height: height)
        .background(colors.header.color)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 20).onEnded { value in
            // Ionic's swipe: a horizontal fling; left shows the next place.
            let dx = value.predictedEndTranslation.width
            guard abs(value.translation.width) > abs(value.translation.height) else { return }
            if dx < -60 { actions.next() } else if dx > 60 { actions.previous() }
        })
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("forecast-header")
    }

    /// The block's height: `min-height: headerHeight`, or the content with its padding when taller (larger text).
    var height: CGFloat {
        let content = MainBox.height(page: page, metrics: metrics, s: s, width: (UIScreenWidth.value) * 0.8)
        return max(metrics.headerHeight, WeatherMetrics.headerTop + content + colors.headerBottom)
    }

    /// `.main-box-arrow`: 10 % wide, the chevron (17 pt Ionicons) centered; a tap switches the place.
    private func arrow(_ glyph: String, width: CGFloat, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            CssLine(runs: [CssRun(text: glyph, size: 17, face: .ionicons)], color: colors.headerText, outline: colors.headerOutline)
                .frame(width: width * 0.1, height: width * 0.14 + 17)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityIdentifier("forecast-\(label)")
    }
}

/// The width the header's main box is laid out for when its height is needed before layout: the screen's.
enum UIScreenWidth {
    @MainActor static var value: CGFloat {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first?.screen.bounds.width ?? 393
    }
}

/// `.main-box`: the temperature with its unit sign (`vertical-align: super`) and the sky image side by side, then the
/// summary lines (21 pt on 24 pt lines, centered, wrapping as WebKit wraps them).
private struct MainBox: View {
    let page: ForecastPage
    let metrics: ChartMetrics
    let theme: Theme
    let colors: WeatherColors
    let s: TextScale
    let width: CGFloat
    let perform: (PageAction) -> Void

    static func height(page: ForecastPage, metrics: ChartMetrics, s: TextScale, width: CGFloat) -> CGFloat {
        guard let hero = page.hero else { return 0 }
        let big = metrics.bigFontSize
        let temp = CssLine.metrics([CssRun(text: hero.temperature, size: big)])
        let lines = SummaryLines.lines(hero.summary, size: s(21), width: width).count
            + (hero.summaryAir.map { SummaryLines.lines($0, size: s(21), width: width).count } ?? 0)
        return temp.ascent + temp.descent + CGFloat(lines) * s(24)
    }

    var body: some View {
        if let hero = page.hero {
            let big = metrics.bigFontSize
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    CssLine(runs: [CssRun(text: hero.temperature, size: big, weight: .light),
                                   CssRun(text: "˚", size: big / 2, weight: .light)],
                            color: colors.headerText, outline: colors.headerOutline, raise: [1: WeatherMetrics.superRaise(big)])
                    ThemeImage(image: hero.sky, theme: theme, height: metrics.bigImageSize)
                }
                SummaryLines(text: hero.summary, colors: colors, s: s, width: width)
                if let air = hero.summaryAir {
                    SummaryLines(text: air, colors: colors, s: s, width: width)
                        .contentShape(Rectangle())
                        .onTapGesture { perform(.airInfo("aqi")) }
                        .accessibilityAddTraits(.isButton)
                        .accessibilityIdentifier("forecast-summary-air")
                }
            }
        }
    }
}

/// `.main-box-summary`: centered lines of 21 pt text on 24 pt lines, broken where CoreText's typesetter breaks them
/// (ICU line breaking, as WebKit: between words, and between Hangul syllables where a word is too long).
struct SummaryLines: View {
    let text: String
    let colors: WeatherColors
    let s: TextScale
    let width: CGFloat

    static func lines(_ text: String, size: CGFloat, width: CGFloat) -> [String] {
        guard !text.isEmpty else { return [""] }
        let attributed = NSAttributedString(string: text, attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateUIFontForLanguage(.system, size, nil)!])
        let typesetter = CTTypesetterCreateWithAttributedString(attributed)
        let units = text.utf16.count
        var start = 0
        var out: [String] = []
        let utf16 = Array(text.utf16)
        while start < units {
            let count = CTTypesetterSuggestLineBreak(typesetter, start, Double(width))
            let end = min(units, start + max(count, 1))
            var line = String(decoding: utf16[start..<end], as: UTF16.self)
            while line.hasSuffix(" ") { line.removeLast() }
            out.append(line)
            start = end
        }
        return out
    }

    var body: some View {
        let size = s(21), lineHeight = s(24)
        VStack(spacing: 0) {
            ForEach(Array(Self.lines(text, size: size, width: width).enumerated()), id: \.offset) { _, line in
                let m = CssLine.metrics([CssRun(text: line, size: size)])
                // The 24 pt line holds the text's own box centered on it (`line-height` larger or smaller than the box).
                CssLine(runs: [CssRun(text: line, size: size)], color: colors.headerText, outline: colors.headerOutline)
                    .offset(y: (lineHeight - (m.ascent + m.descent)) / 2)
                    .frame(height: lineHeight, alignment: .top)
            }
        }
    }
}

/// `[photo-url]`: the photo under a dark veil fading to white at its bottom, at 0.8 opacity, covering the block from its
/// top left (`background-size: cover`); `img/bg.png` when the photo does not load.
private struct PhotoBox: View {
    let url: URL

    var body: some View {
        GeometryReader { g in
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    ZStack {
                        image.resizable().aspectRatio(contentMode: .fill).frame(width: g.size.width, height: g.size.height,
                                                                                 alignment: .topLeading).clipped()
                        LinearGradient(stops: [.init(color: .black.opacity(0.3), location: 0),
                                               .init(color: .black.opacity(0.3), location: 0.95),
                                               .init(color: .white.opacity(0.9), location: 1)],
                                       startPoint: .top, endPoint: .bottom)
                    }
                case .failure:
                    if let bg = ChartImages.shared["img/bg.png"] {
                        bg.resizable().aspectRatio(contentMode: .fill).frame(width: g.size.width, height: g.size.height,
                                                                              alignment: .topLeading).clipped()
                    }
                default:
                    Color.clear
                }
            }
        }
        .opacity(0.8)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// An image of the theme's weather or icon folder (client/www/data/theme.js), `height` high with its own aspect; nothing
/// for an image the Cordova app does not have either.
struct ThemeImage: View {
    let image: PageImage
    let theme: Theme
    let height: CGFloat

    var body: some View {
        let path = (image.weather ? theme.weather : theme.icons) + "/" + image.name
        if let ui = TWResources.url(path).flatMap({ UIImage(contentsOfFile: $0.path) }) {
            Image(uiImage: ui).resizable().interpolation(.high)
                .frame(width: height * ui.size.width / max(ui.size.height, 1), height: height)
                .accessibilityHidden(true)
        } else {
            Color.clear.frame(width: 0, height: height)
        }
    }
}

// MARK: - Cards

/// A `.card`: 10 pt of padding above and below, the title (15 pt, `.card-title`, 5 pt from the sides, 10 pt above the
/// table) and the table.
private struct Card<Body: View>: View {
    let title: String?
    let colors: WeatherColors
    let s: TextScale
    var action: (() -> Void)? = nil
    @ViewBuilder let body_: () -> Body

    init(title: String?, colors: WeatherColors, s: TextScale, action: (() -> Void)? = nil, @ViewBuilder _ body: @escaping () -> Body) {
        self.title = title
        self.colors = colors
        self.s = s
        self.action = action
        self.body_ = body
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let title {
                CssLine(runs: [CssRun(text: title, size: s(WeatherMetrics.cardTitle))], color: colors.cardTitle)
                    .padding(.horizontal, 5)
                    .padding(.bottom, 10)
            }
            Group {
                if let action {
                    body_().contentShape(Rectangle()).onTapGesture(perform: action).accessibilityAddTraits(.isButton)
                } else {
                    body_()
                }
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.vertical, WeatherMetrics.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(colors.card.color)
        .cardShadow()
    }
}

/// `.rowgroup-vspacing-aqi-box`: equal cells side by side, each a 15 pt heading, 5 pt, a 32 pt sentiment glyph on its
/// 37 pt line, the grade and the value under it. `perform` nil: the table as a whole is the target.
private struct AqiTable: View {
    let cells: [AqiCell]
    let colors: WeatherColors
    let s: TextScale
    let perform: ((PageAction) -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in
                let grade = colors.forced ?? WeatherColors.grade(cell.color) ?? colors.text
                VStack(spacing: 0) {
                    CssLine(runs: [CssRun(text: cell.heading, size: s(15))], color: colors.text)
                    Spacer().frame(height: 5)
                    GlyphText(glyph: cell.glyph, size: 32, color: grade)
                        .frame(height: WeatherMetrics.aqiGlyphLine - 17 + s(17), alignment: .top)
                    CssLine(runs: [CssRun(text: cell.grade, size: s(17))], color: grade)
                    if !cell.value.isEmpty {
                        CssLine(runs: runs(cell.value, base: s(17), colors: colors, s: s), color: colors.text, strut: s(17))
                    }
                }
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .onTapGesture { if let perform, let action = cell.action { perform(action) } }
            }
        }
    }
}

/// A glyph of an icon font on a line of its own size (`<i class="material-icons">`, line-height 1).
private struct GlyphText: View {
    let glyph: String
    let size: CGFloat
    let color: CssColor
    var face: CssRun.Face = .material

    var body: some View {
        Text(glyph).font(face == .material ? Glyphs.material(size) : Glyphs.ionicons(size))
            .foregroundStyle(color.color)
            .frame(height: size)
            .fixedSize()
            .accessibilityHidden(true)
    }
}

/// A row's runs: the row's font, `<small>` at 0.8 of `base`, `.sub-text` at 13 pt, its `<small>` at 10.4 pt, links and
/// the Ionicons arrow after a link.
private func runs(_ runs: [TextRun], base: CGFloat, colors: WeatherColors, s: TextScale) -> [CssRun] {
    runs.map { run in
        switch run.style {
        case .plain: CssRun(text: run.text, size: base, color: colors.forced ?? WeatherColors.grade(run.color))
        case .small: CssRun(text: run.text, size: base * 0.8)
        case .sub: CssRun(text: run.text, size: s(13), color: colors.forced ?? colors.subText)
        case .subSmall: CssRun(text: run.text, size: s(10.4), color: colors.forced ?? colors.subText)
        case .link: CssRun(text: run.text, size: base, color: colors.forced ?? colors.link)
        case .linkArrow: CssRun(text: run.text, size: base, color: colors.forced ?? colors.link, face: .ionicons)
        }
    }
}

/// The height of a table row of a 24 pt image and 17 pt text (24.516 pt at the default size).
private func rowHeight(_ s: TextScale) -> CGFloat {
    let line = CssLine.metrics([CssRun(text: "가", size: s(17))])
    return max(24 + WeatherMetrics.rowImageTop, line.ascent + line.descent + WeatherMetrics.rowExtra)
}

/// `.colgroup-box` of the detail weather card: rows of a 24 pt image (8 pt margins) and its text, as one centered table.
private struct WeatherRows: View {
    let rows: [WeatherRow]
    let theme: Theme
    let colors: WeatherColors
    let s: TextScale
    let perform: (PageAction) -> Void

    var body: some View {
        let height = rowHeight(s)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                if let pollen = row.pollen {
                    PollenButton(row: row, theme: theme, colors: colors, s: s) { perform(.pollen(pollen)) }
                } else {
                    HStack(alignment: .top, spacing: 0) {
                        ThemeImage(image: row.image, theme: theme, height: 24)
                            .padding(.horizontal, 8)
                            .padding(.top, height - 24)
                        // The white space between the image and the text (`<img> <span>`).
                        CssLine(runs: [CssRun(text: " ", size: s(17))] + runs(row.text, base: s(17), colors: colors, s: s),
                                color: colors.forced ?? colors.text)
                            .padding(.top, WeatherMetrics.rowTextTop)
                    }
                    .frame(height: height, alignment: .top)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The pollen row: an Ionic clear button (bold 15 pt at 0.87 opacity, 47 pt high, 12 pt padding) with the image, the
/// risk and an information glyph; it opens the pollen popup.
private struct PollenButton: View {
    let row: WeatherRow
    let theme: Theme
    let colors: WeatherColors
    let s: TextScale
    let action: () -> Void

    var body: some View {
        let color = colors.forced ?? CssColor(0x444444)
        Button(action: action) {
            HStack(spacing: 0) {
                ThemeImage(image: row.image, theme: theme, height: 24).padding(.horizontal, 8)
                CssLine(runs: runs(row.text, base: s(15), colors: colors, s: s).map { var r = $0; r.weight = .bold; return r }
                        + [CssRun(text: " " + Glyphs.informationOutline, size: s(15), face: .ionicons)], color: color)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 47)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(0.87)
        .accessibilityIdentifier("forecast-pollen")
    }
}

/// `.colgroup-box` of the detail AQI card: the labels' column and the values' column (a 24 pt glyph with 8 pt margins and
/// the text), centered as one table.
private struct AirRows: View {
    let rows: [AirRow]
    let colors: WeatherColors
    let s: TextScale
    let perform: (PageAction) -> Void

    var body: some View {
        let height = rowHeight(s)
        let text = colors.forced ?? colors.text
        let labelWidth = rows.map { CssLine.width([CssRun(text: $0.label, size: s(17))]) }.max() ?? 0
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(alignment: .top, spacing: 0) {
                    CssLine(runs: [CssRun(text: row.label, size: s(17))], color: text)
                        .padding(.top, WeatherMetrics.rowTextTop)
                        .frame(width: labelWidth, alignment: .leading)
                    GlyphText(glyph: row.glyph, size: 24, color: colors.forced ?? WeatherColors.grade(row.color) ?? text)
                        .padding(.horizontal, 8)
                        .padding(.top, height - 24)
                    CssLine(runs: [CssRun(text: " ", size: s(17))] + runs(row.text, base: s(17), colors: colors, s: s), color: text)
                        .padding(.top, WeatherMetrics.rowTextTop)
                }
                .frame(height: height, alignment: .top)
                .contentShape(Rectangle())
                .onTapGesture { if let action = row.action { perform(action) } }
                .accessibilityAddTraits(row.action == nil ? [] : .isButton)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The legacy daily dust rows (S04, without `dailyAqiForecast`): the day over two columns with a divider, then PM2.5,
/// PM10 and, when sent, ozone.
private struct DustRows: View {
    let rows: [DustRow]
    let colors: WeatherColors
    let s: TextScale
    let perform: (PageAction) -> Void

    var body: some View {
        VStack(spacing: 10) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                GeometryReader { g in
                    let unit = g.size.width / CGFloat(2 + row.cells.count)
                    HStack(alignment: .top, spacing: 0) {
                        VStack(spacing: 0) {
                            CssLine(runs: [CssRun(text: row.weekday, size: s(15))], color: colors.text)
                            Spacer().frame(height: 5)
                            VStack(spacing: 0) {
                                CssLine(runs: [CssRun(text: row.date, size: s(32))], color: colors.forced ?? colors.text)
                                CssLine(runs: [CssRun(text: row.dayString, size: s(17), weight: .bold)], color: colors.forced ?? colors.text)
                            }
                            .frame(maxWidth: .infinity)
                            .overlay(alignment: .trailing) { colors.divider.color.frame(width: 1) }
                        }
                        .frame(width: unit * 2)
                        ForEach(Array(row.cells.enumerated()), id: \.offset) { _, cell in
                            let grade = colors.forced ?? WeatherColors.grade(cell.color) ?? colors.text
                            VStack(spacing: 0) {
                                CssLine(runs: [CssRun(text: cell.heading, size: s(15))], color: colors.text)
                                Spacer().frame(height: 5)
                                GlyphText(glyph: cell.glyph, size: 32, color: grade).frame(height: WeatherMetrics.aqiGlyphLine, alignment: .top)
                                CssLine(runs: [CssRun(text: cell.grade, size: s(17))], color: grade)
                            }
                            .frame(width: unit)
                            .contentShape(Rectangle())
                            .onTapGesture { if let action = cell.action { perform(action) } }
                        }
                    }
                }
                .frame(height: s(19) + 5 + max(WeatherMetrics.aqiGlyphLine + s(22), s(38) + s(22)))
            }
        }
    }
}

/// `.card-scroll` with `.rowgroup-vspacing-box`: a day per cell, at least 132 pt wide with 5 pt padding, wider for longer
/// texts (`white-space: nowrap`), scrolling when wider than the page; each cell has the calendar title (24 pt in) and
/// rows 10 pt apart of a 24 pt image (8 pt to the text), a 15 pt value and its 13 pt label.
private struct DayCells: View {
    let days: [DayCell]
    let theme: Theme
    let colors: WeatherColors
    let s: TextScale
    let scrolls: Bool

    var body: some View {
        GeometryReader { g in
            let row = HStack(alignment: .top, spacing: 0) {
                ForEach(Array(days.enumerated()), id: \.offset) { _, day in
                    cell(day).frame(minWidth: cellWidth(g.size.width), alignment: .topLeading)
                }
            }
            if scrolls {
                ScrollView(.horizontal, showsIndicators: false) { row }
            } else {
                row
            }
        }
        .frame(height: height)
    }

    /// `min-width: 132px` per cell, and the table at least the card's width (`min-width: 100%`).
    private func cellWidth(_ width: CGFloat) -> CGFloat {
        days.isEmpty ? WeatherMetrics.dayCellMin : max(WeatherMetrics.dayCellMin, width / CGFloat(days.count))
    }

    private var line15: CGFloat { let m = CssLine.metrics([CssRun(text: "가", size: s(15))]); return m.ascent + m.descent }

    private var rowHeight: CGFloat { line15 * 2 }

    private var height: CGFloat {
        let rows = days.map(\.rows.count).max() ?? 0
        return line15 + CGFloat(rows) * (10 + rowHeight)
    }

    private func cell(_ day: DayCell) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            CssLine(runs: [CssRun(text: Glyphs.calendar, size: s(15), face: .ionicons), CssRun(text: " " + day.title, size: s(15))],
                    color: colors.text, strut: s(15))
                .padding(.leading, 24)
            ForEach(Array(day.rows.enumerated()), id: \.offset) { _, r in
                HStack(alignment: .center, spacing: 0) {
                    ThemeImage(image: r.image, theme: theme, height: 24).padding(.trailing, 8)
                    VStack(alignment: .leading, spacing: 0) {
                        CssLine(runs: runs(r.value, base: s(15), colors: colors, s: s), color: colors.text, strut: s(15))
                        CssLine(runs: [CssRun(text: r.label, size: s(13))], color: colors.forced ?? colors.subText, strut: s(15))
                    }
                }
                .frame(height: rowHeight)
                .padding(.top, 10)
            }
        }
        .padding(.horizontal, 5)
    }
}

/// The data-source notice under the cards: the Dark Sky image (160 pt wide) or the Visual Crossing link (12 pt) on an
/// 18 pt line; a tap opens the provider's page.
private struct AttributionView: View {
    let attribution: Attribution
    let colors: WeatherColors
    let s: TextScale
    let open: () -> Void

    var body: some View {
        Group {
            switch attribution {
            case .darkSky:
                if let image = TWResources.url("img/poweredby_darksky.png").flatMap({ UIImage(contentsOfFile: $0.path) }) {
                    Image(uiImage: image).resizable().interpolation(.high)
                        .frame(width: 160, height: 160 * image.size.height / max(image.size.width, 1))
                }
            case .visualCrossing:
                CssLine(runs: [CssRun(text: Attribution.visualCrossingText, size: s(12))], color: colors.attributionLink, strut: s(14))
            }
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .onTapGesture(perform: open)
        .accessibilityAddTraits(.isLink)
        .accessibilityIdentifier("forecast-attribution")
    }
}
