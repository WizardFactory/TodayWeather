import Foundation

/// What the system reports for the app's location authorization (CoreLocation's `CLAuthorizationStatus`), with the
/// accuracy the user allowed. Allow Once is `authorizedWhenInUse` until iOS resets it to `notDetermined`; precise and
/// approximate accuracy share every status.
public enum SystemAuthorization: Sendable, Equatable {
    case notDetermined, restricted, denied, authorizedAlways, authorizedWhenInUse
}

/// cordova.plugins.diagnostic 7.4.0's iOS location status (`getLocationAuthorizationStatusAsString` of
/// Diagnostic_Location.m), the value the Cordova iOS app keeps in `Util.locationStatus` and
/// `gLocationAuthorizationStatus`. Restricted and denied are both `denied_always`.
public enum LocationPermission: String, Sendable, Equatable {
    case notDetermined = "not_determined"
    case deniedAlways = "denied_always"
    case authorized = "authorized"
    case authorizedWhenInUse = "authorized_when_in_use"

    public init(_ system: SystemAuthorization) {
        switch system {
        case .notDetermined: self = .notDetermined
        case .restricted, .denied: self = .deniedAlways
        case .authorizedAlways: self = .authorized
        case .authorizedWhenInUse: self = .authorizedWhenInUse
        }
    }

    /// `Util.classifyLocationPermission(status) === 'granted'`.
    public var granted: Bool { self == .authorized || self == .authorizedWhenInUse }
}

/// `Util.locationStatus` on iOS and the app.js code that keeps it (#2959): `checkLocationMode` at the start and on each
/// return to the foreground records the status only while location services are on, and the plugin's state change
/// handler records each status that differs from the one the plugin saw last (it starts with the status at its own
/// start, which it does not report). A change from not enabled to enabled is `locationOn` (`reloadEvent 'locationOn'`).
public struct LocationRecord: Sendable, Equatable {
    /// `Util.locationStatus`: nil until a status was recorded (location services off at the start).
    public private(set) var status: LocationPermission?
    /// The plugin's `currentLocationAuthorizationStatus`.
    public private(set) var reported: LocationPermission?

    public init(status: LocationPermission? = nil, reported: LocationPermission? = nil) {
        self.status = status
        self.reported = reported
    }

    /// `Util.isLocationEnabled()` on iOS: the recorded status is a grant.
    public var enabled: Bool { status?.granted ?? false }

    /// `checkLocationMode`: with location services on, the status is recorded; off, the record stays as it was.
    public mutating func check(servicesEnabled: Bool, status current: LocationPermission) {
        if servicesEnabled { status = current }
    }

    /// The location manager reported `current` (`locationManagerDidChangeAuthorization`, also once at its creation).
    /// True when the change turned location on (`locationOn`).
    @discardableResult
    public mutating func authorizationReported(_ current: LocationPermission) -> Bool {
        defer { reported = current }
        guard let reported, reported != current else { return false }
        let wasEnabled = enabled
        status = current
        return !wasEnabled && enabled
    }
}

/// What ends a failed location attempt: the catalog keys of the retry confirmation's body.
public enum LocationMessage: Sendable, Equatable {
    /// `LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED`.
    case denied
    /// `LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION`.
    case turnOn
    /// No position: `strFailToGetCurrentPosition` (the Wi-Fi line is Android's).
    case notFound
    /// The reverse geocode failed (StartCtrl).
    case noInformation
    /// The prompt was answered with a denial (TabCtrl).
    case promptDenied

    public var lines: [String] {
        switch self {
        case .denied: ["LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED"]
        case .turnOn: ["LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION"]
        case .notFound: ["LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION"]
        case .noInformation: ["LOC_FAIL_TO_GET_LOCATION_INFORMATION"]
        case .promptDenied: ["LOC_PERMISSION_REQUEST_DENIED_PLEASE_SEARCH_BY_LOCATION_NAME_OR_RETRY"]
        }
    }
}

/// A button of a retry confirmation, left to right.
public enum RetryButton: Sendable, Equatable {
    case close
    /// TabCtrl: disable the current position and open the Locations tab.
    case search
    /// `switchToSettings()`: the app's page in the Settings app (iOS has no location settings page to open).
    case settings
    /// `LOC_OK`, which tries again.
    case retry

    public var key: String {
        switch self {
        case .close: "LOC_CLOSE"
        case .search: "LOC_SEARCH"
        case .settings: "LOC_SETTING"
        case .retry: "LOC_OK"
        }
    }

    /// `button-positive`.
    public var positive: Bool { self == .settings || self == .retry }
}

