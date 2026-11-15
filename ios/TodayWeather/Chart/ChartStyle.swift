import CoreText
import SwiftUI
import TWDomain
import TWResources
import UIKit

/// An sRGB color of the Cordova SCSS (`#rrggbb` and an alpha).
struct CssColor: Sendable, Equatable {
    let red: Double, green: Double, blue: Double, alpha: Double

    init(_ hex: UInt32, alpha: Double = 1) {
        red = Double((hex >> 16) & 0xFF) / 255
        green = Double((hex >> 8) & 0xFF) / 255
        blue = Double(hex & 0xFF) / 255
        self.alpha = alpha
    }

    var color: Color { Color(.sRGB, red: red, green: green, blue: blue, opacity: alpha) }
    var cgColor: CGColor { CGColor(srgbRed: red, green: green, blue: blue, alpha: alpha) }
}

/// Chart colors of a theme and page (client/scss/ionic.app.scss: `.chart-scroll`, `.chart-label`, `.chart-separator`
/// and `.chart-expander` of the light theme; dark; the old theme's Hourly and Daily), and the image folders of
/// `client/www/data/theme.js`. `label` is the page's text color, which the HTML header rows take; `currentRect` nil is
/// transparent. Port of the Android `ChartColors`.
struct ChartColors: Sendable, Equatable {
    var label = CssColor(0x000000)
    var text = CssColor(0x444444)
    var bar = CssColor(0x387EF5)
    var guide = CssColor(0xD9E5F2)
    var guideVivid = CssColor(0xC0D6F0)
    var currentRect: CssColor? = nil
    var lineToday = CssColor(0x387EF5)
    var lineYesterday = CssColor(0x9E9E9E)
    var circleToday = CssColor(0x387EF5)
    var circleYesterday = CssColor(0x9E9E9E)
    var circleTodayCurrent = CssColor(0xFF5252)
    var circleTodayCurrentStroke = CssColor(0xFF5252)
    var valueText = CssColor(0xFFFFFF)
    var valueTextCurrent = CssColor(0xFFFFFF)
    var legendBox = CssColor(0x000000, alpha: 0.1)
    var legendToday = CssColor(0x387EF5)
    var legendYesterday = CssColor(0x9E9E9E)
    var separator = CssColor(0xD9E5F2)
    var expander = CssColor(0x444444)
    var background = CssColor(0xFFFFFF)
    var weatherImages = "img/weather_default"
    var iconImages = "img/icons_default"

    static let light = ChartColors()

    private static let dark: ChartColors = {
        var c = ChartColors()
        c.iconImages = "img/icons_dark"
        c.label = CssColor(0xDDDDDD); c.text = CssColor(0xDDDDDD); c.bar = CssColor(0xDDDDDD)
        c.guide = CssColor(0xDDDDDD); c.guideVivid = CssColor(0xDDDDDD)
        c.lineToday = CssColor(0xFFFFFF); c.circleToday = CssColor(0xFFFFFF); c.circleTodayCurrentStroke = CssColor(0xFFFFFF)
        c.valueText = CssColor(0x0C60EE); c.valueTextCurrent = CssColor(0xFEFEFE)
        c.legendBox = CssColor(0x000000, alpha: 0.4); c.legendToday = CssColor(0xFFFFFF)
        c.separator = CssColor(0xDDDDDD); c.expander = CssColor(0xDDDDDD); c.background = CssColor(0x1C1C1D)
        return c
    }()

    private static let old: ChartColors = {
        var c = ChartColors()
        c.weatherImages = "img/weather_old"; c.iconImages = "img/icons_old"
        let white = CssColor(0xFFFFFF)
        c.label = white; c.text = white; c.bar = white; c.guide = white; c.guideVivid = white
        c.lineToday = white; c.lineYesterday = CssColor(0xD0D0D0); c.circleToday = white; c.circleYesterday = CssColor(0xD0D0D0)
        c.circleTodayCurrentStroke = white; c.valueTextCurrent = CssColor(0xFEFEFE)
        c.legendBox = CssColor(0x000000, alpha: 0.4); c.legendToday = white; c.legendYesterday = CssColor(0xD0D0D0)
        c.separator = white; c.expander = white
        return c
    }()

    /// The colors of a Cordova theme (`settingsInfo.theme`: light, dark, old, photo) on Hourly or, when `daily`, Daily
    /// (the photo theme's chart cards are light).
    static func of(theme: String, daily: Bool) -> ChartColors {
        switch theme {
        case "dark": return dark
        case "old":
            var c = old
            if daily {
                c.currentRect = CssColor(0x00ACC1); c.valueText = CssColor(0x0288D1); c.background = CssColor(0x00BCD4)
            } else {
                c.currentRect = CssColor(0x039BE5); c.valueText = CssColor(0x0C60EE); c.background = CssColor(0x03A9F4)
            }
            return c
        default: return light
        }
    }
}

/// Text of the charts as WebKit lays it out: `-apple-system` (the system UI font, with CoreText's fallback fonts
/// such as Apple SD Gothic Neo for Korean), sizes of the Cordova SCSS, and `line-height: normal` from each used
/// font's ascent and descent rounded up to whole points (measured in the Cordova iOS captures: 15 px rows are 19 pt,
/// 17 px rows 22 pt).
enum CssText {
    static let chartText = 15.0
    static let subText = 13.0
    static let unitText = 10.0
    static let dayTitle = 15.0
    static let title = 17.0
    static let smallTitle = 15.0
    static let legend = 13.0

