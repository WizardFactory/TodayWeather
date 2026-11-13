import Foundation

/*
 * Models of the legacy-server responses the app reads, and of the converted place weather (port of
 * android/core-model Models.kt).
 *
 * Each model is a typed view over the JSON object it came from. The Cordova app passes these objects through
 * without validation, so the views keep the raw value: `raw(key)` is nil when the key is absent, `.null` when it
 * is null, and a string or number exactly as served (sentinels such as -50 and numbers sent as strings included).
 * The typed accessors return nil when a value is absent, null or not a number; screens that must show the raw
 * text use `raw`.
 */

/// A typed view over one JSON object.
public protocol JSONView: Hashable, Sendable {
    var json: JSONObject { get }
    init(json: JSONObject)
}

extension JSONView {
    public func raw(_ key: String) -> JSONValue? { json[key] }
    public func has(_ key: String) -> Bool { json.contains(key) }

    /// A number, or a string holding one (trimmed, as Kotlin's `toDoubleOrNull`); nil otherwise.
    public func num(_ key: String) -> Double? {
        switch json[key] {
        case .number(let n): return n.double
        case .string(let s): return JSONViewNumber.parse(s.trimmingCharacters(in: .whitespacesAndNewlines))
        default: return nil
        }
    }

    /// The content of a string, number or boolean; nil when absent, null or a container.
    public func str(_ key: String) -> String? {
        switch json[key] {
        case .string(let s): return s
        case .number(let n): return n.text
        case .bool(let b): return b ? "true" : "false"
        default: return nil
        }
    }

    public func obj(_ key: String) -> JSONObject? { json[key]?.objectValue }

    public func list<T>(_ key: String, _ make: (JSONObject) -> T) -> [T] {
        (json[key]?.arrayValue ?? []).compactMap { $0.objectValue.map(make) }
    }
}

/// Kotlin's `String.toDoubleOrNull` for the forms the server sends (decimal numbers with an optional exponent).
enum JSONViewNumber {
    static func parse(_ s: String) -> Double? {
        guard !s.isEmpty, s.unicodeScalars.allSatisfy({ "0123456789+-.eE".unicodeScalars.contains($0) }) else {
            return ["NaN": Double.nan, "Infinity": .infinity, "+Infinity": .infinity, "-Infinity": -.infinity][s]
        }
        return Double(s)
    }
}

/// `location` of a place: Cordova order `{lat, long}`.
public struct GeoPoint: JSONView {
    public let json: JSONObject
    public init(json: JSONObject) { self.json = json }
    public var lat: Double? { num("lat") }
    public var long: Double? { num("long") }
}

/// The fields every forecast row shares: one row of the short-term (hourly) forecast; KMA every 3 hours,
/// overseas every hour or 3 hours.
public protocol WeatherPointFields: JSONView {}

extension WeatherPointFields {
    public var date: String? { str("date") }
    public var time: String? { str("time") }
    public var fromToday: Double? { num("fromToday") }
    public var skyIcon: String? { str("skyIcon") }
    public var t1h: Double? { num("t1h") }
    public var t3h: Double? { num("t3h") }
    public var pop: Double? { num("pop") }
    public var pty: Double? { num("pty") }
    public var rn1: Double? { num("rn1") }
    public var r06: Double? { num("r06") }
    public var s06: Double? { num("s06") }
    public var reh: Double? { num("reh") }
    public var wsd: Double? { num("wsd") }
    public var wdd: String? { str("wdd") }
    public var currentIndex: JSONValue? { raw("currentIndex") }
}

/// One row of the short-term (hourly) forecast.
public struct WeatherPoint: WeatherPointFields {
    public let json: JSONObject
    public init(json: JSONObject) { self.json = json }
}

/// One day of the mid-term (daily) forecast.
public struct DailyForecast: WeatherPointFields {
    public let json: JSONObject
    public init(json: JSONObject) { self.json = json }
    public var skyAm: String? { str("skyAm") }
    public var skyPm: String? { str("skyPm") }
    public var tmn: Double? { num("tmn") }
    public var tmx: Double? { num("tmx") }
    public var index: Double? { num("index") }
    public var ultrv: Double? { num("ultrv") }
    public var ultrvGrade: Double? { num("ultrvGrade") }
    public var ultrvStr: String? { str("ultrvStr") }
    public var sunrise: String? { str("sunrise") }
    public var sunset: String? { str("sunset") }
    public var dustForecast: JSONObject? { obj("dustForecast") }
}

/// Air measurements of one station (`airInfo.last`, `currentWeather.arpltn`, nationwide `air[]`).
public struct AirMeasurement: JSONView {
    public let json: JSONObject
    public init(json: JSONObject) { self.json = json }
    public var stationName: String? { str("stationName") }
    public var dataTime: String? { str("dataTime") }
    public func value(_ code: String) -> JSONValue? { raw(code + "Value") }
    public func grade(_ code: String) -> Double? { num(code + "Grade") }
    public func text(_ code: String) -> String? { str(code + "Str") }
}

