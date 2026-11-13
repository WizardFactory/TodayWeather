import Foundation
import TWModel

/// One grade band of an air standard: its color, translation key and upper bound per pollutant.
public struct AirGrade: Hashable, Sendable {
    public let color: String
    public let str: String
    public let upperBound: [String: Double]
}

/// An air standard as `setAirUnit` builds it in TabCtrl, plus the chart maxima.
public struct AirStandard: Hashable, Sendable {
    public let grades: [AirGrade]
    public let maxValue: [String: Double]
}

/// Air quality display rules of the Cordova app: `WeatherUtil.aqiStandard`, TabCtrl's `setAirUnit`,
/// `grade2Color`, `airkoreaGrade2Color`, `getSentimentIcon`, and AirCtrl's gauge label and pollutant list
/// (port of Kotlin `AirQuality`). Grades themselves come from the server. ``dustForecast(_:code:)`` and
/// ``hourlyForecast(current:_:)`` port AirCtrl helpers that no template calls; the corpus pins them.
public enum AirQuality {
    public static let pollutants = ["aqi", "pm25", "pm10", "o3", "no2", "co", "so2"]
    private static let codes = ["pm25", "pm10", "o3", "no2", "co", "so2", "aqi"]

    private struct Std {
        let colors: [String]
        let strs: [String]
        let values: [String: [Double]]
        let max: [String: Double]
    }

    private static let koreaColors = ["#32a1ff", "#00c73c", "#fd9b5a", "#ff5959"]
    private static let koreaStrs = ["LOC_GOOD", "LOC_MODERATE", "LOC_UNHEALTHY", "LOC_VERY_UNHEALTHY"]
    private static let sixColors = ["#00c73c", "#d2d211", "#ff6f00", "#FF0000", "#b4004b", "#940021"]
    private static let sixStrs = ["LOC_GOOD", "LOC_MODERATE", "LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS", "LOC_UNHEALTHY",
                                  "LOC_VERY_UNHEALTHY", "LOC_HAZARDOUS"]

    // Values copied from client/www/js/service.weatherutil.js (aqiStandard), including anomaly A17
    // (airnow so2 grade-2 bound 0.75).
    private static let standards: [String: Std] = [
        "airkorea": Std(colors: koreaColors, strs: koreaStrs, values: [
            "pm25": [0, 15, 35, 75, 500], "pm10": [0, 30, 80, 150, 600],
            "o3": [0, 0.03, 0.09, 0.15, 0.6], "no2": [0, 0.03, 0.06, 0.2, 2],
            "co": [0, 2, 9, 15, 50], "so2": [0, 0.02, 0.05, 0.15, 1], "aqi": [0, 50, 100, 250, 500],
        ], max: ["pm25": 100, "pm10": 150, "o3": 0.15, "no2": 0.2, "co": 9, "so2": 0.05, "aqi": 250]),
        "airkorea_who": Std(colors: koreaColors, strs: koreaStrs, values: [
            "pm25": [0, 15, 25, 50, 500], "pm10": [0, 30, 50, 100, 600],
            "o3": [0, 0.03, 0.09, 0.15, 0.6], "no2": [0, 0.03, 0.06, 0.2, 2],
            "co": [0, 2, 9, 15, 50], "so2": [0, 0.02, 0.05, 0.15, 1], "aqi": [0, 50, 100, 250, 500],
        ], max: ["pm25": 100, "pm10": 150, "o3": 0.15, "no2": 0.2, "co": 9, "so2": 0.05, "aqi": 250]),
        "airnow": Std(colors: sixColors, strs: sixStrs, values: [
            "pm25": [0, 12, 35.4, 55.4, 150.4, 250.4, 500.4], "pm10": [0, 54, 154, 254, 354, 424, 604],
            "o3": [0, 0.054, 0.124, 0.164, 0.204, 0.404, 0.604], "no2": [0, 0.053, 0.1, 0.36, 0.649, 1.249, 2.049],
            "co": [0, 4.4, 9.4, 12.4, 15.4, 30.4, 50.4], "so2": [0, 0.035, 0.75, 0.185, 0.304, 0.604, 1.004],
            "aqi": [0, 50, 100, 150, 200, 300, 500],
        ], max: ["pm25": 100, "pm10": 150, "o3": 0.164, "no2": 0.36, "co": 12.4, "so2": 0.185, "aqi": 200]),
        "aqicn": Std(colors: sixColors, strs: sixStrs, values: [
            "pm25": [0, 35, 75, 115, 150, 250, 500], "pm10": [0, 50, 150, 250, 350, 420, 600],
            "o3": [0, 0.075, 0.093, 0.14, 0.187, 0.374, 0.56], "no2": [0, 0.049, 0.097, 0.341, 0.584, 1.14, 1.87],
            "co": [0, 4, 8, 28, 48, 72, 120], "so2": [0, 0.052, 0.175, 0.227, 0.28, 0.56, 0.916],
            "aqi": [0, 50, 100, 150, 200, 300, 500],
        ], max: ["pm25": 100, "pm10": 150, "o3": 0.14, "no2": 0.341, "co": 28, "so2": 0.227, "aqi": 200]),
    ]

