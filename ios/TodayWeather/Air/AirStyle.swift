import SwiftUI
import TWDomain

/// Colors of S05 in a theme (client/scss/ionic.app.scss: `.air` L269-L661, `.dark-theme.air` L673-L780). Only the dark
/// theme has its own; the photo and old themes have no S05 rules, so their page is the light one (the shell's bars keep
/// the theme's colors). `page` holds the page, card, header and link colors S05 shares with the weather pages; the others
/// are the main box title's border and text, the detail and station cells' border and selected background, and the
/// hourly chart's axis, labels, bar without a grade and the other hours' opacity (`.chart-blurry-bar`). Port of the
/// Android `AirColors` (AN-09).
struct AirColors: Equatable {
    var page: WeatherColors
    var titleBorder = CssColor(0x000000)
    var titleText = CssColor(0x000000)
    var cellBorder = CssColor(0xCCCCCC)
    var selected = CssColor(0xF4F4F4)
    var axis = CssColor(0x666666)
    var axisText = CssColor(0x444444)
    var bar = CssColor(0x387EF5)
    var blurry = 0.6

    static func of(_ theme: Theme) -> AirColors {
        guard theme == .dark else { return AirColors(page: WeatherColors.of(.light, daily: false)) }
        let white = CssColor(0xFFFFFF), light = CssColor(0xDDDDDD)
        return AirColors(page: WeatherColors.of(.dark, daily: false), titleBorder: white, titleText: white,
                         cellBorder: CssColor(0x8F8F8F), selected: CssColor(0x3B3B3B), axis: light, axisText: light, bar: light,
                         blurry: 0.8)
    }

    /// A `grade2Color` result: `#rrggbb`, the CSS keyword `white` (a default color), or nil for the element's own color.
    static func css(_ value: String?) -> CssColor? {
        if value == "white" { return CssColor(0xFFFFFF) }
        return WeatherColors.grade(value)
    }
}