/// One station of `airInfoList` (or the overseas `airInfo`).
public struct AirStation: JSONView {
    public let json: JSONObject
    public init(json: JSONObject) { self.json = json }
    public var last: AirMeasurement? { obj("last").map(AirMeasurement.init(json:)) }
    public var pollutants: JSONObject? { obj("pollutants") }
    public var forecastPubDate: String? { str("forecastPubDate") }
    public var forecastSource: String? { str("forecastSource") }
}

/// `currentWeather` of a converted place.
public struct CurrentWeather: WeatherPointFields {
    public let json: JSONObject
    public init(json: JSONObject) { self.json = json }
    public var today: DailyForecast? { obj("today").map(DailyForecast.init(json:)) }
    public var yesterday: WeatherPoint? { obj("yesterday").map(WeatherPoint.init(json:)) }
    public var arpltn: AirMeasurement? { obj("arpltn").map(AirMeasurement.init(json:)) }
    public var summary: String? { str("summary") }
    public var summaryWeather: String? { str("summaryWeather") }
    public var summaryAir: String? { str("summaryAir") }
    public var stnDateTime: String? { str("stnDateTime") }
    public var sensorytem: Double? { num("sensorytem") }
    public var dspls: Double? { num("dspls") }
    public var hPa: Double? { num("hPa") }
    public var visibility: Double? { num("visibility") }
}

/// A `timeChart` series: "yesterday" or "today".
public struct ChartSeries: JSONView {
    public let json: JSONObject
    public init(json: JSONObject) { self.json = json }
    public var name: String? { str("name") }
    public var values: [WeatherPoint] { list("values") { WeatherPoint(json: $0["value"]?.objectValue ?? JSONObject()) } }
    public var currentIndex: Double? { num("currentIndex") }
    public var displayItemCount: Double? { num("displayItemCount") }
}

/// Converted weather of one place, as `WeatherUtil.convertWeatherData` returns it.
public struct PlaceWeather: JSONView {
    public let json: JSONObject
    public init(json: JSONObject) { self.json = json }
    public var source: String? { str("source") }
    public var name: String? { str("name") }
    public var address: String? { str("address") }
    public var country: String? { str("country") }
    public var location: GeoPoint? { obj("location").map(GeoPoint.init(json:)) }
    public var currentWeather: CurrentWeather? { obj("currentWeather").map(CurrentWeather.init(json:)) }
    public var timeTable: [WeatherPoint] { list("timeTable", WeatherPoint.init(json:)) }
    public var timeChart: [ChartSeries] { list("timeChart", ChartSeries.init(json:)) }
    private var firstDayChart: JSONObject? { json["dayChart"]?.arrayValue?.first?.objectValue }
    public var dayTable: [DailyForecast] {
        (firstDayChart?["values"]?.arrayValue ?? []).compactMap { $0.objectValue.map(DailyForecast.init(json:)) }
    }
    public var dayDisplayItemCount: Double? { firstDayChart?["displayItemCount"]?.numberValue?.double }
    public var airStations: [AirStation] {
        let list = list("airInfoList", AirStation.init(json:))
        if !list.isEmpty { return list }
        return obj("airInfo").map { [AirStation(json: $0)] } ?? []
    }
}

/// One city of `/v000903/nation/KR` `weather[]`.
public struct NationCityWeather: JSONView {
    public let json: JSONObject
    public init(json: JSONObject) { self.json = json }
    public var regionName: String? { str("regionName") }
    public var cityName: String? { str("cityName") }
    public var townName: String? { str("townName") }
    public var current: WeatherPoint? { obj("current").map(WeatherPoint.init(json:)) }
}

/// `/v000903/nation/KR`: nationwide weather and air.
public struct NationResponse: JSONView {
    public let json: JSONObject
    public init(json: JSONObject) { self.json = json }
    public var weather: [NationCityWeather] { list("weather", NationCityWeather.init(json:)) }
    public var air: [AirMeasurement] { list("air", AirMeasurement.init(json:)) }
}

/// One bulletin of `/v000903/kma/special`.
public struct WeatherWarning: JSONView {
    public let json: JSONObject
    public init(json: JSONObject) { self.json = json }
    public var announcement: String? { str("announcement") }
    public var type: Double? { num("type") }
    public var comment: String? { str("comment") }
    public var bulletin: JSONObject? { obj("bulletin") }
    public var situationList: [JSONValue]? { json["situationList"]?.arrayValue }
}

/// `/v000903/geocode/coord`: address and name of a position.
public struct GeocodeResponse: JSONView {
    public let json: JSONObject
    public init(json: JSONObject) { self.json = json }
    public var address: String? { str("address") }
    public var name: String? { str("name") }
    public var country: String? { str("country") }
    public var location: GeoPoint? { obj("location").map(GeoPoint.init(json:)) }
}
