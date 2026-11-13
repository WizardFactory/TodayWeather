import Foundation

/// Everything the native app persists. Version 1 mirrors the Cordova keys it replaces (`cities`, `cityIndex`,
/// `units`, `settingsInfo`, `pushData2`, `expandShortChart`), as the Android `AppState` does.
public struct AppState: Codable, Hashable, Sendable {
    public var schemaVersion: Int
    public var places: [Place]
    /// Selected index into `places`; -1 when nothing can be shown (Cordova `cityIndex`).
    public var placeIndex: Int
    public var units: UnitSettings
    public var settings: Settings
    public var push: PushState
    public var expandShortChart: Bool
    /// Cordova onboarding and update values (`startVersion`, `appVersion`, `disableUpdateInfo`), kept for the
    /// start gate (IN-10) and the rollback hand-back (IN-17).
    public var cordovaExtras: [String: JSONValue]
    public var migration: MigrationInfo?

    public init(schemaVersion: Int = 1, places: [Place] = [.currentPositionPlaceholder], placeIndex: Int = -1,
                units: UnitSettings = .defaults(region: nil), settings: Settings = Settings(),
                push: PushState = PushState(), expandShortChart: Bool = false,
                cordovaExtras: [String: JSONValue] = [:], migration: MigrationInfo? = nil) {
        self.schemaVersion = schemaVersion
        self.places = places
        self.placeIndex = placeIndex
        self.units = units
        self.settings = settings
        self.push = push
        self.expandShortChart = expandShortChart
        self.cordovaExtras = cordovaExtras
        self.migration = migration
    }
}

/// A saved place. Index 0 is the current position by convention, as in the Cordova app. `cordova` keeps the
/// other fields of the Cordova city record (weather caches removed) for the hand-back.
public struct Place: Codable, Hashable, Sendable {
    public var currentPosition: Bool
    public var disable: Bool
    public var name: String?
    public var address: String?
    public var country: String?
    public var location: Location?
    public var source: String?
    public var photo: String?
    public var cordova: [String: JSONValue]?

    public init(currentPosition: Bool, disable: Bool, name: String? = nil, address: String? = nil,
                country: String? = nil, location: Location? = nil, source: String? = nil, photo: String? = nil,
                cordova: [String: JSONValue]? = nil) {
        self.currentPosition = currentPosition
        self.disable = disable
        self.name = name
        self.address = address
        self.country = country
        self.location = location
        self.source = source
        self.photo = photo
        self.cordova = cordova
    }

    /// Cordova `createCity()` without an item: current position, disabled.
    public static let currentPositionPlaceholder = Place(currentPosition: true, disable: true)
}

public struct Location: Codable, Hashable, Sendable {
    public var lat: Double
    public var long: Double

    public init(lat: Double, long: Double) {
        self.lat = lat
        self.long = long
    }
}

/// The six Cordova unit settings (`Units`).
public struct UnitSettings: Codable, Hashable, Sendable {
    public var temperatureUnit: String
    public var windSpeedUnit: String
    public var pressureUnit: String
    public var distanceUnit: String
    public var precipitationUnit: String
    public var airUnit: String

    public init(temperatureUnit: String, windSpeedUnit: String, pressureUnit: String, distanceUnit: String,
                precipitationUnit: String, airUnit: String) {
        self.temperatureUnit = temperatureUnit
        self.windSpeedUnit = windSpeedUnit
        self.pressureUnit = pressureUnit
        self.distanceUnit = distanceUnit
        self.precipitationUnit = precipitationUnit
        self.airUnit = airUnit
    }

    public static let keys = ["temperatureUnit", "windSpeedUnit", "pressureUnit", "distanceUnit",
                              "precipitationUnit", "airUnit"]

    /// Choices of the Cordova unit screen (`Units.getSelectList`).
    public static let options: [String: [String]] = [
        "temperatureUnit": ["C", "F"],
        "windSpeedUnit": ["mph", "km/h", "m/s", "bft", "kt"],
        "pressureUnit": ["mmHg", "inHg", "mb", "hPa"],
        "distanceUnit": ["km", "mi"],
        "precipitationUnit": ["mm", "in"],
        "airUnit": ["airkorea", "airkorea_who", "airnow", "aqicn"],
    ]

