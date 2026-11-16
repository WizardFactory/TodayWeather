import SwiftUI
import TWDomain
import TWResources
import UIKit

/// Sizes of start.html in the Cordova iOS build (Ionic 1.3.5 with the app's SCSS), measured in the captures
/// (TodayWeatherTests/StartReference/start-<lang>-<state>.json), in points from the WebView's top.
enum StartMetrics {
    static let top: CGFloat = 24
    static let icon: CGFloat = 96
    static let listGap: CGFloat = 20
    static let inset: CGFloat = 10
    static let corner: CGFloat = 2
    /// `.item-input`: 47 pt with its 1 px border, 16 pt at the sides, 6 above and 5 below.
    static let inputRow: CGFloat = 47
    static let inputPadding: CGFloat = 16
    static let glyphSize: CGFloat = 16
    static let glyphWidth: CGFloat = 18
    static let inputText: CGFloat = 14
    static let inputLine: CGFloat = 16
    /// The input's box (34 pt) starts 7 pt into the row; its text is centred in it after 2 pt above and 4.2 below.
    static let inputBox: CGFloat = 34
    static let inputTop: CGFloat = 7
    static let inputPaddingTop: CGFloat = 2
    static let inputPaddingBottom: CGFloat = 4.2
    /// `padding-right: 44px` of the input, which Cancel overlaps.
    static let inputEnd: CGFloat = 44
    /// `.item` around the shortcuts: 8 pt padding, the buttons with 4 pt margins, rows 55 pt apart.
    static let itemPadding: CGFloat = 8
    static let buttonMargin: CGFloat = 4
    static let buttonHeight: CGFloat = 47
    static let buttonLine: CGFloat = 42
    static let buttonText: CGFloat = 15
    static let buttonPadding: CGFloat = 12
    static let buttonMinWidth: CGFloat = 52
    static let buttonCorner: CGFloat = 4
    static let resultText: CGFloat = 16
    static let googleLogo: CGFloat = 144
    static let border = CssColor(0xDDDDDD)
    static let positive = CssColor(0x387EF5)
    static let placeholder = CssColor(0xAAAAAA)
    static let inputColor = CssColor(0x111111)
    static let itemText = CssColor(0x444444)
    static let divider = CssColor(0xF5F5F5)

    /// A shortcut's width: its label's width in bold 15 pt (with the fallback fonts of `language`, nil: the system's)
    /// with 12 pt padding and the 1 pt borders, at least Ionic's 52 pt. WebKit lays text out in 1/64 pt.
    static func buttonWidth(_ label: String, language: String? = nil, scale: CGFloat = 1) -> CGFloat {
        let buttonText = buttonText * scale
        let base = UIFont.systemFont(ofSize: buttonText, weight: .bold) as CTFont
        var font = base
        if let language {
            let cascade = CTFontCopyDefaultCascadeListForLanguages(base, [language] as CFArray)
            let descriptor = CTFontDescriptorCreateWithAttributes([kCTFontCascadeListAttribute: cascade as Any] as CFDictionary)
            font = CTFontCreateCopyWithAttributes(base, buttonText, nil, descriptor)
        }
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: label, attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): font]))
        let text = (CTLineGetTypographicBounds(line, nil, nil, nil) * 64).rounded() / 64
        return max(buttonMinWidth, text + 2 * buttonPadding + 2)
    }
}

/// The start page S01 in the window (#2959): the status bar in the theme's color (`applyIOSStatusBar` for the `start`
/// state), the page under it, the loading overlay and the shell's popups (O01, O04, O09). No tab bar, no banner.
struct StartView: View {
    let page: StartPage

    var body: some View {
        GeometryReader { geometry in
            StartFrame(page: page, insets: .live(geometry.safeAreaInsets), screenHeight: AppLaunch.screenSize().height)
                .ignoresSafeArea()
        }
        // `KeyboardResize` false (config.xml): the keyboard covers the page.
        .ignoresSafeArea(.keyboard)
        .statusBarStyle(lightContent: page.shell.theme != .light)
        .onAppear {
            Monetization.shared.setShowAds(false)
            page.opened()
        }
    }
}

