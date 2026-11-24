import Foundation
import Testing
import TWModel
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
        let previous = fixture == "kma-seoul" ? ["5°", "3°", "4°", "8°", "10°", "8°"]
                                              : ["11°", "8°", "6°", "5°", "5°", "5°"]
        #expect(weather.hourly.map(\.previousTemperature) == previous)
        #expect(!weather.air.isEmpty)
    }

    @Test func curveUnderstandsBothForecastModesInPreviouslyCachedWeather() throws {
        let rows = try JSONDecoder().decode([WidgetForecast].self, from: Data("""
          [{"label":"03:00","temperature":"-3°","symbol":"cloud.fill"},
           {"label":"11/8","temperature":"2°/-4°","symbol":"sun.max.fill"}]
          """.utf8))
        let hour = try #require(WidgetTemperatureSample(rows[0], hourly: true))
        #expect(hour.label == "03:00" && hour.upper == -3 && hour.lower == nil && hour.previous == nil)
        let day = try #require(WidgetTemperatureSample(rows[1], hourly: false))
        #expect(day.upper == 2 && day.lower == -4)
        #expect(WidgetTemperatureSample(rows[1], hourly: true) == nil)
        #expect(WidgetTemperatureSample.value("–") == nil)
    }

    @Test func previousDayMatchesLocalHoursAcrossNewYearAndKeepsGaps() throws {
        let record = try #require(try JSONValue.parse("""
        {
          "source":"KMA", "currentWeather":{"date":"20261231","time":21,"t1h":5},
          "timeTable":[
            {"date":"20270101","time":0,"t3h":2}, {"date":"20270101","time":3,"t3h":3},
            {"date":"20270101","time":6,"t3h":4}, {"date":"20270101","time":9,"t3h":5},
            {"date":"20270101","time":24,"t3h":6}
          ],
          "timeChart":[{"name":"yesterday","values":[
            {"value":{"date":"20261231","time":9,"t3h":0}},
            {"value":{"date":"20261230","time":24,"t3h":-2}},
            {"value":{"date":"20261231","time":6,"t3h":-50}},
            {"value":{"date":"20270101","time":0,"t3h":2}}
          ]}]
        }
        """).objectValue)
        let weather = try #require(WidgetWeatherProjection.make(record, updatedAt: .now))
        #expect(weather.hourly.map(\.previousTemperature) == ["-2°", nil, nil, "0°", nil])
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

    @MainActor @Test func coldWidgetEntryObservesOnlyTheForecastActuallyOpened() async throws {
        let launch = AppLaunch(store: MemoryStore(), environment: .init(preferredLanguages: ["ko"], photosURL: nil, version: "test"),
                               weatherCache: nil, placeSearch: { nil })
        let sdk = PrivacyRowsTests.Sdk()
        let records = PrivacyRowsTests.Records()
        records.choice = "true"
        records.collection = true
        let directory = URL.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var draws = 0
        let visits = ForecastAdVisits(directory: directory, draw: { draws += 1; return 0 })
        let presenter = ForecastInterstitial(visits: visits, load: { _, _ in }, root: { nil }, uptime: { 0 }, track: { _, _ in })
        let ads = Monetization(analytics: UsageAnalytics(sdk: sdk, records: records, trafficType: "development", region: "DE"),
                               settings: nil, interstitial: presenter)
        ads.connect(launch)
        let state = ShellFixture.state(startupPage: "1")
        let url = try #require(URL(string: "todayweather://widget?place=" + WidgetSharing.id(state.places[1])))
        launch.entries.submit(.link(url))
        launch.migrationFinished(state)
        await Task.yield()
        #expect(launch.shell?.selected == .forecast)
        #expect(sdk.events.filter { $0.hasPrefix("screen_view") } == ["screen_view tab.forecast"])
        #expect(visits.reserve(from: .forecast, to: .dailyforecast, readPastChart: true, navigate: {}) == nil)
        #expect(draws == 0)
        #expect(visits.reserve(from: .dailyforecast, to: .forecast, readPastChart: true, navigate: {}) != nil)
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
