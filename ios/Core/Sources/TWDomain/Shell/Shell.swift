import Foundation
import TWModel

/// Themes of the Cordova app (`settingsInfo.theme`) with their image folders (client/www/data/theme.js), in the order
/// of the theme setting's list (controller.settingctrl.js `settingRadio('theme')`). Port of the Android `Theme`.
public enum Theme: String, CaseIterable, Sendable {
    case photo, light, dark, old

    /// The stored value (`settingsInfo.theme`).
    public var key: String { rawValue }

    /// `window.theme[key].icons`.
    public var icons: String {
        switch self {
        case .photo, .light: "img/icons_default"
        case .dark: "img/icons_dark"
        case .old: "img/icons_old"
        }
    }

    /// `window.theme[key].weather`.
    public var weather: String {
        switch self {
        case .old: "img/weather_old"
        default: "img/weather_default"
        }
    }

    /// The menu's value text (`getThemeValueStr`).
    public var textKey: String {
        switch self {
        case .photo: "LOC_WEATHER_PHOTO_THEME"
        case .light: "LOC_LIGHT_THEME"
        case .dark: "LOC_DARK_THEME"
        case .old: "LOC_OLD_THEME"
        }
    }

    /// A stored value compared by UTF-16 code units; unknown values are light, the Cordova default (service.storage.js).
    public static func of(_ key: String?) -> Theme {
        guard let key else { return .light }
        return allCases.first { JSString.equal($0.rawValue, key) } ?? .light
    }
}

/// The bottom tabs in Cordova order (client/www/templates/tabs.html, the iOS template), named by their Cordova state
/// (`$rootScope.state`).
public enum ShellTab: String, CaseIterable, Sendable {
    case search, forecast, dailyforecast, air

    /// The tab's label (`ion-tab title`).
    public var textKey: String {
        switch self {
        case .search: "LOC_SAVED_LOCATIONS"
        case .forecast: "LOC_HOURLY_FORECAST"
        case .dailyforecast: "LOC_DAILY_FORECAST"
        case .air: "LOC_AIR_INFORMATION"
        }
    }

    /// The tabs whose tap runs `doTabForecast` (`ng-click`); the saved-places tab only follows its `href`.
    public var refreshes: Bool { self != .search }
}

/// `settingsInfo.startupPage`: the first tab (app.js L369-L390) and the menu's value text (`getStartupPageValueStr`).
public enum StartupPage {
    /// The choices of the setting, in the order of its list.
    public static let values = ["0", "1", "2", "3"]

    /// "0" hourly, "1" daily, "2" saved places, "3" air; anything else is hourly, as the TodayWeather product falls
    /// back (`console.error('unknown page')`, then `tab.forecast`). "4" (the TodayAir weather tab) is not a tab here.
    public static func tab(_ value: String?) -> ShellTab {
        switch value.map({ Array($0.utf16) }) {
        case Array("1".utf16): .dailyforecast
        case Array("2".utf16): .search
        case Array("3".utf16): .air
        default: .forecast
        }
    }

    /// `getStartupPageValueStr`; "N/A" (shown as is, the translate filter's missing key) for other values.
    public static func textKey(_ value: String) -> String {
        switch Array(value.utf16) {
        case Array("0".utf16): "LOC_HOURLY_FORECAST"
        case Array("1".utf16): "LOC_DAILY_FORECAST"
        case Array("2".utf16): "LOC_SAVED_LOCATIONS"
        case Array("3".utf16): "LOC_AIR_INFORMATION"
        case Array("4".utf16): "LOC_WEATHER"
        default: "N/A"
        }
    }
}

/// `settingsInfo.refreshInterval` in minutes, "0" manual (`getRefreshIntervalValueStr`).
public enum RefreshInterval {
    public static let values = ["0", "30", "60", "180", "360", "720"]

    public static func textKey(_ value: String) -> String {
        switch Array(value.utf16) {
        case Array("0".utf16): "LOC_MANUAL"
        case Array("30".utf16): "LOC_30_MINUTES"
        case Array("60".utf16): "LOC_1_HOUR"
        case Array("180".utf16): "LOC_3_HOURS"
        case Array("360".utf16): "LOC_6_HOURS"
        case Array("720".utf16): "LOC_12_HOURS"
        default: "N/A"
        }
    }

    /// The theme setting's value text: `getThemeValueStr` of the stored value ("N/A" when unknown).
    public static func themeTextKey(_ value: String) -> String {
        Theme.allCases.first { JSString.equal($0.rawValue, value) }?.textKey ?? "N/A"
    }
}

