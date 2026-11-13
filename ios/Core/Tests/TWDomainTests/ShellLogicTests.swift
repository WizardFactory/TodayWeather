import Foundation
import Testing
import TWDomain
import TWModel

/// Themes, tabs, startup page, menu rows, tab taps, the start gate and the photo feed rules of the Cordova shell
/// (IN-07, #2956); the language rules are in `AppLanguageTests`. Ported from the Android `ShellLogicTest` and extended
/// with the iOS template's choices.
struct ShellLogicTests {
    @Test func themesAndTheirImageFolders() {
        #expect(Theme.of(nil) == .light)
        #expect(Theme.of("unknown") == .light)
        #expect(Theme.of("") == .light)
        #expect(Theme.of("dark").icons == "img/icons_dark")
        #expect(Theme.of("old").weather == "img/weather_old")
        #expect(Theme.of("old").icons == "img/icons_old")
        #expect(Theme.of("photo").weather == "img/weather_default")
        #expect(Theme.of("photo").icons == "img/icons_default")
        #expect(Theme.of("light").icons == "img/icons_default")
        // Stored values compare by UTF-16 code units: a differently normalized or cased value is unknown.
        #expect(Theme.of("Dark") == .light)
        #expect(Theme.allCases.map(\.key) == ["photo", "light", "dark", "old"], "the theme list's order")
        #expect(Theme.allCases.map(\.textKey) == ["LOC_WEATHER_PHOTO_THEME", "LOC_LIGHT_THEME", "LOC_DARK_THEME", "LOC_OLD_THEME"])
    }

