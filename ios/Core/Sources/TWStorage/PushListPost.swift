import Foundation
import TWModel

/// The push list post of the Cordova `Push` service on iOS (`_postPushList` over `_makePostObj`,
/// client/www/js/service.push.js) as a pure function of the state: what `Push.updateUnits()` sends after a unit change
/// (IN-12, #2961; #1845 in the Cordova app). `Push.init` loaded the stored list and repaired its records
/// (`loadPushInfo`) and set the type to `ios`; `updateUnits` posts that list again with the units now set, when it has
/// records and a token. Strings compare by UTF-16 code units, as in the Cordova code. The path version is `/v000903`
/// (#2948; the Cordova app sent `/v000902`, served by the same handler).
///
/// IN-04 (#2953) builds the same post for its start and token events (`PushRegistration.postList`, not merged when this
/// was written): when both are on master, one implementation stays and both goldens check it.
public enum PushListPost {
    /// What the request needs besides the state.
    public struct Context: Sendable {
        /// `Device-Id` and the body's `uuid`: the `CDVUUID` of cordova-plugin-device (`DeviceIdentity`).
        public var deviceId: String
        /// `Accept-Language`: `Util.language` (`navigator.language` of the WKWebView, `ShellLocale.webLanguage`).
        public var language: String
        /// `Util.version`: the app's version.
        public var appVersion: String
        /// The clock and zone of `new Date().getTimezoneOffset()` and of the one-minute-back end time.
        public var now: Date
        public var zone: TimeZone
        public var versionPath: String
        /// `clientConfig.package` of the TodayWeather build.
        public var packageName: String

        public init(deviceId: String, language: String, appVersion: String, now: Date, zone: TimeZone,
                    versionPath: String = "/v000903", packageName: String = "todayWeather") {
            self.deviceId = deviceId
            self.language = language
            self.appVersion = appVersion
            self.now = now
            self.zone = zone
            self.versionPath = versionPath
            self.packageName = packageName
        }
    }

    /// One request; `path` is relative to the server URL.
    public struct Request: Hashable, Sendable {
        public let method: String
        public let path: String
        public let headers: [String: String]
        public let body: JSONValue
    }

    /// `Push.updateUnits()`: the list post with `state.units`, or nil where the Cordova code sends nothing (no record:
    /// `pushList.length > 0` fails; no token: `_postPushList` stops at "You have to register before post").
    public static func updateUnits(_ state: AppState, context: Context) -> Request? {
        guard !state.push.records.isEmpty, let token = state.push.fcmToken, !token.isEmpty else { return nil }
        let records = state.push.records.map { repair($0, places: state.places) }
        let headers = ["Content-Type": "application/json", "Accept-Language": context.language, "Device-Id": context.deviceId]
        return Request(method: "POST", path: context.versionPath + "/push-list", headers: headers,
                       body: .array(records.map { .object(postObject($0, push: state.push, units: state.units, context: context)) }))
    }

    // MARK: - loadPushInfo

    /// `loadPushInfo`'s repair: a record of the current position (`cityIndex === 0`), and a record whose `location`
    /// has no `lat` (TW-365), take the place's simple info (`_getSimpleCityInfo`); where the Cordova code throws (no
    /// place, no location and no town) the record stays as it is.
    static func repair(_ record: JSONObject, places: [Place]) -> JSONObject {
        var r = record
        if r["cityIndex"]?.numberValue?.double == 0 { r = applyInfo(r, places: places) }
        if let location = r["location"], truthy(location), location["lat"] == nil || location["lat"]!.isNull {
            r = applyInfo(r, places: places)
        }
        return r
    }

    static func truthy(_ v: JSONValue) -> Bool {
        switch v {
        case .null: false
        case .bool(let b): b
        case .number(let n): n.double != 0 && !n.double.isNaN
        case .string(let s): !s.isEmpty
        case .array, .object: true
        }
    }

    /// `for (key in city) pushInfo[key] = city[key]` with `city = {name, source, location?, town?}`: an undefined name
    /// or source removes the member (`JSON.stringify` drops it); a replaced member keeps its position.
    static func applyInfo(_ record: JSONObject, places: [Place]) -> JSONObject {
        guard let index = record["cityIndex"]?.numberValue?.double, index >= 0, index < Double(places.count),
              index.rounded() == index, let info = CordovaMigration.simpleCityInfo(places[Int(index)]) else {
            return record
        }
        var out = record
        for key in ["name", "source"] { out[key] = info[key] }
        for key in ["location", "town"] where info.contains(key) { out[key] = info[key] }
        return out
    }

    // MARK: - _makePostObj

