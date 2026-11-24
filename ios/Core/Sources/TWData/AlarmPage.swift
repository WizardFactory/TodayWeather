import Foundation
import Observation
import TWDomain
import TWModel
import TWStorage

/// The push plugin's view of notifications, as S09 asks it (firebasex-messaging 2.0.3 `hasPermission` and
/// `grantPermission` on iOS). The app answers through `UNUserNotificationCenter`; tests inject a double.
@MainActor
public protocol NotificationAccess: AnyObject {
    /// Whether the push plugin runs (`Push.inited`): Firebase is configured in this build.
    var available: Bool { get }
    /// `hasPermission`: the alert setting is enabled (`settings.alertSetting == UNNotificationSettingEnabled`).
    func enabled() async -> Bool
    /// `grantPermission`: while the alert setting is not enabled, the system's request for alerts, sounds and badges
    /// (the prompt shows only while the user has not answered it); after a grant the app registers for remote
    /// notifications. Returns when it was answered.
    func request() async
}

/// The popups of S09: their English title literals, body keys and buttons (key, `button-dark`) as PushCtrl builds them.
public enum AlarmPopup: Equatable, Sendable {
    /// O11, `_showPermissionPopUp`: Close, or Settings to the app's page.
    case permission
    /// O12, `onClose` with an edit: Close discards, Save saves.
    case saveChanges
    /// O13, `onOkay` with equal hours: an alert without a title.
    case equalHours
    /// O14 for the alarm at `index` (or the add row at the end): Set, Delete, Close.
    case picker(index: Int, time: TimePicker)

    public var title: String? {
        switch self {
        case .permission: "Permission"
        case .saveChanges: "Save"
        case .equalHours, .picker: nil
        }
    }

    public var body: String? {
        switch self {
        case .permission: "LOC_NOTIFICATION_IS_OFF_TURN_ON_NOTIFICATION_FOR_THIS_APP"
        case .saveChanges: "LOC_SAVE_CHANGES"
        case .equalHours: "LOC_START_TIME_AND_END_TIME_CAN_NOT_BE_THE_SAME_TIME"
        case .picker: nil
        }
    }

    /// The buttons' catalog keys and whether each is `button-dark`.
    public var buttons: [(key: String, dark: Bool)] {
        switch self {
        case .permission: [("LOC_CLOSE", false), ("LOC_SETTING", true)]
        case .saveChanges: [("LOC_CLOSE", false), ("LOC_SAVE", true)]
        case .equalHours: [("LOC_CLOSE", false)]
        case .picker: [("LOC_SETTING", false), ("LOC_DELETE", false), ("LOC_CLOSE", false)]
        }
    }
}

/// S09 for one visit (PushCtrl, controller.push.js; IN-14, #2963; the Android `AlarmPage` of AN-14). `open` selects the
/// place of `fav` (`setCityIndex`, except slot 0 while it is disabled), loads its `AlarmSettings` and, while the push
/// plugin runs, asks for the notification permission (`Push.grantPermission`, the only place the Cordova iOS app asks)
/// and shows O11 when it stays off. A save of a changed page replaces the place's records as a change of the state,
/// shown at once and saved in order, before the page goes back (`updatePushListByCityIndex` changed the list in memory
/// and storage first), so S02's next visit sees it; `post` then posts the place's list in its turn (`_postPushList` was
/// not awaited). `closed` turns true when the page goes back.
///
/// Kept from Cordova (AN-06): the equal-hours check ignores the switch; the defaults count as edits; Save without an
/// edit only goes back, permission permitting.
@MainActor
@Observable
public final class AlarmPage {
    /// The saved state (the app passes `UnsavedPlaces.alarmAccess`: opening for a saved place selects it, #3097).
    @ObservationIgnored private let holder: any PlaceState
    @ObservationIgnored private let notifications: any NotificationAccess
    /// Posts the saved list of the place at an index, after the registrations before it (`PushSync.postPlace`).
    @ObservationIgnored private let post: (Int) -> Void
    @ObservationIgnored private let openSettings: () -> Void
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let zone: () -> TimeZone
    @ObservationIgnored private var opened = false

    public private(set) var settings: AlarmSettings?
    public private(set) var popup: AlarmPopup?
    public private(set) var closed = false
    /// `cityData.name || getShortenAddress(cityData.address)`.
    public private(set) var title = ""
    /// The permission request of the opening and the check of a Save (for tests that wait for them).
    @ObservationIgnored public private(set) var permissionCheck: Task<Void, Never>?
    @ObservationIgnored public private(set) var saving: Task<Void, Never>?

    public init(holder: any PlaceState, notifications: any NotificationAccess, post: @escaping (Int) -> Void,
                openSettings: @escaping () -> Void, now: @escaping () -> Date = Date.init,
                zone: @escaping () -> TimeZone = { TimeZone.current }) {
        self.holder = holder
        self.notifications = notifications
        self.post = post
        self.openSettings = openSettings
        self.now = now
        self.zone = zone
    }