    public func value(_ key: String) -> String {
        switch key {
        case "temperatureUnit": temperatureUnit
        case "windSpeedUnit": windSpeedUnit
        case "pressureUnit": pressureUnit
        case "distanceUnit": distanceUnit
        case "precipitationUnit": precipitationUnit
        case "airUnit": airUnit
        default: preconditionFailure("unknown unit \(key)")
        }
    }

    /// `Units._getDefaultUnits()` for the region (`Util.region`, see `CordovaRegion`).
    public static func defaults(region: String?) -> UnitSettings {
        switch region {
        case "KR": UnitSettings("C", "m/s", "hPa", "km", "mm", "airkorea")
        case "JP": UnitSettings("C", "m/s", "mmHg", "km", "mm", "airnow")
        case "US": UnitSettings("F", "mph", "inHg", "mi", "in", "airnow")
        case "DE": UnitSettings("C", "km/h", "mb", "km", "mm", "airnow")
        case "CN": UnitSettings("C", "km/h", "hPa", "km", "mm", "airnow")
        case "TW": UnitSettings("C", "km/h", "mmHg", "km", "mm", "airnow")
        default: UnitSettings("C", "m/s", "hPa", "km", "mm", "airnow")
        }
    }

    static func of(_ values: [String: String]) -> UnitSettings {
        UnitSettings(values["temperatureUnit"]!, values["windSpeedUnit"]!, values["pressureUnit"]!,
                     values["distanceUnit"]!, values["precipitationUnit"]!, values["airUnit"]!)
    }

    private init(_ t: String, _ w: String, _ p: String, _ d: String, _ r: String, _ a: String) {
        self.init(temperatureUnit: t, windSpeedUnit: w, pressureUnit: p, distanceUnit: d, precipitationUnit: r,
                  airUnit: a)
    }
}

/// Cordova `settingsInfo`: startup page "0" hourly, "1" daily, "2" favorites, "3" air; refresh minutes, "0"
/// manual; theme.
public struct Settings: Codable, Hashable, Sendable {
    public var startupPage: String
    public var refreshInterval: String
    public var theme: String

    public init(startupPage: String = "0", refreshInterval: String = "0", theme: String = "light") {
        self.startupPage = startupPage
        self.refreshInterval = refreshInterval
        self.theme = theme
    }
}

/// Cordova `pushData2`. `records` keep the alert and alarm records as the Cordova app stores them (`cityIndex`,
/// `id`, `category`, `enable`, ISO time fields, `dayOfWeek`, city info) so IN-04 can register them again unchanged.
/// `needsAlertIntro` is set when legacy `pushData` alarms were converted (the O06 introduction).
public struct PushState: Codable, Hashable, Sendable {
    public var registrationId: String?
    public var type: String
    public var category: String
    public var fcmToken: String?
    public var records: [[String: JSONValue]]
    public var needsAlertIntro: Bool

    public init(registrationId: String? = nil, type: String = "ios", category: String = "", fcmToken: String? = nil,
                records: [[String: JSONValue]] = [], needsAlertIntro: Bool = false) {
        self.registrationId = registrationId
        self.type = type
        self.category = category
        self.fcmToken = fcmToken
        self.records = records
        self.needsAlertIntro = needsAlertIntro
    }
}

public struct MigrationInfo: Codable, Hashable, Sendable {
    /// The source of each migrated key, `key=localStorage` or `key=suite`, comma-separated in key order.
    public var source: String
    public var migratedAtMillis: Int64
    /// What happened to each Cordova key: `migrated`, `partial`, `default`, `malformed`, `legacy`, `absent`.
    public var keys: [String: String]
    /// The `localStorage` database read, relative to the data container (`nil` when none was found).
    public var localStorageFile: String?

    public init(source: String, migratedAtMillis: Int64, keys: [String: String], localStorageFile: String? = nil) {
        self.source = source
        self.migratedAtMillis = migratedAtMillis
        self.keys = keys
        self.localStorageFile = localStorageFile
    }
}
