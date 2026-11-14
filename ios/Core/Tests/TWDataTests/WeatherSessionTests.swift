import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage

/// TabCtrl's loading of the weather pages (IN-08, #2957) on a virtual clock: the `reloadEvent` senders and the
/// ten-minute gate, the refresh-interval timer, the retry confirmation (O03), the swipes between places and a late
/// response applied to its own place. Port of the Android `WeatherSessionTest` without the current position's lookup
/// (IN-10).
@MainActor
struct WeatherSessionTests {
    struct Fixture {
        let clock: VirtualClock
        let http: ScriptedWeatherHTTP
        let holder: AppStateHolder
        let session: WeatherSession

        @MainActor
        init(refreshInterval: String = "0", byURL: @escaping (URL) -> ScriptedWeatherHTTP.Behavior? = { _ in nil },
             photos: WeatherPhotos? = nil) throws {
            let seoulBody = try WeatherFixtures.body("kma-seoul")
            let londonBody = try WeatherFixtures.body("vc-london")
            let clock = VirtualClock()
            self.clock = clock
            http = ScriptedWeatherHTTP(clock: clock) { url in
                if let b = byURL(url) { return b }
                return url.path.contains("37.56,126.98") ? .answer(200, seoulBody) : .answer(200, londonBody)
            }
            holder = AppStateHolder(store: MemoryStore())
            holder.load(AppState(places: [.currentPositionPlaceholder, seoul, london], placeIndex: 1, units: koreanUnits,
                                 settings: Settings(startupPage: "0", refreshInterval: refreshInterval, theme: "light")))
            let repository = WeatherRepository(baseURL: "https://server.test.invalid", cacheDirectory: nil, http: http, clock: clock)
            session = WeatherSession(repository: repository, holder: holder, acceptLanguage: { "ko-KR,ko;q=0.9" },
                                     photos: { photos }, clock: clock, random: { 0 })
        }

        var requests: Int { http.attempts.count }
        func minutes(_ m: Int64) -> Int64 { m * 60_000 }
    }

    @Test func theOpeningLoadsAndAResumeWaitsForTheGate() async throws {
        let f = try Fixture()
        f.session.reload(.initial)
        #expect(f.session.applies == 1, "loadWeatherData fires applyEvent at once")
        await f.clock.advance(by: 1000)
        #expect(f.requests == 1)
        #expect(await eventually { f.session.applies == 2 }, "and again after the response applied")
        #expect(await eventually { f.holder.state?.places[1].source == "KMA" }, "updateCity saves the source")
        #expect(f.http.attempts.first?.headers["Accept-Language"] == "ko-KR,ko;q=0.9")

        await f.clock.advance(to: f.minutes(5))
        f.session.reload(.resume)
        await f.clock.advance(by: 1000)
        #expect(f.requests == 1, "a resume within ten minutes loads nothing")
        #expect(f.session.applies == 2, "and fires no applyEvent")

        f.session.reload(.tab)
        await f.clock.advance(by: 1000)
        #expect(f.requests == 2, "a tab tap reloads at once (reloadCity)")

        await f.clock.advance(to: f.minutes(17))
        f.session.reload(.resume)
        await f.clock.advance(by: 1000)
        #expect(f.requests == 3, "more than ten minutes after the last load a resume loads")
    }

    @Test func theRefreshIntervalReloadsAndRestartsWithEveryLoad() async throws {
        let f = try Fixture(refreshInterval: "30")
        f.session.reload(.initial)
        await f.clock.advance(by: 1000)
        #expect(f.requests == 1)
        await f.clock.advance(to: f.minutes(20))
        f.session.next()   // loadWeatherData restarts the timer: London loads now, the timer fires at 50 minutes
        await f.clock.advance(by: 1000)
        #expect(f.requests == 2)
        await f.clock.advance(to: f.minutes(30) + 5000)
        #expect(f.requests == 2, "the timer restarted at 20 minutes")
        await f.clock.advance(to: f.minutes(50) + 1000)
        #expect(f.requests == 3, "the timer's reload is forced (reloadCity)")
        #expect(f.http.attempts.last?.url.path.contains("51.51,-0.13") == true, "it reloads the selected place")

        // The setting changes to manual: `reloadEvent 'setRefreshInterval'` restarts the timer only.
        f.holder.change { $0.settings.refreshInterval = "0" }
        let applies = f.session.applies
        f.session.reload(.refreshInterval)
        await f.clock.advance(to: f.minutes(200))
        #expect(f.requests == 3, "manual: no timer")
        #expect(f.session.applies == applies, "the setting itself loads nothing")
    }

