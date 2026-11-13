import Foundation
import TWModel

/// A value of the App Group suite as cordova-plugin-app-preferences stored it on iOS (`AppPreferences.m`).
/// `TwStorage.set` passes JSON text as a JavaScript string, which the plugin stores as an `NSString`; values of
/// other JavaScript types become `NSNumber` (numbers and booleans) or UTF-8 `NSData` (objects).
public enum SuiteValue: Hashable, Sendable {
    case string(String)
    case bool(Bool)
    /// An `NSNumber` that is not a boolean, as the plugin's `fetch` formats it (`%@`).
    case number(String)
    case data(Data)
    /// A property-list type the plugin never writes (array, dictionary, date).
    case unsupported(String)

    /// The JSON text the Cordova app would get back from `fetch` and put into `localStorage`; nil when the value
    /// cannot be such a text (not UTF-8, unsupported type).
    public var text: String? {
        switch self {
        case .string(let text): text
        case .bool(let value): value ? "true" : "false"
        case .number(let text): text
        case .data(let data): String(data: data, encoding: .utf8)
        case .unsupported: nil
        }
    }

    /// Classifies a value read from `UserDefaults` or a preferences property list.
    public static func from(_ object: Any) -> SuiteValue {
        switch object {
        case let text as String:
            return .string(text)
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
            return .number("\(number)")
        case let data as Data:
            return .data(data)
        default:
            return .unsupported(String(describing: type(of: object)))
        }
    }
}

/// What the migration reads: the WebView `localStorage` items of origin `app://localhost` and the App Group
/// suite `group.net.wizardfactory.todayweather`. Either can be empty.
public struct CordovaSources: Hashable, Sendable {
    /// The `localStorage` items the migration reads, under their exact names (`CordovaSources.read` matches the
    /// stored keys by UTF-16 code units).
    public var local: [String: String]
    public var suite: [String: SuiteValue]
    /// The database `local` was read from, relative to the data container (recorded in `MigrationInfo`).
    public var localStorageFile: String?

    public init(local: [String: String] = [:], suite: [String: SuiteValue] = [:], localStorageFile: String? = nil) {
        self.local = local
        self.suite = suite
        self.localStorageFile = localStorageFile
    }

    /// The suite keys the migration reads (the Cordova `TwStorage` keys and the analytics choice it ignores).
    public static let suiteKeys = ["cities", "cityIndex", "units", "settingsInfo", "pushData2", "pushData",
                                   "expandShortChart", "startVersion", "guideVersion", "appVersion",
                                   "disableUpdateInfo", "twAnalyticsConsentV1"]
}

/// `Util.region` of the Cordova app on iOS (app.js without the globalization plugin): the last part of the first
/// `navigator.languages` tag with a region, else "KR". WKWebView reports the device's preferred languages.
public enum CordovaRegion {
    public static func from(preferredLanguages: [String]) -> String {
        for tag in preferredLanguages {
            let parts = JSString.split(tag, "-")
            if parts.count > 1 { return parts[parts.count - 1] }
        }
        return "KR"
    }
}

/// The migration of the Cordova app's storage into `AppState`: the rules of the Android `CordovaMigration`
/// (AN-03, android/README.md "Data migration from the Cordova app"), which port the Cordova restore code.
///
/// Each key is read from `localStorage` first, then from the suite; a value that does not parse falls back to the
/// next source, and a key that parses nowhere takes the Cordova default. Stored texts are parsed by
/// `TWModel.JSONValue` (strict JSON, as `JSON.parse`), and stored strings and keys are compared by UTF-16 code
/// units (`JSString`), as the Cordova code compares them. Pure function of its inputs: the same sources, region,
/// time and zone give the same state.
public enum CordovaMigration {
    public static let suiteName = "group.net.wizardfactory.todayweather"

    /// Weather caches are fetched again; `location` lives in `Place.location`.
    static let cacheKeys = ["currentWeather", "timeTable", "timeChart", "dayTable", "dayChart", "airInfo",
                            "airInfoList", "loadTime", "location"]
    static let extraKeys = ["startVersion", "appVersion", "disableUpdateInfo"]

