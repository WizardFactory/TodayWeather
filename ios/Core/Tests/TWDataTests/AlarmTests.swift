import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage

/// The S09 goldens of the Cordova iOS app (`Golden/alarms.json`, written by ios/tools/push/generate.py: PushCtrl over the
/// Cordova `Push` service, ionic-timepicker and the notification callback in JavaScriptCore with the platform reporting
/// iOS; IN-14, #2963).
enum AlarmsGolden {
    static let doc: JSONObject = {
        let url = Bundle.module.url(forResource: "alarms", withExtension: "json", subdirectory: "Golden")!
        return try! JSONValue.parse(Data(contentsOf: url)).objectValue!
    }()

    static let zone = TimeZone(identifier: "Asia/Seoul")!
    static let now = Date(timeIntervalSince1970: doc["now"]!.numberValue!.double / 1000)
    static let units = UnitSettings(temperatureUnit: "C", windSpeedUnit: "m/s", pressureUnit: "hPa", distanceUnit: "km",
                                    precipitationUnit: "mm", airUnit: "airkorea")

    static func places(_ cities: JSONValue?) -> [Place] {
        (cities ?? doc["cities"])!.arrayValue!.map { c in
            let loc = c["location"]!
            return Place(currentPosition: c["currentPosition"]!.boolValue!, disable: c["disable"]!.boolValue!,
                         name: c["name"]?.stringValue, address: c["address"]?.stringValue, country: c["country"]?.stringValue,
                         location: Location(lat: loc["lat"]!.numberValue!.double, long: loc["long"]!.numberValue!.double),
                         source: c["source"]?.stringValue)
        }
    }

    static func records(_ value: JSONValue?) -> [JSONObject] {
        (value?.arrayValue ?? []).map { $0.objectValue! }
    }

    static func context(_ state: AppState) -> PushRegistration.Context? {
        PushRegistration.Context(deviceId: doc["deviceId"]!.stringValue!, language: doc["language"]!.stringValue!,
                                 appVersion: doc["appVersion"]!.stringValue!, units: state.units, now: now, zone: zone)
    }

    static func cases(_ key: String) -> [JSONValue] { doc[key]!.arrayValue! }

    /// Method, path (`/v000902` → `/v000903`), headers and body with member order and number texts.
    static func compare(_ expected: [JSONValue], _ actual: [PushRequest], _ name: String) {
        #expect(actual.count == expected.count, "\(name): request count \(actual.map(\.method))")
        for (e, a) in zip(expected, actual) {
            let url = e["url"]!.stringValue!
            let path = url.replacingOccurrences(of: "https://server", with: "").replacingOccurrences(of: "/v000902/", with: "/v000903/")
            #expect(a.method == e["method"]!.stringValue!, "\(name)")
            #expect(a.path == path, "\(name)")
            let headers = Dictionary(uniqueKeysWithValues: e["headers"]!.objectValue!.map { ($0.key, $0.value.stringValue!) })
            #expect(a.headers == headers, "\(name) headers")
            #expect(a.body.sameText(e["data"]!), "\(name) body:\n\(a.body.jsonText)\nexpected:\n\(e["data"]!.jsonText)")
        }
    }
}

/// `grantPermission` and `hasPermission` as the Cordova cases answer them; records the calls.
@MainActor
final class NotificationsDouble: NotificationAccess {
    var available: Bool
    var permission: Bool
    var calls: [String] = []

    init(available: Bool = true, permission: Bool = true) {
        self.available = available
        self.permission = permission
    }

    func enabled() async -> Bool {
        calls.append("has")
        return permission
    }

    func request() async {
        calls.append("grant")
    }
}

/// One S09 visit over the app's state holder and `PushSync` with a recording transport, as the app connects them.
@MainActor
final class AlarmVisit {
    let holder: AppStateHolder
    let sync: PushSync
    let transport = HeldTransport()
    let notifications: NotificationsDouble
    var settingsOpened = 0
    var posts: [Task<PushSync.Outcome?, Never>] = []
    var page: AlarmPage!
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-alarms-\(UUID().uuidString)")

