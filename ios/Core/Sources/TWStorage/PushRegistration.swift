import Foundation
import TWModel

/// One request to the legacy push API; `path` is relative to the server URL.
public struct PushRequest: Hashable, Sendable {
    public let method: String
    public let path: String
    public let headers: [String: String]
    public let body: JSONValue

    public init(method: String, path: String, headers: [String: String], body: JSONValue) {
        self.method = method
        self.path = path
        self.headers = headers
        self.body = body
    }
}

/// What the Cordova `Push` service (client/www/js/service.push.js) sends after a start on iOS, as pure functions of
/// the stored state (gate G1 of #2948, push part; the Android `PushRegistration` of AN-04).
///
/// `Push.init` loads `pushData2` and repairs the records (`loadPushInfo`); the FCM token callback replaces a changed
/// token on the server (`PUT /push` with `newToken`/`oldToken`) and, for a first token, posts the list; 3 seconds
/// after the start the whole list is posted again (`POST /push-list`) when a token exists. Bodies are built like
/// `_makePostObj`, with `type` `ios` (`Push.init` sets it on iOS whatever was stored). The path version is
/// `/v000903` for every call (#2948). Strings compare by UTF-16 code units, as in the Cordova code.
public enum PushRegistration {
    public struct Context: Sendable {
        /// `Device-Id` and the body's `uuid`: the `CDVUUID` of cordova-plugin-device (`DeviceIdentity`).
        public var deviceId: String
        /// `Accept-Language` of the list post: `Util.language` (`navigator.language`).
        public var language: String
        /// `Util.version`: the app's version.
        public var appVersion: String
        public var units: UnitSettings
        /// The clock and zone of `new Date().getTimezoneOffset()` and of the one-minute-back end time.
        public var now: Date
        public var zone: TimeZone
        public var versionPath: String
        /// `clientConfig.package` of the TodayWeather build.
        public var packageName: String

        public init(deviceId: String, language: String, appVersion: String, units: UnitSettings, now: Date,
                    zone: TimeZone, versionPath: String = "/v000903", packageName: String = "todayWeather") {
            self.deviceId = deviceId
            self.language = language
            self.appVersion = appVersion
            self.units = units
            self.now = now
            self.zone = zone
            self.versionPath = versionPath
            self.packageName = packageName
        }
    }

    public struct Result: Sendable {
        public let requests: [PushRequest]
        /// The push state with the repaired records and the token the Cordova code keeps after these requests.
        public let state: PushState
    }

    /// `Push.platformType`: `ionic.Platform.isIOS()` sets `pushData.type` on every start.
    public static let platformType = "ios"

    /// The app was opened: `token` is the current FCM token, if one is known (the token callback before the 3-second
    /// repost). `repost: false` gives what a token delivered later does (`onTokenRefresh`).
    public static func onStart(_ push: PushState, places: [Place], token: String?, context: Context,
                               repost: Bool = true) -> Result {
        let records = push.records.map { repair($0, places: places) }
        var state = push
        state.records = records
        state.type = platformType
        var requests: [PushRequest] = []
        if let token, accepts(token), !JSString.same(token, state.fcmToken) {
            let first = isFirst(over: state.fcmToken)
            requests.append(replacement(token, over: state.fcmToken, context: context))
            state.fcmToken = token
            if first && !records.isEmpty { requests.append(postList(state, context: context)) }
        }
        if repost, !records.isEmpty, let stored = state.fcmToken, !stored.isEmpty {
            requests.append(postList(state, context: context))
        }
        return Result(requests: requests, state: state)
    }

    /// A token delivered while the app runs (the Cordova token callback after the start): the replacement and, for
    /// a first token, the list; the start's repost does not apply.
    public static func onTokenRefresh(_ push: PushState, places: [Place], token: String, context: Context) -> Result {
        onStart(push, places: places, token: token, context: context, repost: false)
    }

    /// `_updateFcmToken(token)`: `PUT /push` replacing `old` (null when none was stored).
    public static func replacement(_ token: String, over old: String?, context: Context) -> PushRequest {
        PushRequest(method: "PUT", path: context.versionPath + "/push", headers: headers(context, language: false),
                    body: .object(JSONObject([("newToken", .string(token)), ("oldToken", old.map(JSONValue.string) ?? .null)])))
    }

    /// `DELETE /push {fcmToken}`: removes every alarm and alert document of `token` (the legacy route without
    /// `cityIndex` removes all of the token's documents; `_deletePushInfo` sends the same request with a `cityIndex`
    /// when a place is removed). Used by the recovery for tokens the app replaced (CODEX-IN04-12).
    public static func removal(of token: String, context: Context) -> PushRequest {
        PushRequest(method: "DELETE", path: context.versionPath + "/push", headers: headers(context, language: false),
                    body: .object(JSONObject([("fcmToken", .string(token))])))
    }

    /// `_postPushList(pushList)` with a token.
    public static func postList(_ state: PushState, context: Context) -> PushRequest {
        PushRequest(method: "POST", path: context.versionPath + "/push-list", headers: headers(context, language: true),
                    body: .array(state.records.map { .object(postObject($0, state: state, context: context)) }))
    }

