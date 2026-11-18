import Foundation
import TWModel

/// The push records' builders and times of the Cordova `Push` service (`newPushAlert`, `newPushAlarm`,
/// `date2localSecs`; IN-14, #2963; the Android `PushRecords` of AN-14).
public enum PushRecords {
    /// `newPushAlert(id, cityIndex, startHour, endHour)`: enabled, the hours as local wall times of today, the city info.
    public static func newAlert(id: Int, cityIndex: Int, startHour: Double, endHour: Double, places: [Place], now: Date,
                                zone: TimeZone) -> JSONObject {
        record(JSONObject([
            ("cityIndex", .number(cityIndex)), ("id", .number(id)),
            ("startTime", .string(CordovaMigration.secs2date(Int(startHour * 3600), now: now, zone: zone))),
            ("endTime", .string(CordovaMigration.secs2date(Int(endHour * 3600), now: now, zone: zone))),
            ("enable", .bool(true)), ("category", .string("alert")),
        ]), cityIndex: cityIndex, places: places)
    }

    /// `newPushAlarm(id, cityIndex, secs, dayOfWeek)`: enabled, the time as a local wall time of today, the city info.
    public static func newAlarm(id: Int, cityIndex: Int, seconds: Int, days: [Bool], places: [Place], now: Date,
                                zone: TimeZone) -> JSONObject {
        record(JSONObject([
            ("cityIndex", .number(cityIndex)), ("id", .number(id)),
            ("time", .string(CordovaMigration.secs2date(seconds, now: now, zone: zone))), ("dayOfWeek", Self.days(days)),
            ("enable", .bool(true)), ("category", .string("alarm")),
        ]), cityIndex: cityIndex, places: places)
    }

    /// `_getSimpleCityInfo` copied over the base; a city without location or town leaves the base alone (the throw is
    /// caught).
    static func record(_ base: JSONObject, cityIndex: Int, places: [Place]) -> JSONObject {
        guard places.indices.contains(cityIndex), let info = CordovaMigration.simpleCityInfo(places[cityIndex]) else {
            return base
        }
        var out = base
        for (key, value) in info { out[key] = value }
        return out
    }

    public static func days(_ days: [Bool]) -> JSONValue {
        .array(days.map(JSONValue.bool))
    }

    /// `date2localSecs(new Date(iso))`: the local hours and minutes of a stored instant, in seconds; 0 without one.
    public static func localSeconds(_ iso: JSONValue?, zone: TimeZone) -> Int {
        guard let c = components(iso, zone: zone) else { return 0 }
        return c.hour! * 3600 + c.minute! * 60
    }

    /// `getDate()` of a stored instant in `zone`.
    public static func localDayOfMonth(_ iso: JSONValue?, zone: TimeZone) -> Int? {
        components(iso, zone: zone)?.day
    }

    private static func components(_ iso: JSONValue?, zone: TimeZone) -> DateComponents? {
        guard let text = iso?.stringValue, let millis = PushRegistration.isoMillis(text) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let date = Date(timeIntervalSince1970: TimeInterval(millis) / 1000)
        return calendar.dateComponents([.day, .hour, .minute], from: date)
    }

    /// The record's `cityIndex` when it is a number with an integer value.
    public static func cityIndex(_ record: JSONObject) -> Int? {
        integer(record["cityIndex"])
    }

    public static func category(_ record: JSONObject) -> String? {
        record["category"]?.stringValue
    }

    public static func id(_ record: JSONObject) -> Int? {
        integer(record["id"])
    }

    /// `enable` as stored; Cordova tests it with `===` or truthiness, so only `true` counts as on.
    public static func enabled(_ record: JSONObject) -> Bool {
        record["enable"]?.boolValue == true
    }

    private static func integer(_ value: JSONValue?) -> Int? {
        guard let d = value?.numberValue?.double, d.isFinite, d.rounded() == d, abs(d) < 2_147_483_648 else { return nil }
        return Int(d)
    }
}