    init(places: [Place], selected: Int, token: String?, records: [JSONObject], notifications: NotificationsDouble,
         needsAlertIntro: Bool = false, store: (any AppStateSaving)? = nil) {
        self.notifications = notifications
        holder = AppStateHolder(store: store ?? AppStateStore(url: dir.appendingPathComponent("app_state.json")))
        holder.load(AppState(places: places, placeIndex: selected, units: AlarmsGolden.units,
                             push: PushState(type: "ios", fcmToken: token, records: records, needsAlertIntro: needsAlertIntro),
                             migration: MigrationInfo(source: "", migratedAtMillis: 0, keys: [:])))
        sync = PushSync(state: holder, queue: PushTokenQueue(url: dir.appendingPathComponent("push_tokens.json")),
                        transport: transport, context: AlarmsGolden.context)
        let sync = self.sync
        page = AlarmPage(holder: holder, notifications: notifications,
                         post: { [weak self] index in self?.posts.append(Task { await sync.postPlace(index) }) },
                         openSettings: { [weak self] in self?.settingsOpened += 1 },
                         now: { AlarmsGolden.now }, zone: { AlarmsGolden.zone })
    }

    /// Waits for the permission check, a save in flight and every post.
    func settle() async {
        await page.permissionCheck?.value
        await page.saving?.value
        for post in posts { _ = await post.value }
        posts = []
        await holder.saved()
    }
}

/// S09 against PushCtrl run over the Cordova `Push` service on iOS (#2963 AC1, V14 and V15): the page after the opening
/// and after each step (rows, the add row, weekdays, the switch, the popup, the requests, the list saved, going back,
/// the permission calls, the selected place).
@MainActor
@Suite(.timeLimit(.minutes(1)))
struct AlarmPageGoldenTests {
    @Test func everySessionAsTheCordovaPage() async throws {
        let cases = AlarmsGolden.cases("pages")
        #expect(cases.count >= 25)
        for c in cases { try await check(c) }
    }

