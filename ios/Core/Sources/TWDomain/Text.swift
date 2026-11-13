import Foundation
import TWModel

/// The three parts of a Korean address (`getTownFromFullAddress`).
public struct Town: Hashable, Sendable {
    public let first: String
    public let second: String
    public let third: String
    public init(_ first: String, _ second: String, _ third: String) {
        self.first = first
        self.second = second
        self.third = third
    }
}

/// Translated LOC_SAME_AS_YESTERDAY and LOC_THAN_YESTERDAY (with one `%s`).
public struct YesterdayText: Hashable, Sendable {
    public let same: String
    public let than: String
    public init(same: String, than: String) {
        self.same = same
        self.than = than
    }
}

extension String {
    /// Kotlin's `replaceFirst(old, new)`: the first occurrence only.
    func replacingFirst(_ target: String, with replacement: String) -> String {
        guard let r = range(of: target, options: .literal) else { return self }
        return replacingCharacters(in: r, with: replacement)
    }
}

/// Korean address helpers of `WeatherUtil` (getShortenAddress, getTownFromFullAddress, convertAddressArray).
public enum AddressFormat {
    public static func split(_ fullAddress: String?) -> [String] {
        guard let fullAddress, !fullAddress.isEmpty else { return [] }
        return fullAddress.components(separatedBy: " ")
    }

    private static let siDo = ["특별시", "광역시", "특별자치시", "특별자치도"]

    /// `_getShortSiDoName`: 서울특별시 → 서울시, 제주특별자치도 → 제주도.
    private static func shortSiDo(_ name: String) -> String {
        for (i, suffix) in siDo.enumerated() where name.hasSuffix(suffix) {
            return name.replacingFirst(suffix, with: i == siDo.count - 1 ? "도" : "시")
        }
        return name
    }

    public static func shorten(_ fullAddress: String?) -> String {
        let p = split(fullAddress)
        switch p.count {
        case 5: return shortSiDo(p[2]) + "," + p[4]
        case 4: return p[1].hasSuffix("도") ? shortSiDo(p[2]) + "," + p[3] : shortSiDo(p[1]) + "," + p[3]
        case 3: return shortSiDo(p[1]) + "," + p[2]
        case 2: return shortSiDo(p[1])
        default: return ""
        }
    }

    public static func town(_ parts: [String]) -> Town {
        switch parts.count {
        case 5: return Town(parts[1], parts[2] + parts[3], parts[4])
        case 4: return parts[3].hasSuffix("구") ? Town(parts[1], parts[2] + parts[3], "") : Town(parts[1], parts[2], parts[3])
        case 3:
            if parts[2].hasSuffix("읍") || parts[2].hasSuffix("면") || parts[2].hasSuffix("동") {
                return Town(parts[1], parts[1], parts[2])
            }
            return Town(parts[1], parts[2], "")
        case 2: return Town(parts[1], "", "")
        default: return Town("", "", "")
        }
    }
}

/// Display texts computed by the Cordova forecast screen (controller.forecastctrl.js) and WeatherUtil.
public enum ForecastText {
    /// `getWeatherEmoji`, used by sharing.
    public static func weatherEmoji(_ skyIcon: String) -> String {
        if skyIcon.contains("lightning") { return "⛈" }
        if skyIcon.contains("rainsnow") { return "☔☃" }
        if skyIcon.contains("rain") { return "☔" }
        if skyIcon.contains("snow") { return "☃" }
        if skyIcon.contains("cloud") { return skyIcon.contains("sun") || skyIcon.contains("moon") ? "⛅" : "☁" }
        if skyIcon.contains("sun") || skyIcon.contains("moon") { return "🌞" }
        return ""
    }

    /// `_diffTodayYesterday`: "어제보다 +3˚" or "어제와 동일"; empty when either temperature is missing.
    /// [currentT1h] nil means the property is absent.
    public static func diffTodayYesterday(_ currentT1h: JSONValue?, _ yesterday: JSONObject?, fahrenheit: Bool,
                                          text: YesterdayText) -> String {
        guard let currentT1h, let yesterday, let yesterdayT1h = yesterday["t1h"] else { return "" }
        let raw = Js.number(currentT1h) - Js.number(yesterdayT1h)
        let diff = fahrenheit ? Js.round(raw) : Js.toFixedNumber(raw, 1)
        if diff == 0 { return text.same }
        let str = (diff > 0 ? "+" : "") + Js.numberToString(diff)
        return text.than.replacingFirst("%s", with: str)
    }

    /// `$scope.getRainSnowFall`: the amount to show, rounded from 10 up, or "0". Keeps the JSON type.
    public static func rainSnowFall(_ value: JSONObject) -> JSONValue {
        for key in ["rn1", "s06", "r06"] {
            let v = value[key]
            if Js.present(v) && Js.greater(v, 0) {
                return Js.greaterOrEqual(v, 10) ? Js.json(Js.round(Js.number(v))) : v!
            }
        }
        return .string("0")
    }

    /// `$scope.getRainSnowFallSymbol`.
    public static func rainSnowFallSymbol(_ value: JSONObject) -> String {
        if Js.greater(value["rn1"], 0) { return Js.looseEquals(value["pty"], 3) ? "snow" : "rain" }
        if Js.greater(value["s06"], 0) { return "snow" }
        return "rain"
    }
}

/// The update time under the current weather (the `updateTime` IIFE in ForecastCtrl.applyWeatherData).
public enum UpdateTime {
    /// nil where the Cordova code returns undefined (no current weather); "" where it catches an error.
    public static func of(_ currentWeather: JSONValue?) -> String? {
        if !Js.truthy(currentWeather) { return nil }
        guard let cw = currentWeather?.objectValue else { return "" }
        let stn = cw["stnDateTime"]
        if Js.truthy(stn) { return Js.string(stn) }
        guard case .string(let d) = cw["date"] else { return "" }  // tmpDate.substr is not a function
        let units = Array(d.utf16)
        func substr(_ start: Int, _ len: Int) -> String {
            if start >= units.count { return "" }
            return String(decoding: units[start..<min(units.count, start + len)], as: UTF16.self)
        }
        return substr(0, 4) + "-" + substr(4, 2) + "-" + substr(6, 2) + " " + Js.string(cw["time"]) + ":00"
    }
}

public enum GeoLocation {
    /// `geolocationNormalize`: three decimals, as the Cordova app sends coordinates.
    public static func normalize(lat: Double, long: Double) -> (lat: Double, long: Double) {
        (Js.toFixedNumber(lat, 3), Js.toFixedNumber(long, 3))
    }
}
