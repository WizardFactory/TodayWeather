import Foundation
import TWModel

/// The language and region the Cordova app derives from the system languages (client/www/js/app.js L127-L157 and
/// L421-L438, with angular-translate 2.19.1 `determinePreferredLanguage`), and what its WKWebView reports and sends:
/// `navigator.language`, `navigator.languages` and the `Accept-Language` header. Port of the Android `AppLanguage` with
/// the iOS WebView's tags, recorded from the Cordova iOS build (Tests/TWDomainTests/ShellReference/languages.json).
public enum AppLanguage {
    /// Catalogs in client/www/locales, in registration order.
    public static let catalogs = ["en", "de", "ko", "ja", "zh-CN", "zh-TW"]

    /// `registerAvailableLanguageKeys` aliases, in the order angular-translate iterates them.
    private static let aliases: [(String, String)] = [
        ("en_*", "en"), ("de_*", "de"), ("ko_*", "ko"), ("ja_*", "ja"), ("zh_HK", "zh-TW"), ("zh_TW", "zh-TW"),
        ("zh_*", "zh-CN"),
    ]

    /// The catalog for `tag`, the WebView's `navigator.language`: the default tag resolver (`-` to `_`), an exact key,
    /// an alias (exact or `prefix_*`), or the language part; anything else falls back to English
    /// (`fallbackLanguage('en')`).
    public static func catalog(_ tag: String?) -> String {
        let preferred = JSString.split(tag ?? "", "-").joined(separator: "_")
        if preferred.isEmpty { return "en" }
        let lower = preferred.lowercased()
        if let exact = catalogs.first(where: { $0.lowercased() == lower }) { return exact }
        for (alias, key) in aliases {
            let exact = alias.lowercased() == lower
            // `preferred.take(alias.length - 1)` equal to the alias without its `*`, ignoring case.
            let wildcard = alias.hasSuffix("*") && lower.utf16.starts(with: alias.dropLast().lowercased().utf16)
            if exact || wildcard { return key }
        }
        let parts = JSString.split(preferred, "_")
        if parts.count > 1, let language = catalogs.first(where: { $0.lowercased() == parts[0].lowercased() }) {
            return language
        }
        return "en"
    }

    /// `Util.region` without the globalization plugin (the iOS build has none): the last part of the first
    /// `navigator.languages` entry with a `-`, else KR.
    public static func region(_ languages: [String]) -> String {
        for tag in languages {
            let parts = JSString.split(tag, "-")
            if parts.count > 1 { return parts[parts.count - 1] }
        }
        return "KR"
    }

    /// `navigator.language` of the WKWebView for the system's preferred languages (`Locale.preferredLanguages`).
    ///
    /// WebKit on iOS reports only the first language, minimized: the region is dropped and the language takes the
    /// region of its old CFBundle localization (`en` → `en-US`, `ko` → `ko-KR`, `de` → `de-DE`, `fr` → `fr-FR`, `ja`
    /// stays `ja`); Chinese keeps its script as a region (`zh-Hans` → `zh-CN`, `zh-Hant` → `zh-TW`, Hong Kong
    /// `zh-HK`). So a system language `en-KR` gives `en-US` and region US, and `de-AT` gives `de-DE`. Recorded from the
    /// Cordova iOS build on the iOS 26.5 simulator (Tests/TWDomainTests/ShellReference/languages.json). Languages not
    /// recorded there keep their language code alone; none of them has a catalog or region KR.
    public static func webLanguage(_ preferred: [String]) -> String {
        guard let first = preferred.first, !first.isEmpty else { return "en-US" }
        let parts = first.split(whereSeparator: { $0 == "-" || $0 == "_" }).map(String.init)
        let language = parts[0].lowercased()
        let rest = parts.dropFirst()
        let script = rest.first { $0.count == 4 }?.lowercased()
        let region = rest.first { $0.count == 2 || $0.count == 3 && $0.allSatisfy(\.isNumber) }?.uppercased()
        if language == "zh" {
            if region == "HK" { return "zh-HK" }
            if script == "hant" || region == "TW" { return "zh-TW" }
            return "zh-CN"
        }
        return languageRegions[language].map { "\(language)-\($0)" } ?? language
    }

    /// The region WebKit gives a minimized language (`CFBundleCopyLocalizationForLocalizationInfo`), for the recorded
    /// languages; `ja` has none.
    private static let languageRegions = ["en": "US", "ko": "KR", "de": "DE", "fr": "FR"]

    /// `navigator.languages` of the WKWebView: the first language alone.
    public static func webLanguages(_ preferred: [String]) -> [String] {
        [webLanguage(preferred)]
    }

    /// The `Accept-Language` header the WKWebView sends: `navigator.language`, and with a region also its language (for
    /// Chinese its script) at q=0.9: `ko-KR,ko;q=0.9`, `zh-TW,zh-Hant;q=0.9`, `ja`.
    public static func acceptLanguage(_ preferred: [String]) -> String {
        let tag = webLanguage(preferred)
        let parts = JSString.split(tag, "-")
        guard parts.count > 1 else { return tag }
        if parts[0] == "zh" { return "\(tag),zh-\(parts[1] == "CN" ? "Hans" : "Hant");q=0.9" }
        return "\(tag),\(parts[0]);q=0.9"
    }
}