    private func check(_ c: JSONValue) async throws {
        let name = c["name"]!.stringValue!
        let places = AlarmsGolden.places(c["cities"])
        let notifications = NotificationsDouble(available: c["inited"]!.boolValue!, permission: c["permission"]!.boolValue!)
        let visit = AlarmVisit(places: places, selected: Int(c["selected"]!.numberValue!.double),
                               token: c["storedToken"]?.stringValue, records: AlarmsGolden.records(c["list"]),
                               notifications: notifications)
        let page = visit.page!
        page.open(fav: c["fav"]?.numberValue.map { Int($0.double) })
        await visit.settle()
        var sent = 0
        var records = visit.holder.state!.push.records
        func compare(_ expected: JSONValue, _ label: String) {
            let s = page.settings
            #expect(page.title == expected["title"]!.stringValue!, "\(label) title")
            let rows = (s?.alarms ?? []).enumerated().map { i, a in
                "\(i) \(a["id"]!.jsonText) \(a["enable"]!.jsonText) \(AlarmRow.text(PushRecords.localSeconds(a["time"], zone: AlarmsGolden.zone)))"
            }
            let expectedRows = expected["rows"]!.arrayValue!.map { r in
                "\(r["index"]!.jsonText) \(r["id"]!.jsonText) \(r["enable"]!.jsonText) \(r["text"]!.stringValue!)"
            }
            #expect(rows == expectedRows, "\(label) rows")
            #expect(s?.canAdd == expected["canAdd"]!.boolValue!, "\(label) add row")
            #expect(s?.days == expected["days"]!.arrayValue!.map { $0.boolValue! }, "\(label) weekdays")
            #expect(s?.alert["enable"] == expected["alertOn"]!, "\(label) switch")
            // The popup now: the last one opened by this step (none when it closed or nothing opened).
            let opened = expected["opened"]!.arrayValue!
            if let last = opened.last {
                switch last["kind"]!.stringValue! {
                case "picker":
                    let input = Int(last["inputTime"]!.numberValue!.double)
                    if case .picker(_, let time) = page.popup {
                        #expect(time == TimePicker.of(input), "\(label) picker")
                    } else {
                        Issue.record("\(label): expected the picker, got \(String(describing: page.popup))")
                    }
                    #expect(["LOC_SETTING", "LOC_DELETE", "LOC_CLOSE"] == [last["setLabel"], last["cancelLabel"], last["closeLabel"]].map { $0!.stringValue! })
                default:
                    let popup = try? #require(page.popup, "\(label): expected a popup")
                    #expect(popup?.title == last["title"]!.stringValue, "\(label) popup title")
                    #expect(popup?.body == last["template"]!.stringValue, "\(label) popup body")
                    let buttons = last["buttons"]!.arrayValue!.map { "\($0["text"]!.stringValue!) \($0["type"]!.stringValue == "button-dark")" }
                    #expect(popup?.buttons.map { "\($0.key) \($0.dark)" } == buttons, "\(label) popup buttons")
                }
            } else {
                #expect(page.popup == nil, "\(label): no popup expected, got \(String(describing: page.popup))")
            }
            let requests = Array(visit.transport.requests.dropFirst(sent))
            sent = visit.transport.requests.count
            AlarmsGolden.compare(expected["requests"]!.arrayValue!, requests, label)
            let now = visit.holder.state!.push.records
            if let saved = expected["saved"]?.arrayValue {
                #expect(JSONValue.array(now.map(JSONValue.object)).sameText(.array(saved)),
                        "\(label) saved:\n\(JSONValue.array(now.map(JSONValue.object)).jsonText)\nexpected:\n\(JSONValue.array(saved).jsonText)")
            } else {
                #expect(now == records, "\(label): nothing saved")
            }
            records = now
            #expect(page.closed == (expected["back"]!.numberValue!.double > 0), "\(label) back")
            #expect(notifications.calls == expected["permission"]!.arrayValue!.map { $0.stringValue! }, "\(label) permission calls")
            notifications.calls = []
            #expect(visit.holder.state!.placeIndex == Int(expected["selected"]!.numberValue!.double), "\(label) selected")
        }
        compare(c["open"]!, "\(name) open")
        for after in c["after"]!.arrayValue! {
            let step = after["step"]!
            let op = step["op"]!.stringValue!
            switch op {
            case "day": page.toggleDay(Int(step["day"]!.numberValue!.double))
            case "alert": page.setAlert(step["enable"]!.boolValue!)
            case "hours": page.setHours(from: step["from"]!.numberValue!.double, to: step["to"]!.numberValue!.double)
            case "picker": page.openPicker(Int(step["index"]!.numberValue!.double))
            case "set": page.answerPicker(Int(step["secs"]!.numberValue!.double))
            case "delete": page.answerPicker(0)
            case "close": page.answerPicker(nil)
            case "cancel": page.cancel()
            case "save": page.save()
            case "answer":
                let value = step["value"]?.stringValue
                switch page.popup {
                case .saveChanges: page.answerSaveChanges(save: value == "save")
                case .permission: page.answerPermission(settings: value == "settings")
                default: Issue.record("\(name): an answer without a popup")
                }
            case "permission": notifications.permission = step["enabled"]!.boolValue!
            default: Issue.record("\(name): unknown step \(op)")
            }
            await visit.settle()
            compare(after, "\(name) \(op)")
        }
        #expect(visit.settingsOpened == c["settingsOpened"]!.arrayValue!.count, "\(name) settings opened")
    }

    /// The S09 save is shown and saved before the post; a store that cannot be written sends nothing and fails nothing.
    @Test func nothingIsSentWhenTheSaveFails() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-alarms-\(UUID().uuidString)")
        // The store cannot be written at all (a full disk): the post's own read of the saved state fails too.
        let store = ProcessStore(AppStateStore(url: dir.appendingPathComponent("app_state.json")), failures: 100)
        let visit = AlarmVisit(places: AlarmsGolden.places(nil), selected: 1, token: "token-a", records: [],
                               notifications: NotificationsDouble(), store: store)
        visit.page.open(fav: nil)
        await visit.settle()
        visit.page.save()
        await visit.settle()
        #expect(visit.page.closed)
        #expect(visit.transport.requests.isEmpty)
        #expect(visit.holder.state!.push.records.count == 3, "the change stays shown and is saved with the next write")
    }

    /// A later save of the same place before the post's turn: the post sends the list as saved then, once per save, so
    /// no alarm is lost and none is sent twice in one post.
    @Test func eachPostSendsTheListAsSavedAtItsTurn() async throws {
        let visit = AlarmVisit(places: AlarmsGolden.places(nil), selected: 1, token: "token-a",
                               records: AlarmsGolden.records(AlarmsGolden.doc["pushList"]), notifications: NotificationsDouble())
        let held = HeldTransport(held: true)
        let sync = PushSync(state: visit.holder, queue: PushTokenQueue(url: visit.dir.appendingPathComponent("q.json")),
                            transport: held, context: AlarmsGolden.context)
        // A registration in flight holds the posts behind it.
        let open = Task { await sync.open { "token-a" } }
        await held.waitForRequests(1)
        var posts: [Task<PushSync.Outcome?, Never>] = []
        for days in [[0], [6]] {
            let page = AlarmPage(holder: visit.holder, notifications: NotificationsDouble(),
                                 post: { i in posts.append(Task { await sync.postPlace(i) }) }, openSettings: {},
                                 now: { AlarmsGolden.now }, zone: { AlarmsGolden.zone })
            page.open(fav: nil)
            await page.permissionCheck?.value
            for d in days { page.toggleDay(d) }
            page.save()
            await page.saving?.value
        }
        held.release()
        _ = await open.value
        try #require(posts.count == 2, "each save posts once")
        let outcomes = await [posts[0].value, posts[1].value]
        let lists = outcomes.map { $0?.requests.first?.body.arrayValue?.compactMap { $0["id"]?.numberValue?.double } ?? [] }
        #expect(lists == [[1, 2], [1, 2]], "each post holds the place's two records once")
        let days = outcomes.map { $0?.requests.first?.body.arrayValue?.last?["dayOfWeek"]?.jsonText }
        #expect(days[0] == days[1], "both posts send the list as saved by the later save")
        #expect(days[0] == #"[true,true,true,true,true,true,true]"#, "both weekday changes are in the list")
        #expect(visit.holder.state!.push.records.filter { PushRecords.cityIndex($0) == 1 }.count == 2, "no duplicate record")
    }
}

