import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWResources
import TWStorage

/// The settings pages S07 and S08, the menu's hand-offs and About (IN-12, #2961) against the Cordova code run with the
/// platform reporting iOS in JavaScriptCore (`Golden/settings.json`, ios/tools/settings/generate.py).
enum SettingsGolden {
    static func json() throws -> JSONValue {
        let url = try #require(Bundle.module.url(forResource: "settings", withExtension: "json", subdirectory: "Golden"))
        return try JSONValue.parse(Data(contentsOf: url))
    }

    /// angular-translate's lookup in one Cordova catalog: the text, or the key itself (the golden's `text`).
    static func text(_ code: String) -> (String) -> String {
        let bundle = TWResources.strings(catalog: code)
        return { key in
            guard let bundle else { return key }
            let value = bundle.localizedString(forKey: key, value: "\u{1}", table: nil)
            return value == "\u{1}" ? key : value
        }
    }

    static func string(_ v: JSONValue?) -> String { v?.stringValue ?? "<\(v?.description ?? "missing")>" }

    /// The golden's places as the native state holds them.
    static func places(_ golden: JSONValue) -> [Place] {
        (golden["cities"]?.arrayValue ?? []).map { c in
            let loc = c["location"].flatMap { l in
                l["lat"]?.numberValue.flatMap { lat in l["long"]?.numberValue.map { Location(lat: lat.double, long: $0.double) } }
            }
            return Place(currentPosition: c["currentPosition"]?.boolValue ?? false, disable: c["disable"]?.boolValue ?? false,
                         name: c["name"]?.stringValue, address: c["address"]?.stringValue, country: c["country"]?.stringValue,
                         location: loc, source: c["source"]?.stringValue)
        }
    }

    /// The push request's context of the golden run (device, language, version, clock) in `zone`.
    static func context(_ golden: JSONValue, zone: String, units: UnitSettings) throws -> PushRegistration.Context {
        let device = try #require(golden["device"])
        let now = try #require(golden["now"]?.numberValue?.double)
        return PushRegistration.Context(deviceId: string(device["uuid"]), language: "ko-KR",
                                        appVersion: string(device["version"]), units: units,
                                        now: Date(timeIntervalSince1970: now / 1000),
                                        zone: try #require(TimeZone(identifier: zone)))
    }

    /// The golden's `$http` request with the native path version.
    static func expected(_ http: JSONValue) -> (method: String, path: String, headers: [String: String], body: JSONValue?) {
        let url = string(http["url"]).replacingOccurrences(of: "https://server/v000902", with: "/v000903")
        var headers: [String: String] = [:]
        for (k, v) in http["headers"]?.objectValue ?? JSONObject() { headers[k] = v.stringValue }
        return (string(http["method"]), url, headers, http["data"])
    }
}

/// S07's rows and each S08 list: the keys, values and texts the Cordova pages show (Korean and English).
struct SettingListsTests {
    @Test func unitRowsAsTheCordovaPage() throws {
        let golden = try SettingsGolden.json()
        let units = UnitSettings.defaults(region: "KR")
        for page in golden["units"]?.arrayValue ?? [] {
            let lang = SettingsGolden.string(page["lang"])
            let text = SettingsGolden.text(lang)
            let rows = page["rows"]?.arrayValue ?? []
            #expect(rows.map { SettingsGolden.string($0["name"]) } == SettingLists.units, "\(lang): S07's order")
            for row in rows {
                let name = SettingsGolden.string(row["name"])
                let key = SettingLists.unitName(name)
                let value = SettingLists.unitValue(name, units.value(name))
                #expect(key == row["nameKey"]?.stringValue, "\(lang) \(name) name key")
                #expect(value == row["valueKey"]?.stringValue, "\(lang) \(name) value key")
                #expect(text(key) == row["name_text"]?.stringValue, "\(lang) \(name) name")
                #expect(value.map(text) == row["value_text"]?.stringValue, "\(lang) \(name) value")
            }
        }
        // Values the Korean defaults do not show (the Android corpus's rarer rows).
        #expect(SettingLists.unitValue("windSpeedUnit", "bft") == "beaufort")
        #expect(SettingLists.unitValue("windSpeedUnit", "kt") == "knotes")
        #expect(SettingLists.unitValue("pressureUnit", "mb") == "mbar")
        #expect(SettingLists.unitValue("distanceUnit", "mi") == "miles")
        #expect(SettingLists.unitValue("precipitationUnit", "in") == "inches")
        #expect(SettingLists.unitValue("airUnit", "aircn") == nil)
    }

