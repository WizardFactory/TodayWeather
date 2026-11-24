import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWResources
import TWStorage

/// The share message of the Cordova iOS app (IN-16, #2965; O16, V20) against `doTabShare` run in JavaScriptCore
/// (Golden/share.json, written by ios/tools/share/generate.py with the sources' commits and hashes): the city line, the
/// values joined as JavaScript joins them, the emoji, the summary, the city line alone when the weather lines throw, and
/// nothing (the start choice) without a location. The texts come from the imported catalogs, as the app reads them. The
/// Branch link per `Util.language` that the Cordova message ended with gave way to the `link.todayweather.ai` link of the
/// shared place and tab (specs/deeplink.md §7, D35, #3097).
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

    /// The Cordova message with its Branch link replaced by the place's `link.todayweather.ai` link for the Hourly tab:
    /// the record's numeric `location.lat` and `location.long` and the message's first line as the name.
    static func replacingBranchLink(_ message: String, city: JSONObject) -> String {
        let link = DeepLink.shareURL(lat: city["location"]?["lat"]?.numberValue?.double,
                                     lon: city["location"]?["long"]?.numberValue?.double,
                                     name: String(message.prefix { $0 != "\n" }), view: .hourly, pollutant: nil)
        var out = message
        for branch in ["https://twa.app.link/wgVmUTfVoM", "https://twa.app.link/II1JstpVoM"] {
            out = out.replacingOccurrences(of: " " + branch, with: " " + link)
        }
        return out
    }

    /// Every case of the golden: the same message (its link replaced), or none where Cordova opened the start choice.
    @Test func everyCaseAsTheCordovaCode() throws {
        let cases = try #require(Self.golden["cases"]?.arrayValue)
        #expect(cases.count == 47)
        var shared = 0
        for c in cases {
            let name = c["name"]?.stringValue ?? "?"
            let catalog = try #require(c["catalog"]?.stringValue)
            #expect(c["language"]?.stringValue != nil)
            let message = ShareMessage.build(c["city"]?.objectValue, texts: ShareMessage.Texts(Self.translate(catalog)))
            if let cordova = c["message"]?.stringValue {
                shared += 1
                let expected = Self.replacingBranchLink(cordova, city: try #require(c["city"]?.objectValue))
                #expect(!expected.contains("twa.app.link"), "\(name)")
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
        #expect(ShareMessage.build(record, texts: ShareMessage.Texts(Self.translate("ko")))
                == "회현동\n현재 7.2˚ ⛅\n최고 12˚, 최저 -1˚\n어제보다 -1˚, 맑음\n대기상태가 좋아요\n\n오늘날씨 https://link.todayweather.ai/place/seoul")
        // A current position without a location shares nothing.
        #expect(ShareMessage.build(cityRecord(.currentPositionPlaceholder, nil), texts: ShareMessage.Texts(Self.translate("ko"))) == nil)
    }

    /// The link follows the shared place and tab: a catalog city within 0.04° by slug, else three-decimal coordinates
    /// with the name the message starts with, else `/open` (specs/deeplink.md §7).
    @Test func theLinkFollowsTheSharedPlaceAndTab() throws {
        func city(_ name: String, _ lat: String, _ long: String) throws -> JSONObject {
            try #require(JSONValue.parse(Data("""
                {"name": "\(name)", "location": {"lat": \(lat), "long": \(long)},
                 "currentWeather": {"t1h": 7, "skyIcon": "sun", "today": {"tmx": 12, "tmn": 3}}}
                """.utf8)).objectValue)
        }
        let ko = ShareMessage.Texts(current: "현재", highest: "최고", lowest: "최저", app: "오늘날씨")
        func link(_ city: JSONObject, _ view: WeatherView = .hourly, _ pollutant: String? = nil) -> String? {
            ShareMessage.build(city, texts: ko, view: view, pollutant: pollutant)?.split(separator: " ").last.map(String.init)
        }
        let seoul = try city("회현동", "37.56", "126.98")
        #expect(link(seoul) == "https://link.todayweather.ai/place/seoul")
        #expect(link(seoul, .daily) == "https://link.todayweather.ai/place/seoul?view=daily")
        #expect(link(seoul, .air, "pm25") == "https://link.todayweather.ai/air/seoul?pollutant=pm25")
        #expect(link(seoul, .air, "aqi") == "https://link.todayweather.ai/air/seoul")
        // Outside the catalog: three decimals and the name the message starts with.
        #expect(link(try city("분당구", "37.38274", "127.11891"), .air, "o3")
                == "https://link.todayweather.ai/loc?lat=37.383&lon=127.119&name=%EB%B6%84%EB%8B%B9%EA%B5%AC&view=air&pollutant=o3")
        #expect(link(try city("Null Island", "-0.0001", "0")) == "https://link.todayweather.ai/loc?lat=0&lon=0&name=Null%20Island")
        // Coordinates out of range or not numbers open the app only.
        #expect(link(try city("x", "95", "127")) == "https://link.todayweather.ai/open")
        #expect(link(try city("x", "\"37.5\"", "127")) == "https://link.todayweather.ai/open")
    }
}