    public static func migrate(_ sources: CordovaSources, region: String?, now: Date, zone: TimeZone) -> AppState {
        var report: [String: String] = [:]
        var sourceOrder: [(String, String)] = []

        /// The `localStorage` value when it parses, else the suite's; malformed only when no present value parses.
        func parse(_ key: String) -> JSONValue? {
            var present: [(String, String?)] = []
            if let text = sources.local[key] { present.append(("localStorage", text)) }
            if let value = sources.suite[key] { present.append(("suite", value.text)) }
            if present.isEmpty {
                if report[key] == nil { report[key] = "absent" }
                return nil
            }
            for (source, text) in present {
                if let text, let parsed = try? JSONValue.parse(text) {
                    if let i = sourceOrder.firstIndex(where: { $0.0 == key }) {
                        sourceOrder[i].1 = source
                    } else {
                        sourceOrder.append((key, source))
                    }
                    return parsed
                }
            }
            report[key] = "malformed"
            return nil
        }

        let places = places(parse("cities"), &report)
        let placeIndex = placeIndex(parse("cityIndex"), places, &report)
        let units = units(parse("units"), region: region, &report)
        let settings = settings(parse("settingsInfo"), local: sources.local, &report)
        let push = push(parse("pushData2"), parse("pushData"), places, now: now, zone: zone, &report)
        let expand = parse("expandShortChart")?.boolValue
        report["expandShortChart"] = expand != nil ? "migrated" : report["expandShortChart"] ?? "default"
        // `_setBackwardCompatibility`: a store with only the old `guideVersion` starts as if `startVersion` had it.
        var extras = JSONObject()
        for key in extraKeys {
            if let value = parse(key) ?? (key == "startVersion" ? parse("guideVersion") : nil) {
                extras[key] = value
                report[key] = "migrated"
            }
        }
        // The Cordova analytics opt-in never carries over (analytics stays off until the user opts in, IN-15).
        if sources.local["twAnalyticsConsentV1"] != nil || sources.suite["twAnalyticsConsentV1"] != nil {
            report["twAnalyticsConsentV1"] = "ignored"
        }
        return AppState(
            places: places, placeIndex: placeIndex, units: units, settings: settings, push: push,
            expandShortChart: expand ?? false, cordovaExtras: extras,
            migration: MigrationInfo(source: sourceOrder.map { "\($0.0)=\($0.1)" }.joined(separator: ","),
                                     migratedAtMillis: millis(now), keys: report,
                                     localStorageFile: sources.localStorageFile))
    }

    // MARK: - Views of stored values (the kotlinx `JsonPrimitive` accessors of the Android port)

    /// `intOrNull` of a non-string primitive: a number whose text is a 32-bit integer (`1`, not `1.0`).
    static func int32(_ value: JSONValue?) -> Int? {
        guard let n = value?.numberValue, let i = Int32(n.text) else { return nil }
        return Int(i)
    }

    /// `doubleOrNull` of a non-string primitive.
    static func double(_ value: JSONValue?) -> Double? { value?.numberValue?.double }

    /// The entry of `options` equal to `text` by UTF-16 code units (`indexOf(text) !== -1` in the Cordova code).
    static func choice(_ text: String?, _ options: [String]) -> String? {
        guard let text else { return nil }
        return options.first { JSString.equal($0, text) }
    }

    // MARK: - Places

    /// `WeatherInfo.loadCities`: restore defaults; a missing or broken list starts like a new install.
    static func places(_ cities: JSONValue?, _ report: inout [String: String]) -> [Place] {
        guard let list = cities?.arrayValue else {
            if cities != nil { report["cities"] = "malformed" }
            return [.currentPositionPlaceholder]
        }
        // An entry that is not an object keeps its slot as a disabled place, so `cityIndex` and the alarms'
        // `cityIndex` still point at the same places.
        let out = list.enumerated().map { index, item -> Place in
            guard let city = item.objectValue else { return Place(currentPosition: index == 0, disable: true) }
            var kept = JSONObject()
            for (key, value) in city where choice(key, cacheKeys) == nil { kept[key] = value }
            return Place(
                currentPosition: city["currentPosition"]?.boolValue == true,
                disable: city["disable"]?.boolValue ?? false, // createCity: a missing disable means enabled
                name: city["name"]?.stringValue,
                address: city["address"]?.stringValue,
                country: city["country"]?.stringValue,
                location: location(city["location"]),
                source: city["source"]?.stringValue,
                photo: city["photo"]?.stringValue,
                cordova: kept)
        }
        report["cities"] = list.allSatisfy { $0.objectValue != nil } && !out.isEmpty ? "migrated" : "partial"
        return out.isEmpty ? [.currentPositionPlaceholder] : out
    }