    /// `setAirUnit`: nil for an unknown or missing standard (the Cordova code then leaves the scope unset).
    public static func standard(_ airUnit: String?) -> AirStandard? {
        guard let airUnit, let std = standards[airUnit] else { return nil }
        let grades = std.colors.indices.map { i in
            AirGrade(color: std.colors[i], str: std.strs[i],
                     upperBound: Dictionary(uniqueKeysWithValues: codes.map { ($0, std.values[$0]![i + 1]) }))
        }
        return AirStandard(grades: grades, maxValue: std.max)
    }

    /// The grade index (0-based) for a 1-based grade number clamped to the last grade, or nil.
    private static func gradeIndex(_ grade: Double, count: Int) -> Int? {
        var g = grade
        if g > Double(count) { g = Double(count) }
        let i = g - 1
        return i >= 0 && i == i.rounded(.down) && i < Double(count) ? Int(i) : nil
    }

    /// `$scope.grade2Color(grade, defaultColor)`. [grade] nil means undefined.
    public static func gradeColor(_ standard: AirStandard?, _ grade: JSONValue?, _ defaultColor: String?) -> String {
        let color = defaultColor ?? ""
        guard let standard, let grade, !grade.isNull else { return color }
        guard let i = gradeIndex(Js.number(grade), count: standard.grades.count) else { return color }
        return standard.grades[i].color
    }

    /// `$scope.airkoreaGrade2Color(grade)`; nil where the Cordova code yields undefined.
    public static func airkoreaGradeColor(_ grade: JSONValue?) -> String? {
        gradeIndex(Js.number(grade), count: koreaColors.count).map { koreaColors[$0] }
    }

    /// `$scope.getSentimentIcon(grade)`: Material icon code points as HTML entities. Strict equality on numbers.
    public static func sentimentIcon(_ airUnit: String?, _ grade: JSONValue?) -> String {
        guard case .number(let n) = grade else { return "&#xE814;" }
        let korean = airUnit == "airkorea" || airUnit == "airkorea_who"
        let icons: [Double: String] = korean
            ? [1: "&#xE815;", 2: "&#xE812;", 3: "&#xE811;", 4: "&#xE814;"]
            : [1: "&#xE815;", 2: "&#xE812;", 3: "&#xE811;", 4: "&#xE811;", 5: "&#xE7F3;", 6: "&#xE814;"]
        return icons[n.double] ?? "&#xE814;"
    }

    /// `$scope.getLabelPosition(grade, val)`: x of the value label over the grade bands of the gauge, [width] wide,
    /// with a label [labelWidth] wide. 0 where the Cordova code catches an error.
    public static func labelPosition(_ standard: AirStandard?, code: String, grade: Int, value: Double, width: Double,
                                     labelWidth: Double = 52) -> Double {
        guard let standard, grade >= 1, grade <= standard.grades.count else { return 0 }
        let gradeW = width / Double(standard.grades.count) + 2
        var start = 0.0
        if grade >= 2 {
            guard let s = standard.grades[grade - 2].upperBound[code] else { return 0 }
            start = s
        }
        guard let end = standard.grades[grade - 1].upperBound[code] else { return 0 }
        let diff = (value - start) / (end - start)
        var x = gradeW * Double(grade - 1) + diff * gradeW
        x -= labelWidth / 2
        if x < 0 { x = 0 }
        if x > width - labelWidth { x = width - labelWidth }
        return x
    }

