import Foundation
import Testing
import TWDomain
import TWStorage
@testable import TodayWeather

struct WidgetWeatherIntegrationTests {
    @Test(arguments: ["kma-seoul", "vc-london"])
    func rendersFutureForecastsFromNativeResponses(_ fixture: String) throws {
        let converted = try #require(try WeatherConverter.convert(References.json("forecast-\(fixture).input.json")))
        let updated = Date(timeIntervalSince1970: 1_000)
        let weather = try #require(WidgetWeatherProjection.make(converted, updatedAt: updated))
        #expect(weather.date == updated)
        #expect(weather.daily.count == 6)
        #expect(weather.hourly.count == 6)
        #expect(weather.daily.first?.label == (fixture == "kma-seoul" ? "11/8" : "11/7"))
        #expect(weather.hourly.first?.label == (fixture == "kma-seoul" ? "03:00" : "18:00"))
        #expect(weather.temperature == (fixture == "kma-seoul" ? "3°" : "10°"))
        #expect(!weather.air.isEmpty)
    }

    @Test func widgetCatalogPublishesTheRegisteredWeatherRoutesAndUnits() throws {
        var place = Place(currentPosition: false, disable: false, address: "서울특별시 중구 명동",
                          location: Location(lat: 37.56, long: 126.98))
        let units = UnitSettings.defaults(region: "US")
        let server = "https://legacy.test.invalid"
        func check(_ path: String) throws {
            let url = try #require(WidgetSharing.place(place, base: server, units: units).request)
            #expect(url.host == "legacy.test.invalid")
            #expect(url.path(percentEncoded: false) == path)
            let query = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
            for key in UnitSettings.keys {
                #expect(query.contains(URLQueryItem(name: key, value: units.value(key))))
            }
        }
        try check("/weather/v000903/coord/37.56,126.98")
        place.location = nil
        try check("/v000903/kma/addr/서울특별시/중구/명동")
        place.address = "United Kingdom London Westminster Abbey Road"
        try check("/weather/v000903/addr/United Kingdom London Westminster Abbey Road")
        #expect(WidgetSharing.place(place, base: nil, units: units).request == nil)
        place.address = nil
        #expect(WidgetSharing.place(place, base: server, units: units).request == nil)
    }

    @MainActor @Test func widgetLinksSelectTheirPlaceBeforeAndAfterMigration() throws {
        let launch = AppLaunch(store: MemoryStore(), environment: .init(preferredLanguages: ["ko"], photosURL: nil, version: "test"),
                               weatherCache: nil, placeSearch: { nil })
        var state = ShellFixture.state()
        let seoul = state.places[1]
        let busan = Place(currentPosition: false, disable: false, name: "부산", address: "대한민국 부산광역시")
        state.places.append(busan)
        let url = try #require(URL(string: "todayweather://widget?place=" + WidgetSharing.id(busan)))
        launch.entries.submit(.link(url))
        launch.migrationFinished(state)
        #expect(launch.holder.state?.placeIndex == 2)
        launch.holder.change { $0.places.swapAt(1, 2) }
        launch.shell?.select(.air)
        launch.entries.submit(.link(url))
        #expect(launch.shell?.selected == .forecast)
        #expect(launch.holder.state?.placeIndex == 1)
        #expect(launch.holder.state?.places.last == seoul)
    }
}
