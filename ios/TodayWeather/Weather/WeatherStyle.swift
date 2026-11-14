import CoreText
import SwiftUI
import TWDomain
import UIKit

/// Colors of the weather pages S03 and S04 in a theme (client/scss/ionic.app.scss: `.forecast .main-content` L269-L671,
/// the photo theme L663-L671, dark L673-L780, old Hourly L782-L885 and Daily L887-L990). In the old theme the detail and
/// AQI tables' glyphs and texts are white (`color: #fff !important`), over the grade colors: `forced`. Port of the
/// Android `ForecastColors`.
struct WeatherColors: Equatable {
    var page = CssColor(0xF5F5F5)
    var text = CssColor(0x000000)
    var header = CssColor(0xFFFFFF)
    var headerText = CssColor(0x444444)
    var headerOutline: CssColor? = nil
    /// The header block's bottom padding (`[md-page-header]`: 5 pt, 22 pt in the photo theme).
    var headerBottom: CGFloat = 5
    var card = CssColor(0xFFFFFF)
    var cardTitle = CssColor(0x666666)
    var subText = CssColor(0x666666)
    var link = CssColor(0x015DC1)
    /// Ionic's `a` (#387ef5): the Visual Crossing link.
    var attributionLink = CssColor(0x387EF5)
    var divider = CssColor(0x666666)
    var forced: CssColor? = nil
    var chart = ChartColors.light

    static func of(_ theme: Theme, daily: Bool) -> WeatherColors {
        var c = WeatherColors()
        switch theme {
        case .light:
            return c
        case .photo:
            // The header's text is white with a gray outline over the photo; the cards stay light.
            c.headerText = CssColor(0xFFFFFF); c.headerOutline = CssColor(0x8F8F8F); c.headerBottom = 22
            return c
        case .dark:
            c.page = CssColor(0x171717); c.text = CssColor(0xDDDDDD); c.header = CssColor(0x1C1C1D)
            c.headerText = CssColor(0xDDDDDD); c.card = CssColor(0x1C1C1D); c.cardTitle = CssColor(0xDDDDDD)
            c.subText = CssColor(0xDDDDDD); c.link = CssColor(0xDDDDDD); c.divider = CssColor(0xDDDDDD)
            c.chart = ChartColors.of(theme: "dark", daily: daily)
            return c
        case .old:
            let base = daily ? CssColor(0x00BCD4) : CssColor(0x03A9F4)
            let white = CssColor(0xFFFFFF)
            c.page = base; c.text = white; c.header = base; c.headerText = white; c.card = base; c.cardTitle = white
            c.subText = white; c.link = white; c.divider = white; c.forced = white
            c.chart = ChartColors.of(theme: "old", daily: daily)
            return c
        }
    }

    /// A grade color of `grade2Color` (`#rrggbb`), nil for none.
    static func grade(_ hex: String?) -> CssColor? {
        guard let hex, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        return CssColor(value)
    }
}

/// Sizes of the Cordova iOS weather pages in points at the default text size, measured in the captures
/// (Core/Tests/TWDomainTests/ForecastReference) where the SCSS does not give them directly.
enum WeatherMetrics {
    /// `.platform-ios [md-page-header]` padding-top: the bar's 44 pt and the old 20 pt status bar.
    static let headerTop: CGFloat = 64
    /// `[md-page-header]` margin-bottom inside the first card, and every card's margin-bottom.
    static let gap: CGFloat = 5
    /// `.card` padding.
    static let cardPadding: CGFloat = 10
    /// `.card-title`: 15 pt text on its 19 pt line, 10 pt above the table.
    static let cardTitle: CGFloat = 15
    /// A table row of a 24 pt image or glyph with 17 pt text: 24.516 pt apart, the image at the row's bottom, the text's
    /// line box (22 pt) 1.53 pt below the row's top (`vertical-align: middle` against the strut).
    static let rowExtra: CGFloat = 2.516
    static let rowImageTop: CGFloat = 0.516
    static let rowTextTop: CGFloat = 1.53
    /// The AQI cells: heading, 5 pt, a 32 pt glyph on a 37 pt line, then 22 pt lines.
    static let aqiGlyphLine: CGFloat = 37
    /// `.rowgroup-vspacing-box` (S04's days): cells at least 132 pt wide with 5 pt padding, rows 10 pt apart.
    static let dayCellMin: CGFloat = 132
    /// `vertical-align: super`: WebKit raises the baseline by a third of the parent's font size and 1 pt.
    static func superRaise(_ parentSize: CGFloat) -> CGFloat { parentSize / 3 + 1 }
}

/// The text scale of Dynamic Type for the weather pages: 1 at the default size (`large`), as UIKit scales `body`.
struct TextScale {
    let factor: CGFloat
    init(_ category: ContentSizeCategory) {
        let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(category))
        factor = UIFontMetrics(forTextStyle: .body).scaledValue(for: 17, compatibleWith: traits) / 17
    }
    func callAsFunction(_ size: CGFloat) -> CGFloat { size * factor }
}

