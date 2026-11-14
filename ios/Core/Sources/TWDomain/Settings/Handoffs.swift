import Foundation

/// The targets of the menu rows that open other apps (IN-12, #2961): controller.settingctrl.js `clickMenu` and
/// service.util.js `sendMail` and `openMarket`, on iOS. The wind map and the store page open as
/// `cordova.InAppBrowser.open(url, "_system")` opens them on iOS (`UIApplication.openURL`); the feedback mail as the
/// WKWebView hands a `mailto:` navigation to the system (cordova-ios's intent filter, `<allow-intent href="mailto:*"/>`).
public enum Handoffs {
    /// 널스쿨 풍향 (region KR): the wind map over Korea.
    public static let nullschool = "https://earth.nullschool.net/#current/wind/surface/level/orthographic=-233.36,38.96,3000"

    /// 응원리뷰쓰기 (`openMarket` on iOS): `clientConfig.iOSStoreUrl` of the release build, the App Store page of Apple ID
    /// 1041700694 (docs/rewrite/screen-overlays.md, checked 2026-09-27; it redirects to apps.apple.com).
    public static let appStore = "https://itunes.apple.com/app/todayweather/id1041700694"

    /// 의견보내기 (`Util.sendMail`): the text the Cordova code assigns to `window.location.href`: `mailto:` the feedback
    /// address `to`, the translated `subject` as it is, and a body with the app `version`, the device `uuid`
    /// (`device.uuid`, D37: kept) and the WebView's `userAgent` (`ionic.Platform.ua`), encoded by `encodeURIComponent`.
    /// WebKit then parses it as a URL (non-ASCII and spaces in the subject become UTF-8 percent escapes), as
    /// Foundation's `URL(string:)` does.
    public static func feedbackMail(to: String, subject: String, version: String, uuid: String, userAgent: String) -> String {
        let body = "\n====================\nApp Version : " + version + "\nUUID : " + uuid + "\nUA : " + userAgent
            + "\n====================\n"
        return "mailto:" + to + "?subject=" + subject + "&body=" + encodeURIComponent(body)
    }

    /// The URL WebKit navigates to for `text` assigned to `location.href`, for a URL that is not special (no host),
    /// such as the mail link: WebKit's URL parser (WHATWG) percent-encodes as UTF-8 the controls, every non-ASCII
    /// character and, in the query, space, `"`, `<` and `>`; `'` stays (only special schemes encode it). Foundation's
    /// `URL` refuses `` ` ``, `{`, `}`, `|`, `\`, `^`, a space in the path and a second `#`, so those are encoded too
    /// (WebKit keeps them; the mail link has none: its body is `encodeURIComponent`'s output and its address and
    /// subject have none). Nil when `text` is not a URL with a scheme.
    public static func webKitURL(_ text: String) -> URL? {
        var out = ""
        var fragment = false
        for scalar in text.unicodeScalars {
            let v = scalar.value
            var encode = v <= 0x20 || v >= 0x7F || "\"<>`{}|\\^".unicodeScalars.contains(scalar)
            if scalar == "#" {
                encode = fragment
                fragment = true
            }
            if encode {
                for byte in String(scalar).utf8 { out += String(format: "%%%02X", byte) }
            } else {
                out.unicodeScalars.append(scalar)
            }
        }
        guard let url = URL(string: out, encodingInvalidCharacters: false), url.scheme != nil else { return nil }
        return url
    }

    /// JavaScript's `encodeURIComponent`: UTF-8 bytes in `%XX` except ASCII letters, digits and `-_.!~*'()`. A lone
    /// surrogate (which JavaScript rejects with a URIError) cannot occur in a Swift `String`.
    public static func encodeURIComponent(_ s: String) -> String {
        let hex = Array("0123456789ABCDEF")
        var out = ""
        for b in s.utf8 {
            let c = Character(Unicode.Scalar(b))
            if b < 0x80, c.isLetter || c.isNumber || "-_.!~*'()".contains(c) {
                out.append(c)
            } else {
                out.append("%")
                out.append(hex[Int(b >> 4)])
                out.append(hex[Int(b & 15)])
            }
        }
        return out
    }
}

/// The About popup (O10, `openInfo`): the app's name as the title, the data sources and the provisional-data notice
/// (one line each, `<br>` in the Cordova template) and the OK button (`$ionicPopup.alert`, `okText` `LOC_OK`). Shown in
/// every locale (`showAbout()` returns true). `text` translates a catalog key.
public struct About: Equatable, Sendable {
    public let title: String
    public let lines: [String]
    public let ok: String

    public init(text: (String) -> String) {
        title = text("LOC_TODAYWEATHER")
        lines = [
            text("LOC_WEATHER_INFORMATION") + " : " + text("LOC_KOREA_METEOROLOGICAL_ADMINISTRATION"),
            text("LOC_AQI_INFORMATION") + " : " + text("LOC_KOREA_ENVIRONMENT_CORPORATION"),
            text("LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS"),
        ]
        ok = text("LOC_OK")
    }

    /// The catalog keys the popup reads.
    public static let keys = ["LOC_TODAYWEATHER", "LOC_WEATHER_INFORMATION", "LOC_KOREA_METEOROLOGICAL_ADMINISTRATION",
                              "LOC_AQI_INFORMATION", "LOC_KOREA_ENVIRONMENT_CORPORATION",
                              "LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS", "LOC_OK"]
}