/// A retry confirmation (`showRetryConfirm`, titled `LOC_ERROR`): the body's catalog keys and the buttons.
public struct RetryConfirm: Sendable, Equatable {
    public let lines: [String]
    public let buttons: [RetryButton]

    public init(lines: [String], buttons: [RetryButton]) {
        self.lines = lines
        self.buttons = buttons
    }
}

let appInfoHint = "LOC_OPENS_THE_APP_INFO_PAGE"

/// StartCtrl's location attempt on iOS (`updateCurrentPosition` and `_getCurrentPosition`, controller.start.js
/// L395-L573) and its retry confirmation O04 (L683-L814). Every branch settles (#2871): a position, a message, or a
/// grant that runs the attempt again.
public enum StartLocation {
    public enum Step: Sendable, Equatable {
        /// Take a position (`WeatherUtil.getCurrentPosition`).
        case locate
        /// Show the system prompt; with a recorded `not_determined` the loading overlay hides first.
        case ask(hideLoading: Bool)
        /// End in O04 with the message.
        case fail(LocationMessage)
    }

    /// The step for the recorded status (`Util.locationStatus`) and, where StartCtrl reads it
    /// (`getLocationAuthorizationStatus`), the current one. `records` is what the attempt stores as
    /// `gLocationAuthorizationStatus` (nil: it keeps the previous value).
    public static func decide(record: LocationPermission?, current: LocationPermission)
        -> (step: Step, records: LocationPermission?) {
        if let record, record.granted { return (.locate, record) }
        if record == .notDetermined { return (.ask(hideLoading: true), nil) }
        switch current {
        case .authorized, .authorizedWhenInUse: return (.fail(.turnOn), current)
        case .deniedAlways: return (.fail(.denied), current)
        case .notDetermined: return (.ask(hideLoading: false), nil)
        }
    }

    /// The prompt's answer: a grant runs the attempt again (nil), anything else is the denial. iOS records nothing.
    public static func afterPrompt(_ answer: LocationPermission) -> LocationMessage? {
        answer.granted ? nil : .denied
    }

    /// O04 for the status the page recorded last and `Util.isLocationEnabled()` (`enabled`): `denied_always` adds the
    /// app-info hint and Settings; no recorded status matches diagnostic 7.x's undefined `permissionStatus.DENIED` and
    /// gets Settings; location not enabled gets Settings (iOS: positive, the app's page); then OK.
    public static func retry(_ message: LocationMessage, recorded: LocationPermission?, enabled: Bool) -> RetryConfirm {
        if recorded == .deniedAlways {
            return RetryConfirm(lines: message.lines + [appInfoHint], buttons: [.close, .settings, .retry])
        }
        if recorded == nil || !enabled {
            return RetryConfirm(lines: message.lines, buttons: [.close, .settings, .retry])
        }
        return RetryConfirm(lines: message.lines, buttons: [.close, .retry])
    }
}

/// TabCtrl's lookup of the current position on iOS (`updateCurrentPosition` and `_getCurrentPosition`,
/// controller.tabctrl.js L954-L1088) and its retry confirmation of type `forecast` (O03, L435-L636). TabCtrl's iOS branch
/// reads no status of its own; `gLocationAuthorizationStatus` is what S02 recorded (IN-11).
public enum TabLocation {
    public enum Step: Sendable, Equatable {
        /// Take a position.
        case locate
        /// Show the system prompt.
        case ask
        /// Not enabled, with a saved location or address: the place loads as saved.
        case useSaved
        /// Not enabled, without one: `locationAccuracy.request`, which on iOS asks the system to show its location
        /// services alert when they are off, and settles silently (`locationOn` reloads).
        case requestServices
    }

    public static func decide(record: LocationPermission?, hasSaved: Bool) -> Step {
        if let record, record.granted { return .locate }
        if record == .notDetermined { return .ask }
        return hasSaved ? .useSaved : .requestServices
    }

    /// A grant settles silently (`locationOn` reloads); a denial asks to search or retry.
    public static func afterPrompt(_ answer: LocationPermission) -> LocationMessage? {
        answer.granted ? nil : .promptDenied
    }

    /// O03 `forecast` on iOS: the Android-only `DENIED_ALWAYS` branch is skipped; no recorded status (diagnostic 7.x's
    /// undefined `DENIED`) gives Search and OK; location not enabled Search, Settings and OK; otherwise Close and OK.
    public static func retry(_ message: LocationMessage, recorded: LocationPermission?, enabled: Bool) -> RetryConfirm {
        if recorded == nil { return RetryConfirm(lines: message.lines, buttons: [.search, .retry]) }
        if !enabled { return RetryConfirm(lines: message.lines, buttons: [.search, .settings, .retry]) }
        return RetryConfirm(lines: message.lines, buttons: [.close, .retry])
    }
}