    /// Finite coordinates within ±90/±180, or nil (the place is then address-only, as old favorites are).
    static func location(_ value: JSONValue?) -> Location? {
        guard let loc = value?.objectValue, let lat = double(loc["lat"]), let long = double(loc["long"]),
              lat.isFinite, long.isFinite, (-90.0...90.0).contains(lat), (-180.0...180.0).contains(long) else {
            return nil
        }
        return Location(lat: lat, long: long)
    }

    /// `loadCities` index rules; `setFirstCityIndex` when absent, out of range or invalid.
    static func placeIndex(_ index: JSONValue?, _ places: [Place], _ report: inout [String: String]) -> Int {
        if let i = int32(index), places.indices.contains(i) {
            report["cityIndex"] = "migrated"
            return i
        }
        report["cityIndex"] = index == nil ? report["cityIndex"] ?? "default" : "malformed"
        if !places[0].disable { return 0 }
        return places.count > 1 ? 1 : -1
    }

    // MARK: - Units and settings

    /// `Units.loadUnits`: missing members and the retired `aircn` take the region defaults; unknown values too.
    static func units(_ saved: JSONValue?, region: String?, _ report: inout [String: String]) -> UnitSettings {
        let defaults = UnitSettings.defaults(region: region)
        let obj = saved?.objectValue
        var replaced = false
        var values: [String: String] = [:]
        for key in UnitSettings.keys {
            if let option = choice(obj?[key]?.stringValue, UnitSettings.options[key]!) {
                values[key] = option
            } else {
                values[key] = defaults.value(key)
                replaced = true
            }
        }
        if obj == nil && saved != nil {
            report["units"] = "malformed"
        } else if obj == nil {
            report["units"] = report["units"] ?? "default"
        } else if replaced {
            report["units"] = "partial"
        } else {
            report["units"] = report["units"] ?? "migrated"
        }
        return UnitSettings.of(values)
    }

    static let startupPages = ["0", "1", "2", "3"]
    static let themes = ["light", "dark", "photo", "old"]

    /// Kotlin `toIntOrNull() >= 0`: an optional sign and ASCII digits within 32 bits.
    static func validRefresh(_ text: String?) -> String? {
        guard let text, let minutes = Int32(text), minutes >= 0 else { return nil }
        return text
    }

    /// `settingsInfo`; `setForwardCompatibility` adds the light theme when missing. Without it,
    /// `_setBackwardCompatibility` builds it from the standalone `localStorage` keys `startupPage` and
    /// `refreshInterval` (raw strings, not JSON), which never reach the suite.
    static func settings(_ saved: JSONValue?, local: [String: String], _ report: inout [String: String]) -> Settings {
        guard let obj = saved?.objectValue else {
            let legacyStartup = choice(local["startupPage"], startupPages)
            let legacyRefresh = validRefresh(local["refreshInterval"])
            if saved == nil && (legacyStartup != nil || legacyRefresh != nil) {
                report["settingsInfo"] = "legacy"
                return Settings(startupPage: legacyStartup ?? "0", refreshInterval: legacyRefresh ?? "0")
            }
            report["settingsInfo"] = saved != nil ? "malformed" : report["settingsInfo"] ?? "default"
            return Settings()
        }
        let d = Settings()
        let startup = choice(obj["startupPage"]?.stringValue, startupPages)
        let refresh = validRefresh(obj["refreshInterval"]?.stringValue)
        let theme = choice(obj["theme"]?.stringValue, themes)
        report["settingsInfo"] = startup != nil && refresh != nil && theme != nil ? "migrated" : "partial"
        return Settings(startupPage: startup ?? d.startupPage, refreshInterval: refresh ?? d.refreshInterval,
                        theme: theme ?? d.theme)
    }

    // MARK: - Alerts and alarms

