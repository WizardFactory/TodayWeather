import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
import UIKit
@testable import TodayWeather

/// The notification permission as S09 asks it, answered by the test; records the calls.
@MainActor
final class TestNotifications: NotificationAccess {
    var available: Bool
    var permission: Bool
    var calls: [String] = []

    init(available: Bool, permission: Bool = true) {
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

/// S09 in the live shell (IN-14, #2963) over IN-11's S02 fixture: the alarms page as the app connects it (the bells, the
/// page slot, the return to the tabs), with the notification permission, the posts and the settings opener recorded.
@MainActor
final class AlarmsFixture {
    final class Recorded {
        var posts: [Int] = []
        var lists = 0
        var settings = 0
    }

    let places: PlacesFixture
    let alarms: AlarmsScreens
    let notifications: TestNotifications
    let recorded = Recorded()

    init(places list: [Place], selected: Int = 1, records: [JSONObject] = [], firebase: Bool = false, permission: Bool = true,
         needsAlertIntro: Bool = false, started: Bool = true) throws {
        places = try PlacesFixture(places: list, selected: selected, records: records, started: started)
        if needsAlertIntro { places.holder.change { $0.push.needsAlertIntro = true } }
        let notifications = TestNotifications(available: firebase, permission: permission)
        self.notifications = notifications
        let holder = places.holder, recorded = self.recorded
        alarms = AlarmsScreens(shell: places.shell, makePage: {
            AlarmPage(holder: holder, notifications: notifications, post: { recorded.posts.append($0) },
                      openSettings: { recorded.settings += 1 })
        }, postList: { recorded.lists += 1 })
        // As `AppLaunch.makeAlarms` connects them.
        let alarms = self.alarms, weather = places.weather, placesScreens = places.places
        weather.onBell = { [weak alarms, weak holder] in alarms?.open(fav: holder?.state?.placeIndex) }
        placesScreens.onBell = { [weak alarms] in alarms?.open(fav: $0) }
        alarms.onClosed = { [weak placesScreens, weak weather] in
            placesScreens?.reopen()
            weather?.reopen()
        }
    }

    var state: AppState { places.holder.state! }

    /// The shell with S09's page slot in a window, on `tab`.
    func hosted(_ tab: ShellTab = .search) async throws -> HostedView {
        places.shell.select(tab)
        let weather = places.weather, placesScreens = places.places, alarms = self.alarms
        let view = try HostedView(ShellView(model: places.shell, content: { tab in
            tab == .search ? placesScreens.content(tab) : weather.content(tab)
        }, page: { alarms.pageView($0) }), size: CGSize(width: 393, height: 852))
        if tab == .search {
            #expect(await HostedShellTests.AirLiveTests.wait(5) { placesScreens.visits == 1 })
            await places.settle()
        }
        try await view.settle()
        return view
    }

    func settle(_ view: HostedView) async throws {
        await alarms.page?.permissionCheck?.value
        await alarms.page?.saving?.value
        try await view.settle()
    }

    func records(_ index: Int) -> [JSONObject] {
        state.push.records.filter { PushRecords.cityIndex($0) == index }
    }
}

extension HostedShellTests {
@MainActor
struct AlarmsScreenTests {
    static let londonAlarms: [JSONObject] = [
        JSONObject([("cityIndex", 2), ("id", 1), ("startTime", "2026-11-06T22:00:00.000Z"), ("endTime", "2026-11-07T13:00:00.000Z"),
                    ("enable", true), ("category", "alert")]),
        PlacesFixture.alarm(2),
    ]

    /// #2963: S02's bell opens its row's S09 (selecting it); the weather page's bell the selected place's. Back without an
    /// edit returns to the tab, whose page starts anew.
    @Test func theBellsOpenTheAlarmsOfTheirPlace() async throws {
        let f = try AlarmsFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul, PlacesFixture.london],
                                  records: Self.londonAlarms)
        let app = try await f.hosted()
        defer { app.close() }
        try app.tap("places-bell-2")
        try await f.settle(app)
        #expect(app.element("alarms-page") != nil)
        #expect(f.alarms.page?.title == "London")
        #expect(f.state.placeIndex == 2, "setCityIndex(fav)")
        #expect(app.element("alarms-row-0") != nil, "London's 7:40 alarm")
        try app.tap("alarms-back")
        try await f.settle(app)
        #expect(app.element("alarms-page") == nil)
        #expect(f.places.places.visits == 2, "S02 starts anew and reads its bells again")
        // The weather page's bell: S09 of the selected place.
        f.places.shell.select(.forecast)
        try await app.settle()
        f.places.weather.onBell()
        try await f.settle(app)
        #expect(f.alarms.page?.title == "London")
    }

    /// Save of a place without records registers the defaults once: the records are saved before the post, the post is
    /// asked for once, and S02's bell turns on.
    @Test func savingTheDefaultsRegistersThemOnce() async throws {
        let f = try AlarmsFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul, PlacesFixture.london])
        let app = try await f.hosted()
        defer { app.close() }
        #expect(app.element("places-bell-1")?.accessibilityLabel == "alarm off")
        try app.tap("places-bell-1")
        try await f.settle(app)
        #expect(app.element("alarms-row-0") != nil && app.element("alarms-row-1") != nil && app.element("alarms-add") != nil)
        #expect(f.notifications.calls.isEmpty, "without Firebase S09 neither asks nor checks")
        try app.tap("alarms-save")
        try await f.settle(app)
        #expect(app.element("alarms-page") == nil)
        #expect(f.recorded.posts == [1])
        #expect(f.records(1).map { PushRecords.category($0) } == ["alert", "alarm", "alarm"])
        #expect(app.element("places-bell-1")?.accessibilityLabel == "alarm on")
    }

    /// O14 from the add row: the arrows turn the time, Set adds the alarm; O12 on the back arrow after an edit, whose Save
    /// saves; O13 for equal hours.
    @Test func thePickerTheConfirmationAndTheEqualHours() async throws {
        let f = try AlarmsFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul, PlacesFixture.london],
                                  records: Self.londonAlarms)
        let app = try await f.hosted()
        defer { app.close() }
        try app.tap("places-bell-2")
        try await f.settle(app)
        try app.tap("alarms-add")
        try await app.settle()
        #expect(app.element("picker-heading")?.accessibilityLabel == "08 : 00 AM")
        try app.tap("picker-up-0")
        try await app.settle()
        #expect(app.element("picker-heading")?.accessibilityLabel == "09 : 00 AM")
        try app.tap("picker-set")
        try await app.settle()
        #expect(app.element("picker") == nil)
        #expect(f.alarms.content?.rows.map(\.text) == ["7:40", "9:00"])
        try app.tap("alarms-back")
        try await app.settle()
        #expect(f.alarms.page?.popup == .saveChanges)
        #expect(app.element("popup") != nil)
        try app.tap("popup-button-1")
        try await f.settle(app)
        #expect(app.element("alarms-page") == nil)
        #expect(f.records(2).count == 3)
        #expect(f.recorded.posts == [2])
        // Equal hours: O13, nothing saved.
        try app.tap("places-bell-2")
        try await f.settle(app)
        f.alarms.actions.setHours(9, 9)
        try app.tap("alarms-save")
        try await f.settle(app)
        #expect(f.alarms.page?.popup == .equalHours)
        try app.tap("popup-button-0")
        try await app.settle()
        #expect(f.alarms.page?.popup == nil && f.recorded.posts == [2])
    }

    /// With Firebase, S09 asks for the permission on opening (`grantPermission`, then `hasPermission`); off: O11, whose
    /// Settings opens the app's page; Save is refused with O11 again.
    @Test func thePermissionDialog() async throws {
        let f = try AlarmsFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul], firebase: true, permission: false)
        let app = try await f.hosted()
        defer { app.close() }
        try app.tap("places-bell-1")
        try await f.settle(app)
        #expect(f.notifications.calls == ["grant", "has"])
        #expect(f.alarms.page?.popup == .permission)
        try app.tap("popup-button-1")
        try await app.settle()
        #expect(f.recorded.settings == 1)
        try app.tap("alarms-save")
        try await f.settle(app)
        #expect(f.alarms.page?.popup == .permission && f.recorded.posts.isEmpty)
        try app.tap("popup-button-0")
        f.notifications.permission = true
        try app.tap("alarms-save")
        try await f.settle(app)
        #expect(app.element("alarms-page") == nil && f.recorded.posts == [1])
    }

    /// O06 over the tabs for alarms converted from `pushData` (once per process); OK turns the alerts on and posts the list.
    /// O07 for a message while the app shows.
    @Test func theIntroductionAndAMessage() async throws {
        let converted: [JSONObject] = [
            JSONObject([("cityIndex", 1), ("id", 1), ("startTime", "2026-11-06T22:00:00.000Z"), ("endTime", "2026-11-07T13:00:00.000Z"),
                        ("enable", false), ("category", "alert")]),
            PlacesFixture.alarm(1),
        ]
        let f = try AlarmsFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul], records: converted, needsAlertIntro: true)
        let app = try await f.hosted(.forecast)
        defer { app.close() }
        f.alarms.showIntroIfDue()
        try await app.settle()
        #expect(f.places.shell.popups.first?.title == "악천후 경보")
        try app.tap("popup-button-1")
        try await app.settle()
        #expect(!f.state.push.needsAlertIntro)
        #expect(f.records(1).filter { PushRecords.category($0) == "alert" }.allSatisfy(PushRecords.enabled))
        #expect(f.recorded.lists == 1)
        f.alarms.showIntroIfDue()
        #expect(f.places.shell.popups.isEmpty, "once")
        f.alarms.showMessage(JSONObject([("aps", .object(JSONObject([("alert", .object(JSONObject([("title", "서울 맑음"), ("body", "7:40")])))]))),
                                         ("cityIndex", "1")]))
        try await app.settle()
        #expect(f.places.shell.popups.first?.title == "날씨")
        #expect(f.places.shell.popups.first?.lines == ["서울 맑음", "7:40"])
        try app.tap("popup-button-0")
        try await app.settle()
        #expect(f.places.shell.popups.isEmpty)
    }

    /// S01 closing as IN-10's flow does it: a place added and selected, `startVersion` stored, the shell on its tabs, then
    /// `AppLaunch.startClosed`'s call.
    static func closeStart(_ f: AlarmsFixture, adding place: Place) {
        f.places.holder.change { s in
            s.places.append(place)
            s.placeIndex = s.places.count - 1
            s.cordovaExtras["startVersion"] = 1
        }
        f.places.shell.closeStart()
        f.alarms.startClosed(session: f.places.session)
    }

    /// A tap that comes while S01 shows waits until S01 has closed, then selects its place and loads it (CODEX-IN14-1:
    /// the Android app holds the delivery while the start page shows; S01's add would otherwise select its own place
    /// over the notification's).
    @Test func aTapWhileTheStartPageShowsWaitsForItsEnd() async throws {
        let f = try AlarmsFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul, PlacesFixture.london], started: false)
        #expect(f.places.shell.screen == .start)
        f.alarms.notificationTapped("2", session: f.places.session)
        #expect(f.state.placeIndex == 1, "held while S01 shows")
        let before = f.places.server.requests.count
        Self.closeStart(f, adding: PlacesFixture.busan)
        #expect(f.state.placeIndex == 2, "the notification's place, after S01 selected its own")
        #expect(await HostedShellTests.AirLiveTests.wait(5) { f.places.server.requests.count > before }, "and it loads")
        let after = f.places.server.requests.count
        f.alarms.startClosed(session: f.places.session)
        try await Task.sleep(for: .milliseconds(300))
        #expect(f.state.placeIndex == 2 && f.places.server.requests.count == after, "delivered once")
    }

    /// O06 is due 500 ms after the tabs show: a first start that opens on S01 shows it 500 ms after S01 closed
    /// (CODEX-IN14-2), once.
    @Test func theIntroductionWaitsForTheStartPage() async throws {
        let f = try AlarmsFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul], needsAlertIntro: true, started: false)
        f.alarms.scheduleIntro()
        try await Task.sleep(for: .milliseconds(800))
        #expect(f.places.shell.popups.isEmpty, "not over S01")
        Self.closeStart(f, adding: PlacesFixture.busan)
        #expect(await HostedShellTests.AirLiveTests.wait(5) { !f.places.shell.popups.isEmpty }, "O06 after S01 closed")
        #expect(f.places.shell.popups.first?.title == "악천후 경보")
        #expect(f.places.shell.popups.count == 1)
    }

    /// A tap selects `parseInt(cityIndex)` within range and reloads at once (`reloadEvent 'push'`); the tab stays.
    @Test func aNotificationTapOpensItsPlace() async throws {
        let f = try AlarmsFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul, PlacesFixture.london])
        let app = try await f.hosted(.dailyforecast)
        defer { app.close() }
        let before = f.places.server.requests.count
        f.alarms.notificationTapped("2", session: f.places.session)
        #expect(await HostedShellTests.AirLiveTests.wait(5) { f.places.server.requests.count > before })
        #expect(f.state.placeIndex == 2)
        #expect(f.places.shell.selected == .dailyforecast)
        let reloaded = f.places.server.requests.count
        f.alarms.notificationTapped("7", session: f.places.session)
        #expect(f.state.placeIndex == 2, "an index outside the places is refused")
        // `reloadEvent 'push'` still follows (Cordova broadcasts after the refused `setCityIndex`).
        #expect(await HostedShellTests.AirLiveTests.wait(5) { f.places.server.requests.count > reloaded })
        try await app.settle()
        let count = f.places.server.requests.count
        f.alarms.notificationTapped("abc", session: f.places.session)
        try await app.settle()
        #expect(f.places.server.requests.count == count, "no number: nothing")
    }
}
}
