import Foundation
import Observation
import os
import SwiftUI
import TWData
import TWDomain
import TWModel
import TWStorage
import UIKit
import UserNotifications

/// S09 and the notifications of the app (IN-14, #2963), in the shell: a visit of S09 (`AlarmPage`, PushCtrl) from the
/// weather pages' bell (`goPushPage`: the selected place) and S02's bells (`OnOpenSettingPush(index)`), shown over the tabs
/// as the Cordova `setting-push` state; its popups O11–O14 over it; the weather-alert introduction O06 over the tabs for
/// alarms converted from the legacy `pushData`; a message that arrives while the app shows as O07; and a notification's
/// tap, which selects its place (`cityIndex`) and reloads (`reloadEvent 'push'`). Port of the Android `AlarmsScreen`
/// (AN-14) with the iOS plugin's behavior (firebasex-messaging 2.0.3).
@MainActor
@Observable
final class AlarmsScreens {
    /// The visit shown; nil: the tabs.
    private(set) var page: AlarmPage?

    @ObservationIgnored let shell: ShellModel
    @ObservationIgnored let catalog: Catalog
    @ObservationIgnored private let makePage: () -> AlarmPage
    /// Posts the whole list after O06's OK (`PushSync.postList` through the app's push service).
    @ObservationIgnored private let postList: () -> Void
    /// The tabs' pages start anew on the return (`cache: false`): S02 reads its bells again, the weather page its bell.
    @ObservationIgnored var onClosed: () -> Void = {}
    /// The time zone of the visit's times (the device's).
    @ObservationIgnored var zone: () -> TimeZone = { TimeZone.current }
    @ObservationIgnored private var introShown = false
    @ObservationIgnored private let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "alarms")

    init(shell: ShellModel, makePage: @escaping () -> AlarmPage, postList: @escaping () -> Void) {
        self.shell = shell
        self.makePage = makePage
        self.postList = postList
        catalog = Catalog(code: shell.locale.catalog)
    }

    // MARK: S09

    /// `$location.url('/setting-push?fav=' + index)`: a new visit (`cache: false`).
    func open(fav: Int?) {
        let page = makePage()
        self.page = page
        page.open(fav: fav)
        watch(page)
    }

    private func watch(_ page: AlarmPage) {
        withObservationTracking {
            _ = page.closed
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, self.page === page else { return }
                if page.closed { close() } else { watch(page) }
            }
        }
    }

    /// `$ionicHistory.goBack()`.
    private func close() {
        page = nil
        onClosed()
    }

    /// What S09 shows now.
    var content: AlarmsContent? {
        page.flatMap { AlarmsContent.of($0, zone: zone()) }
    }

    /// The shell's page slot: S09 in the shell's insets, nil while none shows.
    var pageView: (ShellInsets) -> AnyView? {
        { [weak self] insets in
            guard let self, page != nil else { return nil }
            return AnyView(AlarmsPageView(screens: self, insets: insets))
        }
    }

    var actions: AlarmsActions {
        AlarmsActions(back: { [weak self] in self?.page?.cancel() }, save: { [weak self] in self?.page?.save() },
                      setAlert: { [weak self] in self?.page?.setAlert($0) },
                      setHours: { [weak self] in self?.page?.setHours(from: $0, to: $1) },
                      toggleDay: { [weak self] in self?.page?.toggleDay($0) },
                      openPicker: { [weak self] in self?.page?.openPicker($0) })
    }

    /// The popup of the visit as the Cordova page builds it, its buttons answering the visit.
    func popup(_ popup: AlarmPopup) -> Popup? {
        guard let page else { return nil }
        switch popup {
        case .picker(_, let time):
            return Popup(title: "", lines: [], buttons: [], custom: AnyView(
                TimePickerView(time: time, catalog: catalog, turn: { page.turnPicker($0) }, set: { page.pickerSet() },
                               delete: { page.answerPicker(0) }, close: { page.answerPicker(nil) })))
        case .permission, .saveChanges, .equalHours:
            return Self.standardPopup(popup, catalog: catalog) { i in
                switch popup {
                case .permission: page.answerPermission(settings: i == 1)
                case .saveChanges: page.answerSaveChanges(save: i == 1)
                default: page.closeEqualHours()
                }
            }
        }
    }

    /// O11, O12 or O13 as `$ionicPopup` shows it: the English title literal, the body's text and the buttons.
    static func standardPopup(_ popup: AlarmPopup, catalog: Catalog, answer: @escaping (Int) -> Void) -> Popup {
        let buttons = popup.buttons.enumerated().map { i, b in
            Popup.Button(text: catalog(b.key), style: b.dark ? .dark : .standard) { answer(i) }
        }
        return Popup(title: popup.title ?? "", lines: popup.body.map { [catalog($0)] } ?? [], buttons: buttons)
    }

    // MARK: Taps, O06 and O07

    /// A notification's tap (`_notificationCallback` with `tap`): `setCityIndex(parseInt(cityIndex))`, which refuses an
    /// index outside the places, then `reloadEvent 'push'`, which TabCtrl handles once it exists (not while S01 shows).
    /// The page shown stays. Nothing without a number.
    func notificationTapped(_ cityIndex: String?, session: WeatherSession) {
        guard let index = NotificationTap.placeIndex(cityIndex), let state = shell.holder.state else { return }
        let valid = index >= 0 && index < Double(state.places.count)
        if case .start = shell.screen {
            if valid { shell.holder.change { $0.placeIndex = Int(index) } }
            return
        }
        session.openPlace(valid ? Int(index) : -1, sender: .push)
    }


    /// `showAlertInfoEvent`, 500 ms after the app opened over the tabs, once per process while the introduction is due:
    /// Close keeps the migrated alerts off, OK turns them on and posts the list.
    func showIntroIfDue() {
        guard !introShown, AlertIntro.due(shell.holder.state), case .tab = shell.screen else { return }
        introShown = true
        let holder = shell.holder, postList = self.postList
        shell.show(Popup(title: catalog("LOC_WEATHER_ALERT"),
                         lines: Self.introLines(catalog("LOC_ADDED_BAD_WEATHER_ALERT_FUNCTION")),
                         buttons: [Popup.Button(text: catalog("LOC_CLOSE")) { AlertIntro.answer(holder, enable: false, post: {}) },
                                   Popup.Button(text: catalog("LOC_OK"), style: .dark) {
                                       AlertIntro.answer(holder, enable: true, post: postList)
                                   }]))
    }

    /// The introduction's text with its first line break as a break (`replace('\n', '<br>')`).
    static func introLines(_ text: String) -> [String] {
        guard let range = text.range(of: "\n") else { return [text] }
        return [String(text[..<range.lowerBound]), String(text[range.upperBound...])]
    }

    /// `notificationEvent` (TabCtrl): a message while the app shows, in a popup titled 날씨 with OK; nothing for a payload
    /// the Cordova callback could not read.
    func showMessage(_ payload: JSONObject) {
        guard let template = ForegroundMessage.template(payload: payload) else { return }
        shell.show(Popup(title: catalog("LOC_WEATHER"), lines: ForegroundMessage.lines(template),
                         buttons: [Popup.Button(text: catalog("LOC_OK"), style: .dark)]))
    }
}

