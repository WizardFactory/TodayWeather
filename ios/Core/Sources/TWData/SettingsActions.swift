import Foundation
import TWDomain
import TWModel
import TWStorage

/// The push registration's part in a unit change (`Push.updateUnits()`, #1845 in the Cordova app): the push list is
/// posted again with the new units. IN-04 (#2953) owns the registration (the FCM token, the replacement log, the
/// transport) and implements this; until it does, the app passes no implementation and nothing is sent.
///
/// The settings call it on the main actor right after the change is shown and queued for saving, with that state. It
/// returns at once; the implementation sends the request itself, in its own order of events. What it sends is
/// `PushListPost.updateUnits(state, context:)`: nothing without a record or a token, and nothing without a server URL
/// or a `Device-Id` (no request can be built then).
public protocol PushUnitsUpdating: Sendable {
    func updateUnits(_ state: AppState)
}

/// What the settings pages change (S07, S08; IN-12, #2961), as the Cordova `radioList.setValue` and `RadioCtrl` do it
/// (controller.setting.radio.js): a unit chosen on S08 is saved and, when it changed, the push list is posted again with
/// it (`Push.updateUnits`); a startup page, refresh interval or theme is saved, and the refresh interval restarts the
/// timer (`reloadEvent 'setRefreshInterval'`). Then every place may load again and the selected one loads
/// (`_resetUpdateTimeCities`: `reloadCity` for every place, `reloadEvent 'resume'`), unless the retry confirmation is
/// open. Opening the refresh interval's list restarts the timer too, since `settingRadio` sets the list's current
/// value. State writes go through the `AppStateHolder`. Port of the Android `SettingsActions` (AN-12).
@MainActor
public final class SettingsActions {
    private let holder: AppStateHolder
    private let session: WeatherSession
    private let push: (any PushUnitsUpdating)?

    public init(holder: AppStateHolder, session: WeatherSession, push: (any PushUnitsUpdating)?) {
        self.holder = holder
        self.session = session
        self.push = push
    }

    /// The value the list `name` shows checked (`radioList.getValue()`): the stored unit or setting.
    public func value(_ name: String) -> String? {
        guard let s = holder.state else { return nil }
        if SettingLists.units.contains(name) { return s.units.value(name) }
        switch name {
        case "startupPage": return s.settings.startupPage
        case "refreshInterval": return s.settings.refreshInterval
        case "theme": return s.settings.theme
        default: return nil
        }
    }

    /// The S08 list `name` opened (`settingRadio`, which sets the list's value).
    public func opened(_ name: String) {
        if name == "refreshInterval" { session.reload(.refreshInterval) }
    }

    /// `value` was chosen on the S08 list `name` (`valueChanged`; the radio calls it only for another value).
    public func choose(_ name: String, value: String) {
        guard let s = holder.state else { return }
        if SettingLists.units.contains(name) {
            // `Units.setUnit` saves and posts only a changed unit.
            if !JSString.equal(s.units.value(name), value) {
                holder.change { $0.units.set(name, value) }
                if let push, let state = holder.state { push.updateUnits(state) }
            }
        } else if SettingLists.settings.contains(name) {
            holder.change { st in
                switch name {
                case "startupPage": st.settings.startupPage = value
                case "refreshInterval": st.settings.refreshInterval = value
                default: st.settings.theme = value
                }
            }
            if name == "refreshInterval" { session.reload(.refreshInterval) }
        } else {
            return
        }
        session.settingChanged()
    }
}

extension UnitSettings {
    /// Sets the unit `key` (one of `UnitSettings.keys`).
    mutating func set(_ key: String, _ value: String) {
        switch key {
        case "temperatureUnit": temperatureUnit = value
        case "windSpeedUnit": windSpeedUnit = value
        case "pressureUnit": pressureUnit = value
        case "distanceUnit": distanceUnit = value
        case "precipitationUnit": precipitationUnit = value
        case "airUnit": airUnit = value
        default: preconditionFailure("unknown unit \(key)")
        }
    }
}
