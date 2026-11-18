import CoreText
import SwiftUI
import TWDomain
import TWResources
import UIKit

/// The nationwide page on top (`NationScreens.page`) over the tabs, in the window's insets.
struct NationPageView: View {
    let screens: NationScreens
    let insets: ShellInsets

    var body: some View {
        if let page = screens.page {
            NationPageFrame(page: page, content: screens.content, theme: screens.shell.theme, insets: insets,
                            loading: screens.loading, onBack: { screens.back() }, onMode: { screens.choose($0) },
                            onAirType: { screens.choose(airType: $0) })
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("nation-page-\(page.rawValue)")
        }
    }
}

/// A nationwide page (`ion-view` in the side menu's content), as the Cordova iOS build lays it out (measured in
/// TodayWeatherTests/NationReference/nation-<state>.json): the status bar and the 49 pt header bar in the theme's plain
/// colors (`applyIOSStatusBar(theme, '')`, the menu's bar), the back arrow (`ion-ios-arrow-back`) and the title, then
/// the page's content on #F5F5F5 in every theme (`style="background-color: #F5F5F5"` on its ion-content), which starts
/// on the bar's last point (`.has-header`). While S10 or S11 loads, `$ionicLoading` covers the WebView's area, the header
/// included. `scrolls: false` lays the content out at `offset` without a scroll view (the screenshot tests render it,
/// as `SideMenu(scrolls: false)`).
struct NationPageFrame: View {
    let page: NationPage
    let content: NationContent
    let theme: Theme
    let insets: ShellInsets
    var loading = false
    var scrolls = true
    /// The content's scroll position when `scrolls` is false.
    var offset: CGFloat = 0
    var onBack: () -> Void = {}
    var onMode: (Nationwide.Mode) -> Void = { _ in }
    var onAirType: (String) -> Void = { _ in }

    var body: some View {
        let colors = ShellColors.menu(theme)
        ZStack(alignment: .top) {
            VStack(spacing: 0) {
                colors.statusBar.color.frame(height: insets.statusBar)
                ZStack(alignment: .top) {
                    // Ionic draws the header over the content, which starts on the header's last point.
                    body(top: insets.top + ShellMetrics.headerHeight - 1)
                    BarFrame(colors: colors, title: content.title, insets: insets, titleIdentifier: "nation-title",
                             titleOffset: NationMetrics.titleBaseline) {
                        BarButton(glyph: Glyphs.arrowBack, colors: colors, width: SettingsMetrics.backWidth, action: onBack)
                            .accessibilityLabel("back")
                            .accessibilityIdentifier("nation-back")
                    } trailing: {
                        EmptyView()
                    }
                }
            }
            if loading {
                IonicLoading().padding(.top, insets.statusBar)
            }
        }
        .background(NationMetrics.page.color)
    }

    @ViewBuilder private func body(top: CGFloat) -> some View {
        let inner = Group {
            switch page {
            case .nation: NationWeatherBody(content: content, theme: theme, onMode: onMode)
            case .nationAir: NationAirBody(content: content, scrolls: scrolls, onAirType: onAirType)
            case .warnings: WarningsBody(cards: content.cards, note: content.note)
            }
        }
        .padding(.leading, insets.leading).padding(.trailing, insets.trailing).padding(.bottom, insets.bottom)
        if scrolls {
            ScrollView { inner }
                .scrollIndicators(.hidden)
                .padding(.top, top)
                .accessibilityIdentifier("nation-scroll")
        } else {
            inner.offset(y: -offset)
                .frame(minHeight: 0, maxHeight: .infinity, alignment: .top)
                .padding(.top, top)
                .clipped()
        }
    }
}

/// S10: the three mode buttons (`changeWeatherType`), then the map with NationCtrl's labels in the chosen mode.
struct NationWeatherBody: View {
    let content: NationContent
    let theme: Theme
    let onMode: (Nationwide.Mode) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ModeBar(labels: content.modes, onMode: onMode)
                .padding(.top, NationMetrics.modeBarTop)
            // `<p></p>` under the bar: its 10 px bottom margin takes in the map's 2 px.
            NationMap(labels: content.labels, theme: theme, wind: content.mode == .wind)
                .padding(.top, NationMetrics.mapTop)
        }
    }
}