/// Rows of the side menu (S06) in Cordova order (client/www/index.html L97-L171) with the iOS template's choices:
/// the Korea-only rows need region KR (`getRegion() === 'KR'`; 전국날씨 also needs the TodayWeather product, which this
/// app is), the analytics, ad privacy, policy and terms rows are block buttons, and on iOS the units, feedback, rating
/// and about rows show a chevron (`ng-if="!isAndroid()"`). The guide row (`ng-if="false"`) is never shown; About shows
/// in every locale (`showAbout()` returns true).
public enum MenuRow: String, CaseIterable, Sendable {
    case specialWeather, nationalWeather, nationalAir, nullschoolWind, units, startupPage, refreshInterval, theme
    case analytics, adPrivacy, privacyPolicy, terms, sendFeedback, rateApp, version, about

    public var textKey: String {
        switch self {
        case .specialWeather: "LOC_TYPE_SPECIAL_WEATHER"
        case .nationalWeather: "LOC_NATIONAL_WEATHER"
        case .nationalAir: "LOC_NATIONAL_AIR"
        case .nullschoolWind: "LOC_NULLSCHOOL_WIND"
        case .units: "LOC_UNITS"
        case .startupPage: "LOC_STARTUP_PAGE"
        case .refreshInterval: "LOC_REFRESH_INTERVAL"
        case .theme: "LOC_THEME_SETTING"
        case .analytics: "LOC_ANALYTICS_CHOICE"
        case .adPrivacy: "LOC_AD_PRIVACY_CHOICES"
        case .privacyPolicy: "LOC_PRIVACY_POLICY"
        case .terms: "LOC_TERMS"
        case .sendFeedback: "LOC_SEND_FEEDBACK"
        case .rateApp: "LOC_RATE_THIS_APP"
        case .version: "LOC_VERSION"
        case .about: "LOC_ABOUT"
        }
    }

    /// Shown only for region KR.
    public var krOnly: Bool {
        switch self {
        case .specialWeather, .nationalWeather, .nationalAir, .nullschoolWind: true
        default: false
        }
    }

    /// `.item.button.button-block` rather than a plain `.item`.
    public var isButton: Bool {
        switch self {
        case .analytics, .adPrivacy, .privacyPolicy, .terms: true
        default: false
        }
    }

    /// An `ion-chevron-right` at the right of the row on iOS.
    public var chevron: Bool {
        switch self {
        case .specialWeather, .nationalWeather, .nationalAir, .nullschoolWind, .units, .sendFeedback, .rateApp, .about: true
        default: false
        }
    }

    /// Whether choosing the row closes the menu first (`$ionicSideMenuDelegate.toggleLeft()`): the pages, the setting
    /// lists, the mail and the store. The wind map and About open over the menu, the policy, ad and analytics rows
    /// open a browser or a popup over it, and the version row does nothing.
    public var closesMenu: Bool {
        switch self {
        case .specialWeather, .nationalWeather, .nationalAir, .units, .startupPage, .refreshInterval, .theme,
             .sendFeedback, .rateApp: true
        default: false
        }
    }

    /// The rows shown for `region` (`Util.region`, compared by UTF-16 code units), in order.
    public static func rows(region: String?) -> [MenuRow] {
        let korea = region.map { JSString.equal($0, "KR") } ?? false
        return allCases.filter { !$0.krOnly || korea }
    }
}

/// What a tap on a tab does (controller.tabctrl.js `doTabForecast` and Ionic's tab selection).
public enum TabTapAction: Equatable, Sendable {
    /// Another tab: it becomes the selected tab.
    case select(ShellTab)
    /// The selected weather or air tab, more than 700 ms after the previous weather or air tab tap: a reload
    /// (`reloadEvent 'tab'`).
    case refresh(ShellTab)
    /// The selected tab again: the saved-places tab, or a weather or air tab within 700 ms of the previous one.
    case none
}

/// The tab taps of one shell: `doTabForecast` keeps the time of the last weather or air tab tap (`lastClickTime`,
/// updated on every such tap, also one that changes the tab) and skips a reload when the gap is 700 ms or less.
public struct TabTaps: Sendable {
    private var lastWeatherTap: Int64 = 0

    public init() {}

    /// The action for a tap on `tab` while `selected` is shown, at `now` (milliseconds).
    public mutating func tap(_ tab: ShellTab, selected: ShellTab, now: Int64) -> TabTapAction {
        guard tab.refreshes else { return tab == selected ? .none : .select(tab) }
        let gap = now - lastWeatherTap
        lastWeatherTap = now
        if tab != selected { return .select(tab) }
        return gap <= 700 ? .none : .refresh(tab)
    }
}