    @Test func listsAsTheCordovaPages() throws {
        let golden = try SettingsGolden.json()
        let lists = golden["lists"]?.arrayValue ?? []
        #expect(lists.map { SettingsGolden.string($0["name"]) } == SettingLists.units + SettingLists.settings)
        for entry in lists {
            let name = SettingsGolden.string(entry["name"])
            let list = SettingLists.list(name)
            #expect(list.isUnit == SettingLists.units.contains(name))
            for (lang, page) in [("ko", entry["page"]), ("en", entry["en"])] {
                let text = SettingsGolden.text(lang)
                #expect(list.title == page?["title"]?.stringValue, "\(name) title")
                let items = page?["items"]?.arrayValue ?? []
                #expect(list.choices.map(\.label) == items.map { SettingsGolden.string($0["label"]) }, "\(name) labels")
                #expect(list.choices.map(\.value) == items.map { SettingsGolden.string($0["value"]) }, "\(name) values")
                #expect(list.choices.map { text($0.label) } == items.map { SettingsGolden.string($0["text"]) }, "\(lang) \(name) texts")
            }
        }
        #expect(SettingLists.keys.contains("LOC_UNITS"))
        #expect(SettingLists.keys.contains("LOC_AIR_QUALITY_INDEX_KR_WHO"))
    }
}

/// The menu's hand-offs on iOS and About: the URL `InAppBrowser.open(_, "_system")` opened, the text the mail row
/// assigned to `location.href`, the alert's title, lines and button, in Korean and English.
struct HandoffTargetTests {
    @Test(arguments: ["ko", "en"])
    func targetsAsTheCordovaMenu(lang: String) throws {
        let golden = try SettingsGolden.json()
        let text = SettingsGolden.text(lang)
        let rows = (golden["menu"]?.arrayValue ?? []).filter { $0["lang"]?.stringValue == lang }
        #expect(rows.count == 4)
        for row in rows {
            let trace = row["trace"]?.arrayValue ?? []
            switch SettingsGolden.string(row["row"]) {
            case "nullschool":
                #expect(trace.count == 1, "the menu stays open")
                #expect(trace.first?[1]?.stringValue == Handoffs.nullschool)
                #expect(trace.first?[2]?.stringValue == "_system")
            case "openMarket":
                #expect(trace.first?[0]?.stringValue == "toggleLeft", "the menu closes first")
                #expect(trace.last?[1]?.stringValue == Handoffs.appStore)
                #expect(trace.last?[2]?.stringValue == "_system")
            case "sendMail":
                #expect(trace.first?[0]?.stringValue == "toggleLeft", "the menu closes first")
                let device = try #require(golden["device"])
                let mail = Handoffs.feedbackMail(to: SettingsGolden.string(golden["config"]?["mailTo"]), subject: text("LOC_SEND_FEEDBACK"),
                                                 version: SettingsGolden.string(device["version"]),
                                                 uuid: SettingsGolden.string(device["uuid"]), userAgent: SettingsGolden.string(golden["ua"]))
                #expect(mail == row["location"]?.stringValue, "\(lang) mail link")
                let url = try #require(Handoffs.webKitURL(mail), "\(lang) mail URL")
                #expect(url.scheme == "mailto")
            case "openInfo":
                let alert = try #require(trace.first?[1])
                let about = About(text: text)
                #expect(about.title == alert["title"]?.stringValue, "\(lang) About title")
                #expect(about.lines.joined(separator: "<br>") == alert["template"]?.stringValue, "\(lang) About lines")
                #expect(about.ok == alert["okText"]?.stringValue, "\(lang) About button")
            default:
                Issue.record("unknown row \(row)")
            }
        }
    }