/// S11: the strip of pollutant tabs (`changeAirType`), then the map with NationAirCtrl's labels for the chosen one.
struct NationAirBody: View {
    let content: NationContent
    var scrolls = true
    let onAirType: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            AirStrip(selected: content.airType ?? Nationwide.airTypes[0], scrolls: scrolls, onType: onAirType)
            NationMap(labels: content.labels, theme: .light)
                .padding(.top, NationMetrics.airMapTop)
        }
    }
}

/// `.button-bar.nation-bar`: three `button-dark button-outline` buttons sharing the width (flex 1 from width 0), 34 pt
/// tall, each with a 1 pt #444 left, top and bottom border and the last with its right border too, 4 pt outer corners,
/// 16 pt padding (`.button-bar > .button`). The text is bold 15 pt #444 (`.button` of the app) centered on a 32 pt
/// line, on one line that ends with an ellipsis when it does not fit; the buttons are at 0.87 opacity. While a button
/// is pressed it turns #444 with white text (`.activated`).
struct ModeBar: View {
    let labels: [String]
    let onMode: (Nationwide.Mode) -> Void
    @ScaledMetric(relativeTo: .body) private var textSize = NationMetrics.modeText

    var body: some View {
        ModeBarLayout {
            ForEach(Array(labels.enumerated()), id: \.offset) { i, label in
                Button { Nationwide.Mode(rawValue: i).map(onMode) } label: {
                    Text(label)
                }
                .buttonStyle(ModeButtonStyle(size: textSize, first: i == 0, last: i == labels.count - 1))
                .accessibilityIdentifier("nation-mode-\(i)")
            }
        }
        .frame(height: NationMetrics.modeBarHeight)
        .opacity(0.87)
    }
}

/// Flex's shares: each button is (width − borders − paddings) / 3 plus its padding and borders, at WebKit's fractional
/// positions (130.67, 130.67 and 131.67 pt at 393 pt).
struct ModeBarLayout: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        CGSize(width: proposal.width ?? 393, height: proposal.height ?? NationMetrics.modeBarHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let n = CGFloat(subviews.count)
        let share = max(0, (bounds.width - (n + 1) - n * 2 * NationMetrics.modePadding) / n)
        var x = bounds.minX
        for (i, view) in subviews.enumerated() {
            let width = share + 2 * NationMetrics.modePadding + (i == subviews.count - 1 ? 2 : 1)
            view.place(at: CGPoint(x: x, y: bounds.minY), proposal: ProposedViewSize(width: width, height: bounds.height))
            x += width
        }
    }
}

private struct ModeButtonStyle: ButtonStyle {
    let size: CGFloat
    let first: Bool
    let last: Bool

    func makeBody(configuration: Configuration) -> some View {
        let shape = UnevenRoundedRectangle(topLeadingRadius: first ? 4 : 0, bottomLeadingRadius: first ? 4 : 0,
                                           bottomTrailingRadius: last ? 4 : 0, topTrailingRadius: last ? 4 : 0)
        configuration.label
            .font(.system(size: size, weight: .bold))
            .lineLimit(1)
            .truncationMode(.tail)
            .foregroundStyle(configuration.isPressed ? Color.white : NationMetrics.dark.color)
            .padding(.leading, NationMetrics.modePadding + 1)
            .padding(.trailing, NationMetrics.modePadding + (last ? 1 : 0))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .offset(y: NationMetrics.modeTextBaseline)
            .background(configuration.isPressed ? NationMetrics.dark.color : Color.clear, in: shape)
            .overlay {
                // Left, top and bottom borders; the last button's right border too (the others' lie under the next).
                shape.strokeBorder(NationMetrics.dark.color, lineWidth: 1)
                    .padding(.trailing, last ? 0 : -1)
                    .clipShape(Rectangle())
            }
            .contentShape(Rectangle())
    }
}

/// `ion-scroll` with `.nation-air-label`: a 480 pt row of `.item` tabs that scrolls sideways when the window is
/// narrower; it starts on the header's last point, as the content does. The tabs are 81×54 pt boxes every 79 pt from
/// -1 pt, drawn in order, so each one's left border covers the previous one's right edge; the 52 pt strip clips their
/// top and bottom borders. The chosen tab is `.item-dark`: #444 with a #111 border and white text; the others white with
/// a #ddd border and black text, 16 pt, 17 pt from the tab's left and top edges. `scrolls: false` draws the strip at its
/// start without a scroll view (the screenshot tests render it).
struct AirStrip: View {
    let selected: String
    var scrolls = true
    let onType: (String) -> Void
    @ScaledMetric(relativeTo: .body) private var textSize = NationMetrics.tabText