    /// `$scope.getAirCodeUnit(code)`.
    public static func codeUnit(_ code: String) -> String {
        switch code {
        case "pm25", "pm10": return "㎍/㎥"
        case "o3", "no2", "co", "so2": return "ppm"
        default: return ""
        }
    }

    /// `_getAQIname`.
    public static func codeName(_ code: String) -> String {
        switch code {
        case "pm25": return "LOC_PM25"
        case "pm10": return "LOC_PM10"
        case "o3": return "LOC_O3"
        case "no2": return "LOC_NO2"
        case "co": return "LOC_CO"
        case "so2": return "LOC_SO2"
        case "aqi": return "LOC_AQI"
        default: return ""
        }
    }

    /// `_getAQIList(airInfo, pollutants)`: the pollutant cards, "-" for a pollutant with no current value.
    public static func pollutantList(_ last: JSONObject, _ pollutants: JSONObject?) -> [JSONValue] {
        AirQuality.pollutants.compactMap { code in
            if let value = last["\(code)Value"] {
                var o = JSONObject()
                o["name"] = .string(codeName(code))
                o["value"] = value
                if let g = last["\(code)Grade"] { o["grade"] = g }
                if let s = last["\(code)Str"] { o["str"] = s }
                o["code"] = .string(code)
                return .object(o)
            }
            if let pollutants, pollutants.contains(code) {
                return .object(JSONObject([("name", .string(codeName(code))), ("code", .string(code)), ("value", "-")]))
            }
            return nil
        }
    }

    /// `_getDustForecast(days)` for the selected pollutant [code]; nil where the Cordova code fails.
    public static func dustForecast(_ days: JSONValue?, code: String) -> [JSONValue]? {
        guard case .array(let list) = days else { return nil }
        if list.contains(where: \.isNull) { return nil }
        return list.compactMap { day -> JSONValue? in
            guard case .object(let d) = day else { return nil }
            if !Js.greaterOrEqual(d["fromToday"], 0) || !d.contains("dustForecast") { return nil }
            var obj = d
            if case .object(let forecast) = d["dustForecast"] {
                for (key, value) in forecast where key.contains(code) {
                    if key.contains("Grade") {
                        obj = obj.setting("grade", value)
                    } else if key.contains("Str") {
                        obj = obj.setting("str", value)
                    }
                }
            }
            return obj.contains("grade") ? .object(obj) : nil
        }
    }

    /// `_getHourlyForecast(current, hourlyList)`: rows after [current], each with its hour as `time`.
    public static func hourlyForecast(current: String, _ hourly: JSONValue?) -> [JSONValue]? {
        guard case .array(let list) = hourly else { return nil }
        if list.contains(where: \.isNull) { return nil }
        return list.compactMap { row -> JSONValue? in
            guard case .object(let o) = row, case .string(let date) = o["date"], Js.stringGreater(date, current) else { return nil }
            let units = Array(date.utf16)
            let from = min(11, units.count), to = min(13, units.count)
            let hour = parseIntPrefix(String(decoding: units[from..<to], as: UTF16.self))
            return .object(o.setting("time", hour.map { .number($0) } ?? .null))
        }
    }

    /// `parseInt` of a short string: optional white space and sign, then digits; nil for NaN.
    private static func parseIntPrefix(_ s: String) -> Int? {
        var chars = Substring(s)
        while let c = chars.first, c.isWhitespace { chars.removeFirst() }
        var sign = ""
        if let c = chars.first, c == "+" || c == "-" {
            sign = String(c)
            chars.removeFirst()
        }
        let digits = chars.prefix { $0.isASCII && $0.isNumber }
        return digits.isEmpty ? nil : Int(sign + digits)
    }
}