    static func push(_ current: JSONValue?, _ legacy: JSONValue?, _ places: [Place], now: Date, zone: TimeZone,
                     _ report: inout [String: String]) -> PushState {
        if let obj = current?.objectValue {
            let list = obj["pushList"]?.arrayValue
            let records = (list ?? []).compactMap(\.objectValue).filter(validRecord)
            let orphans = records.filter { !places.indices.contains(int32($0["cityIndex"])!) }.count
            report["pushData2"] = list != nil && records.count == list!.count ? "migrated" : "partial"
            report["pushData2.records"] = "\((list?.count ?? 0) - records.count) dropped, \(orphans) orphan"
            return PushState(registrationId: obj["registrationId"]?.stringValue,
                             type: obj["type"]?.stringValue ?? "ios",
                             category: obj["category"]?.stringValue ?? "",
                             fcmToken: obj["fcmToken"]?.stringValue,
                             records: records)
        }
        if current != nil { report["pushData2"] = "malformed" }
        // Push.init: legacy pushData converts only while pushData2 is absent or unparsable (`loadOldPushInfo`).
        guard let old = legacy?.objectValue, let alarms = old["alarmList"]?.arrayValue?.compactMap(\.objectValue) else {
            return PushState()
        }
        report["pushData"] = "legacy"
        let alerts = alarms.map { a -> JSONObject in
            newAlert(id: 1, cityIndex: looseInt(a["cityIndex"]) ?? -1, startHour: 7, endHour: 22,
                     places: places, now: now, zone: zone).setting("enable", .bool(false))
        }
        let converted = alarms.map { a -> JSONObject in
            let cityIndex = looseInt(a["cityIndex"]) ?? -1
            var alarm = a
            alarm["time"] = jsDateISO(a["time"]).map(JSONValue.string) ?? .null
            alarm["category"] = .string("alarm")
            alarm["id"] = .number(cityIndex + 1)
            alarm["enable"] = .bool(true)
            alarm["dayOfWeek"] = .array(Array(repeating: .bool(true), count: 7))
            return alarm
        }
        return PushState(registrationId: old["registrationId"]?.stringValue,
                         type: old["type"]?.stringValue ?? "ios",
                         records: alerts + converted, needsAlertIntro: true)
    }

    /// Kotlin `JsonPrimitive.intOrNull`: a 32-bit integer number, or a string holding one.
    static func looseInt(_ value: JSONValue?) -> Int? {
        if let i = int32(value) { return i }
        if let text = value?.stringValue, let i = Int32(text) { return Int(i) }
        return nil
    }

    /// `newPushAlert(id, cityIndex, startHour, endHour)`: enabled, the hours as local wall times of the migration
    /// day, the city info.
    static func newAlert(id: Int, cityIndex: Int, startHour: Int, endHour: Int, places: [Place], now: Date,
                         zone: TimeZone) -> JSONObject {
        var record = JSONObject([
            ("cityIndex", .number(cityIndex)), ("id", .number(id)),
            ("startTime", .string(secs2date(startHour * 3600, now: now, zone: zone))),
            ("endTime", .string(secs2date(endHour * 3600, now: now, zone: zone))),
            ("enable", .bool(true)), ("category", .string("alert")),
        ])
        if places.indices.contains(cityIndex), let info = simpleCityInfo(places[cityIndex]) {
            for (key, value) in info { record[key] = value }
        }
        return record
    }

    /// `_getSimpleCityInfo`; nil where the Cordova code throws (no location and no town), so the record keeps its
    /// base fields.
    static func simpleCityInfo(_ city: Place) -> JSONObject? {
        var info = JSONObject()
        if let name = city.name { info["name"] = .string(name) }
        if let source = city.source { info["source"] = .string(source) }
        if let loc = city.location, loc.lat != 0 {
            info["location"] = .object(JSONObject([("lat", .number(loc.lat)), ("long", .number(loc.long))]))
        }
        if let source = city.source, JSString.equal(source, "KMA"), let address = city.address {
            let full = JSString.includes(address, "대한민국") ? address : "대한민국 " + address
            let town = town(full.isEmpty ? [] : JSString.split(full, " "))
            if !town.first.isEmpty {
                info["town"] = .object(JSONObject([("first", .string(town.first)), ("second", .string(town.second)),
                                                   ("third", .string(town.third))]))
                if !info.contains("name") {
                    info["name"] = .string(!town.third.isEmpty ? town.third : !town.second.isEmpty ? town.second : town.first)
                }
            }
        }
        return info.contains("location") || info.contains("town") ? info : nil
    }

    /// `WeatherUtil.getTownFromFullAddress` over `convertAddressArray`.
    static func town(_ parts: [String]) -> (first: String, second: String, third: String) {
        func ends(_ s: String, _ suffix: String) -> Bool { JSString.endsWith(s, suffix) }
        switch parts.count {
        case 5: return (parts[1], parts[2] + parts[3], parts[4])
        case 4: return ends(parts[3], "구") ? (parts[1], parts[2] + parts[3], "") : (parts[1], parts[2], parts[3])
        case 3:
            let p = parts[2]
            return ends(p, "읍") || ends(p, "면") || ends(p, "동") ? (parts[1], parts[1], p) : (parts[1], p, "")
        case 2: return (parts[1], "", "")
        default: return ("", "", "")
        }
    }