/// `StartView` for given insets; the screenshot tests render it with their own.
struct StartFrame: View {
    let page: StartPage
    let insets: ShellInsets
    /// `window.screen.height`, which chooses how many shortcuts show.
    let screenHeight: CGFloat
    /// False: the page without a scroll view (the screenshot tests render it, as `SideMenu(scrolls: false)`).
    var scrolls = true

    var body: some View {
        ZStack(alignment: .top) {
            VStack(spacing: 0) {
                StartPalette.statusBar(page.shell.theme).color.frame(height: insets.statusBar)
                Group {
                    if scrolls {
                        ScrollView { StartContent(page: page, screenHeight: screenHeight, live: true) }.scrollDismissesKeyboard(.never)
                    } else {
                        StartContent(page: page, screenHeight: screenHeight, live: false)
                    }
                }
                .padding(.leading, insets.leading).padding(.trailing, insets.trailing)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            if page.loading {
                IonicLoadingView().padding(.top, insets.statusBar)
            }
            if let popup = page.shell.popups.first {
                IonicPopupView(popup: popup, onTap: page.shell.tapPopupButton, scrolls: scrolls).padding(.top, insets.statusBar)
            }
        }
        .background(Color.white)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("start-page")
    }
}

/// The status bar of the `start` state (`applyIOSStatusBar`): the theme's color.
enum StartPalette {
    static func statusBar(_ theme: Theme) -> CssColor {
        switch theme {
        case .light: CssColor(0xFFFFFF)
        case .dark: CssColor(0x1B1B1B)
        case .old, .photo: CssColor(0x444444)
        }
    }
}

/// start.html: the app icon, the first card with the search box over either the shortcuts or the results, and under
/// the shortcuts the second card with 현재위치 날씨보기. A result tapped while the keyboard shows only closes it
/// (`OnSelectResult`).
struct StartContent: View {
    let page: StartPage
    let screenHeight: CGFloat
    /// False: the input drawn as its text, without a text field (the screenshot tests render it; `ImageRenderer` cannot
    /// draw a text field).
    var live = true
    @FocusState private var focused: Bool
    /// Text follows Dynamic Type (#2948): 1 at the default size, where the page has the captured sizes.
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    private var catalog: Catalog { Catalog(code: page.shell.locale.catalog) }

    var body: some View {
        let shortcuts = CityShortcuts.forScreenHeight(screenHeight)
        VStack(spacing: 0) {
            Color.clear.frame(height: StartMetrics.top)
            AppIcon().frame(width: StartMetrics.icon, height: StartMetrics.icon)
            Color.clear.frame(height: StartMetrics.listGap)
            VStack(spacing: 0) {
                searchRow
                switch page.results {
                case nil:
                    ShortcutFlow(names: shortcuts.map(\.name)) { page.addShortcut(shortcuts[$0]) }
                        .padding(StartMetrics.itemPadding + 1) // inside the 1 px border
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .itemBox(top: false)
                case .predictions(let word, let list)?:
                    ForEach(Array(list.enumerated()), id: \.offset) { i, prediction in
                        ResultRow(text: prediction.fullText, identifier: "start-result-\(i)") {
                            select { page.addPrediction(prediction, word: word) }
                        }
                    }
                    Attribution { GoogleLogo() }
                case .towns(_, let townPage)?:
                    ForEach(Array(townPage.towns.enumerated()), id: \.offset) { i, town in
                        ResultRow(text: [town.first, town.second, town.third].filter { !$0.isEmpty }.joined(separator: " "),
                                  identifier: "start-result-\(i)") {
                            select { page.addTown(town) }
                        }
                        .onAppear { if i == townPage.towns.count - 1 { page.moreTowns() } }
                    }
                    Attribution {
                        CssLine(runs: [CssRun(text: "powered by TodayWeather", size: StartMetrics.resultText * scale, weight: .medium)],
                                color: CssColor(0x222222))
                    }
                }
            }
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: StartMetrics.corner))
            .padding(.horizontal, StartMetrics.inset)
            if page.results == nil {
                Color.clear.frame(height: StartMetrics.listGap)
                OutlineButton(label: catalog("LOC_USE_YOUR_CURRENT_LOCATION"), identifier: "start-location", shrinks: true) {
                    page.useCurrentLocation()
                }
                .padding(.vertical, 1)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, StartMetrics.inset)
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .environment(\.startScale, scale)
    }