    var body: some View {
        if scrolls {
            ScrollView(.horizontal) { tabs }
                .scrollIndicators(.hidden)
                .frame(height: NationMetrics.stripHeight)
                .accessibilityIdentifier("nation-strip")
        } else {
            Color.clear.frame(height: NationMetrics.stripHeight)
                .overlay(alignment: .topLeading) { tabs }
                .clipped()
        }
    }

    private var tabs: some View {
            ZStack(alignment: .topLeading) {
                ForEach(Array(Nationwide.airTypes.enumerated()), id: \.offset) { i, type in
                    let chosen = type == selected
                    Button { onType(type) } label: {
                        ZStack(alignment: .topLeading) {
                            Rectangle().fill(chosen ? NationMetrics.dark.color : Color.white)
                            Rectangle().strokeBorder(chosen ? CssColor(0x111111).color : CssColor(0xDDDDDD).color, lineWidth: 1)
                            CssLine(runs: [CssRun(text: type.uppercased(), size: textSize)],
                                    color: chosen ? CssColor(0xFFFFFF) : CssColor(0x000000))
                                .offset(x: NationMetrics.tabTextLeft, y: NationMetrics.tabTextTop)
                        }
                        .frame(width: NationMetrics.tabWidth, height: NationMetrics.tabHeight)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .offset(x: CGFloat(-1 + 79 * i), y: NationMetrics.tabTop)
                    .zIndex(Double(i))
                    .accessibilityIdentifier("nation-tab-\(type)")
                    .accessibilityAddTraits(chosen ? .isSelected : [])
                }
            }
            .frame(width: NationMetrics.stripWidth, height: NationMetrics.stripHeight, alignment: .topLeading)
            .clipped()
    }
}

/// `.nation`: the 330×485 pt map (img/kr.png at its size, top centered) with 2 pt margins, centered in the window. Each
/// label sits at its fixed position in the map; a label that larger text makes reach past the window's right edge moves
/// left to stay whole. In a window narrower than the map (an iPad Split View third, 320 pt) the map and its labels scale
/// down to the window's width, so nothing is cut (IN-18); no iPhone of iOS 17 is that narrow.
struct NationMap: View {
    let labels: [NationLabel]
    let theme: Theme
    var wind = false

    var body: some View {
        GeometryReader { geometry in
            let scale = min(1, geometry.size.width / NationMetrics.mapWidth)
            let width = geometry.size.width / scale
            let x = max(0, (width - NationMetrics.mapWidth) / 2)
            let busanTop = wind ? labels.first { $0.name == "부산" }?.top : nil
            ZStack(alignment: .topLeading) {
                if let ui = TWResources.url("img/kr.png").flatMap({ UIImage(contentsOfFile: $0.path) }) {
                    Image(uiImage: ui).resizable().interpolation(.high)
                        .frame(width: NationMetrics.mapWidth, height: NationMetrics.mapHeight)
                        .offset(x: x)
                        .accessibilityHidden(true)
                }
                ForEach(labels, id: \.name) { label in
                    NationLabelView(label: label, theme: theme)
                        .alignmentGuide(.leading) { d in
                            -min(x + CGFloat(label.left), max(0, width - d.width))
                        }
                        .alignmentGuide(.top) { d in
                            let top = CGFloat(label.top)
                            if label.name == "울산", let busanTop {
                                // At larger text sizes even three intact lines can reach Busan.
                                return -min(top, CGFloat(busanTop) - d.height - 1)
                            }
                            return -top
                        }
                }
            }
            .frame(width: width, alignment: .topLeading)
            .scaleEffect(scale, anchor: .topLeading)
        }
        .frame(height: NationMetrics.mapHeight + 2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("nation-map")
    }
}

/// `.nation-label`: the city's name, then (S10) the weather icon and the values, each line centered, with 4 pt at both
/// sides, on the label's color with 5% elliptic corners. Text is #F5F5F5 at 20 pt on `line-height: normal` lines (25 pt
/// in the captures), units 12 pt on the value's baseline. The icon (36 pt, margin -3 pt above and -12 pt under) makes
/// its own 26 pt line, 21 pt above the baseline, and reaches into the next line, whose text is painted over it. The
/// label is absolutely positioned, so its width is CSS's shrink-to-fit: its longest line, but no wider than the map
/// leaves right of it, and no narrower than its longest unbreakable piece; Korean text wraps between syllables there.
struct NationLabelView: View {
    let label: NationLabel
    let theme: Theme
    @ScaledMetric(relativeTo: .body) private var textSize = NationMetrics.labelText
    @ScaledMetric(relativeTo: .body) private var unitSize = NationMetrics.unitText

