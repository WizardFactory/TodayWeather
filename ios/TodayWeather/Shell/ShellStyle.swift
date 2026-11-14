import CoreText
import SwiftUI
import TWDomain
import TWResources
import UIKit

/// Shell colors of a Cordova theme on a tab (client/scss/ionic.app.scss: the header bars L88-L168, the tab bar
/// L236-L262, the side menu L1011-L1061) and the iOS status bar of `Util.applyIOSStatusBar` (service.util.js
/// L146-L163). Port of the Android `ShellColors` with the iOS template's differences.
struct ShellColors: Equatable {
    var headerBar: CssColor
    var headerLine: CssColor?
    var headerText: CssColor
    /// The photo theme's outline around the header's title and buttons over the photo (`text-shadow`).
    var headerOutline: CssColor? = nil
    var tabBar: CssColor
    var tabLine: CssColor
    var tabText: CssColor
    var menuList: CssColor
    var menuItem: CssColor
    var menuBorder: CssColor
    var menuText: CssColor
    /// `StatusBar.backgroundColorByHexString` and `styleLightContent` (true) or `styleDefault` (dark content on iOS 13
    /// and later, cordova-plugin-statusbar 4.0.0).
    var statusBar: CssColor
    var statusBarLightContent: Bool

    static func of(_ theme: Theme, tab: ShellTab) -> ShellColors {
        let white = CssColor(0xFFFFFF), black = CssColor(0x000000)
        let light = ShellColors(
            headerBar: white, headerLine: CssColor(0xDDDDDD), headerText: black,
            tabBar: white, tabLine: CssColor(0xB2B2B2), tabText: black,
            menuList: white, menuItem: white, menuBorder: CssColor(0xDDDDDD), menuText: CssColor(0x444444),
            statusBar: white, statusBarLightContent: false)
        // `.photo-theme .body-content .bar`, `.old-theme .body-content .bar` and the menu's bar in both themes.
        var plain = light
        plain.headerBar = CssColor(0x444444); plain.headerLine = CssColor(0x111111); plain.headerText = white
        plain.statusBar = CssColor(0x444444); plain.statusBarLightContent = true
        switch theme {
        case .light:
            return light
        case .dark:
            return ShellColors(
                headerBar: CssColor(0x1B1B1B), headerLine: CssColor(0x444444), headerText: white,
                tabBar: CssColor(0x1B1B1B), tabLine: CssColor(0x444444), tabText: white,
                menuList: CssColor(0x171717), menuItem: CssColor(0x1C1C1D), menuBorder: CssColor(0x111111), menuText: white,
                statusBar: CssColor(0x1B1B1B), statusBarLightContent: true)
        case .photo:
            // The Hourly and Daily headers are clear with outlined text over the photo (`.photo-theme.forecast
            // .body-content .bar`; the captures show Daily's clear too).
            guard tab == .forecast || tab == .dailyforecast else { return plain }
            var clear = plain
            clear.headerBar = CssColor(0x000000, alpha: 0); clear.headerLine = nil
            clear.headerOutline = CssColor(0x8F8F8F)
            return clear
        case .old:
            var c = plain
            switch tab {
            case .forecast:
                c.headerBar = CssColor(0x03A9F4); c.headerLine = CssColor(0x0288D1)
                c.tabBar = CssColor(0x03A9F4); c.tabLine = CssColor(0x0288D1); c.tabText = white
                c.statusBar = CssColor(0x03A9F4)
            case .dailyforecast:
                c.headerBar = CssColor(0x00BCD4); c.headerLine = CssColor(0x0097A7)
                c.tabBar = CssColor(0x00BCD4); c.tabLine = CssColor(0x0097A7); c.tabText = white
                c.statusBar = CssColor(0x00BCD4)
            default: break
            }
            return c
        }
    }

    /// The side menu: the theme's plain header (`.<theme> .menu .bar`) and its list, whatever tab is open.
    static func menu(_ theme: Theme) -> ShellColors { of(theme, tab: .search) }
}

/// The icon fonts of the Cordova app: Ionicons 2.0.1 and Material Icons, from the imported copies (TWResources
/// `fonts/`), registered for the process. Code points from ionicons.css (`.ion-*:before { content }`) of the built app.
enum Glyphs {
    static let starOutline = "\u{F4B2}"      // ion-ios-star-outline
    static let star = "\u{F4B3}"             // ion-ios-star
    static let clockOutline = "\u{F402}"     // ion-ios-clock-outline
    static let reload = "\u{F49D}"           // ion-ios-reload
    static let calendarOutline = "\u{F3F3}"  // ion-ios-calendar-outline
    static let cloudOutline = "\u{F409}"     // ion-ios-cloud-outline
    static let navicon = "\u{F20E}"          // ion-navicon
    static let arrowBack = "\u{F3CF}"        // ion-ios-arrow-back
    static let chevronRight = "\u{F125}"     // ion-chevron-right

    /// The Ionicons font at `size`, or nil when the copy is missing.
    static func ionicons(_ size: Double) -> Font {
        _ = registered
        return .custom("Ionicons", fixedSize: size)
    }

    /// The tab glyph of `tab` (tabs.html, the iOS template): the selected weather and air tabs show the reload glyph.
    static func tab(_ tab: ShellTab, selected: Bool) -> String {
        switch tab {
        case .search: selected ? star : starOutline
        case .forecast: selected ? reload : clockOutline
        case .dailyforecast: selected ? reload : calendarOutline
        case .air: selected ? reload : cloudOutline
        }
    }

    /// Registering a font file with CoreText is thread-safe; the lazy static runs it once per process.
    private static let registered: Bool = {
        for name in ["fonts/ionicons.ttf", "fonts/MaterialIcons-Regular.ttf"] {
            if let url = TWResources.url(name) {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            }
        }
        return true
    }()
}

/// The strings of the catalog the shell uses, as angular-translate looks them up: the chosen catalog, then English
/// (`fallbackLanguage('en')`), then the key itself.
struct Catalog {
    let code: String
    private let bundle: Bundle?
    private let english: Bundle?

    init(code: String) {
        self.code = code
        bundle = TWResources.strings(catalog: code)
        english = TWResources.strings(catalog: "en")
    }

    func callAsFunction(_ key: String) -> String {
        for b in [bundle, english].compactMap({ $0 }) {
            let value = b.localizedString(forKey: key, value: "\u{1}", table: nil)
            if value != "\u{1}" { return value }
        }
        return key
    }
}