    /// `.item.item-input`: the gray `ion-search` glyph, the input and, once a word is typed, Cancel.
    private var searchRow: some View {
        let binding = Binding(get: { page.word }, set: { page.change($0) })
        let textSize = StartMetrics.inputText * scale
        let m = CssText.metrics("", size: textSize)
        // The input's text: a 16 pt line centred in the content box, whose baseline is the font's ascent below the
        // line's half-leading. The box and the row grow with the text size.
        let box = StartMetrics.inputBox * scale, line = StartMetrics.inputLine * scale
        let rowHeight = StartMetrics.inputRow - StartMetrics.inputBox + box
        let content = box - StartMetrics.inputPaddingTop - StartMetrics.inputPaddingBottom
        let lineTop = StartMetrics.inputPaddingTop + (content - line) / 2
        let baseline = lineTop + (line - (m.ascent + m.descent)) / 2 + m.ascent
        return ZStack(alignment: .topLeading) {
            Text(Glyphs.search).font(Glyphs.ionicons(StartMetrics.glyphSize)).foregroundStyle(StartMetrics.placeholder.color)
                .frame(width: StartMetrics.glyphWidth, alignment: .leading)
                .frame(height: box)
                .offset(x: StartMetrics.inputPadding + 1, y: StartMetrics.inputTop)
                .accessibilityHidden(true)
            // The placeholder (`::placeholder` #aaa) while nothing is typed, drawn here in both modes, so it sits where
            // the typed text does.
            Group {
                if page.word.isEmpty {
                    Text(catalog("LOC_ENTER_CITY")).foregroundStyle(StartMetrics.placeholder.color).accessibilityHidden(true)
                } else if !live {
                    Text(page.word).foregroundStyle(StartMetrics.inputColor.color)
                }
            }
            .font(.system(size: textSize))
            .lineLimit(1)
            .alignmentGuide(.top) { $0[.firstTextBaseline] - baseline - StartMetrics.inputTop }
            .padding(.leading, StartMetrics.inputPadding + 1 + StartMetrics.glyphWidth)
            .padding(.trailing, StartMetrics.inputPadding + 1 + StartMetrics.inputEnd)
            if live {
                TextField("", text: binding)
                    .font(.system(size: textSize))
                    .foregroundStyle(StartMetrics.inputColor.color)
                    .focused($focused)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.done)
                    .alignmentGuide(.top) { $0[.firstTextBaseline] - baseline - StartMetrics.inputTop }
                    .padding(.leading, StartMetrics.inputPadding + 1 + StartMetrics.glyphWidth)
                    .padding(.trailing, StartMetrics.inputPadding + 1 + StartMetrics.inputEnd)
                    .accessibilityLabel(catalog("LOC_ENTER_CITY"))
                    .accessibilityIdentifier("start-input")
            }
            if !page.word.trimmingCharacters(in: .whitespaces).isEmpty {
                // `.button.button-icon.button-stable`: bold 15 pt #444 on its `line-height: normal`, 6 pt at its sides
                // inside a transparent 1 px border, ending at the input's end, its box 13.5 pt below the row's top
                // (measured).
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    Button { page.cancel() } label: {
                        CssLine(runs: [CssRun(text: catalog("LOC_CANCEL"), size: StartMetrics.buttonText * scale, weight: .bold)],
                                color: StartMetrics.itemText)
                            .padding(.horizontal, 7)
                            .padding(.top, 14.5 * scale)
                            .frame(height: rowHeight, alignment: .top)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("start-cancel")
                }
                .padding(.trailing, StartMetrics.inputPadding + 1)
            }
        }
        .frame(maxWidth: .infinity, minHeight: rowHeight, maxHeight: rowHeight, alignment: .topLeading)
        .itemBox(top: true)
    }

    private func select(_ add: () -> Void) {
        if focused {
            focused = false
            return
        }
        add()
    }
}

extension Glyphs {
    static let search = "\u{F21F}"           // ion-search
}

/// The app icon (`img/app_icon.png`).
private struct AppIcon: View {
    var body: some View {
        if let url = TWResources.url("img/app_icon.png"), let image = UIImage(contentsOfFile: url.path) {
            Image(uiImage: image).resizable().interpolation(.high)
        } else {
            Color.clear
        }
    }
}