    // ASCII digits only (CODEX-IN03-2): ICU's `\d` also matches other decimal digits (Arabic-Indic, fullwidth), which
    // Kotlin's (Java's) `\d` in the Android port does not.
    private static let isoInstant = try! NSRegularExpression(
        pattern: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$"#)
    private static let isoLike = try! NSRegularExpression(pattern: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*Z$"#)

    /// A match over the whole text (`NSRegularExpression` works on UTF-16 code units).
    static func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
        regex.firstMatch(in: text, range: NSRange(location: 0, length: text.utf16.count)) != nil
    }

    /// An ISO instant (`Date.toISOString()` form) naming a real date and time: no rollover, hours 0–23.
    static func validInstant(_ text: String) -> Bool {
        guard matches(isoInstant, text) else { return false }
        let n = text.utf8.split(whereSeparator: { $0 < 0x30 || $0 > 0x39 })
            .compactMap { Int(String(decoding: $0, as: UTF8.self)) }
        guard n.count == 6 || n.count == 7 else { return false }
        let (year, month, day, hour, minute, second) = (n[0], n[1], n[2], n[3], n[4], n[5])
        guard year >= 1, (1...12).contains(month), hour <= 23, minute <= 59, second <= 59 else { return false }
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        guard let first = utc.date(from: DateComponents(year: year, month: month, day: 1)),
              let days = utc.range(of: .day, in: .month, for: first) else { return false }
        return days.contains(day)
    }

    /// A record the server can take back: integer `cityIndex` and `id`, boolean `enable`, and for an alert ISO
    /// `startTime`/`endTime`, for an alarm an ISO `time` and seven booleans in `dayOfWeek`; times must name real
    /// dates and times. Other records are dropped. Records whose `cityIndex` names no place are kept (the Cordova
    /// app keeps them too, anomaly A24) and counted.
    static func validRecord(_ r: JSONObject) -> Bool {
        func iso(_ key: String) -> Bool { r[key]?.stringValue.map(validInstant) == true }
        guard int32(r["cityIndex"]) != nil, int32(r["id"]) != nil, r["enable"]?.boolValue != nil,
              let category = r["category"]?.stringValue else {
            return false
        }
        if JSString.equal(category, "alert") { return iso("startTime") && iso("endTime") }
        if JSString.equal(category, "alarm") {
            guard iso("time"), let days = r["dayOfWeek"]?.arrayValue else { return false }
            return days.count == 7 && days.allSatisfy { $0.boolValue != nil }
        }
        return false
    }

    /// `secs2date`: `setHours(0,0,0,0)` then `setSeconds(secs)` on the migration day, which sets local wall time
    /// (07:00 stays 07:00 on daylight-saving days), as an ISO instant.
    public static func secs2date(_ secs: Int, now: Date, zone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        var day = calendar.dateComponents([.year, .month, .day], from: now)
        day.day! += secs / 86_400
        let rest = secs % 86_400
        day.hour = rest / 3600
        day.minute = rest % 3600 / 60
        day.second = rest % 60
        return iso(millis(calendar.date(from: day)!))
    }

    /// `new Date(time).toISOString()` of a legacy alarm time (Kotlin `doubleOrNull?.toLong()` of a number, or an
    /// ISO-like string as it is); nil for anything else and for times outside JavaScript's date range.
    static func jsDateISO(_ value: JSONValue?) -> String? {
        switch value {
        case .number(let n):
            guard n.double.isFinite, abs(n.double) <= 8.64e15 else { return nil }
            return iso(Int64(n.double))
        case .string(let text):
            return matches(isoLike, text) ? text : nil
        default:
            return nil
        }
    }

    static func millis(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded(.down))
    }

    /// `Date.toISOString()` of epoch milliseconds.
    public static func iso(_ millis: Int64) -> String {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let seconds = millis >= 0 ? millis / 1000 : (millis - 999) / 1000
        let ms = Int(millis - seconds * 1000)
        let c = utc.dateComponents([.year, .month, .day, .hour, .minute, .second],
                                   from: Date(timeIntervalSince1970: TimeInterval(seconds)))
        return String(format: "%04ld-%02ld-%02ldT%02ld:%02ld:%02ld.%03ldZ", c.year!, c.month!, c.day!, c.hour!,
                      c.minute!, c.second!, ms)
    }
}