/// The S09 save and the O06 answer of the Cordova `Push` service on iOS (`placeSaved`, `alertIntro`).
struct AlarmRequestGoldenTests {
    static func context() -> PushRegistration.Context {
        PushRegistration.Context(deviceId: AlarmsGolden.doc["deviceId"]!.stringValue!,
                                 language: AlarmsGolden.doc["language"]!.stringValue!,
                                 appVersion: AlarmsGolden.doc["appVersion"]!.stringValue!, units: AlarmsGolden.units,
                                 now: AlarmsGolden.now, zone: AlarmsGolden.zone)
    }

    @Test func savingAPlaceAsCordova() {
        let places = AlarmsGolden.places(nil)
        for c in AlarmsGolden.cases("placeSaved") {
            let name = c["name"]!.stringValue!
            let push = PushState(type: "ios", fcmToken: c["storedToken"]?.stringValue, records: AlarmsGolden.records(c["pushList"]))
            let index = Int(c["index"]!.numberValue!.double)
            let result = PushRegistration.onPlaceSaved(push, places: places, list: AlarmsGolden.records(c["list"]), index: index,
                                                       context: Self.context())
            AlarmsGolden.compare(c["requests"]!.arrayValue!, result.requests, name)
            #expect(JSONValue.array(result.state.records.map(JSONValue.object)).sameText(c["saved"]!), "\(name) saved")
            // The post in its turn reads the stored list and sends the same request.
            AlarmsGolden.compare(c["requests"]!.arrayValue!, PushRegistration.placePost(result.state, index: index, context: Self.context()),
                                 "\(name) post")
            #expect(PushRegistration.onPlaceSaved(push, places: places, list: AlarmsGolden.records(c["list"]), index: index,
                                                  context: nil).requests.isEmpty, "\(name): nothing without a server")
        }
    }

    @Test func answeringTheIntroductionAsCordova() {
        let places = AlarmsGolden.places(nil)
        for c in AlarmsGolden.cases("alertIntro") {
            let name = c["name"]!.stringValue!
            let push = PushState(type: "ios", fcmToken: c["storedToken"]?.stringValue, records: AlarmsGolden.records(c["pushList"]),
                                 needsAlertIntro: true)
            let enable = c["answer"]!.stringValue! == "intro-ok"
            let result = PushRegistration.onAlertIntro(push, places: places, enable: enable, context: Self.context())
            AlarmsGolden.compare(c["requests"]!.arrayValue!, result.requests, name)
            #expect(JSONValue.array(result.state.records.map(JSONValue.object)).sameText(c["saved"]!), "\(name) saved")
            #expect(!result.state.needsAlertIntro, "\(name): the introduction ends")
            AlarmsGolden.compare(c["requests"]!.arrayValue!, enable ? PushRegistration.listPost(result.state, context: Self.context()) : [],
                                 "\(name) post")
        }
    }

    /// O06's answer is a change shown and saved at once; OK's post follows.
    @MainActor
    @Test func theIntroductionAnswerIsSavedThenPosted() async {
        let visit = AlarmVisit(places: AlarmsGolden.places(nil), selected: 1, token: "token-a",
                               records: AlarmsGolden.records(AlarmsGolden.cases("alertIntro")[0]["pushList"]),
                               notifications: NotificationsDouble(), needsAlertIntro: true)
        #expect(AlertIntro.due(visit.holder.state))
        var posted = 0
        AlertIntro.answer(visit.holder, enable: true) { posted += 1 }
        #expect(!AlertIntro.due(visit.holder.state))
        #expect(posted == 1)
        #expect(visit.holder.state!.push.records.filter { PushRecords.category($0) == "alert" }.allSatisfy(PushRecords.enabled))
        AlertIntro.answer(visit.holder, enable: false) { posted += 1 }
        #expect(posted == 1, "Close posts nothing")
    }
}