    /// The headers of `$http` in `_postPushList` (with `Accept-Language`) and `_updateFcmToken` (without).
    static func headers(_ context: Context, language: Bool) -> [String: String] {
        var h = ["Content-Type": "application/json", "Device-Id": context.deviceId]
        if language { h["Accept-Language"] = context.language }
        return h
    }

    /// A token replacing `old` is a first token (Cordova's `!self.pushData.fcmToken`: null and "" alike); its
    /// replacement is followed by the list post. Every path decides this here, the replay included (CODEX-IN04-9).
    public static func isFirst(over old: String?) -> Bool {
        old?.isEmpty ?? true
    }

    /// The token callback takes `token` (it ignores a blank one). An ignored value is no observation of the token
    /// either: every path decides this here (CODEX-IN04-10).
    public static func accepts(_ token: String?) -> Bool {
        token.map { !isBlank($0) } ?? false
    }

    /// The token callback's test: `typeof token !== 'string' || token.trim().length === 0` ignores the token.
    static func isBlank(_ token: String) -> Bool {
        token.unicodeScalars.allSatisfy(isJSWhiteSpace)
    }

    /// ECMAScript WhiteSpace and LineTerminator, what `String.prototype.trim` removes.
    static func isJSWhiteSpace(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0xFEFF, 0x2028, 0x2029: return true
        default: return s.properties.generalCategory == .spaceSeparator
        }
    }

    // MARK: - loadPushInfo

    /// `loadPushInfo`: a record of the current position (`cityIndex === 0`), and a record whose `location` has no
    /// `lat` (TW-365), take the place's simple info (`_getSimpleCityInfo`); where the Cordova code throws (no place,
    /// no location and no town) the record stays as it is.
    public static func repair(_ record: JSONObject, places: [Place]) -> JSONObject {
        var r = record
        if r["cityIndex"]?.numberValue?.double == 0 { r = applyInfo(r, places: places) }
        if let location = r["location"], truthy(location), location["lat"] == nil || location["lat"]!.isNull {
            r = applyInfo(r, places: places)
        }
        return r
    }

    /// JavaScript truthiness of a JSON value.
    static func truthy(_ v: JSONValue) -> Bool {
        switch v {
        case .null: false
        case .bool(let b): b
        case .number(let n): n.double != 0 && !n.double.isNaN
        case .string(let s): !s.isEmpty
        case .array, .object: true
        }
    }

    /// `for (key in city) pushInfo[key] = city[key]` with `city = {name, source, location?, town?}`: an undefined
    /// name or source removes the member (JSON.stringify drops it); a replaced member keeps its position.
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
    public static func postObject(_ r: JSONObject, state: PushState, context: Context) -> JSONObject {
        var o = JSONObject()
        o["type"] = .string(state.type)
        for key in ["cityIndex", "id", "category", "enable", "name", "location", "town", "source"] {
            if let value = r[key] { o[key] = value }
        }
        var units = JSONObject(UnitSettings.keys.map { ($0, .string(context.units.value($0))) })
        units["airForecastSource"] = "kaq"
        o["units"] = .object(units)
        // new Date().getTimezoneOffset() * -1
        o["timezoneOffset"] = .number(context.zone.secondsFromGMT(for: context.now) / 60)
        o["package"] = .string(context.packageName)
        o["uuid"] = .string(context.deviceId)
        o["appVersion"] = .string(context.appVersion)
        if let id = state.registrationId, !id.isEmpty { o["registrationId"] = .string(id) }
        if let token = state.fcmToken, !token.isEmpty { o["fcmToken"] = .string(token) }
        let category = r["category"]?.stringValue
        if let category, JSString.equal(category, "alarm") {
            o["pushTime"] = utcSecs(jsDate(r["time"]))
            if let days = r["dayOfWeek"] { o["dayOfWeek"] = days }
        } else if let category, JSString.equal(category, "alert") {
            let startTime = jsDate(r["startTime"])
            let endTime = jsDate(r["endTime"])
            let start = utcSecs(startTime)
            var end = utcSecs(endTime)
            if start == end, let ms = endTime {
                end = utcSecs(minuteBack(ms, zone: context.zone))
            }
            o["startTime"] = start
            o["endTime"] = end
            let airUnit = context.units.airUnit
            o["airAlertsBreakPoint"] = .number(airUnit == "airkorea" || airUnit == "airkorea_who" ? 3 : 4)
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

    /// `new Date(value)` of a stored time as epoch milliseconds, for the values the records hold: an ISO instant
    /// (`toISOString` form, as the Cordova app stores dates) or null (epoch 0); nil (an invalid date) otherwise.
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
        let (y, m, d) = (n(0, 4), n(5, 2), n(8, 2))
        var millis = (daysFromCivil(y, m, d) * 86_400 + n(11, 2) * 3600 + n(14, 2) * 60 + n(17, 2)) * 1000
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

    /// `date.setMinutes(date.getMinutes() - 1)` in `zone`: the local wall time one minute earlier, turned back into
    /// an instant with ECMAScript's LocalTime→UTC rule as JavaScriptCore applies it: a repeated local time takes its
    /// earlier instant, a skipped one is read with the offset before the transition. In New York on 2026-11-01,
    /// 06:00Z (01:00 EST) becomes 04:59Z (00:59 EDT).
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