    @Test func encodeURIComponentAsJavaScript() {
        #expect(Handoffs.encodeURIComponent("a b\n=:/;,()!*'~-_.") == "a%20b%0A%3D%3A%2F%3B%2C()!*'~-_.")
        #expect(Handoffs.encodeURIComponent("의견") == "%EC%9D%98%EA%B2%AC")
        #expect(Handoffs.webKitURL("mailto:a@b.c?subject=의견 보내기&body=x%20y")?.absoluteString
                == "mailto:a@b.c?subject=%EC%9D%98%EA%B2%AC%20%EB%B3%B4%EB%82%B4%EA%B8%B0&body=x%20y")
    }
}

/// `Push.updateUnits` on iOS (`PushRegistration.onUnitsChanged`): the list post after each unit change of every list,
/// and the cases that send nothing.
struct PushUnitsPostTests {
    static func post(_ state: AppState, _ golden: JSONValue, zone: String) throws -> PushRequest? {
        let context = try SettingsGolden.context(golden, zone: zone, units: state.units)
        return PushRegistration.onUnitsChanged(state.push, places: state.places, context: context).requests.first
    }

    @Test func everyUnitChangePostsTheCordovaRequest() throws {
        let golden = try SettingsGolden.json()
        let places = SettingsGolden.places(golden)
        let records = (golden["pushList"]?.arrayValue ?? []).compactMap(\.objectValue)
        var compared = 0
        for list in golden["lists"]?.arrayValue ?? [] where SettingLists.units.contains(SettingsGolden.string(list["name"])) {
            let name = SettingsGolden.string(list["name"])
            for choice in list["choices"]?.arrayValue ?? [] {
                var units = UnitSettings.defaults(region: "KR")
                units.setForTest(name, SettingsGolden.string(choice["value"]))
                let state = AppState(places: places, placeIndex: 1, units: units,
                                     push: PushState(fcmToken: "token-a", records: records))
                let posts = (choice["trace"]?.arrayValue ?? []).filter { $0[0]?.stringValue == "$http" }
                #expect(posts.count == 1, "\(name)=\(SettingsGolden.string(choice["value"])): one post")
                let request = try #require(try Self.post(state, golden, zone: "Asia/Seoul"))
                try Self.compare(request, posts[0][1], "\(name)=\(SettingsGolden.string(choice["value"]))")
                compared += 1
            }
        }
        #expect(compared == 13, "every other value of the six unit lists (1 + 4 + 3 + 1 + 1 + 3)")
    }

