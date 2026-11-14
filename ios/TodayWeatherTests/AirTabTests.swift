import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
@testable import TodayWeather

/// The air page in the shell (IN-09, #2958): the Air tab opens a visit on the selected place's weather, a station cell
/// shows that station's values and a reload (a tap on the selected tab) returns to the first station, a pollutant chosen
/// on S03 stays across the weather tabs until the Locations tab (the captured Cordova navigation), the forecast source's
/// description O08 has the captured texts, the current weather opens S03, and a response without air data shows only the
/// grade scale. The server is a double; the state is injected through the `AppStateHolder`.
@MainActor
@Suite(.serialized)
struct AirTabTests {
    typealias Server = WeatherTabTests.Server

    struct Fixture {
        let server: Server
        let holder: AppStateHolder
        let shell: ShellModel
        let screens: WeatherScreens

        @MainActor
        init(_ behavior: @escaping @Sendable (URL) -> Server.Behavior) {
            server = Server(behavior)
            holder = AppStateHolder(store: WeatherTabTests.Memory())
            let seoul = Place(currentPosition: false, disable: false, name: "회현동", address: "대한민국 서울특별시 중구 회현동",
                              country: "KR", location: Location(lat: 37.56, long: 126.98))
            let jeju = Place(currentPosition: false, disable: false, name: "연동", address: "대한민국 제주특별자치도 제주시 연동",
                             country: "KR", location: Location(lat: 33.5, long: 126.53))
            holder.load(AppState(places: [.currentPositionPlaceholder, seoul, jeju], placeIndex: 1,
                                 units: .defaults(region: "KR"), cordovaExtras: JSONObject([("startVersion", 1)])))
            shell = ShellModel(holder: holder, locale: ShellLocale(preferredLanguages: ["ko-KR"]), version: "test")
            let repository = WeatherRepository(baseURL: "https://server.test.invalid", cacheDirectory: nil, http: server)
            let session = WeatherSession(repository: repository, holder: holder, acceptLanguage: { "ko-KR,ko;q=0.9" })
            screens = WeatherScreens(session: session, shell: shell, screenSize: CGSize(width: 393, height: 852))
        }
    }

    /// The captured responses: Seoul as served, Jeju without its stations and observation.
    static func byPlace() -> @Sendable (URL) -> Server.Behavior {
        let seoul = (try? Data(contentsOf: References.url("air-kma-seoul.input.json"))) ?? Data()
        var jeju = (try? JSONValue.parse(Data(contentsOf: References.url("air-kma-jeju.input.json"))))?.objectValue ?? JSONObject()
        jeju["airInfoList"] = nil
        if var current = jeju["current"]?.objectValue {
            current["arpltn"] = nil
            jeju["current"] = .object(current)
        }
        let noAir = Data(JSONValue.object(jeju).jsonText.utf8)
        return { url in url.path.contains("37.56,126.98") ? .answer(0.05, seoul) : .answer(0.05, noAir) }
    }

