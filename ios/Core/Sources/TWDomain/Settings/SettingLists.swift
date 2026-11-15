import Foundation
import TWModel

/// A choice of an S08 list: its `label` (a catalog key, or a text the translate filter shows as it is, such as "mph")
/// and the stored `value`.
public struct SettingChoice: Equatable, Sendable {
    public let label: String
    public let value: String

    public init(label: String, value: String) {
        self.label = label
        self.value = value
    }
}

/// An S08 list (`radioList`): the setting it changes, the key of its title and its choices.
public struct SettingList: Equatable, Sendable {
    public let name: String
    public let title: String
    public let choices: [SettingChoice]

    /// A unit (S07 opens it) rather than one of the menu's settings.
    public var isUnit: Bool { SettingLists.units.contains(name) }
}

/// The lists and labels of the settings pages S07 and S08 (IN-12, #2961) as the Cordova app has them for the
/// todayWeather package: controller.units.js (`Units.getSelectList`, `UnitsCtrl.getUnitNameStr`, `getUnitValueStr`) and
/// controller.settingctrl.js (`settingRadio` and the menu's values). Labels are catalog keys or texts that the translate
/// filter shows as they are. Port of the Android `SettingLists` (AN-12).
public enum SettingLists {
    /// The units in the order of S07 (`Units.getAllUnits`).
    public static let units = ["temperatureUnit", "windSpeedUnit", "pressureUnit", "distanceUnit", "precipitationUnit", "airUnit"]

    /// The menu's lists (`settingRadio`).
    public static let settings = ["startupPage", "refreshInterval", "theme"]

    /// `getUnitNameStr`: a unit's row on S07 and the title of its list; "" for no unit.
    public static func unitName(_ name: String) -> String {
        switch Array(name.utf16) {
        case Array("temperatureUnit".utf16): "LOC_TEMPERATURE_UNIT"
        case Array("windSpeedUnit".utf16): "LOC_WIND_SPEED_UNIT"
        case Array("pressureUnit".utf16): "LOC_PRESSURE_UNIT"
        case Array("distanceUnit".utf16): "LOC_DISTANCE_UNIT"
        case Array("precipitationUnit".utf16): "LOC_PRECIPITATION"
        case Array("airUnit".utf16): "LOC_AIR_QUALITY_INDEX_UNIT"
        default: ""
        }
    }

    /// `getUnitValueStr`: what S07 shows for a unit's `value`; nil (nothing shown) for an air standard without a name.
    public static func unitValue(_ name: String, _ value: String) -> String? {
        if JSString.equal(name, "airUnit") { return ForecastFormat.airUnitKey(value) }
        switch Array(value.utf16) {
        case Array("kt".utf16): return "knotes"
        case Array("bft".utf16): return "beaufort"
        case Array("mb".utf16): return "mbar"
        case Array("mi".utf16): return "miles"
        case Array("in".utf16): return "inches"
        default: return value
        }
    }

    /// `Units.getSelectList`: the choices of a unit's list, in the Cordova order.
    public static func unitChoices(_ name: String) -> [SettingChoice] {
        func c(_ label: String, _ value: String) -> SettingChoice { SettingChoice(label: label, value: value) }
        switch Array(name.utf16) {
        case Array("temperatureUnit".utf16): return [c("C", "C"), c("F", "F")]
        case Array("windSpeedUnit".utf16): return [c("mph", "mph"), c("km/h", "km/h"), c("m/s", "m/s"), c("beaufort", "bft"), c("knotes", "kt")]
        case Array("pressureUnit".utf16): return [c("mmHg", "mmHg"), c("inHg", "inHg"), c("mbar", "mb"), c("hPa", "hPa")]
        case Array("distanceUnit".utf16): return [c("km", "km"), c("miles", "mi")]
        case Array("precipitationUnit".utf16): return [c("mm", "mm"), c("inch", "in")]
        case Array("airUnit".utf16):
            return ["airnow", "aqicn", "airkorea", "airkorea_who"].map { c(ForecastFormat.airUnitKey($0) ?? $0, $0) }
        default: return []
        }
    }

    /// The list S08 shows for `name`: a unit (from S07) or one of the menu's settings.
    public static func list(_ name: String) -> SettingList {
        switch Array(name.utf16) {
        case Array("startupPage".utf16):
            return SettingList(name: name, title: "LOC_STARTUP_PAGE",
                               choices: StartupPage.values.map { SettingChoice(label: StartupPage.textKey($0), value: $0) })
        case Array("refreshInterval".utf16):
            return SettingList(name: name, title: "LOC_REFRESH_INTERVAL",
                               choices: RefreshInterval.values.map { SettingChoice(label: RefreshInterval.textKey($0), value: $0) })
        case Array("theme".utf16):
            return SettingList(name: name, title: "LOC_THEME_SETTING",
                               choices: Theme.allCases.map { SettingChoice(label: $0.textKey, value: $0.key) })
        default:
            return SettingList(name: name, title: unitName(name), choices: unitChoices(name))
        }
    }

    /// The catalog keys of the settings pages, for the app to load.
    public static var keys: [String] {
        var all = ["LOC_UNITS"] + units.map(unitName)
        for name in units + settings {
            let l = list(name)
            all.append(l.title)
            all += l.choices.map(\.label)
        }
        var seen = Set<String>()
        return all.filter { $0.hasPrefix("LOC_") && seen.insert($0).inserted }
    }
}
