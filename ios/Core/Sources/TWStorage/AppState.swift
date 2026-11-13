import Foundation
import TWModel

/// Everything the native app persists. Version 1 mirrors the Cordova keys it replaces (`cities`, `cityIndex`,
/// `units`, `settingsInfo`, `pushData2`, `expandShortChart`), as the Android `AppState` does.
///
/// Values taken over from the Cordova storage stay `TWModel.JSONValue`/`JSONObject`: member order, number texts and
/// keys compared by UTF-16 code units, as the Cordova app had them. The state file is written through `JSONValue`
/// too (`AppStateStore`), so they survive a save unchanged.
public struct AppState: Hashable, Sendable {
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
    public var cordovaExtras: JSONObject
    public var migration: MigrationInfo?

    public init(schemaVersion: Int = 1, places: [Place] = [.currentPositionPlaceholder], placeIndex: Int = -1,
                units: UnitSettings = .defaults(region: nil), settings: Settings = Settings(),
                push: PushState = PushState(), expandShortChart: Bool = false,
                cordovaExtras: JSONObject = JSONObject(), migration: MigrationInfo? = nil) {
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
public struct Place: Hashable, Sendable {
    public var currentPosition: Bool
    public var disable: Bool
    public var name: String?
    public var address: String?
    public var country: String?
    public var location: Location?
    public var source: String?
    public var photo: String?
    public var cordova: JSONObject?

    public init(currentPosition: Bool, disable: Bool, name: String? = nil, address: String? = nil,
                country: String? = nil, location: Location? = nil, source: String? = nil, photo: String? = nil,
                cordova: JSONObject? = nil) {
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

    /// Equality compares the texts by UTF-16 code units, as the Cordova app compares them.
    public static func == (a: Place, b: Place) -> Bool {
        a.currentPosition == b.currentPosition && a.disable == b.disable && JSString.same(a.name, b.name)
            && JSString.same(a.address, b.address) && JSString.same(a.country, b.country) && a.location == b.location
            && JSString.same(a.source, b.source) && JSString.same(a.photo, b.photo) && a.cordova == b.cordova
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(currentPosition)
        hasher.combine(disable)
        for text in [name, address, country, source, photo] {
            hasher.combine(text == nil)
            if let text { JSString.hash(text, into: &hasher) }
        }
        hasher.combine(location)
        hasher.combine(cordova)
    }
}

public struct Location: Hashable, Sendable {
    public var lat: Double
    public var long: Double

    public init(lat: Double, long: Double) {
        self.lat = lat
        self.long = long
    }
}

/// The six Cordova unit settings (`Units`). The values are the ASCII choices of the unit screen.
public struct UnitSettings: Hashable, Sendable {
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
public struct Settings: Hashable, Sendable {
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
public struct PushState: Hashable, Sendable {
    public var registrationId: String?
    public var type: String
    public var category: String
    public var fcmToken: String?
    public var records: [JSONObject]
    public var needsAlertIntro: Bool

    public init(registrationId: String? = nil, type: String = "ios", category: String = "", fcmToken: String? = nil,
                records: [JSONObject] = [], needsAlertIntro: Bool = false) {
        self.registrationId = registrationId
        self.type = type
        self.category = category
        self.fcmToken = fcmToken
        self.records = records
        self.needsAlertIntro = needsAlertIntro
    }

    /// Equality compares the texts by UTF-16 code units.
    public static func == (a: PushState, b: PushState) -> Bool {
        JSString.same(a.registrationId, b.registrationId) && JSString.equal(a.type, b.type)
            && JSString.equal(a.category, b.category) && JSString.same(a.fcmToken, b.fcmToken)
            && a.records == b.records && a.needsAlertIntro == b.needsAlertIntro
    }

    public func hash(into hasher: inout Hasher) {
        for text in [registrationId, type, category, fcmToken] {
            hasher.combine(text == nil)
            if let text { JSString.hash(text, into: &hasher) }
        }
        hasher.combine(records)
        hasher.combine(needsAlertIntro)
    }
}

public struct MigrationInfo: Hashable, Sendable {
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

extension JSString {
    /// Code-unit equality of two optional texts (both absent counts as equal).
    static func same(_ a: String?, _ b: String?) -> Bool {
        switch (a, b) {
        case (nil, nil): true
        case let (a?, b?): equal(a, b)
        default: false
        }
    }
}

// MARK: - The state file

/// The state file's JSON form. Members are written in a fixed order (Cordova values in their own order), so the
/// same state always gives the same text.
extension AppState {
    struct DecodingError: Error, CustomStringConvertible {
        let description: String
    }

    var json: JSONValue {
        var o = JSONObject()
        o["schemaVersion"] = .number(schemaVersion)
        o["places"] = .array(places.map(\.json))
        o["placeIndex"] = .number(placeIndex)
        o["units"] = .object(JSONObject(UnitSettings.keys.map { ($0, .string(units.value($0))) }))
        o["settings"] = .object(JSONObject([("startupPage", .string(settings.startupPage)),
                                            ("refreshInterval", .string(settings.refreshInterval)),
                                            ("theme", .string(settings.theme))]))
        var push = JSONObject()
        push["registrationId"] = self.push.registrationId.map(JSONValue.string) ?? .null
        push["type"] = .string(self.push.type)
        push["category"] = .string(self.push.category)
        push["fcmToken"] = self.push.fcmToken.map(JSONValue.string) ?? .null
        push["records"] = .array(self.push.records.map(JSONValue.object))
        push["needsAlertIntro"] = .bool(self.push.needsAlertIntro)
        o["push"] = .object(push)
        o["expandShortChart"] = .bool(expandShortChart)
        o["cordovaExtras"] = .object(cordovaExtras)
        if let migration {
            var m = JSONObject()
            m["source"] = .string(migration.source)
            m["migratedAtMillis"] = .number(Int(migration.migratedAtMillis))
            m["keys"] = .object(JSONObject(migration.keys.sorted { JSString.less($0.key, $1.key) }
                .map { ($0.key, .string($0.value)) }))
            m["localStorageFile"] = migration.localStorageFile.map(JSONValue.string) ?? .null
            o["migration"] = .object(m)
        } else {
            o["migration"] = .null
        }
        return .object(o)
    }

    init(json: JSONValue) throws {
        func fail(_ what: String) -> DecodingError { DecodingError(description: "app state: \(what)") }
        func int(_ v: JSONValue?, _ what: String) throws -> Int {
            guard let n = v?.numberValue, n.isInteger, let i = Int(n.text) else { throw fail(what) }
            return i
        }
        func string(_ v: JSONValue?, _ what: String) throws -> String {
            guard let s = v?.stringValue else { throw fail(what) }
            return s
        }
        func optionalString(_ v: JSONValue?, _ what: String) throws -> String? {
            if v == nil || v!.isNull { return nil }
            return try string(v, what)
        }
        func bool(_ v: JSONValue?, _ what: String) throws -> Bool {
            guard let b = v?.boolValue else { throw fail(what) }
            return b
        }
        guard let o = json.objectValue, let placeList = o["places"]?.arrayValue else { throw fail("not a state") }
        let places = try placeList.map(Place.init(json:))
        guard let units = o["units"]?.objectValue, let settings = o["settings"]?.objectValue,
              let push = o["push"]?.objectValue, let extras = o["cordovaExtras"]?.objectValue else {
            throw fail("members")
        }
        var unitValues: [String: String] = [:]
        for key in UnitSettings.keys { unitValues[key] = try string(units[key], key) }
        var migration: MigrationInfo?
        if let m = o["migration"]?.objectValue {
            var keys: [String: String] = [:]
            for (k, v) in m["keys"]?.objectValue ?? JSONObject() { keys[k] = try string(v, "migration key \(k)") }
            migration = MigrationInfo(source: try string(m["source"], "source"),
                                      migratedAtMillis: Int64(try int(m["migratedAtMillis"], "migratedAtMillis")),
                                      keys: keys, localStorageFile: try optionalString(m["localStorageFile"], "file"))
        }
        self.init(
            schemaVersion: try int(o["schemaVersion"], "schemaVersion"), places: places,
            placeIndex: try int(o["placeIndex"], "placeIndex"), units: UnitSettings.of(unitValues),
            settings: Settings(startupPage: try string(settings["startupPage"], "startupPage"),
                               refreshInterval: try string(settings["refreshInterval"], "refreshInterval"),
                               theme: try string(settings["theme"], "theme")),
            push: PushState(registrationId: try optionalString(push["registrationId"], "registrationId"),
                            type: try string(push["type"], "type"), category: try string(push["category"], "category"),
                            fcmToken: try optionalString(push["fcmToken"], "fcmToken"),
                            records: try (push["records"]?.arrayValue ?? []).map {
                                guard let r = $0.objectValue else { throw fail("record") }
                                return r
                            },
                            needsAlertIntro: try bool(push["needsAlertIntro"], "needsAlertIntro")),
            expandShortChart: try bool(o["expandShortChart"], "expandShortChart"), cordovaExtras: extras,
            migration: migration)
    }
}

extension Place {
    var json: JSONValue {
        var o = JSONObject()
        o["currentPosition"] = .bool(currentPosition)
        o["disable"] = .bool(disable)
        for (key, text) in [("name", name), ("address", address), ("country", country)] {
            if let text { o[key] = .string(text) }
        }
        if let location {
            o["location"] = .object(JSONObject([("lat", .number(location.lat)), ("long", .number(location.long))]))
        }
        for (key, text) in [("source", source), ("photo", photo)] {
            if let text { o[key] = .string(text) }
        }
        if let cordova { o["cordova"] = .object(cordova) }
        return .object(o)
    }

    init(json: JSONValue) throws {
        guard let o = json.objectValue, let current = o["currentPosition"]?.boolValue,
              let disable = o["disable"]?.boolValue else {
            throw AppState.DecodingError(description: "app state: place")
        }
        var location: Location?
        if let loc = o["location"]?.objectValue {
            guard let lat = loc["lat"]?.numberValue?.double, let long = loc["long"]?.numberValue?.double else {
                throw AppState.DecodingError(description: "app state: location")
            }
            location = Location(lat: lat, long: long)
        }
        self.init(currentPosition: current, disable: disable, name: o["name"]?.stringValue,
                  address: o["address"]?.stringValue, country: o["country"]?.stringValue, location: location,
                  source: o["source"]?.stringValue, photo: o["photo"]?.stringValue, cordova: o["cordova"]?.objectValue)
    }
}