    @Test func pushCases() throws {
        let golden = try SettingsGolden.json()
        let places = SettingsGolden.places(golden)
        for c in golden["push"]?.arrayValue ?? [] {
            let name = SettingsGolden.string(c["name"])
            var units = UnitSettings.defaults(region: "KR")
            for key in UnitSettings.keys { if let v = c["units"]?[key]?.stringValue { units.setForTest(key, v) } }
            units.setForTest(SettingsGolden.string(c["unit"]), SettingsGolden.string(c["value"]))
            let records = (c["list"]?.arrayValue ?? []).compactMap(\.objectValue)
            let token = c["token"]?.stringValue
            let state = AppState(places: places, placeIndex: 1, units: units, push: PushState(fcmToken: token, records: records))
            let posts = (c["trace"]?.arrayValue ?? []).filter { $0[0]?.stringValue == "$http" }
            let request = try Self.post(state, golden, zone: SettingsGolden.string(c["zone"]))
            if posts.isEmpty {
                #expect(request == nil, "\(name): nothing is sent")
            } else {
                try Self.compare(try #require(request, "\(name)"), posts[0][1], name)
            }
        }
    }

    static func compare(_ request: PushRequest, _ http: JSONValue?, _ name: String) throws {
        let expected = SettingsGolden.expected(try #require(http))
        #expect(request.method == expected.method, "\(name) method")
        #expect(request.path == expected.path, "\(name) path")
        #expect(request.headers == expected.headers, "\(name) headers")
        let body = try #require(expected.body)
        #expect(request.body.sameText(body), "\(name) body\n\(request.body.jsonText)\n\(body.jsonText)")
    }
}

extension UnitSettings {
    mutating func setForTest(_ key: String, _ value: String) {
        switch key {
        case "temperatureUnit": temperatureUnit = value
        case "windSpeedUnit": windSpeedUnit = value
        case "pressureUnit": pressureUnit = value
        case "distanceUnit": distanceUnit = value
        case "precipitationUnit": precipitationUnit = value
        default: airUnit = value
        }
    }
}

/// A recorder of the push hook: the states `Push.updateUnits` was asked to post (test code only).
final class PushUnitsRecorder: PushUnitsUpdating, @unchecked Sendable {
    private let lock = NSLock()
    private var states: [AppState] = []
    var calls: [AppState] { lock.withLock { states } }
    func updateUnits(_ state: AppState) { lock.withLock { states.append(state) } }
}

/// What a choice on S08 does (`radioList.setValue` and `RadioCtrl.valueChanged`), on a virtual clock with a server
/// double: what is stored, the push hook, the weather request in the new units and the refresh timer.
extension ClockedDataTests {
@MainActor
struct SettingsActionsTests {
    struct Fixture {
        let clock = VirtualClock()
        let http: ScriptedWeatherHTTP
        let store = MemoryStore()
        let holder: AppStateHolder
        let session: WeatherSession
        let push = PushUnitsRecorder()
        let actions: SettingsActions

        @MainActor
        init(push hook: Bool = true, settings: Settings = Settings()) throws {
            let golden = try SettingsGolden.json()
            let body = try WeatherFixtures.body("kma-seoul")
            http = ScriptedWeatherHTTP(clock: clock) { _ in .answer(100, body) }
            holder = AppStateHolder(store: store)
            holder.load(AppState(places: [.currentPositionPlaceholder, seoul, london], placeIndex: 1, units: koreanUnits,
                                 settings: settings,
                                 push: PushState(fcmToken: "token-a",
                                                 records: (golden["pushList"]?.arrayValue ?? []).compactMap(\.objectValue))))
            let repository = WeatherRepository(baseURL: "https://server.test.invalid", cacheDirectory: nil, http: http, clock: clock)
            session = WeatherSession(repository: repository, holder: holder, acceptLanguage: { "ko-KR,ko;q=0.9" }, clock: clock)
            actions = SettingsActions(holder: holder, session: session, push: hook ? push : nil)
        }
    }

    /// Every choice of every list from the Korean defaults: the stored units and settings equal the Cordova storage, a
    /// unit change asks for the push post (with the new units) exactly when the Cordova code posted, and the selected
    /// place loads again in the units now set.
    @Test func everyChoiceAsTheCordovaTrace() async throws {
        let golden = try SettingsGolden.json()
        for list in golden["lists"]?.arrayValue ?? [] {
            let name = SettingsGolden.string(list["name"])
            for choice in list["choices"]?.arrayValue ?? [] {
                let value = SettingsGolden.string(choice["value"])
                let f = try Fixture()
                f.session.reload(.initial)
                await f.clock.advance(by: 1000)
                #expect(f.http.attempts.count == 1)
                f.actions.opened(name)
                #expect(f.actions.value(name) == list["page"]?["value"]?.stringValue, "\(name): the checked value")
                f.actions.choose(name, value: value)
                await f.clock.advance(by: 1000)
                let state = try #require(f.holder.state)
                let stored = choice["stored"]
                for key in UnitSettings.keys {
                    #expect(state.units.value(key) == stored?["units"]?[key]?.stringValue, "\(name)=\(value): \(key) stored")
                }
                #expect(state.settings.startupPage == stored?["settingsInfo"]?["startupPage"]?.stringValue)
                #expect(state.settings.refreshInterval == stored?["settingsInfo"]?["refreshInterval"]?.stringValue)
                #expect(state.settings.theme == stored?["settingsInfo"]?["theme"]?.stringValue, "\(name)=\(value) theme")
                await f.holder.saved()
                #expect(f.store.last == state, "\(name)=\(value): saved")
                let trace = choice["trace"]?.arrayValue ?? []
                let posted = trace.contains { $0[0]?.stringValue == "$http" }
                #expect(f.push.calls.count == (posted ? 1 : 0), "\(name)=\(value): push post")
                if posted { #expect(f.push.calls.first?.units == state.units, "with the new units") }
                // `_resetUpdateTimeCities`: every place reloads, then `reloadEvent 'resume'` loads the selected one.
                let reloads = trace.filter { $0[0]?.stringValue == "WeatherInfo.reloadCity" }.count
                #expect(reloads == 3 && trace.last?[1]?.stringValue == "reloadEvent" && trace.last?[2]?.stringValue == "resume")
                #expect(f.http.attempts.count == 2, "\(name)=\(value): the weather is requested again")
                let query = f.http.attempts.last?.url.query ?? ""
                for key in UnitSettings.keys {
                    #expect(query.contains("\(key)=\(state.units.value(key))"), "\(name)=\(value): \(key) in \(query)")
                }
            }
        }
    }

    /// Opening the refresh interval's list restarts the timer (`setValue` broadcasts `setRefreshInterval`); choosing 30
    /// minutes reloads 30 minutes after the choice.
    @Test func theRefreshIntervalRestartsTheTimer() async throws {
        let f = try Fixture()
        f.session.reload(.initial)
        await f.clock.advance(by: 1000)
        f.actions.opened("refreshInterval")
        f.actions.choose("refreshInterval", value: "30")
        await f.clock.advance(by: 1000)
        #expect(f.http.attempts.count == 2)
        await f.clock.advance(by: 29 * 60_000)
        #expect(f.http.attempts.count == 2)
        await f.clock.advance(by: 60_000)
        #expect(f.http.attempts.count == 3, "the timer of the new interval")
        // Opening the list again restarts it: the next timer reload is 30 minutes after the opening.
        await f.clock.advance(by: 20 * 60_000)
        f.actions.opened("refreshInterval")
        await f.clock.advance(by: 15 * 60_000)
        #expect(f.http.attempts.count == 3, "restarted on opening")
        await f.clock.advance(by: 16 * 60_000)
        #expect(f.http.attempts.count == 4)
    }

    /// Without IN-04's implementation of the hook, a unit change still applies and loads; nothing is posted.
    @Test func withoutThePushHookNothingIsPosted() async throws {
        let f = try Fixture(push: false)
        f.actions.choose("temperatureUnit", value: "F")
        await f.clock.advance(by: 1000)
        #expect(f.holder.state?.units.temperatureUnit == "F")
        #expect(f.push.calls.isEmpty)
        #expect(f.http.attempts.count == 1)
    }

    /// The same value again (the radio does not call `valueChanged` then; `setUnit` would refuse it) changes nothing and
    /// posts nothing; an unknown list does nothing.
    @Test func theSameUnitPostsNothing() async throws {
        let f = try Fixture()
        f.actions.choose("temperatureUnit", value: "C")
        f.actions.choose("noSuchList", value: "x")
        await f.clock.advance(by: 1000)
        #expect(f.push.calls.isEmpty)
        #expect(f.holder.state?.units == koreanUnits)
    }

    /// While the retry confirmation is open, a change is stored but loads nothing (`reloadEvent` is ignored then).
    @Test func aChangeWhileTheRetryConfirmationIsOpenLoadsNothing() async throws {
        let f = try Fixture()
        let failing = ScriptedWeatherHTTP(clock: f.clock) { _ in .fail(100, 503) }
        let repository = WeatherRepository(baseURL: "https://server.test.invalid", cacheDirectory: nil, http: failing, clock: f.clock)
        let session = WeatherSession(repository: repository, holder: f.holder, acceptLanguage: { "ko-KR" }, clock: f.clock)
        let actions = SettingsActions(holder: f.holder, session: session, push: f.push)
        session.reload(.initial)
        await f.clock.advance(by: 1000)
        #expect(session.retry)
        let before = failing.attempts.count
        actions.choose("theme", value: "dark")
        await f.clock.advance(by: 1000)
        #expect(f.holder.state?.settings.theme == "dark")
        #expect(failing.attempts.count == before)
    }

    /// The state file keeps every choice: a change saved through the holder reads back from a new store.
    @Test func settingsPersistInTheStateFile() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-settings-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = AppStateStore(url: dir.appendingPathComponent("app_state.json"))
        let f = try Fixture()
        let holder = AppStateHolder(store: store)
        holder.load(try #require(f.holder.state))
        let actions = SettingsActions(holder: holder, session: f.session, push: nil)
        actions.choose("windSpeedUnit", value: "kt")
        actions.choose("startupPage", value: "3")
        actions.choose("theme", value: "old")
        actions.choose("refreshInterval", value: "60")
        await holder.saved()
        let read = try #require(try store.load())
        #expect(read.units.windSpeedUnit == "kt")
        #expect(read.settings == Settings(startupPage: "3", refreshInterval: "60", theme: "old"))
    }
}

/// What the Cordova iOS build sent and parsed in the settings capture (`Golden/settings-capture.json`,
/// ios/tools/settings-reference): the weather request after 온도단위 F and after a theme choice, and WebKit's URL of the
/// mail links.
@MainActor
struct SettingsCaptureTests {
    static func capture() throws -> JSONValue {
        let url = try #require(Bundle.module.url(forResource: "settings-capture", withExtension: "json", subdirectory: "Golden"))
        return try JSONValue.parse(Data(contentsOf: url))
    }

    /// A change requests the weather again, as the Cordova build did: the same path and query (the server URL left out)
    /// and `Accept-Language`, at once on S08.
    @Test(arguments: [("temperatureUnit", "F", "choose-temperatureUnit-F"), ("theme", "dark", "choose-theme-dark")])
    func theWeatherRequestAfterAChangeIsTheCordovaRequest(name: String, value: String, step: String) async throws {
        let capture = try Self.capture()
        let sent = (capture["weather"]?.arrayValue ?? []).filter { $0["step"]?.stringValue == step }
        #expect(sent.count == 1, "\(step): one request")
        let expected = try #require(sent.first)
        let f = try SettingsActionsTests.Fixture()
        f.session.reload(.initial)
        await f.clock.advance(by: 1000)
        f.actions.choose(name, value: value)
        await f.clock.advance(by: 1000)
        #expect(f.http.attempts.count == 2)
        let url = try #require(f.http.attempts.last?.url)
        #expect(url.path + "?" + (url.query ?? "") == expected["path"]?.stringValue, "\(step)")
        #expect(f.http.attempts.last?.headers["Accept-Language"] == expected["acceptLanguage"]?.stringValue)
    }

    /// The mail link as the Cordova WKWebView navigated to it: WebKit's parse of the golden's text in Korean and English.
    @Test func theMailURLIsWebKits() throws {
        let capture = try Self.capture()
        let hrefs = capture["mail"]?.arrayValue ?? []
        #expect(hrefs.count == 2)
        for entry in hrefs {
            let raw = try #require(entry["raw"]?.stringValue)
            #expect(Handoffs.webKitURL(raw)?.absoluteString == entry["href"]?.stringValue, "\(raw.prefix(60))")
        }
    }
}
}