/// `img/powered_by_google_on_white.png` at 144 pt wide.
private struct GoogleLogo: View {
    var body: some View {
        if let url = TWResources.url("img/powered_by_google_on_white.png"), let image = UIImage(contentsOfFile: url.path) {
            Image(uiImage: image).resizable().interpolation(.high)
                .frame(width: StartMetrics.googleLogo, height: StartMetrics.googleLogo * image.size.height / image.size.width)
                .accessibilityLabel("powered by Google")
        }
    }
}

extension View {
    /// An Ionic `.item` in a `.list-inset`: a 1 px #ddd border, the card's corners on its outer side, overlapping the
    /// item above by its border.
    fileprivate func itemBox(top: Bool) -> some View {
        let shape = UnevenRoundedRectangle(topLeadingRadius: top ? StartMetrics.corner : 0, bottomLeadingRadius: top ? 0 : StartMetrics.corner,
                                           bottomTrailingRadius: top ? 0 : StartMetrics.corner, topTrailingRadius: top ? StartMetrics.corner : 0)
        return self.background(Color.white).overlay(shape.strokeBorder(StartMetrics.border.color, lineWidth: 1))
            .padding(.top, top ? 0 : -1)
    }
}

/// A result row (`.item` with 8 pt around): its text in 16 pt #444, a #ddd border.
private struct ResultRow: View {
    @Environment(\.startScale) private var scale
    let text: String
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            // Ionic's `.item`: one line (`white-space: nowrap`, ellipsis) on `line-height: normal`.
            let size = StartMetrics.resultText * scale
            let m = CssText.metrics(text, size: size)
            ZStack(alignment: .topLeading) {
                Color.clear.frame(height: m.ascent + m.descent)
                Text(text).font(.system(size: size)).foregroundStyle(StartMetrics.itemText.color)
                    .lineLimit(1).truncationMode(.tail)
                    .alignmentGuide(.top) { $0[.firstTextBaseline] - m.ascent }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .padding(StartMetrics.itemPadding + 1) // inside the 1 px border
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .itemBox(top: false)
        .accessibilityIdentifier(identifier)
    }
}

/// `.item.item-divider` under the results: #f5f5f5, 8 pt above and 16 pt at the sides inside its 1 px border, 40 pt
/// high with the 18 pt Google logo (measured), the card's lower corners.
private struct Attribution<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(.leading, 17).padding(.top, 9)
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .topLeading)
            .background(StartMetrics.divider.color)
            .itemBox(top: false)
            .accessibilityIdentifier("start-attribution")
    }
}

/// `.button.button-outline.button-positive`: the label in bold 15 pt #387ef5 on a 42 pt line from the top of a 47 pt
/// box (`min-height`), 12 pt from a 1 px border of the same blue with 4 pt corners.
struct OutlineButton: View {
    @Environment(\.startScale) private var scale
    let label: String
    let identifier: String
    /// True: a label wider than the space it gets is drawn smaller (a long translation at a large text size), so the
    /// button stays inside the page.
    var shrinks = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if shrinks {
                ViewThatFits(in: .horizontal) {
                    box(scale)
                    box(scale * 0.85)
                    box(scale * 0.7)
                    box(scale * 0.55)
                }
            } else {
                box(scale)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }

    private func box(_ k: CGFloat) -> some View {
        FixedCssLine(text: label, size: StartMetrics.buttonText * k, weight: .bold, color: StartMetrics.positive,
                     height: StartMetrics.buttonLine * scale)
            // Measured in the captures: the label's line box starts 2 pt below the box's top (the 1 px border and
            // 1 pt of the 47 pt `min-height` over its 44 pt content).
            .padding(.top, 2)
            .padding(.horizontal, StartMetrics.buttonPadding + 1)
            .frame(minWidth: StartMetrics.buttonMinWidth, minHeight: StartMetrics.buttonHeight * scale, alignment: .top)
            .overlay(RoundedRectangle(cornerRadius: StartMetrics.buttonCorner).strokeBorder(StartMetrics.positive.color, lineWidth: 1))
            .contentShape(Rectangle())
    }
}

extension EnvironmentValues {
    /// The Dynamic Type scale of S01's text (`StartContent`): 1 at the default size.
    @Entry var startScale: CGFloat = 1
}

