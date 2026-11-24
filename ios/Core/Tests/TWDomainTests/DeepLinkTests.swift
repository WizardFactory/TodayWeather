import Foundation
import Testing
import TWDomain
import TWModel

/// `link.todayweather.ai` links against the shared golden vectors (specs/deeplink.golden.json, copied with the web
/// catalog's `PLACES` by ios/tools/import_deeplink_golden.py), which the edge, the web app and Android check too: every
/// parse case, every share case and the catalog (#3097, specs/deeplink.md §8).
struct DeepLinkTests {
    static func resource(_ name: String) -> JSONValue {
        let url = Bundle.module.resourceURL!.appendingPathComponent("DeepLink/\(name)")
        return (try? JSONValue.parse(Data(contentsOf: url))) ?? .null
    }

    static let golden = resource("deeplink.golden.json")
    static let places = resource("places.json")

    private static func string(_ value: JSONValue?) -> String? { value?.isNull == false ? value?.stringValue : nil }
    private static func number(_ value: JSONValue?) -> Double? { value?.isNull == false ? value?.numberValue?.double : nil }

    private static func expected(_ native: JSONValue?) -> DeepLinkTarget? {
        guard let n = native, !n.isNull else { return nil }
        switch string(n["kind"]) {
        case "open": return .open(lang: string(n["lang"]))
        case "place": return .place(slug: string(n["slug"])!, view: WeatherView.of(string(n["view"])), pollutant: string(n["pollutant"]))
        case "coordinate":
            return .coordinate(lat: number(n["lat"])!, lon: number(n["lon"])!, name: string(n["name"]),
                               view: WeatherView.of(string(n["view"])), pollutant: string(n["pollutant"]))
        case "nationWeather": return .nationWeather
        case "nationAir": return .nationAir
        case "warnings": return .warnings
        case "legacyWidget": return .legacyWidget(placeID: string(n["placeId"]))
        default: Issue.record("unknown kind \(String(describing: n["kind"]))"); return nil
        }
    }

    @Test func everyGoldenParseCaseMatches() throws {
        let cases = try #require(Self.golden["parseCases"]?.arrayValue)
        #expect(cases.count >= 39)
        for c in cases {
            let url = try #require(Self.string(c["url"]))
            // The Android widget link (`todayweather://N`) is not an iOS link: it opens nothing here.
            let want = Self.string(c["legacyPlatform"]) == "android" ? nil : Self.expected(c["native"])
            #expect(DeepLink.parse(url) == want, "\(Self.string(c["id"]) ?? "?"): \(url)")
        }
    }

    @Test func everyGoldenShareCaseMatches() throws {
        let cases = try #require(Self.golden["shareBuildCases"]?.arrayValue)
        #expect(cases.count >= 12)
        for c in cases {
            let input = try #require(c["input"])
            let url = DeepLink.shareURL(lat: Self.number(input["lat"]), lon: Self.number(input["lon"]),
                                        name: Self.string(input["name"]), view: WeatherView.of(Self.string(input["view"])),
                                        pollutant: Self.string(input["pollutant"]), placeID: Self.string(input["placeId"]))
            #expect(url == Self.string(c["url"]), "\(Self.string(c["id"]) ?? "?")")
        }
    }

    @Test func theCatalogMatchesTheGoldenCatalogAndTheWebPlaces() throws {
        let catalog = try #require(Self.golden["catalog"]?.arrayValue)
        #expect(catalog.map { "\(Self.string($0["id"])!) \(Self.number($0["lat"])!) \(Self.number($0["lon"])!)" }
                == DeepLinkCatalog.places.map { "\($0.id) \($0.lat) \($0.lon)" })
        let web = try #require(Self.places.arrayValue).map {
            CatalogPlace(id: Self.string($0["id"])!, name: Self.string($0["name"])!, address: Self.string($0["address"])!,
                         country: Self.string($0["country"])!, lat: Self.number($0["lat"])!, lon: Self.number($0["lon"])!)
        }
        #expect(web.count == 22)
        #expect(web == DeepLinkCatalog.places)
    }

    @Test func hostsOtherThanTheLinkHostOpenNothing() {
        for url in ["https://todayweather.ai/mobile/privacy.html", "https://app.todayweather.ai/weather/seoul/hourly",
                    "https://link.todayweather.ai.evil.example/place/seoul", "https://evil.example/link.todayweather.ai/place/seoul",
                    "intent://link.todayweather.ai/place/seoul", "", "not a url"] {
            #expect(DeepLink.parse(url) == nil, "\(url)")
        }
        #expect(DeepLink.parse("https://link.todayweather.ai:443/place/seoul#top") == .place(slug: "seoul", view: .hourly, pollutant: nil))
        #expect(DeepLink.parse("https://LINK.todayweather.ai/loc?lat=37.5&lon=127&name=a+b&lat=1")
                == .coordinate(lat: 37.5, lon: 127, name: "a b", view: .hourly, pollutant: nil))
    }

    @Test func savedPlacesMatchWithinAHundredthOfADegree() {
        #expect(DeepLink.nearSaved(37.567, 126.978, 37.577, 126.968))
        #expect(!DeepLink.nearSaved(37.567, 126.978, 37.578, 126.978))
        #expect(DeepLinkCatalog.find("seoul")?.id == "seoul")
        #expect(DeepLinkCatalog.find("not-in-catalog") == nil)
        #expect(DeepLinkCatalog.nearby(lat: 37.6, lon: 126.95)?.id == "seoul")
        #expect(DeepLinkCatalog.nearby(lat: 37.61, lon: 126.978) == nil)
    }

    /// Raw and escaped names decode alike (supplementary characters too); ports follow `new URL` (CODEX-3164-8, -9).
    @Test func rawNamesDecodeAsEscapedOnesAndPortsMustBeValid() {
        let raw = DeepLink.parse("https://link.todayweather.ai/loc?lat=1&lon=2&name=😀 서울")
        #expect(raw == .coordinate(lat: 1, lon: 2, name: "😀 서울", view: .hourly, pollutant: nil))
        #expect(raw == DeepLink.parse("https://link.todayweather.ai/loc?lat=1&lon=2&name=%F0%9F%98%80%20%EC%84%9C%EC%9A%B8"))
        #expect(DeepLink.parse("https://link.todayweather.ai:65536/open") == nil)
        #expect(DeepLink.parse("https://link.todayweather.ai:x/open") == nil)
        #expect(DeepLink.parse("https://link.todayweather.ai:8443/open") == .open(lang: nil))
        #expect(DeepLink.parse("https://link.todayweather.ai:/open") == .open(lang: nil))
    }

    /// A linked place without a name is titled by its coordinates as JavaScript prints them.
    @Test func coordinatesTitleAPlaceWithoutAName() {
        #expect(DeepLink.coordinateText(lat: 0, lon: -0.5) == "0, -0.5")
        #expect(DeepLink.coordinateText(lat: 37.383, lon: 127.119) == "37.383, 127.119")
    }
}