    /// PushCtrl's `init`, once per visit.
    public func open(fav: Int?) {
        guard !opened, let s = holder.state else { return }
        opened = true
        if let fav, fav != 0 || s.places.first?.disable == false, s.places.indices.contains(fav), fav != s.placeIndex {
            holder.change { $0.placeIndex = fav }
        }
        guard let current = holder.state, current.places.indices.contains(current.placeIndex) else { return }
        let index = current.placeIndex
        let city = current.places[index]
        title = city.name.flatMap { $0.isEmpty ? nil : $0 } ?? AddressFormat.shorten(city.address)
        // The records as the Cordova list in memory had them: repaired by `loadPushInfo` at the start.
        let records = current.push.records.map { PushRegistration.repair($0, places: current.places) }
        settings = AlarmSettings.load(records, cityIndex: index, places: current.places, now: now(), zone: zone())
        guard notifications.available else { return }
        let notifications = self.notifications
        permissionCheck = Task { [weak self] in
            await notifications.request()
            if !(await notifications.enabled()) { self?.popup = .permission }
        }
    }

    private func edit(_ change: (AlarmSettings) -> AlarmSettings) {
        if let s = settings { settings = change(s) }
    }

    public func toggleDay(_ day: Int) { edit { $0.toggleDay(day) } }

    public func setAlert(_ on: Bool) { edit { $0.setAlert(on) } }

    /// The hour bar's `onChange`.
    public func setHours(from: Double, to: Double) { edit { $0.setHours(from: from, to: to) } }

    /// O14 on an alarm row or the add row (`onOpenTimePicker`).
    public func openPicker(_ index: Int) {
        guard let s = settings else { return }
        popup = .picker(index: index, time: TimePicker.of(s.pickerInput(index, zone: zone())))
    }

    /// The picker's arrows.
    public func turnPicker(_ change: (TimePicker) -> TimePicker) {
        guard case .picker(let index, let time) = popup else { return }
        popup = .picker(index: index, time: change(time))
    }

    /// The picker's answer: the seconds of Set, 0 for Delete, nil for Close.
    public func answerPicker(_ seconds: Int?) {
        guard case .picker(let index, _) = popup else { return }
        popup = nil
        guard let places = holder.state?.places else { return }
        let now = now(), zone = zone()
        edit { $0.pick(index, seconds: seconds, places: places, now: now, zone: zone) }
    }

    /// Set: the shown time's seconds.
    public func pickerSet() {
        if case .picker(_, let time) = popup { answerPicker(time.seconds()) }
    }

    /// The back arrow and Cancel (`onClose`): back without an edit, else O12.
    public func cancel() {
        if settings?.updated != true { closed = true } else { popup = .saveChanges }
    }

    /// Save (`onOkay`): O13 for equal hours; without the plugin save and back; else, once `hasPermission` answers, save
    /// and back with the permission, O11 without.
    public func save() {
        guard let s = settings, saving == nil else { return }
        if s.equalHours {
            popup = .equalHours
            return
        }
        guard notifications.available else {
            persist(s)
            closed = true
            return
        }
        let notifications = self.notifications
        saving = Task { [weak self] in
            let enabled = await notifications.enabled()
            guard let self else { return }
            saving = nil
            if enabled {
                if let current = settings { persist(current) }
                closed = true
            } else {
                popup = .permission
            }
        }
    }

    private func persist(_ s: AlarmSettings) {
        guard let list = s.toSave(now: now(), zone: zone()) else { return }
        holder.change { state in
            state.push = PushRegistration.onPlaceSaved(state.push, places: state.places, list: list, index: s.cityIndex,
                                                      context: nil).state
        }
        post(s.cityIndex)
    }

    /// O11: Settings opens the app's page; either button closes it.
    public func answerPermission(settings open: Bool) {
        popup = nil
        if open { openSettings() }
    }

    /// O12: Save runs `save`'s checks; Close goes back without saving.
    public func answerSaveChanges(save saveIt: Bool) {
        popup = nil
        if saveIt { save() } else { closed = true }
    }

    /// O13's Close.
    public func closeEqualHours() {
        popup = nil
    }
}

/// The weather-alert introduction O06 (TabCtrl's `showAlertInfoEvent` for alarms converted from the legacy `pushData`,
/// `Push.enableAlertForOldAlarm`; IN-14; the Android `answerAlertIntro`): the answer is a change of the state, shown at
/// once and saved in order. OK turns every alert on, and either answer ends the introduction. OK's post of the whole list
/// (`post`, `PushSync.postList`) follows after the registrations before it.
@MainActor
public enum AlertIntro {
    /// The introduction is due: alarms were converted from `pushData` and it was not answered yet.
    public static func due(_ state: AppState?) -> Bool {
        state?.push.needsAlertIntro == true
    }

    public static func answer(_ holder: AppStateHolder, enable: Bool, post: () -> Void) {
        holder.change { state in
            state.push = PushRegistration.onAlertIntro(state.push, places: state.places, enable: enable, context: nil).state
        }
        if enable { post() }
    }
}