/// S09 for one place (PushCtrl, controller.push.js; IN-14, #2963; the Android `AlarmSettings` of AN-14): the alert, the
/// alarms and their weekdays as the page holds them, with PushCtrl's rules and anomalies (AN-06):
/// - `load` takes the place's records (the last alert wins, alarms in stored order, the weekdays of the first alarm) and
///   fills what is missing with defaults that count as edits (D34): an enabled 07–22 alert, Mon–Fri, alarms at 07:40 and
///   20:20, with `_generateId`'s ids;
/// - the hour bar reads the alert's local hours, an end of 0 as 24 only when the end's day of the month is later (A23);
/// - Delete in the picker keeps the alarm, disabled; a new alarm takes `_generateId`; the add row shows while fewer than
///   five alarms are enabled;
/// - `equalHours` ignores the switch; `toSave` is nothing without an edit, else the alert with today's hours and every
///   alarm with the shared weekdays.
/// Times are the device's time zone, as the Cordova `Date`s were.
public struct AlarmSettings: Equatable, Sendable {
    public var cityIndex: Int
    public var alert: JSONObject
    public var alarms: [JSONObject]
    public var days: [Bool]
    public var startHour: Double
    public var endHour: Double
    public var updated: Bool

    public static let weekdays = [false, true, true, true, true, true, false]
    /// The alarm defaults (07:40 and 20:20), "smoother than a lunch or commute alarm".
    public static let defaultAlarms = [7 * 3600 + 40 * 60, 20 * 3600 + 20 * 60]

    public init(cityIndex: Int, alert: JSONObject, alarms: [JSONObject], days: [Bool], startHour: Double, endHour: Double,
                updated: Bool) {
        self.cityIndex = cityIndex
        self.alert = alert
        self.alarms = alarms
        self.days = days
        self.startHour = startHour
        self.endHour = endHour
        self.updated = updated
    }

    /// The switch (`ng-true-value="true"`).
    public var alertOn: Bool { PushRecords.enabled(alert) }

    /// The hour bar shows unless the alert is off (`ng-hide="alert.enable === false"`).
    public var barShown: Bool { alert["enable"]?.boolValue != false }

    /// The enabled alarms (`ng-if="value.enable"`): their index in the list and local time in seconds.
    public func rows(zone: TimeZone) -> [(index: Int, seconds: Int)] {
        alarms.enumerated().compactMap { i, a in
            PushRecords.enabled(a) ? (i, PushRecords.localSeconds(a["time"], zone: zone)) : nil
        }
    }

    /// `canMakeNewAlarm`: fewer than five enabled alarms.
    public var canAdd: Bool { alarms.filter(PushRecords.enabled).count < 5 }

    /// The picker's input: the alarm's local time, or 08:00 for the add row.
    public func pickerInput(_ index: Int, zone: TimeZone) -> Int {
        alarms.indices.contains(index) ? PushRecords.localSeconds(alarms[index]["time"], zone: zone) : 8 * 3600
    }

    /// `startTime === endTime`, with the switch on or off.
    public var equalHours: Bool { startHour == endHour }

    public func toggleDay(_ day: Int) -> AlarmSettings {
        var s = self
        if s.days.indices.contains(day) { s.days[day].toggle() }
        s.updated = true
        return s
    }

    public func setAlert(_ on: Bool) -> AlarmSettings {
        var s = self
        s.alert["enable"] = .bool(on)
        s.updated = true
        return s
    }

    public func setHours(from: Double, to: Double) -> AlarmSettings {
        var s = self
        s.startHour = from
        s.endHour = to
        s.updated = true
        return s
    }