    var body: some View {
        let layout = NationLabelLayout(label: label, text: textSize, unit: unitSize)
        VStack(spacing: 0) {
            ForEach(Array(layout.rows.enumerated()), id: \.offset) { _, row in
                switch row {
                case .text(let runs):
                    CssLine(runs: runs, color: NationMetrics.labelColor, strut: textSize)
                        .frame(maxWidth: .infinity)
                case .icon:
                    let m = CssLine.metrics([], strut: textSize)
                    let ascent = max(NationMetrics.iconAbove, m.ascent)
                    // The line keeps its height; the icon overflows it (above by 3 pt, below into the next line).
                    Color.clear.frame(height: ascent + m.descent)
                        .frame(maxWidth: .infinity)
                        .overlay(alignment: .top) {
                            icon(label.icon ?? "")
                                .offset(y: ascent - NationMetrics.iconAbove + NationMetrics.iconMarginTop)
                        }
                    .zIndex(-1)
                }
            }
        }
        .frame(width: layout.width)
        .padding(.horizontal, NationMetrics.labelPadding)
        .background(EllipticRoundedRect().fill(cssColor(label.background).color))
        .fixedSize()
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("nation-label-\(label.name)")
    }

    /// `<img ng-src="{{::weatherImgPath}}/{{getIcon(city.name)}}.png">`: the theme's weather folder, 36 pt high with
    /// its own aspect; nothing for an image the Cordova app does not have either.
    @ViewBuilder private func icon(_ name: String) -> some View {
        if let ui = TWResources.url(theme.weather + "/" + name + ".png").flatMap({ UIImage(contentsOfFile: $0.path) }) {
            let height = NationMetrics.iconHeight
            Image(uiImage: ui).resizable().interpolation(.high)
                .frame(width: height * ui.size.width / max(ui.size.height, 1), height: height)
                .accessibilityHidden(true)
        }
    }
}

/// The rows of a label at its shrink-to-fit width.
struct NationLabelLayout {
    enum Row { case text([CssRun]), icon }
    let rows: [Row]
    let width: CGFloat

    init(label: NationLabel, text: CGFloat, unit: CGFloat) {
        let available = NationMetrics.mapWidth - CGFloat(label.left) - 2 * NationMetrics.labelPadding
        let iconWidth: CGFloat = label.icon == nil ? 0 : NationMetrics.iconHeight
        let lines = [[CssRun(text: label.name, size: text)]] + label.lines.map { line in
            [CssRun(text: line.text, size: text)] + (line.unit.isEmpty ? [] : [CssRun(text: line.unit, size: unit)])
        }
        let longest = lines.map(CssLine.width).max() ?? 0
        // Keep each reported value intact (e.g. 북북서). The map can shift a wide marker
        // left at the viewport edge; wrapping a direction would add height over the next city.
        let valueWidth = lines.dropFirst().map(CssLine.width).max() ?? 0
        let piece = max(Self.minWidth(lines[0]), valueWidth)
        // WebKit's layout units are 1/64 pt.
        let width = ceil(min(max(max(piece, iconWidth), available), max(longest, iconWidth)) * 64) / 64
        var rows: [Row] = []
        for (i, line) in lines.enumerated() {
            rows += Self.wrap(line, width: width).map { Row.text($0) }
            if i == 0, label.icon != nil { rows.append(.icon) }
        }
        self.rows = rows
        self.width = width
    }

    private static func breaks(_ runs: [CssRun]) -> Bool { runs.contains { $0.text.unicodeScalars.contains(where: isHangul) } }