    static func font(_ size: Double) -> CTFont { CTFontCreateUIFontForLanguage(.system, size, nil)! }

    /// A single-line text with runs of (string, size), in `color`.
    static func line(_ runs: [(String, Double)], color: CssColor) -> CTLine {
        let text = NSMutableAttributedString()
        for (string, size) in runs where !string.isEmpty {
            text.append(NSAttributedString(string: string, attributes: [
                NSAttributedString.Key(kCTFontAttributeName as String): font(size),
                NSAttributedString.Key(kCTForegroundColorAttributeName as String): color.cgColor,
            ]))
        }
        return CTLineCreateWithAttributedString(text)
    }

    static func width(_ line: CTLine) -> Double { CTLineGetTypographicBounds(line, nil, nil, nil) }

    /// Ascent and descent of the line box (`line-height: normal`), over the fonts the text uses.
    static func metrics(_ text: String, size: Double) -> (ascent: Double, descent: Double) {
        var ascent = ceil(CTFontGetAscent(font(size)))
        var descent = ceil(CTFontGetDescent(font(size)))
        for run in CTLineGetGlyphRuns(line([(text, size)], color: CssColor(0))) as? [CTRun] ?? [] {
            let attributes = CTRunGetAttributes(run) as NSDictionary
            if let value = attributes[kCTFontAttributeName], CFGetTypeID(value as CFTypeRef) == CTFontGetTypeID() {
                let f = value as! CTFont
                ascent = max(ascent, ceil(CTFontGetAscent(f)))
                descent = max(descent, ceil(CTFontGetDescent(f)))
            }
        }
        return (ascent, descent)
    }

    /// The height of a row of `texts` with `line-height: normal`.
    static func lineHeight(_ texts: [String], size: Double) -> Double {
        let m = (texts.isEmpty ? [""] : texts).map { metrics($0, size: size) }
        return (m.map(\.ascent).max() ?? 0) + (m.map(\.descent).max() ?? 0)
    }

    /// Draws `line` with its baseline at `baseline` (points, y down) and its left edge at `x`.
    static func draw(_ line: CTLine, x: Double, baseline: Double, in cg: CGContext) {
        cg.saveGState()
        cg.textMatrix = .identity
        cg.translateBy(x: x, y: baseline)
        cg.scaleBy(x: 1, y: -1)
        cg.textPosition = .zero
        CTLineDraw(line, cg)
        cg.restoreGState()
    }
}

/// The Material Icons glyphs of the expander (`expand_less`, `expand_more`), from the imported font
/// (TWResources `fonts/MaterialIcons-Regular.ttf`, as `<i class="material-icons">` draws them: 24 px, line-height 1).
enum MaterialIcons {
    // CTFont is immutable and thread-safe; CoreFoundation types are not marked Sendable.
    nonisolated(unsafe) static let font: CTFont? = {
        guard let url = TWResources.url("fonts/MaterialIcons-Regular.ttf"), let data = try? Data(contentsOf: url),
              let descriptor = CTFontManagerCreateFontDescriptorFromData(data as CFData) else { return nil }
        return CTFontCreateWithFontDescriptor(descriptor, 24, nil)
    }()

    /// Draws the ligature `name` in a 24 pt box at (`x`, `top`).
    static func draw(_ name: String, x: Double, top: Double, color: CssColor, in cg: CGContext) {
        guard let font else { return }
        let text = NSAttributedString(string: name, attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): color.cgColor,
        ])
        let line = CTLineCreateWithAttributedString(text)
        let ascent = ceil(CTFontGetAscent(font)), descent = ceil(CTFontGetDescent(font))
        // line-height 24: half the remaining space above the ascent.
        let baseline = top + (24 - (ascent + descent)) / 2 + ascent
        CssText.draw(line, x: x, baseline: baseline, in: cg)
    }
}

/// Chart images from the imported Cordova assets (TWResources `img/…`) by the SVG `href`; nil for an image the Cordova
/// app does not have either (such as `Rain.png`), which WebKit does not draw.
@MainActor
final class ChartImages {
    static let shared = ChartImages()
    private var cache: [String: Image?] = [:]

    subscript(href: String) -> Image? {
        if let hit = cache[href] { return hit }
        let image = TWResources.url(href).flatMap { UIImage(contentsOfFile: $0.path) }.map { Image(uiImage: $0) }
        cache[href] = image
        return image
    }
}

extension ChartTexts {
    /// The chart strings of an imported Cordova catalog (`en`, `ko`, …); IN-07 chooses the catalog as the Cordova app.
    static func catalog(_ code: String) -> ChartTexts {
        guard let bundle = TWResources.strings(catalog: code) else { return ChartTexts([:]) }
        var strings: [String: String] = [:]
        for key in ChartTexts.keys {
            let value = bundle.localizedString(forKey: key, value: "\u{1}", table: nil)
            if value != "\u{1}" { strings[key] = value }
        }
        return ChartTexts(strings)
    }
}
