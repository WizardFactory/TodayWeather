import Foundation
import TWModel

/// A row of S02's list (SearchCtrl `init`, tab-search.html, #2960): the label lines, the location glyph of the current
/// position, a disabled row (shown only in edit mode), the sky icon and, when the place has a temperature, the
/// temperature and today's minimum and maximum; the bell is on when an enabled alarm names the row's index. Port of the
/// Android `PlaceRow` (AN-11).
public struct PlaceRow: Equatable, Sendable {
    public let lines: [String]
    public let currentPosition: Bool
    public let disabled: Bool
    public let skyIcon: String
    /// `{{t1h.toFixed(0)}}˚`; nil when the place has no temperature (`t1h` is `-`).
    public let temperature: String?
    /// `{{tmn.toFixed(0)}}˚/{{tmx.toFixed(0)}}˚`, a value that is no number printing nothing.
    public let minMax: String?
    public let hasPush: Bool

    public init(lines: [String], currentPosition: Bool, disabled: Bool, skyIcon: String, temperature: String?, minMax: String?,
                hasPush: Bool) {
        self.lines = lines
        self.currentPosition = currentPosition
        self.disabled = disabled
        self.skyIcon = skyIcon
        self.temperature = temperature
        self.minMax = minMax
        self.hasPush = hasPush
    }
}

public enum PlaceRows {
    /// `LOC_CURRENT` and `LOC_LOCATION` of the app's catalog.
    public struct Texts: Sendable {
        public let current: String
        public let location: String

        public init(current: String, location: String) {
            self.current = current
            self.location = location
        }
    }

    /// The row's label lines: `[name]`, else the shortened address split on its comma, else one empty line. The current
    /// position without an address reads 현재위치, joined without a space when `Util.language` contains ko, ja, zh-CN or
    /// zh-TU (A13 kept: zh-TW gets the space).
    public static func label(name: String?, address: String?, currentPosition: Bool, language: String, texts: Texts) -> [String] {
        if currentPosition && address == nil {
            let joined = ["ko", "ja", "zh-CN", "zh-TU"].contains { JSString.includes(language, $0) }
            return [joined ? texts.current + texts.location : texts.current + " " + texts.location]
        }
        if let name, !name.isEmpty { return [name] }
        if let address, !address.isEmpty { return JSString.split(AddressFormat.shorten(address), ",") }
        return [""]
    }

    /// A row from the place and its stored `currentWeather` (nil: no weather yet).
    public static func row(name: String?, address: String?, currentPosition: Bool, disable: Bool, currentWeather: JSONObject?,
                           hasPush: Bool, language: String, texts: Texts) -> PlaceRow {
        let sky = currentWeather?["skyIcon"].flatMap { Js.truthy($0) ? $0.stringValue : nil } ?? "sun"
        let t1h = currentWeather?["t1h"]
        let today = currentWeather?["today"]?.objectValue
        // `ng-if="city.t1h != '-'"`: undefined became '-' (`init`); any other value shows, null too.
        let shown = t1h != nil && t1h?.stringValue.map { !JSString.equal($0, "-") } ?? true
        return PlaceRow(lines: label(name: name, address: address, currentPosition: currentPosition, language: language, texts: texts),
                        currentPosition: currentPosition, disabled: disable, skyIcon: sky,
                        temperature: shown ? fixed(t1h) + "˚" : nil,
                        minMax: shown ? fixed(today?["tmn"]) + "˚/" + fixed(today?["tmx"]) + "˚" : nil,
                        hasPush: hasPush)
    }

    /// `value.toFixed(0)` in a template: a number's digits; anything else (Angular's forgiving call on a value without
    /// `toFixed`) prints nothing.
    static func fixed(_ value: JSONValue?) -> String {
        guard case .number(let n)? = value else { return "" }
        return Js.toFixed(n.double, 0)
    }

    /// `goPage()`: the startup page's tab, `"0"` Hourly, `"1"` Daily, `"3"` Air; `"4"` (TodayAir's weather page), `"2"`
    /// and anything else the product's default, Hourly.
    public static func startTab(_ startupPage: String?) -> ShellTab {
        switch startupPage {
        case "1": .dailyforecast
        case "3": .air
        default: .forecast
        }
    }
}

/// SearchCtrl's `/geocode/…/addr/` query of a Places prediction (`_makeQueryString`): its terms by offset, joined by
/// commas (`Array.toString`).
public enum SearchQuery {
    public static func of(_ fullText: String) -> String {
        PredictionName.terms(fullText).sorted { $0.offset < $1.offset }.map(\.text).joined(separator: ",")
    }
}

/// SearchCtrl's lookup of the current position on iOS (`updateCurrentPosition`, controller.searchctrl.js L643-L819) and
/// its retry confirmation of type `search` (TabCtrl's `showRetryConfirm`, O03, controller.tabctrl.js L435-L636), for
/// find-by-location, the first enable of the current position and a visit's lookup. SearchCtrl records into TabCtrl's
/// `gLocationAuthorizationStatus` (its scope's `setLocationAuthorizationStatus`).
public enum SearchLocation {
    /// StartCtrl's steps (`StartLocation.decide`), except that a recorded grant locates without recording anything:
    /// SearchCtrl's iOS branch does not call `setLocationAuthorizationStatus` there.
    public static func decide(record: LocationPermission?, current: LocationPermission)
        -> (step: StartLocation.Step, records: LocationPermission?) {
        let decision = StartLocation.decide(record: record, current: current)
        return decision.step == .locate ? (.locate, nil) : decision
    }

    /// O03 `search` on iOS: Close first; then no recorded status (diagnostic 7.x's undefined `DENIED`) gives OK;
    /// location not enabled Settings (the app's page) and OK; otherwise OK. The Android-only `DENIED_ALWAYS` branch
    /// with its hint is skipped. OK always finds by location again (A26).
    public static func retry(_ message: LocationMessage, recorded: LocationPermission?, enabled: Bool) -> RetryConfirm {
        if recorded == nil { return RetryConfirm(lines: message.lines, buttons: [.close, .retry]) }
        if !enabled { return RetryConfirm(lines: message.lines, buttons: [.close, .settings, .retry]) }
        return RetryConfirm(lines: message.lines, buttons: [.close, .retry])
    }
}