    @Test func aManualIntervalHasNoTimer() async throws {
        let f = try Fixture(refreshInterval: "0")
        f.session.reload(.initial)
        await f.clock.advance(to: f.minutes(24 * 60))
        #expect(f.requests == 1)
    }

    /// O03 `weather`: a failed load opens the confirmation (Close, OK); other reloads wait while it is open; OK reloads.
    @Test func aFailureOpensTheRetryConfirmation() async throws {
        let f = try Fixture(byURL: { _ in .fail(100, 503) })
        f.session.reload(.initial)
        await f.clock.advance(by: 1000)
        #expect(f.session.retry)
        f.session.reload(.tab)
        await f.clock.advance(by: 1000)
        #expect(f.requests == 1, "reloadEvent is skipped while the confirmation is open")
        f.session.closeRetry()
        #expect(!f.session.retry)
        f.session.reload(.tab)
        await f.clock.advance(by: 1000)
        #expect(f.requests == 2 && f.session.retry)
        f.session.confirmRetry()
        #expect(!f.session.retry)
        await f.clock.advance(by: 1000)
        #expect(f.requests == 3, "OK reloads (reloadEvent 'retryPopup')")
    }

    /// The swipes move between the enabled places (the disabled current position is skipped) and load through the gate.
    @Test func swipesMoveBetweenPlaces() async throws {
        let f = try Fixture()
        f.session.reload(.initial)
        await f.clock.advance(by: 1000)
        f.session.next()
        #expect(f.holder.state?.placeIndex == 2)
        await f.clock.advance(by: 1000)
        #expect(f.requests == 2)
        f.session.next()
        #expect(f.holder.state?.placeIndex == 1, "past the last place: the first enabled one")
        await f.clock.advance(by: 1000)
        #expect(f.requests == 2, "Seoul loaded less than ten minutes ago")
        f.session.previous()
        #expect(f.holder.state?.placeIndex == 2)
    }

    /// V09: Seoul's slow response arrives after the swipe to London; it is saved with Seoul, and London shows its own
    /// weather (Cordova would apply it to the place selected at completion, A01).
    @Test func aLateResponseStaysWithItsPlace() async throws {
        let seoulBody = try WeatherFixtures.body("kma-seoul")
        let f = try Fixture(byURL: { url in url.path.contains("37.56,126.98") ? .answer(3000, seoulBody) : nil })
        f.session.reload(.initial)
        await f.clock.advance(by: 500)
        #expect(f.session.loadingSelected, "the title's spinner while the selected place loads")
        f.session.next()
        await f.clock.advance(by: 1000)
        #expect(f.holder.state?.placeIndex == 2)
        #expect(await eventually { f.session.record(london)["source"]?.stringValue == "VC" })
        let londonRecord = f.session.record(london)
        #expect(!f.session.loadingSelected)
        await f.clock.advance(by: 5000)
        #expect(f.holder.state?.placeIndex == 2, "the selection stays")
        #expect(await eventually { f.holder.state?.places[1].source == "KMA" }, "Seoul's response is saved with Seoul")
        #expect(f.holder.state?.places[2].source == "VC")
        #expect(f.session.record(london)["currentWeather"]?.jsonText == londonRecord["currentWeather"]?.jsonText,
                "London keeps its own weather")
    }

    /// A response gives the place a photo from the feed (`_getPhoto`); the feed arriving later fills places without one.
    @Test func photosFollowTheFeed() async throws {
        let feed = WeatherPhotos.parse(try JSONValue.parse(#"[{"tags":["sun"],"twUrls":{"regular":"https://p.test.invalid/sun.jpg"}},{"tags":["moon"],"twUrls":{"regular":"https://p.test.invalid/moon.jpg"}},{"tags":["cloud"],"twUrls":{"regular":"https://p.test.invalid/cloud.jpg"}},{"tags":["sun"],"twUrls":{"regular":"https://p.test.invalid/sun2.jpg"}},{"tags":["moon"],"twUrls":{"regular":"https://p.test.invalid/moon2.jpg"}},{"tags":["cloud"],"twUrls":{"regular":"https://p.test.invalid/cloud2.jpg"}}]"#))
        let f = try Fixture(photos: feed)
        f.session.reload(.initial)
        await f.clock.advance(by: 1000)
        #expect(await eventually { f.holder.state?.places[1].photo != nil })
        let sky = f.session.record(seoul)["currentWeather"]?["skyIcon"]?.stringValue ?? ""
        #expect(f.holder.state?.places[1].photo == feed.find(skyIcon: sky, random: 0))
        #expect(f.holder.state?.places[1].photo != nil)
    }
}