/// ionic-timepicker, the notification payloads and O07's text against the Cordova code.
struct AlarmDomainGoldenTests {
    @Test func thePickerAsIonicTimepicker() {
        for c in AlarmsGolden.cases("picker") {
            let input = Int(c["inputTime"]!.numberValue!.double)
            let steps = c["steps"]!.arrayValue!.map { $0.stringValue! }
            let label = "\(input) \(steps)"
            let opening = TimePicker.of(input)
            #expect([opening.hours, opening.minutes, opening.meridian]
                    == [c["opening"]!["hours"]!.stringValue!, c["opening"]!["minutes"]!.stringValue!, c["opening"]!["meridian"]!.stringValue!],
                    "\(label) opening")
            var t = opening
            for s in steps {
                switch s {
                case "up": t = t.increaseHours()
                case "down": t = t.decreaseHours()
                case "minUp": t = t.increaseMinutes()
                case "minDown": t = t.decreaseMinutes()
                default: t = t.changeMeridian()
                }
            }
            #expect([t.hours, t.minutes, t.meridian]
                    == [c["shown"]!["hours"]!.stringValue!, c["shown"]!["minutes"]!.stringValue!, c["shown"]!["meridian"]!.stringValue!],
                    "\(label) shown")
            #expect(Double(t.seconds()) == c["set"]!.numberValue!.double, "\(label) Set")
            #expect(c["deleted"]!.numberValue!.double == 0, "\(label) Delete answers 0")
            #expect(c["closed"]! == .null, "\(label) Close answers nothing")
        }
    }

    @Test func taps() {
        for c in AlarmsGolden.cases("taps") {
            let payload = c["payload"]!.objectValue!
            let events = c["events"]!.arrayValue!
            let label = JSONValue.object(payload).jsonText
            #expect(c["threw"]! == .null)
            if payload["tap"]?.stringValue != nil {
                let index = NotificationTap.placeIndex(payload["cityIndex"]?.stringValue)
                let expected = events.first { $0[0]?.stringValue == "setCityIndex" }?[1]?.numberValue?.double
                #expect(index == expected, "\(label) index")
                #expect(events.contains { $0[0]?.stringValue == "reloadEvent" } == (expected != nil), "\(label) reload")
            } else {
                let data = try? #require(events.first { $0[0]?.stringValue == "notificationEvent" }?[1]?.objectValue, "\(label)")
                let expected = ForegroundMessage.template(title: data?["title"].flatMap { Js.truthy($0) ? $0.stringValue : nil },
                                                          body: data?["message"].flatMap { Js.truthy($0) ? $0.stringValue : nil })
                #expect(ForegroundMessage.template(payload: payload) == expected, "\(label) O07")
            }
        }
    }

    @Test func foregroundText() {
        #expect(ForegroundMessage.template(title: "명동 맑음", body: "내일 아침") == "명동 맑음<br>내일 아침")
        #expect(ForegroundMessage.template(title: nil, body: "b") == "b")
        #expect(ForegroundMessage.template(title: "t", body: nil) == "t")
        #expect(ForegroundMessage.lines("a <b>bold</b> &amp; title<br>x") == ["a bold & title", "x"])
        #expect(ForegroundMessage.template(payload: JSONObject([("aps", .object(JSONObject([("badge", 1)])))])) == nil,
                "an aps without alert throws in Cordova: no popup")
    }

    @Test func alarmRowText() {
        #expect(AlarmRow.text(7 * 3600 + 40 * 60) == "7:40")
        #expect(AlarmRow.text(20 * 3600 + 5 * 60) == "20:05")
        #expect(AlarmRow.text(0) == "0:00")
    }

    /// CODEX-3190-15 (#3097): opening for a saved place selects it (`setCityIndex(fav)`) and says so, also when it is
    /// already the selected one; an opening without a place says nothing.
    @MainActor @Test func openingForASavedPlaceSaysItChoseIt() async throws {
        let visit = AlarmVisit(places: AlarmsGolden.places(nil), selected: 1, token: "token-a", records: [],
                               notifications: NotificationsDouble())
        var chosen = 0
        let page = AlarmPage(holder: visit.holder, notifications: NotificationsDouble(), post: { _ in }, openSettings: {},
                             now: { AlarmsGolden.now }, zone: { AlarmsGolden.zone }, chosen: { chosen += 1 })
        page.open(fav: 1)
        #expect(chosen == 1, "the selected place again")
        let other = AlarmPage(holder: visit.holder, notifications: NotificationsDouble(), post: { _ in }, openSettings: {},
                              now: { AlarmsGolden.now }, zone: { AlarmsGolden.zone }, chosen: { chosen += 1 })
        other.open(fav: nil)
        #expect(chosen == 1, "no place, no choice")
        await page.permissionCheck?.value
        await other.permissionCheck?.value
    }
}
