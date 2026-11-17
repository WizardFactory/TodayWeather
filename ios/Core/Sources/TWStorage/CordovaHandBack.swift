import Foundation
import TWModel

/// The rollback hand-back (IN-17, #2966; the Android `CordovaHandBack` of AN-17): what a fallback Cordova build, shipped
/// with a higher version when the native release must be rolled back, reads of the state the user left in the native
/// app. The native app writes it into the App Group suite (`CordovaMigration.suiteName`) after every saved state and
/// every write of the analytics choice (`HandBackWriter`); the fallback build's `TwStorage.init` prefers it over its stale
/// WebView storage when the marker says so (`client/www/js/service.storage.js`, `_handBack`).
///
/// Contract, schema 1: `marker` holds `{"schema":1,"generation":N,"writer":"native"|"cordova","complete":true,"keys":[…]}`;
/// each of `keys` holds the text the Cordova app itself writes (`TwStorage.set`'s JSON, the consent as `Monetization`
/// stores it), as a string, which cordova-plugin-app-preferences stores as an `NSString` and its `fetch` returns
/// unchanged; or it is absent when the state has none, so a deleted place or alarm cannot come back. `generation` grows by
/// one at each hand-over; the fallback build claims the state with `writer: cordova`, after which the native start
/// migrates the Cordova storage again (`cordovaClaim`, `MigrationRunner`).
public enum CordovaHandBack {
    /// The marker's suite key: the leading `_` keeps it out of the migration's suite read and Cordova's restore list.
    public static let marker = "_twHandBack"
    public static let schema = 1
    public static let native = "native"
    public static let cordova = "cordova"

    /// `Monetization`'s consent key, which the Cordova app keeps in WebView storage and mirrors into the suite.
    public static let consentKey = "twAnalyticsConsentV1"

    /// The keys a hand-back owns, in the order the writer writes them; `pushData` (legacy alarms, converted into
    /// `pushData2`) is always removed.
    public static let keys = ["cities", "cityIndex", "cityList", "units", "settingsInfo", "pushData2", "pushData",
                              "expandShortChart", "startVersion", "appVersion", "disableUpdateInfo", consentKey]

    /// The weather caches `createCity` leaves empty; the native app does not keep them (`CordovaMigration`).
    static let emptyCaches = ["currentWeather", "timeTable", "timeChart", "dayTable", "dayChart"]

    /// The Cordova text of each of `keys` for `state` and the stored analytics choice `consent` (`"true"`, `"false"`
    /// or none), in the order of `keys`; nil removes the key.
    public static func texts(_ state: AppState, consent: String?) -> [(key: String, text: String?)] {
        let cities = state.places.map(city)
        let settings = JSONObject([("startupPage", .string(state.settings.startupPage)),
                                   ("refreshInterval", .string(state.settings.refreshInterval)),
                                   ("theme", .string(state.settings.theme))])
        // `Units.loadUnits` assigns the members in this order, so `TwStorage.set("units", Units)` writes them so.
        let units = JSONObject(UnitSettings.keys.map { ($0, .string(state.units.value($0))) })
        func extra(_ key: String) -> String? { state.cordovaExtras[key]?.jsonText }
        return [
            ("cities", JSONValue.array(cities.map(JSONValue.object)).jsonText),
            ("cityIndex", String(state.placeIndex)),
            ("cityList", JSONValue.object(cityList(cities)).jsonText),
            ("units", JSONValue.object(units).jsonText),
            ("settingsInfo", JSONValue.object(settings).jsonText),
            ("pushData2", JSONValue.object(pushData2(state.push)).jsonText),
            ("pushData", nil),
            ("expandShortChart", state.expandShortChart ? "true" : "false"),
            ("startVersion", extra("startVersion")),
            ("appVersion", extra("appVersion")),
            ("disableUpdateInfo", extra("disableUpdateInfo")),
            (consentKey, consent == "true" || consent == "false" ? consent : nil),
        ]
    }