    /// The picker's answer for `index` (an alarm, or the add row at the end): nil is Close (no change), 0 is Delete (the
    /// alarm is disabled; the add row only marks an edit), anything else is Set (the alarm's time and `enable`, or a new
    /// alarm with the shared weekdays).
    public func pick(_ index: Int, seconds: Int?, places: [Place], now: Date, zone: TimeZone) -> AlarmSettings {
        guard let seconds else { return self }
        var s = self
        s.updated = true
        if seconds == 0 {
            if alarms.indices.contains(index) { s.alarms[index]["enable"] = .bool(false) }
            return s
        }
        if index >= alarms.count {
            s.alarms.append(PushRecords.newAlarm(id: Self.generateId(alarms, hasAlert: true), cityIndex: cityIndex,
                                                 seconds: seconds, days: days, places: places, now: now, zone: zone))
            return s
        }
        s.alarms[index]["time"] = .string(CordovaMigration.secs2date(seconds, now: now, zone: zone))
        s.alarms[index]["enable"] = .bool(true)
        return s
    }

    /// `_savePushInfo`: nothing without an edit; else the alert with the bar's hours on today and the alarms with the
    /// weekdays.
    public func toSave(now: Date, zone: TimeZone) -> [JSONObject]? {
        guard updated else { return nil }
        var alertCopy = alert
        alertCopy["startTime"] = .string(CordovaMigration.secs2date(Int(startHour * 3600), now: now, zone: zone))
        alertCopy["endTime"] = .string(CordovaMigration.secs2date(Int(endHour * 3600), now: now, zone: zone))
        return [alertCopy] + alarms.map { $0.setting("dayOfWeek", PushRecords.days(days)) }
    }

    /// PushCtrl `init` for `cityIndex`: `_loadPushInfo`, then the defaults.
    public static func load(_ records: [JSONObject], cityIndex: Int, places: [Place], now: Date,
                            zone: TimeZone) -> AlarmSettings {
        var alert: JSONObject?
        var alarms: [JSONObject] = []
        var days: [Bool] = []
        var updated = false
        for record in records where PushRecords.cityIndex(record) == cityIndex {
            switch PushRecords.category(record) {
            case "alert": alert = record
            case "alarm":
                alarms.append(record)
                if days.isEmpty {
                    days = record["dayOfWeek"]?.arrayValue?.map { $0.boolValue == true } ?? []
                }
            default: break
            }
        }
        let theAlert: JSONObject
        if let alert {
            theAlert = alert
        } else {
            theAlert = PushRecords.newAlert(id: generateId(alarms, hasAlert: false), cityIndex: cityIndex, startHour: 7,
                                            endHour: 22, places: places, now: now, zone: zone)
            updated = true
        }
        if days.isEmpty {
            days = weekdays
            updated = true
        }
        if alarms.isEmpty {
            for seconds in defaultAlarms {
                alarms.append(PushRecords.newAlarm(id: generateId(alarms, hasAlert: true), cityIndex: cityIndex,
                                                   seconds: seconds, days: days, places: places, now: now, zone: zone))
            }
            updated = true
        }
        let start = Double(PushRecords.localSeconds(theAlert["startTime"], zone: zone)) / 3600
        var end = Double(PushRecords.localSeconds(theAlert["endTime"], zone: zone)) / 3600
        if end == 0, let endDay = PushRecords.localDayOfMonth(theAlert["endTime"], zone: zone),
           let startDay = PushRecords.localDayOfMonth(theAlert["startTime"], zone: zone), endDay > startDay {
            end = 24
        }
        return AlarmSettings(cityIndex: cityIndex, alert: theAlert, alarms: alarms, days: days, startHour: start,
                             endHour: end, updated: updated)
    }

    /// `_generateId`: the last alarm's id + 1; without alarms 2, or 1 while there is no alert yet.
    public static func generateId(_ alarms: [JSONObject], hasAlert: Bool) -> Int {
        if let last = alarms.last { return (PushRecords.id(last) ?? 0) + 1 }
        return hasAlert ? 2 : 1
    }
}