    /// `_makePostObj(pushInfo)`. Members a record lacks are left out, as `JSON.stringify` drops undefined values.
    static func postObject(_ r: JSONObject, push: PushState, units: UnitSettings, context: Context) -> JSONObject {
        var o = JSONObject()
        o["type"] = "ios"
        for key in ["cityIndex", "id", "category", "enable", "name", "location", "town", "source"] {
            if let value = r[key] { o[key] = value }
        }
        var unitValues = JSONObject(UnitSettings.keys.map { ($0, .string(units.value($0))) })
        unitValues["airForecastSource"] = "kaq"
        o["units"] = .object(unitValues)
        // new Date().getTimezoneOffset() * -1
        o["timezoneOffset"] = .number(context.zone.secondsFromGMT(for: context.now) / 60)
        o["package"] = .string(context.packageName)
        o["uuid"] = .string(context.deviceId)
        o["appVersion"] = .string(context.appVersion)
        if let id = push.registrationId, !id.isEmpty { o["registrationId"] = .string(id) }
        if let token = push.fcmToken, !token.isEmpty { o["fcmToken"] = .string(token) }
        let category = r["category"]?.stringValue
        if let category, JSString.equal(category, "alarm") {
            o["pushTime"] = utcSecs(jsDate(r["time"]))
            if let days = r["dayOfWeek"] { o["dayOfWeek"] = days }
        } else if let category, JSString.equal(category, "alert") {
            let endTime = jsDate(r["endTime"])
            let start = utcSecs(jsDate(r["startTime"]))
            var end = utcSecs(endTime)
            if start == end, let ms = endTime { end = utcSecs(minuteBack(ms, zone: context.zone)) }
            o["startTime"] = start
            o["endTime"] = end
            let air = units.airUnit
            o["airAlertsBreakPoint"] = .number(JSString.equal(air, "airkorea") || JSString.equal(air, "airkorea_who") ? 3 : 4)
        }
        return o
    }

    /// `date2utcSecs(date)`: UTC hours and minutes in seconds; an invalid date gives NaN, which JSON writes as null.
    static func utcSecs(_ millis: Int64?) -> JSONValue {
        guard let millis else { return .null }
        let day: Int64 = 86_400_000
        let ms = ((millis % day) + day) % day
        return .number(Int(ms / 3_600_000 * 3600 + ms % 3_600_000 / 60_000 * 60))
    }

    /// `new Date(value)` of a stored time as epoch milliseconds (`loadPushInfo` turns the stored strings into dates):
    /// an ISO instant as the Cordova app stores dates, null (epoch 0) or a number; nil (an invalid date) otherwise.
    static func jsDate(_ value: JSONValue?) -> Int64? {
        switch value {
        case .null: return 0
        case .number(let n): return n.double.isFinite && abs(n.double) <= 8.64e15 ? Int64(n.double) : nil
        case .string(let s): return isoMillis(s)
        default: return nil
        }
    }

    /// Epoch milliseconds of `YYYY-MM-DDTHH:MM:SS(.sss)?Z` naming a real date and time; nil otherwise.
    static func isoMillis(_ text: String) -> Int64? {
        guard CordovaMigration.validInstant(text) else { return nil }
        let u = Array(text.utf8)
        func n(_ from: Int, _ count: Int) -> Int64 {
            u[from..<from + count].reduce(0) { $0 * 10 + Int64($1 - 48) }
        }
        var millis = (daysFromCivil(n(0, 4), n(5, 2), n(8, 2)) * 86_400 + n(11, 2) * 3600 + n(14, 2) * 60 + n(17, 2)) * 1000
        if u.count > 20, u[19] == UInt8(ascii: ".") {
            let digits = u.count - 21
            millis += n(20, digits) * [100, 10, 1][digits - 1]
        }
        return millis
    }

    /// Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant's days_from_civil).
    static func daysFromCivil(_ y0: Int64, _ m: Int64, _ d: Int64) -> Int64 {
        let y = m <= 2 ? y0 - 1 : y0
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    /// `date.setMinutes(date.getMinutes() - 1)` in `zone`: the local wall time one minute earlier, turned back into an
    /// instant with ECMAScript's LocalTime→UTC rule as JavaScriptCore applies it (a repeated local time takes its
    /// earlier instant, a skipped one is read with the offset before the transition).
    static func minuteBack(_ millis: Int64, zone: TimeZone) -> Int64 {
        func offset(_ ms: Int64) -> Int64 {
            Int64(zone.secondsFromGMT(for: Date(timeIntervalSince1970: TimeInterval(ms) / 1000))) * 1000
        }
        let day: Int64 = 86_400_000
        let local = millis + offset(millis) - 60_000
        let before = offset(local - day)
        let after = offset(local + day)
        return offset(local - before) != before && offset(local - after) == after ? local - after : local - before
    }
}
