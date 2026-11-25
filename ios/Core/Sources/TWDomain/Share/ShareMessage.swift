import Foundation
import TWModel

/// The share message of TabCtrl's `doTabShare` for TodayWeather (IN-16, #2965; O16, V20), as the Cordova iOS app hands it
/// to the socialsharing plugin (`share(message, null, null, null)`: the text alone, no subject, file or URL item). Port
/// of the Android `ShareMessage` (AN-16), checked against the Cordova code run in JavaScriptCore
/// (`TWDataTests/Golden/share.json`, `ios/tools/share/generate.py`). It ends with the `link.todayweather.ai` link of the
/// shared place and tab (`DeepLink.shareURL`) where the Cordova app ended with a Branch link per language (D35, #3097).
public enum ShareMessage {
    /// The catalog keys it reads: LOC_CURRENT, LOC_HIGHEST, LOC_LOWEST and the app name (`$rootScope.title`).
    public static let keys = ["LOC_CURRENT", "LOC_HIGHEST", "LOC_LOWEST", "LOC_TODAYWEATHER"]

    public struct Texts: Sendable, Equatable {
        public var current: String
        public var highest: String
        public var lowest: String
        public var app: String

        public init(current: String, highest: String, lowest: String, app: String) {
            self.current = current
            self.highest = highest
            self.lowest = lowest
            self.app = app
        }

        /// The texts from a catalog lookup (`key` → translation).
        public init(_ translate: (String) -> String) {
            self.init(current: translate("LOC_CURRENT"), highest: translate("LOC_HIGHEST"), lowest: translate("LOC_LOWEST"),
                      app: translate("LOC_TODAYWEATHER"))
        }
    }

    /// The message for the selected `city` record (`WeatherInfo.getCityOfIndex`: the place with its weather), or nil when
    /// there is none or it has no location (loosely `undefined`: missing or null; `doTabShare` opens the start choice O02
    /// instead). `view` and `pollutant` are the tab shared from. Values are joined as JavaScript joins them; when building
    /// the weather lines throws (no `currentWeather`, a `skyIcon` without `indexOf`), the message is the city line alone,
    /// which the `.finally` shares.
    public static func build(_ city: JSONObject?, texts: Texts, view: WeatherView = .hourly, pollutant: String? = nil) -> String? {
        guard let city, Js.present(city["location"]) else { return nil }
        let name = city["name"]
        let cityName = Js.truthy(name) ? concat(name) : AddressFormat.shorten(city["address"]?.stringValue)
        let head = cityName + "\n"
        guard let weather = weatherLines(city["currentWeather"], texts: texts) else { return head }
        return head + weather + "\n" + texts.app + " " + link(city, name: cityName, view: view, pollutant: pollutant)
    }

    /// The link for `city`'s saved coordinates (numeric `location.lat` and `location.long`) and its display name.
    private static func link(_ city: JSONObject, name: String, view: WeatherView, pollutant: String?) -> String {
        let location = city["location"]
        return DeepLink.shareURL(lat: location?["lat"]?.numberValue?.double, lon: location?["long"]?.numberValue?.double,
                                 name: name, view: view, pollutant: pollutant)
    }

    /// `getWeatherEmoji`.
    public static func emoji(_ skyIcon: String) -> String { ForecastText.weatherEmoji(skyIcon) }

    /// `_makeMessageForTodayWeather`, or nil where it throws: `currentWeather.t1h` of undefined or null, and
    /// `skyIcon.indexOf` of a value that is no string (arrays, which have `indexOf`, do not occur in responses).
    private static func weatherLines(_ value: JSONValue?, texts: Texts) -> String? {
        guard let value, !value.isNull else { return nil }
        // A string or number `currentWeather` has no `skyIcon`, so `getWeatherEmoji(undefined)` throws.
        guard let current = value.objectValue, let skyIcon = current["skyIcon"]?.stringValue else { return nil }
        let today = current["today"]
        let tmx = Js.truthy(today) ? today?["tmx"] : nil
        let tmn = Js.truthy(today) ? today?["tmn"] : nil
        // `summary` keeps its JavaScript value: `summaryWeather` + "\n" + `summaryAir` (joined as strings), else
        // `summaryWeather` or `summary` as it is.
        let summary: JSONValue?
        if current.contains("summaryWeather") {
            summary = current.contains("summaryAir")
                ? .string(concat(current["summaryWeather"]) + "\n" + concat(current["summaryAir"]))
                : current["summaryWeather"]
        } else if current.contains("summary") {
            summary = current["summary"]
        } else {
            summary = nil
        }
        var message = texts.current + " " + concat(current["t1h"]) + "˚ " + emoji(skyIcon) + "\n"
        message += texts.highest + " " + concat(tmx) + "˚, " + texts.lowest + " " + concat(tmn) + "˚\n"
        if Js.truthy(summary) { message += concat(summary) + "\n" }
        return message
    }

    /// A value in a JavaScript string concatenation (ToString): arrays join their elements with "," (null and undefined as
    /// ""), objects are `[object Object]`.
    static func concat(_ value: JSONValue?) -> String {
        guard let value else { return "undefined" }
        switch value {
        case .array(let items): return items.map { $0.isNull ? "" : concat($0) }.joined(separator: ",")
        default: return Js.string(value)
        }
    }
}