    private static func isHangul(_ s: Unicode.Scalar) -> Bool { (0xAC00...0xD7A3).contains(s.value) || (0x1100...0x11FF).contains(s.value) }

    /// The longest piece that cannot break: a Korean syllable, or a whole line without Korean.
    private static func minWidth(_ runs: [CssRun]) -> CGFloat {
        guard breaks(runs) else { return CssLine.width(runs) }
        return runs.flatMap { run in run.text.map { CssLine.width([CssRun(text: String($0), size: run.size)]) } }.max() ?? 0
    }

    /// A Korean line broken between syllables where it passes `width` (greedy, as WebKit breaks it); other lines whole.
    private static func wrap(_ runs: [CssRun], width: CGFloat) -> [[CssRun]] {
        guard breaks(runs), CssLine.width(runs) > width + 0.01 else { return [runs] }
        var lines: [[CssRun]] = []
        var current: [CssRun] = []
        for run in runs {
            for ch in run.text {
                let piece = CssRun(text: String(ch), size: run.size, weight: run.weight)
                if !current.isEmpty, CssLine.width(current + [piece]) > width + 0.01 {
                    lines.append(merge(current))
                    current = []
                }
                current.append(piece)
            }
        }
        if !current.isEmpty { lines.append(merge(current)) }
        return lines
    }

    private static func merge(_ runs: [CssRun]) -> [CssRun] {
        var out: [CssRun] = []
        for run in runs {
            if let last = out.last, last.size == run.size, last.weight == run.weight {
                out[out.count - 1].text += run.text
            } else {
                out.append(run)
            }
        }
        return out
    }
}

/// `border-radius: 5%`: corners 5% of the width across and 5% of the height down.
struct EllipticRoundedRect: Shape {
    func path(in rect: CGRect) -> Path {
        Path(roundedRect: rect, cornerSize: CGSize(width: rect.width * 0.05, height: rect.height * 0.05), style: .circular)
    }
}

/// `rgba(r,g,b,a)` as a color; the label's translucent black for anything else.
func cssColor(_ css: String) -> CssColor {
    let inside = css.replacingOccurrences(of: " ", with: "")
    guard inside.hasPrefix("rgba("), inside.hasSuffix(")") else { return CssColor(0x000000, alpha: 0.4) }
    let parts = inside.dropFirst(5).dropLast().split(separator: ",").map(String.init)
    guard parts.count == 4, let r = UInt32(parts[0]), let g = UInt32(parts[1]), let b = UInt32(parts[2]), let a = Double(parts[3]),
          r < 256, g < 256, b < 256 else { return CssColor(0x000000, alpha: 0.4) }
    return CssColor(r << 16 | g << 8 | b, alpha: a)
}

/// S12: a `.item.item-body` card per warning, each overlapping the previous one's border by 1 pt, the first on the
/// header's last point. A card is 2 pt wider than the window, so its side borders fall outside it; it has a #ddd border,
/// white background and 16 pt padding, with #444 16 pt text.
struct WarningsBody: View {
    let cards: [WarningCard]
    let note: String

