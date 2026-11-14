import Foundation
import Testing
import TWDomain
import TWModel

/// The language rules of the Cordova shell (IN-07, #2956, V24): the catalog angular-translate picks, `Util.region`, and
/// what the Cordova iOS WKWebView reports and sends for the system languages.
struct AppLanguageTests {
    /// angular-translate with the app's keys and aliases: exact keys, aliases in order, the language part, else English
    /// (the cases of the Android `ShellLogicTest`).
    @Test func navigatorLanguagePicksTheCatalog() {
        let cases: [(String, String)] = [
            ("ko-KR", "ko"), ("ko", "ko"), ("en-US", "en"), ("en", "en"), ("de-AT", "de"), ("de-DE", "de"), ("ja-JP", "ja"),
            ("ja", "ja"), ("zh-TW", "zh-TW"), ("zh-HK", "zh-TW"), ("zh-CN", "zh-CN"), ("zh-SG", "zh-CN"),
            ("zh-Hant-TW", "zh-CN"), // "zh_Hant_TW" only matches zh_* (survey ambiguity 4)
            ("zh", "en"), ("fr-FR", "en"), ("pt-BR", "en"), ("", "en"), ("EN-us", "en"), ("zh-tw", "zh-TW"),
        ]
        for (tag, expected) in cases {
            #expect(AppLanguage.catalog(tag) == expected, "\(tag)")
        }
        #expect(AppLanguage.catalog(nil) == "en")
    }

    @Test func regionIsTheLastPartOfTheFirstTagWithARegion() {
        #expect(AppLanguage.region(["ko-KR", "en-US"]) == "KR")
        #expect(AppLanguage.region(["en", "en-US"]) == "US")
        #expect(AppLanguage.region(["zh-Hant-TW"]) == "TW")
        #expect(AppLanguage.region(["en"]) == "KR")
        #expect(AppLanguage.region(["ja"]) == "KR", "ja has no region on iOS: the KR default")
        #expect(AppLanguage.region([]) == "KR")
    }

    /// Every recorded system language list: `navigator.language`, `navigator.languages` and `Accept-Language` as the
    /// Cordova iOS WebView reported and sent them (ios/tools/shell-reference/capture.py languages).
    @Test func theWebViewLanguagesAsRecorded() throws {
        let url = Bundle.module.resourceURL!.appendingPathComponent("ShellReference/languages.json")
        let record = try JSONValue.parse(Data(contentsOf: url))
        let cases = try #require(record["cases"]?.arrayValue)
        #expect(cases.count == 12)
        for c in cases {
            let system = (c["appleLanguages"]?.arrayValue ?? []).compactMap(\.stringValue)
            let languages = (c["navigatorLanguages"]?.arrayValue ?? []).compactMap(\.stringValue)
            #expect(AppLanguage.webLanguage(system) == c["navigatorLanguage"]?.stringValue, "\(system)")
            #expect(AppLanguage.webLanguages(system) == languages, "\(system)")
            #expect(AppLanguage.acceptLanguage(system) == c["acceptLanguage"]?.stringValue, "\(system)")
        }
    }

    /// The system's own forms of the same languages (`Locale.preferredLanguages` adds the region of the locale and
    /// writes Chinese with its script) give the same WebView language.
    @Test func systemLanguageForms() {
        #expect(AppLanguage.webLanguage(["ko"]) == "ko-KR")
        #expect(AppLanguage.webLanguage(["ko-US"]) == "ko-KR")
        #expect(AppLanguage.webLanguage(["en-GB"]) == "en-US")
        #expect(AppLanguage.webLanguage(["en"]) == "en-US")
        #expect(AppLanguage.webLanguage(["ja-KR"]) == "ja")
        #expect(AppLanguage.webLanguage(["zh-Hans"]) == "zh-CN")
        #expect(AppLanguage.webLanguage(["zh-Hans-KR"]) == "zh-CN")
        #expect(AppLanguage.webLanguage(["zh-Hant"]) == "zh-TW")
        #expect(AppLanguage.webLanguage(["zh-Hant-KR"]) == "zh-TW")
        #expect(AppLanguage.webLanguage(["zh_Hant_HK"]) == "zh-HK")
        #expect(AppLanguage.webLanguage(["es-419"]) == "es", "a language without a recorded region keeps its code")
        #expect(AppLanguage.webLanguage([]) == "en-US")
        #expect(AppLanguage.acceptLanguage(["es-ES"]) == "es")
        // The resulting catalog and region of the shell.
        #expect(AppLanguage.catalog(AppLanguage.webLanguage(["zh-Hant-TW"])) == "zh-TW", "on iOS the WebView gives zh-TW")
        #expect(AppLanguage.region(AppLanguage.webLanguages(["en-KR"])) == "US", "English with region Korea: no KR rows")
        #expect(AppLanguage.region(AppLanguage.webLanguages(["ko-US"])) == "KR")
    }
}