/// One line of text in a CSS line box of a fixed height (`line-height: <height>px`): the baseline where WebKit puts it,
/// half the difference between the box and the primary font's line (ascent and descent rounded up) above its ascent.
struct FixedCssLine: View {
    @Environment(\.cssFallbackLanguage) private var fallbackLanguage
    let text: String
    let size: CGFloat
    var weight: Font.Weight = .regular
    let color: CssColor
    let height: CGFloat
    /// The system font, or a glyph font whose own ascent and descent make the line (IN-11's bell and ⊗).
    var face: CssRun.Face = .system

    var body: some View {
        let m = face == .system ? CssText.metrics("", size: size) : Self.glyphMetrics(face, size)
        let baseline = (height - (m.ascent + m.descent)) / 2 + m.ascent
        let font: Font = switch face {
        case .system: fallbackLanguage.map { CssLine.system(size, weight, language: $0) } ?? .system(size: size, weight: weight)
        case .ionicons: Glyphs.ionicons(size).weight(weight)
        case .material: Glyphs.material(size)
        }
        ZStack(alignment: .topLeading) {
            Color.clear.frame(width: 0, height: height)
            Text(text).font(font).foregroundStyle(color.color).lineLimit(1).fixedSize()
                .alignmentGuide(.top) { $0[.firstTextBaseline] - baseline }
        }
        .frame(height: height, alignment: .topLeading)
    }

    /// A glyph font's ascent and descent rounded up, as WebKit's line box of that font.
    static func glyphMetrics(_ face: CssRun.Face, _ size: CGFloat) -> (ascent: Double, descent: Double) {
        _ = Glyphs.material(size)
        let font = CTFontCreateWithName((face == .ionicons ? "Ionicons" : "MaterialIcons-Regular") as CFString, size, nil)
        return (ceil(CTFontGetAscent(font)), ceil(CTFontGetDescent(font)))
    }
}

/// The shortcuts as WebKit flows their inline-block buttons: each its own width with 4 pt around it, the next line
/// starting where a button does not fit, rows 55 pt apart.
private struct ShortcutFlow: View {
    @Environment(\.cssFallbackLanguage) private var fallbackLanguage
    @Environment(\.startScale) private var scale
    let names: [String]
    let onTap: (Int) -> Void

    var body: some View {
        FlowLayout(widths: names.map { StartMetrics.buttonWidth($0, language: fallbackLanguage, scale: scale) },
                   height: StartMetrics.buttonHeight * scale) {
            ForEach(Array(names.enumerated()), id: \.offset) { i, name in
                OutlineButton(label: name, identifier: "start-shortcut-\(i)") { onTap(i) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("start-shortcuts")
    }
}

/// Places its subviews at the given widths and the button height, in lines.
private struct FlowLayout: Layout {
    let widths: [CGFloat]
    let height: CGFloat

    private func frames(_ available: CGFloat) -> ([CGRect], CGFloat) {
        let margin = StartMetrics.buttonMargin
        let row = height + 2 * margin
        var x: CGFloat = 0, y: CGFloat = 0
        var out: [CGRect] = []
        for width in widths {
            if x > 0 && x + width + 2 * margin > available + 0.01 {
                x = 0
                y += row
            }
            out.append(CGRect(x: x + margin, y: y + margin, width: width, height: height))
            x += width + 2 * margin
        }
        return (out, widths.isEmpty ? 0 : y + row)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 355
        return CGSize(width: width, height: frames(width).1)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let (rects, _) = frames(bounds.width)
        for (subview, rect) in zip(subviews, rects) {
            subview.place(at: CGPoint(x: bounds.minX + rect.minX, y: bounds.minY + rect.minY), anchor: .topLeading,
                          proposal: ProposedViewSize(width: rect.width, height: rect.height))
        }
    }
}

/// `$ionicLoading` with the app's template (`<ion-spinner icon="bubbles" class="spinner-stable">`): the backdrop (40 %
/// black) and, in the middle, a box of 70 % black with 5 pt corners and 20 pt around the #f8f8f8 spinner.
struct IonicLoadingView: View {
    var body: some View {
        ZStack {
            Color.black.opacity(0.4).contentShape(Rectangle()).onTapGesture {}
            BubblesSpinner(color: CssColor(0xF8F8F8))
                .padding(20)
                .background(Color.black.opacity(0.7))
                .clipShape(RoundedRectangle(cornerRadius: 5))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("start-loading")
    }
}