    var body: some View {
        VStack(spacing: -1) {
            ForEach(Array(cards.enumerated()), id: \.offset) { i, card in
                WarningCardView(card: card, note: note)
                    .accessibilityIdentifier("nation-card-\(i)")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("nation-warnings")
    }
}

/// A card of kma-special.html, laid out as WebKit does (the captures' line boxes):
/// - the heading (h2, black 16 pt, `line-height: 1.2` makes 19 pt lines with the text 1 pt above, 16 pt margins);
/// - the image's line (the `<img>` without a source): its own line when blocks follow, else the comment's first line
///   starts on it after the white space that follows the image;
/// - per situation the bold title line, the info lines and the empty line of its `<br>`;
/// - the note heading (types 1 and 2);
/// - the comment's lines (`ng-bind-html`), an empty line where two `<br>` follow each other.
/// Lines are `line-height: normal` (20 pt at 16 pt) and broken where WebKit breaks them (`CssParagraph`).
struct WarningCardView: View {
    let card: WarningCard
    let note: String
    @ScaledMetric(relativeTo: .body) private var textSize = NationMetrics.cardText

    var body: some View {
        let blocks = !card.situations.isEmpty || card.note
        VStack(alignment: .leading, spacing: 0) {
            CssParagraph(text: card.heading, size: textSize, weight: .regular, color: CssColor(0x000000),
                         lineHeight: (textSize * 1.2).rounded(.down))
                .padding(.vertical, NationMetrics.headingMargin)
            if blocks {
                strut
                ForEach(Array(card.situations.enumerated()), id: \.offset) { _, s in
                    CssParagraph(text: s.title, size: textSize, weight: .bold, color: NationMetrics.cardColor)
                    ForEach(Array(s.lines.enumerated()), id: \.offset) { _, line in
                        CssParagraph(text: line, size: textSize, weight: .regular, color: NationMetrics.cardColor)
                    }
                    strut
                }
                if card.note { CssParagraph(text: note, size: textSize, weight: .bold, color: NationMetrics.cardColor) }
            }
            // Without blocks the comment's first line follows the image and the white space after it: one space.
            let comment = blocks ? card.comment
                : card.comment.enumerated().map { $0.offset == 0 && !$0.element.isEmpty ? " " + $0.element : $0.element }
            ForEach(Array(comment.enumerated()), id: \.offset) { _, line in
                if line.isEmpty {
                    strut
                } else {
                    CssParagraph(text: line, size: textSize, weight: .regular, color: NationMetrics.cardColor)
                }
            }
            if !blocks && card.comment.isEmpty { strut }
        }
        .padding(.horizontal, NationMetrics.cardPadding)
        .padding(.vertical, NationMetrics.cardPadding + 1)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .overlay(alignment: .top) { NationMetrics.cardBorder.color.frame(height: 1) }
        .overlay(alignment: .bottom) { NationMetrics.cardBorder.color.frame(height: 1) }
        .accessibilityElement(children: .combine)
    }

    /// An empty line of 16 pt text: the strut's ascent and descent.
    private var strut: some View {
        let m = CssLine.metrics([], strut: textSize)
        return Color.clear.frame(height: m.ascent + m.descent)
    }
}

/// A block of text broken into lines where WebKit breaks it: CoreText's suggested breaks for the system font give the
/// captured lines (between Korean syllables too, `word-break: normal`), each line a `CssLine` (`line-height: normal`),
/// or, with `lineHeight`, a line of that height with the text on the line box's half-leading as WebKit places it.
struct CssParagraph: View {
    let text: String
    let size: CGFloat
    let weight: Font.Weight
    let color: CssColor
    var lineHeight: CGFloat? = nil

    /// The width the block is laid out in; it starts at the 393 pt iPhone's card width (393 + 2 − 2 × 17).
    @State private var width: CGFloat = 361

    var body: some View {
        let lines = Self.lines(text, size: size, weight: weight, width: width)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, text in
                line(text)
            }
        }
        // The width given, not the lines' own: lines broken for a wider window must not hold the block at that width.
        .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
    }

    @ViewBuilder private func line(_ text: String) -> some View {
        let css = CssLine(runs: [CssRun(text: text, size: size, weight: weight)], color: color, strut: size)
        if let lineHeight {
            let m = CssLine.metrics([CssRun(text: text, size: size, weight: weight)], strut: size)
            css.offset(y: ((lineHeight - (m.ascent + m.descent)) / 2).rounded(.down))
                .frame(height: lineHeight, alignment: .top)
        } else {
            // Each line its own box, with the line gap of the fonts it uses below the descent: a fallback font with a
            // gap (Helvetica Neue for ※) makes its line 21 pt where the system font's lines are 20 (the third card).
            css.frame(height: Self.lineHeight(text, size: size, weight: weight), alignment: .top)
        }
    }