/// S09 over the tabs with its popup.
struct AlarmsPageView: View {
    let screens: AlarmsScreens
    let insets: ShellInsets

    var body: some View {
        if let page = screens.page, let content = screens.content, let theme = screens.shell.holder.state.map({ Theme.of($0.settings.theme) }) {
            ZStack(alignment: .top) {
                AlarmsPageFrame(content: content, theme: theme, catalog: screens.catalog, insets: insets, actions: screens.actions)
                if let state = page.popup, let popup = screens.popup(state) {
                    IonicPopupView(popup: popup, onTap: { index in
                        // The page's popups answer the visit, which closes them.
                        popup.buttons[index].action()
                    })
                    .padding(.top, insets.statusBar)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("alarms-page")
        }
    }
}

/// The push plugin's notification permission on iOS (firebasex-messaging 2.0.3 `hasPermission`, `grantPermission`) over
/// `UNUserNotificationCenter`. Available only with Firebase configured (`Push.inited`; a build without
/// `GoogleService-Info.plist` neither asks nor checks, as AN-14).
@MainActor
final class UserNotificationAccess: NotificationAccess {
    let available: Bool

    init(available: Bool) {
        self.available = available
    }

    /// `_hasPermission`: the alert setting is enabled; then the app registers for remote notifications, as the plugin does.
    func enabled() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        let on = settings.alertSetting == .enabled
        if on { UIApplication.shared.registerForRemoteNotifications() }
        return on
    }

    /// `grantPermission`: nothing while the alert setting is enabled; else the request for alerts, sounds and badges (the
    /// system prompt only while the user has not answered), and a grant registers for remote notifications.
    func request() async {
        let center = UNUserNotificationCenter.current()
        if await center.notificationSettings().alertSetting == .enabled { return }
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        if granted { UIApplication.shared.registerForRemoteNotifications() }
    }
}

/// The notifications' delegate of the app (firebasex-messaging's `willPresentNotification` and
/// `didReceiveNotificationResponse`), set before the launch finishes so a tap that started the app reaches it: a tap
/// becomes an entry event with the payload's `cityIndex` (cold or warm start, also for a notification the Cordova build
/// received before the update, which iOS keeps); a message while the app shows goes to O07, and the system shows it as
/// well only when its data asks for that (`notification_foreground`). It has no state of its own.
final class NotificationEvents: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    static let shared = NotificationEvents()

    @MainActor
    func start() {
        UNUserNotificationCenter.current().delegate = self
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification)
        async -> UNNotificationPresentationOptions {
        let info = notification.request.content.userInfo
        let payload = Self.payload(info)
        let aps = payload["aps"]?.objectValue
        let foreground = info["notification_foreground"] != nil
        let messageType = payload["messageType"]?.stringValue
        await MainActor.run {
            if messageType != "data" { AppLaunch.shared.message(payload) }
        }
        guard foreground else { return [] }
        var options: UNNotificationPresentationOptions = []
        if aps?["alert"] != nil { options.formUnion([.list, .banner]) }
        if aps?["badge"] != nil { options.insert(.badge) }
        if aps?["sound"] != nil { options.insert(.sound) }
        return options
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let cityIndex = Self.payload(response.notification.request.content.userInfo)["cityIndex"]?.stringValue
        await MainActor.run { AppLaunch.shared.entries.submit(.notification(cityIndex: cityIndex)) }
    }

    /// The APNs `userInfo` as JSON (what the plugin hands the web page); values JSON cannot hold are left out.
    nonisolated static func payload(_ info: [AnyHashable: Any]) -> JSONObject {
        let clean = info.reduce(into: [String: Any]()) { out, pair in
            if let key = pair.key as? String, JSONSerialization.isValidJSONObject([key: pair.value]) { out[key] = pair.value }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: clean, options: [.sortedKeys]),
              let value = try? JSONValue.parse(data) else { return JSONObject() }
        return value.objectValue ?? JSONObject()
    }
}