    @Test func startupPageChoosesTheFirstTab() {
        #expect(StartupPage.tab("0") == .forecast)
        #expect(StartupPage.tab("1") == .dailyforecast)
        #expect(StartupPage.tab("2") == .search)
        #expect(StartupPage.tab("3") == .air)
        #expect(StartupPage.tab("4") == .forecast, "the TodayAir weather tab is not a tab of this app")
        #expect(StartupPage.tab("9") == .forecast)
        #expect(StartupPage.tab(nil) == .forecast)
        #expect(StartupPage.tab("01") == .forecast)
        #expect(StartupPage.values.map(StartupPage.textKey) ==
                ["LOC_HOURLY_FORECAST", "LOC_DAILY_FORECAST", "LOC_SAVED_LOCATIONS", "LOC_AIR_INFORMATION"])
        #expect(StartupPage.textKey("4") == "LOC_WEATHER")
        #expect(StartupPage.textKey("x") == "N/A")
        #expect(RefreshInterval.values.map(RefreshInterval.textKey) ==
                ["LOC_MANUAL", "LOC_30_MINUTES", "LOC_1_HOUR", "LOC_3_HOURS", "LOC_6_HOURS", "LOC_12_HOURS"])
        #expect(RefreshInterval.textKey("15") == "N/A")
        #expect(RefreshInterval.themeTextKey("dark") == "LOC_DARK_THEME")
        #expect(RefreshInterval.themeTextKey("blue") == "N/A")
    }

    @Test func tabsInCordovaOrder() {
        #expect(ShellTab.allCases == [.search, .forecast, .dailyforecast, .air])
        #expect(ShellTab.allCases.map(\.textKey) == ["LOC_SAVED_LOCATIONS", "LOC_HOURLY_FORECAST", "LOC_DAILY_FORECAST", "LOC_AIR_INFORMATION"])
        #expect(ShellTab.allCases.map(\.refreshes) == [false, true, true, true])
    }

    /// index.html L97-L171 with the iOS choices: Korea-only rows for KR, chevrons where `!isAndroid()`, blocks.
    @Test func menuRowsForTheRegion() {
        let korea: [MenuRow] = [.specialWeather, .nationalWeather, .nationalAir, .nullschoolWind, .units, .startupPage,
                                .refreshInterval, .theme, .analytics, .adPrivacy, .privacyPolicy, .terms, .sendFeedback,
                                .rateApp, .version, .about]
        #expect(MenuRow.rows(region: "KR") == korea)
        #expect(MenuRow.rows(region: "US") == Array(korea.dropFirst(4)))
        #expect(MenuRow.rows(region: nil) == Array(korea.dropFirst(4)), "an undefined region shows no Korea-only row")
        #expect(MenuRow.rows(region: "kr") == Array(korea.dropFirst(4)), "the region compares exactly")
        #expect(korea.filter(\.chevron) == [.specialWeather, .nationalWeather, .nationalAir, .nullschoolWind, .units,
                                            .sendFeedback, .rateApp, .about])
        #expect(korea.filter(\.isButton) == [.analytics, .adPrivacy, .privacyPolicy, .terms])
        #expect(korea.filter(\.closesMenu) == [.specialWeather, .nationalWeather, .nationalAir, .units, .startupPage,
                                               .refreshInterval, .theme, .sendFeedback, .rateApp])
        #expect(korea.map(\.textKey).first == "LOC_TYPE_SPECIAL_WEATHER")
        #expect(korea.map(\.textKey).last == "LOC_ABOUT")
    }

    /// `doTabForecast`: another tab is selected; the selected weather or air tab reloads unless the previous weather or
    /// air tab tap was 700 ms or less before (every such tap counts); the saved-places tab never reloads.
    @Test func tabTapsSelectOrRefresh() {
        var taps = TabTaps()
        #expect(taps.tap(.forecast, selected: .forecast, now: 10_000) == .refresh(.forecast))
        #expect(taps.tap(.forecast, selected: .forecast, now: 10_700) == .none, "700 ms: skipped")
        #expect(taps.tap(.forecast, selected: .forecast, now: 11_401) == .refresh(.forecast), "701 ms after the skipped tap")
        #expect(taps.tap(.dailyforecast, selected: .forecast, now: 11_500) == .select(.dailyforecast))
        #expect(taps.tap(.dailyforecast, selected: .dailyforecast, now: 12_000) == .none, "the switch counted as a tap")
        #expect(taps.tap(.search, selected: .dailyforecast, now: 12_100) == .select(.search))
        #expect(taps.tap(.search, selected: .search, now: 20_000) == .none)
        #expect(taps.tap(.air, selected: .search, now: 20_100) == .select(.air))
        #expect(taps.tap(.air, selected: .air, now: 21_000) == .refresh(.air), "the saved-places taps did not count")
        var first = TabTaps()
        #expect(first.tap(.air, selected: .air, now: 500) == .none, "Cordova's lastClickTime starts at 0")
        #expect(first.tap(.air, selected: .air, now: 1_201) == .refresh(.air))
    }

    @Test func startGateFollowsStartVersion() {
        #expect(StartGate.shows(nil))
        #expect(StartGate.shows(.null))
        #expect(StartGate.shows(.number(0)))
        #expect(StartGate.shows(.string("0.9")))
        #expect(!StartGate.shows(.number(1)))
        #expect(!StartGate.shows(.string("1")))
        #expect(!StartGate.shows(.number(2)))
        #expect(!StartGate.shows(.string("x")), "NaN: the comparison is false")
        #expect(StartGate.shows(.string("")), "Number('') is 0")
        #expect(StartGate.closed == .number(1))
        #expect(StartScreen.first(startVersion: nil, startupPage: "3") == .start)
        #expect(StartScreen.first(startVersion: .number(1), startupPage: "3") == .tab(.air))
        #expect(StartScreen.first(startVersion: .number(1), startupPage: nil) == .tab(.forecast))
    }

    /// The Cordova code's grouping and choice (corpus/photos.json): groups by joined tags, the first group in the icon
    /// name with photos, and the photo at floor(random * (n - 1)), for every weather image name.
    @Test func photosMatchTheCordovaCode() throws {
        let corpus = try Corpus.read("photos.json")
        #expect(corpus["request"]?["timeout"] == .number(20000))
        for feed in try #require(corpus["feeds"]?.arrayValue) {
            let groups = WeatherPhotos.parse(try #require(feed["feed"])).groups
                .mapValues { $0.map { $0["id"]?.stringValue ?? "?" } }
            var expected: [String: [String]] = [:]
            for (key, ids) in try #require(feed["groups"]?.objectValue) {
                expected[key] = (ids.arrayValue ?? []).compactMap(\.stringValue)
            }
            #expect(groups == expected, "\(feed["name"]?.stringValue ?? "")")
        }
        let photos = WeatherPhotos.parse(try #require(corpus["feeds"]?[0]?["feed"]))
        let cases = try #require(corpus["cases"]?.arrayValue)
        #expect(cases.count == 195)
        for c in cases {
            let icon = c["skyIcon"]?.stringValue
            let random = try #require(c["random"]?.numberValue?.double)
            #expect(photos.find(skyIcon: icon, random: random) == c["photo"]?.stringValue, "\(icon ?? "nil") at \(random)")
        }
        #expect(WeatherPhotos.parse(.object(JSONObject())).find(skyIcon: "sun", random: 0.3) == nil, "not an array")
        #expect(WeatherPhotos.keys == ["lightning", "rain", "snow", "sun_smallcloud", "sun_bigcloud", "sun",
                                       "moon_smallcloud", "moon_bigcloud", "moon", "cloud"])
    }

    /// `Array.prototype.join`: numbers, booleans and nested arrays as JavaScript joins them.
    @Test func photoTagsJoinAsJavaScript() throws {
        let feed = try JSONValue.parse("""
        [{"id":"a","tags":[["sun","x"],1],"twUrls":{"regular":"a"}},{"id":"b","tags":[true,null,"moon"],"twUrls":{"regular":"b"}},
         {"id":"c","tags":"sun"},{"id":"d","tags":[{"k":"rain"}],"twUrls":{"regular":"d"}}]
        """)
        let groups = WeatherPhotos.parse(feed).groups.mapValues { $0.map { $0["id"]?.stringValue ?? "" } }
        #expect(groups["sun"] == ["a"], "\"sun,x_1\"")
        #expect(groups["moon"] == ["b"], "\"true__moon\"")
        #expect(groups.values.flatMap { $0 }.count == 2, "a string and an object tag join to nothing usable")
    }
}

/// The entry-event queue (IN-07): events wait until the migration has finished, then go out in arrival order.
@MainActor
struct EntryQueueTests {
    @Test func eventsWaitForTheMigrationAndKeepTheirOrder() {
        let queue = EntryQueue<String>()
        var handled: [String] = []
        queue.submit("launch")
        queue.submit("notification 2")
        queue.submit("link 1")
        #expect(!queue.isOpen)
        #expect(handled.isEmpty)
        queue.open { handled.append($0) }
        #expect(handled == ["launch", "notification 2", "link 1"])
        queue.submit("resume")
        #expect(handled == ["launch", "notification 2", "link 1", "resume"], "after the migration: at once")
        queue.open { _ in handled.append("second handler") }
        queue.submit("link 2")
        #expect(handled.last == "link 2", "the first handler stays")
    }

    @Test func anEventSubmittedWhileHandlingWaitsForTheOnesBefore() {
        let queue = EntryQueue<Int>()
        var handled: [Int] = []
        queue.submit(1)
        queue.submit(2)
        queue.open { event in
            handled.append(event)
            if event == 1 { queue.submit(3) }
        }
        #expect(handled == [1, 2, 3])
    }
}