private extension UIContentSizeCategory {
    init(_ c: ContentSizeCategory) {
        switch c {
        case .extraSmall: self = .extraSmall
        case .small: self = .small
        case .medium: self = .medium
        case .large: self = .large
        case .extraLarge: self = .extraLarge
        case .extraExtraLarge: self = .extraExtraLarge
        case .extraExtraExtraLarge: self = .extraExtraExtraLarge
        case .accessibilityMedium: self = .accessibilityMedium
        case .accessibilityLarge: self = .accessibilityLarge
        case .accessibilityExtraLarge: self = .accessibilityExtraLarge
        case .accessibilityExtraExtraLarge: self = .accessibilityExtraExtraLarge
        case .accessibilityExtraExtraExtraLarge: self = .accessibilityExtraExtraExtraLarge
        @unknown default: self = .large
        }
    }
}

/// A run of a CSS line: text at a size and weight, in a color (nil: the line's), in the system font or a glyph font.
struct CssRun {
    enum Face { case system, ionicons, material }
    var text: String
    var size: CGFloat
    var weight: Font.Weight = .regular
    var color: CssColor?
    var face: Face = .system
}

/// One line of CSS text: its runs on one baseline (SwiftUI concatenated `Text`), placed so the baseline is where WebKit
/// puts it in a line box of `line-height: normal` (each used font's ascent and descent rounded up to whole points).
struct CssLine: View {
    let runs: [CssRun]
    let color: CssColor
    var outline: CssColor? = nil
    /// The block's own font size, whose line box (the strut) the line has at least.
    var strut: CGFloat? = nil
    /// Runs raised by points (`vertical-align: super`), by index; the line box keeps its height, as in WebKit for a
    /// raised box inside it.
    var raise: [Int: CGFloat] = [:]

    /// The line box's ascent and descent: the largest over the runs (with CoreText's fallback fonts for the text) and
    /// the strut. A glyph run (Ionicons `:before`) sits in its element's system-font box.
    nonisolated static func metrics(_ runs: [CssRun], strut: CGFloat? = nil) -> (ascent: CGFloat, descent: CGFloat) {
        var ascent: CGFloat = 0, descent: CGFloat = 0
        let all = runs + (strut.map { [CssRun(text: "", size: $0)] } ?? [])
        for run in all {
            let m = CssText.metrics(run.face == .system ? run.text : "", size: run.size)
            ascent = max(ascent, m.ascent)
            descent = max(descent, m.descent)
        }
        return (ascent, descent)
    }

    nonisolated static func width(_ runs: [CssRun]) -> CGFloat {
        runs.reduce(0) { total, run in
            let font: CTFont
            switch run.face {
            case .system: font = CTFontCreateUIFontForLanguage(.system, run.size, nil)!
            case .ionicons: font = CTFontCreateWithName("Ionicons" as CFString, run.size, nil)
            case .material: font = CTFontCreateWithName("MaterialIcons-Regular" as CFString, run.size, nil)
            }
            let line = CTLineCreateWithAttributedString(NSAttributedString(string: run.text, attributes: [
                NSAttributedString.Key(kCTFontAttributeName as String): font]))
            return total + CTLineGetTypographicBounds(line, nil, nil, nil)
        }
    }

    var text: Text {
        runs.enumerated().reduce(Text("")) { result, item in
            let (i, run) = item
            let font: Font
            switch run.face {
            case .system: font = .system(size: run.size, weight: run.weight)
            case .ionicons: font = Glyphs.ionicons(run.size)
            case .material: font = Glyphs.material(run.size)
            }
            return result + Text(run.text).font(font).foregroundColor((run.color ?? color).color)
                .baselineOffset(raise[i] ?? 0)
        }
    }

    var body: some View {
        let m = Self.metrics(raise.isEmpty ? runs : runs.enumerated().filter { raise[$0.offset] == nil }.map(\.element),
                             strut: strut)
        ZStack(alignment: .topLeading) {
            Color.clear.frame(width: 0, height: m.ascent + m.descent)
            text.lineLimit(1).fixedSize()
                .outlined(outline)
                .alignmentGuide(.top) { $0[.firstTextBaseline] - m.ascent }
        }
        .frame(height: m.ascent + m.descent, alignment: .topLeading)
    }
}

extension Glyphs {
    static let chevronLeft = "\u{F124}"        // ion-chevron-left
    static let bell = "\u{F3E2}"               // ion-ios-bell
    static let bellOutline = "\u{F3E1}"        // ion-ios-bell-outline
    static let upload = "\u{F4CA}"             // ion-ios-upload-outline
    static let calendar = "\u{F117}"           // ion-calendar
    static let informationOutline = "\u{F44C}" // ion-ios-information-outline
    static let linkArrow = "\u{F3D3}"          // `.colgroup-box a:after`
    static let locationOn = "\u{E0C8}"         // material-icons location_on
    static let locationOff = "\u{E0C7}"        // material-icons location_off

    /// The Material Icons font at `size`.
    static func material(_ size: Double) -> Font {
        _ = ionicons(size) // registers both imported fonts
        return .custom("MaterialIcons-Regular", fixedSize: size)
    }
}