    /// `line-height: normal` of one line: the largest rounded-up ascent over the fonts it uses, and the largest
    /// rounded-up descent plus rounded-up line gap (measured: 20 pt for 16 pt system text and Korean, 21 pt for a line
    /// with a Helvetica Neue fallback).
    nonisolated static func lineHeight(_ text: String, size: CGFloat, weight: Font.Weight) -> CGFloat {
        let font = UIFont.systemFont(ofSize: size, weight: weight == .bold ? .bold : .regular) as CTFont
        var ascent = ceil(CTFontGetAscent(font)), below = ceil(CTFontGetDescent(font)) + ceil(CTFontGetLeading(font))
        let attributed = NSAttributedString(string: text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
        for run in CTLineGetGlyphRuns(CTLineCreateWithAttributedString(attributed)) as? [CTRun] ?? [] {
            let attributes = CTRunGetAttributes(run) as NSDictionary
            guard let value = attributes[kCTFontAttributeName], CFGetTypeID(value as CFTypeRef) == CTFontGetTypeID() else { continue }
            let f = value as! CTFont
            ascent = max(ascent, ceil(CTFontGetAscent(f)))
            below = max(below, ceil(CTFontGetDescent(f)) + ceil(CTFontGetLeading(f)))
        }
        return ascent + below
    }

    /// The lines of `text` at `width`: CTTypesetter's suggested breaks with the system font of `size` and `weight`.
    nonisolated static func lines(_ text: String, size: CGFloat, weight: Font.Weight, width: CGFloat) -> [String] {
        if text.isEmpty { return [] }
        let font = UIFont.systemFont(ofSize: size, weight: weight == .bold ? .bold : .regular) as CTFont
        let attributed = NSAttributedString(string: text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
        let typesetter = CTTypesetterCreateWithAttributedString(attributed)
        let ns = text as NSString
        var start = 0
        var out: [String] = []
        while start < ns.length {
            let count = max(1, CTTypesetterSuggestLineBreak(typesetter, start, Double(max(width, 1))))
            // A line's trailing white space hangs (`white-space: normal`).
            out.append(ns.substring(with: NSRange(location: start, length: count)).replacingOccurrences(of: " +$", with: "",
                                                                                                         options: .regularExpression))
            start += count
        }
        return out
    }
}

/// `$ionicLoading` with the app's template (`<ion-spinner icon="bubbles" class="spinner-stable">`): the backdrop (#000
/// at 0.4) over the page, header included, and in the middle a 68×72 pt box (#000 at 0.7, 5 pt corners, 20 pt padding)
/// with the 28 pt spinner in #f8f8f8 at its top left. It takes every touch.
struct IonicLoading: View {
    var body: some View {
        ZStack {
            Color.black.opacity(0.4).contentShape(Rectangle()).onTapGesture {}
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 5).fill(Color.black.opacity(0.7))
                BubblesSpinner(color: CssColor(0xF8F8F8)).padding(20)
            }
            .frame(width: NationMetrics.loadingWidth, height: NationMetrics.loadingHeight)
            .accessibilityIdentifier("nation-loading-box")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("nation-loading")
    }
}

/// Sizes of the Cordova iOS nationwide pages in points (client/scss/ionic.app.scss `.nation*`, Ionic's buttons, items
/// and loading), measured in the captures (TodayWeatherTests/NationReference/nation-<state>.json).
enum NationMetrics {
    static let page = CssColor(0xF5F5F5)
    static let dark = CssColor(0x444444)
    static let titleBaseline: CGFloat = SettingsMetrics.titleBaseline
    /// The mode bar at 51 pt: 2 pt under the content's top (48 pt).
    static let modeBarTop: CGFloat = 3
    static let modeBarHeight: CGFloat = 34
    static let modeText: CGFloat = 15
    static let modePadding: CGFloat = 16
    static let modeTextBaseline: CGFloat = 0
    static let mapTop: CGFloat = 10
    static let airMapTop: CGFloat = 2
    static let mapWidth: CGFloat = 330
    static let mapHeight: CGFloat = 485
    static let labelText: CGFloat = 20
    static let unitText: CGFloat = 12
    static let labelPadding: CGFloat = 4
    static let labelColor = CssColor(0xF5F5F5)
    static let iconHeight: CGFloat = 36
    static let iconAbove: CGFloat = 21
    static let iconMarginTop: CGFloat = -3
    static let stripWidth: CGFloat = 480
    static let stripHeight: CGFloat = 52
    static let tabWidth: CGFloat = 81
    static let tabHeight: CGFloat = 54
    static let tabTop: CGFloat = -1
    static let tabText: CGFloat = 16
    static let tabTextLeft: CGFloat = 17
    static let tabTextTop: CGFloat = 17
    static let cardText: CGFloat = 16
    static let cardColor = CssColor(0x444444)
    static let cardBorder = CssColor(0xDDDDDD)
    static let cardPadding: CGFloat = 16
    static let headingMargin: CGFloat = 16
    static let loadingWidth: CGFloat = 68
    static let loadingHeight: CGFloat = 72
}
