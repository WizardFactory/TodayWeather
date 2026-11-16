import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWResources
import TWStorage

/// The share message of the Cordova iOS app (IN-16, #2965; O16, V20) against `doTabShare` run in JavaScriptCore
/// (Golden/share.json, written by ios/tools/share/generate.py with the sources' commits and hashes): the city line, the
/// values joined as JavaScript joins them, the emoji, the summary, the link per `Util.language`, the city line alone when
/// the weather lines throw, and nothing (the start choice) without a location. The texts come from the imported catalogs,
/// as the app reads them.
struct ShareMessageTests {
    static let golden: JSONValue = {
        let url = Bundle.module.resourceURL!.appendingPathComponent("Golden/share.json")
        return (try? JSONValue.parse(Data(contentsOf: url))) ?? .null
    }()

    /// The catalog's translation, as angular-translate looks it up (the catalog, then English, then the key).
    static func translate(_ catalog: String) -> (String) -> String {
        let bundles = [TWResources.strings(catalog: catalog), TWResources.strings(catalog: "en")].compactMap { $0 }
        return { key in
            for b in bundles {
                let value = b.localizedString(forKey: key, value: "\u{1}", table: nil)
                if value != "\u{1}" { return value }
            }
            return key
        }
    }

    @Test func goldenComesFromTheCordovaSources() throws {
        let sources = try #require(Self.golden["sources"]?.arrayValue)
        let paths = sources.compactMap { $0["path"]?.stringValue }
        #expect(paths.prefix(2) == ["client/www/js/service.weatherutil.js", "client/www/js/controller.tabctrl.js"])
        #expect(paths.count == 8)
        for source in sources {
            #expect(source["commit"]?.stringValue?.utf8.count == 40)
            #expect(source["sha256"]?.stringValue?.utf8.count == 64)
        }
        #expect(Self.golden["generator"]?.stringValue?.contains("JavaScriptCore") == true)
    }

    /// The imported catalogs give the strings `doTabShare` translated.
    @Test func theCatalogsGiveTheCordovaTexts() throws {
        let texts = try #require(Self.golden["texts"]?.objectValue)
        #expect(texts.keys.count == 6)
        for code in texts.keys {
            let translate = Self.translate(code)
            for key in ShareMessage.keys {
                #expect(translate(key) == texts[code]?[key]?.stringValue, "\(code) \(key)")
            }
        }
    }

    /// Every case of the golden: the same message, or none where Cordova opened the start choice.
    @Test func everyCaseAsTheCordovaCode() throws {
        let cases = try #require(Self.golden["cases"]?.arrayValue)
        #expect(cases.count == 47)
        var shared = 0
        for c in cases {
            let name = c["name"]?.stringValue ?? "?"
            let catalog = try #require(c["catalog"]?.stringValue)
            let language = try #require(c["language"]?.stringValue)
            let message = ShareMessage.build(c["city"]?.objectValue, texts: ShareMessage.Texts(Self.translate(catalog)),
                                             language: language)
            if let expected = c["message"]?.stringValue {
                shared += 1
                #expect(message == expected, "\(name)")
                #expect(c["shareArguments"] == .array([.null, .null, .null]), "\(name): the text alone")
            } else {
                #expect(message == nil, "\(name)")
                #expect(c["startPopup"]?.boolValue == true, "\(name)")
            }
        }
        #expect(shared == 43)
    }

    /// The record the pages apply (`cityRecord`): a saved place with its weather gives the Cordova lines.
    @Test func aPlaceRecordGivesTheMessage() throws {
        let place = Place(currentPosition: false, disable: false, name: "회현동", address: "대한민국 서울특별시 중구 회현동",
                          country: "KR", location: Location(lat: 37.56, long: 126.98))
        let weather = try JSONValue.parse(Data("""
            {"currentWeather": {"t1h": 7.2, "skyIcon": "moon_smallcloud", "today": {"tmx": 12, "tmn": -1},
             "summaryWeather": "어제보다 -1˚, 맑음", "summaryAir": "대기상태가 좋아요"}}
            """.utf8))
        let entry = WeatherEntry(weather: try #require(weather.objectValue), loadedAt: Date(timeIntervalSince1970: 0))
        let record = cityRecord(place, entry)
        #expect(ShareMessage.build(record, texts: ShareMessage.Texts(Self.translate("ko")), language: "ko-KR")
                == "회현동\n현재 7.2˚ ⛅\n최고 12˚, 최저 -1˚\n어제보다 -1˚, 맑음\n대기상태가 좋아요\n\n오늘날씨 https://twa.app.link/wgVmUTfVoM")
        // A current position without a location shares nothing.
        #expect(ShareMessage.build(cityRecord(.currentPositionPlaceholder, nil), texts: ShareMessage.Texts(Self.translate("ko")),
                                   language: "ko-KR") == nil)
    }
}
