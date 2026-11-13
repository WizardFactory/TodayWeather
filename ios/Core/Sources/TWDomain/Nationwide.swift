import Foundation
import TWModel

/// A city label on the nationwide maps: name and position in points on the 330×485 map.
public struct MapLabel: Hashable, Sendable {
    public let name: String
    public let top: Int
    public let left: Int
    public init(_ name: String, _ top: Int, _ left: Int) {
        self.name = name
        self.top = top
        self.left = left
    }
}

/// Nationwide weather (S10, NationCtrl) and air (S11, NationAirCtrl); port of Kotlin `Nationwide`.
public enum Nationwide {
    public static let weatherCities = [
        MapLabel("서울", 60, 100), MapLabel("춘천", 20, 160), MapLabel("강릉", 40, 230), MapLabel("대전", 155, 90),
        MapLabel("청주", 130, 164), MapLabel("전주", 240, 78), MapLabel("광주", 322, 74), MapLabel("대구", 220, 190),
        MapLabel("부산", 300, 230), MapLabel("제주", 420, 60), MapLabel("인천", 70, 36), MapLabel("목포", 360, 0),
        MapLabel("여수", 320, 135), MapLabel("안동", 130, 225), MapLabel("울산", 220, 270),
    ]
    public static let airCities = [
        MapLabel("서울", 90, 72), MapLabel("부산", 300, 210), MapLabel("대구", 240, 190), MapLabel("인천", 70, 14),
        MapLabel("광주", 322, 78), MapLabel("대전", 220, 110), MapLabel("울산", 260, 270), MapLabel("제주", 420, 60),
        MapLabel("경기", 80, 130), MapLabel("강원", 40, 200), MapLabel("충북", 140, 150), MapLabel("충남", 180, 24),
        MapLabel("전북", 240, 50), MapLabel("전남", 340, 16), MapLabel("경북", 180, 225), MapLabel("경남", 320, 150),
        MapLabel("세종", 170, 90),
    ]
    public static let airTypes = ["pm2.5", "pm10", "o3", "no2", "so2", "co"]

    /// The label background without a grade: `.nation-label` in the stylesheet and `grade2Color`'s fallback.
    public static let noGrade = "rgba(0, 0, 0, 0.4)"

    /// The weather map's modes in the Cordova order (`changeWeatherType(0…2)`).
    public enum Mode: Int, CaseIterable, Sendable { case skyTemperature, rain, wind }

    public struct WeatherLabel: Hashable, Sendable {
        public let icon: String?
        public let text1: JSONValue?
        public let text2: JSONValue?
    }

    /// NationCtrl `getIcon`/`getText1`/`getText2` for the first city whose region/city/town contains [name].
    public static func weatherLabel(_ nation: NationResponse, mode: Mode, name: String) -> WeatherLabel {
        let city = nation.weather.first { c in
            ["regionName", "cityName", "townName"].map { Js.string(c.raw($0)) }.joined(separator: "/").contains(name)
        }
        guard let current = city?.current else { return WeatherLabel(icon: nil, text1: nil, text2: nil) }
        switch mode {
        case .skyTemperature: return WeatherLabel(icon: current.skyIcon, text1: current.raw("t1h"), text2: nil)
        case .rain: return WeatherLabel(icon: current.skyIcon, text1: current.raw("rn1"), text2: nil)
        case .wind: return WeatherLabel(icon: nil, text1: current.raw("wdd"), text2: current.raw("wsd"))
        }
    }

    /// The unit next to text1 (precipitation in rain mode) and text2 (wind speed in wind mode).
    public static func unitKeys(_ mode: Mode) -> (String?, String?) {
        switch mode {
        case .rain: return ("precipitationUnit", nil)
        case .wind: return (nil, "windSpeedUnit")
        case .skyTemperature: return (nil, nil)
        }
    }

    private static func airKey(_ type: String) -> String { type == "pm2.5" ? "pm25" : type }

    private static func province(_ nation: NationResponse, _ name: String) -> AirMeasurement? {
        nation.air.first { m in
            switch m.raw("sidoName") {
            case .string(let s): return s == name
            case .number(let n): return n.text == name
            case .bool(let b): return (b ? "true" : "false") == name
            default: return false
            }
        }
    }

    /// NationAirCtrl `getText1`: the value of [type] for the province [name].
    public static func airValue(_ nation: NationResponse, type: String, name: String) -> JSONValue? {
        province(nation, name)?.value(airKey(type))
    }

    /// NationAirCtrl `grade2Color`: the grade color at 0.8 alpha, or translucent black without data.
    public static func airColor(_ nation: NationResponse, type: String, name: String, airUnit: String?) -> String {
        guard let city = province(nation, name), let grade = city.raw(airKey(type) + "Grade"),
              let standard = AirQuality.standard(airUnit) else { return noGrade }
        let i = Js.number(grade) - 1
        if !(i >= 0) || i != i.rounded(.down) || i >= Double(standard.grades.count) { return noGrade }
        let rgb = Array(standard.grades[Int(i)].color.utf8)
        func channel(_ from: Int) -> Int { Int(String(decoding: rgb[from..<from + 2], as: UTF8.self), radix: 16)! }
        return "rgba(\(channel(1)),\(channel(3)),\(channel(5)),0.8)"
    }
}