    private func eventually(_ seconds: Double = 900, _ condition: () -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(20))
        }
        return condition()
    }

    @Test func stationsSwitchTheValuesAndAReloadReturnsToTheFirst() async throws {
        let f = Fixture(Self.byPlace())
        f.screens.handle(.launch)
        #expect(await eventually { f.screens.scope?.currentWeather != nil })
        f.shell.now = { 10_000 }
        f.shell.tapTab(.air)
        #expect(await eventually { f.screens.airScope != nil })
        let opened = try #require(f.screens.airContent)
        #expect(opened.page.title == "회현동")
        #expect(opened.page.stations?.map(\.heading) == ["중구", "한강대로", "청계천로"])
        #expect(opened.page.main?.value == "좋음")
        #expect(opened.page.gauge.label == "40")
        #expect(f.screens.content(.air)?.title == "회현동")

        // Manual page 12: the second station's values.
        f.screens.selectAirStation(1)
        let station = try #require(f.screens.airContent)
        #expect(station.page.stations?.map(\.selected) == [false, true, false])
        #expect(station.page.gauge.label == "47")
        #expect(station.page.info?.first?.text.first?.text == "한강대로")
        #expect(station.scrolls == 1, "the page goes to the top")

        // A tap on the selected Air tab reloads (`reloadEvent 'tab'`): the first station again.
        f.shell.now = { 20_000 }
        f.shell.tapTab(.air)
        #expect(await eventually { f.server.requests.count == 2 })
        #expect(await eventually { f.screens.airScope?.stnIndex == 0 })
        #expect(f.screens.airContent?.page.gauge.label == "40")

        // Manual page 11: a detail cell selects its pollutant.
        f.screens.selectAirCode("pm25")
        #expect(f.screens.airContent?.page.main?.value == "12")
        #expect(f.screens.airContent?.page.main?.unit == "㎍/㎥")
        #expect(f.screens.airContent?.page.stationsTitle == "측정소 (초미세먼지)")
    }

    /// The captured Cordova navigation (`air-captures.json` `navigation`): `goAirInfoPage('pm25')` on S03, then Hourly,
    /// Air, Daily, Air, Locations, Air.
    @Test func aPollutantChosenOnS03StaysAcrossTheWeatherTabsUntilLocations() async throws {
        let steps = try #require(try References.json("air-captures.json")["navigation"]?.arrayValue)
        #expect(steps.count == 7)
        let f = Fixture(Self.byPlace())
        f.screens.handle(.launch)
        #expect(await eventually { f.screens.scope?.currentWeather != nil })
        f.screens.perform(.airInfo("pm25"))
        var codes: [String?] = []
        func note() { codes.append(f.shell.selected == .air ? f.screens.airScope?.aqiCode : nil) }
        note()
        var now: Int64 = 10_000
        for tab in [ShellTab.forecast, .air, .dailyforecast, .air, .search, .air] {
            now += 1000
            let time = now
            f.shell.now = { time }
            f.shell.tapTab(tab)
            try await Task.sleep(for: .milliseconds(150))
            #expect(await eventually { f.shell.selected == tab && (tab != .air || f.screens.airScope != nil) })
            note()
        }
        #expect(codes == steps.map { $0["aqiCode"]?.stringValue }, "\(codes)")
    }

    @Test func theForecastSourceAndTheWeatherLinks() async throws {
        let f = Fixture(Self.byPlace())
        f.screens.handle(.launch)
        #expect(await eventually { f.screens.scope?.currentWeather != nil })
        f.shell.now = { 10_000 }
        f.shell.tapTab(.air)
        #expect(await eventually { f.screens.airScope != nil })
        let info = try #require(f.screens.airContent?.page.info)
        let source = try #require(info.first { $0.action == .airForecastInfo("airkorea") })
        f.screens.perform(try #require(source.action))
        // O08 as the Cordova build showed it (air-captures.json `o08`).
        let captured = try #require(try References.json("air-captures.json")["o08"])
        let popup = try #require(f.shell.popups.last)
        #expect(popup.lines == captured["body"]?.arrayValue?.compactMap(\.stringValue))
        #expect(popup.buttons.map(\.text) == captured["buttons"]?.arrayValue?.compactMap { $0["text"]?.stringValue })
        f.shell.tapPopupButton(0)
        #expect(info.first { $0.label == "대기환경기준" }?.action == .units)
        // The current weather of the main box opens S03 (`goWeather`).
        f.screens.airWeatherTapped()
        #expect(f.shell.selected == .forecast)
        #expect(await eventually { f.screens.scope != nil && f.screens.airScope == nil })
    }

    /// A response without air data (Jeju without stations and observation): the grade scale only.
    @Test func withoutAirDataOnlyTheScaleShows() async throws {
        let f = Fixture(Self.byPlace())
        f.holder.change { $0.placeIndex = 2 }
        f.screens.handle(.launch)
        #expect(await eventually { f.holder.state?.places[2].source == "KMA" })
        f.shell.now = { 10_000 }
        f.shell.tapTab(.air)
        #expect(await eventually { f.screens.airScope != nil })
        let page = try #require(f.screens.airContent?.page)
        #expect(page.main == nil && page.chartTitle == nil && page.daily == nil && page.detail == nil && page.info == nil
                && page.stations == nil)
        #expect(page.gauge.bands.map(\.bound) == ["~ 50", "~ 100", "~ 250", "~ 500"])
        #expect(page.gauge.label == "")
    }
}