    /// A city record as the Cordova app keeps it: the record it had (`Place.cordova`) with the caches empty, and the
    /// native fields over it; a field the native app has no value for keeps the record's key empty, or stays absent.
    static func city(_ place: Place) -> JSONObject {
        var out = place.cordova ?? JSONObject()
        for key in emptyCaches { out[key] = .null }
        func put(_ key: String, _ value: JSONValue?) {
            if let value { out[key] = value } else if out.contains(key) { out[key] = .null }
        }
        put("currentPosition", .bool(place.currentPosition))
        put("disable", .bool(place.disable))
        put("name", place.name.map(JSONValue.string))
        put("address", place.address.map(JSONValue.string))
        put("country", place.country.map(JSONValue.string))
        put("location", place.location.map {
            .object(JSONObject([("lat", .number($0.lat)), ("long", .number($0.long))]))
        })
        put("source", place.source.map(JSONValue.string))
        put("photo", place.photo.map(JSONValue.string))
        return out
    }

    /// `WeatherInfo._saveCitiesPreference`: the enabled places' summary with their index. A member the city lacks is
    /// left out, as `JSON.stringify` leaves out `undefined`.
    static func cityList(_ cities: [JSONObject]) -> JSONObject {
        var list: [JSONValue] = []
        for (index, city) in cities.enumerated() where !truthy(city["disable"]) {
            var info = JSONObject()
            if truthy(city["name"]), let name = city["name"] { info["name"] = name }
            for key in ["currentPosition", "address", "location", "country"] {
                if let value = city[key] { info[key] = value }
            }
            info["index"] = .number(index)
            list.append(.object(info))
        }
        return JSONObject([("cityList", .array(list))])
    }

    /// JavaScript truthiness of a member (`if (city.name)`, `!city.disable`); an absent member is falsy.
    static func truthy(_ value: JSONValue?) -> Bool {
        switch value {
        case nil, .null?: false
        case .bool(let b)?: b
        case .number(let n)?: n.double != 0 && !n.double.isNaN
        case .string(let s)?: !s.isEmpty
        case .array?, .object?: true
        }
    }

    /// `Push.pushData` as `savePushInfo` stores it.
    static func pushData2(_ push: PushState) -> JSONObject {
        JSONObject([("registrationId", push.registrationId.map(JSONValue.string) ?? .null),
                    ("type", .string(push.type)), ("category", .string(push.category)),
                    ("fcmToken", push.fcmToken.map(JSONValue.string) ?? .null),
                    ("pushList", .array(push.records.map(JSONValue.object)))])
    }

    public struct Marker: Equatable, Sendable {
        public var schema: Int
        public var generation: Int
        public var writer: String
        public var complete: Bool
        public var keys: [String]

        public init(schema: Int, generation: Int, writer: String, complete: Bool, keys: [String]) {
            self.schema = schema
            self.generation = generation
            self.writer = writer
            self.complete = complete
            self.keys = keys
        }
    }

    /// The marker text of a hand-over by `writer` as `generation`, naming `keys`. `complete: false` marks a hand-back
    /// being written (`HandBackWriter`): the fallback build ignores it, as it ignores any incomplete marker.
    public static func markerText(generation: Int, writer: String, complete: Bool = true) -> String {
        JSONValue.object(JSONObject([("schema", .number(schema)), ("generation", .number(generation)),
                                     ("writer", .string(writer)), ("complete", .bool(complete)),
                                     ("keys", .array(keys.map(JSONValue.string)))])).jsonText
    }

    /// The marker in `text`, or nil when it is not one (unreadable, or a member missing or of another type).
    public static func parse(_ text: String?) -> Marker? {
        guard let text, let object = (try? JSONValue.parse(text))?.objectValue,
              let schema = CordovaMigration.int32(object["schema"]),
              let generation = CordovaMigration.int32(object["generation"]),
              let writer = object["writer"]?.stringValue, let complete = object["complete"]?.boolValue,
              let list = object["keys"]?.arrayValue else { return nil }
        return Marker(schema: schema, generation: generation, writer: writer, complete: complete,
                      keys: list.compactMap(\.stringValue))
    }

    /// The generation of the next hand-over after the stored marker `text`: one more, or 1 without a readable one.
    public static func nextGeneration(_ text: String?) -> Int { (parse(text)?.generation ?? 0) + 1 }

    /// The fallback build's complete schema-1 claim in `text`, or nil.
    public static func cordovaClaim(_ text: String?) -> Marker? {
        guard let marker = parse(text), marker.schema == schema, marker.complete,
              JSString.equal(marker.writer, cordova) else { return nil }
        return marker
    }
}
