import Foundation
import TWModel

/// A value line of a map label: the value and the unit in its 12 px span (S10), or the value alone (S11).
public struct LabelLine: Hashable, Sendable {
    public let text: String
    public let unit: String

    public init(text: String, unit: String = "") {
        self.text = text
        self.unit = unit
    }
}

/// A label of the S10 or S11 map as nation.html and nation-air.html draw it, at its CSS px position on the map.
public struct NationLabel: Hashable, Sendable {
    public let name: String
    public let top: Int
    public let left: Int
    /// S10: the sky icon's file name in the theme's weather folder, when `getIcon` returns one.
    public let icon: String?
    public let lines: [LabelLine]
    /// S11: `grade2Color`, `rgba(r,g,b,a)`; S10 keeps the stylesheet's `rgba(0, 0, 0, 0.4)`.
    public let background: String

    public init(name: String, top: Int, left: Int, icon: String? = nil, lines: [LabelLine] = [],
                background: String = Nationwide.noGrade) {
        self.name = name
        self.top = top
        self.left = left
        self.icon = icon
        self.lines = lines
        self.background = background
    }
}

/// What the nationwide pages show (IN-13, #2962): the labels of nation.html (S10) and nation-air.html (S11). Port of
/// the Android `NationPages` (AN-13).
public enum NationPages {
    /// The catalog strings S10, S11 and S12 show.
    public static let keys = ["LOC_KOREA", "LOC_CHINA", "LOC_USA", "LOC_UK", "LOC_TYPE_SPECIAL_WEATHER",
                              "LOC_SPECIAL_WEATHER_NOTE", "LOC_WEATHER", "LOC_TEMP", "LOC_PRECIPITATION",
                              "LOC_WIND_DIRECTION", "LOC_WIND_SPEED"]

    /// `getNationName` for the region; nil leaves the title empty, as the translate filter of undefined does.
    public static func title(_ region: String) -> String? {
        switch region {
        case "KR": "LOC_KOREA"
        case "JP", "CN": "LOC_CHINA" // JP shows China in the Cordova app too
        case "US": "LOC_USA"
        case "GB": "LOC_UK"
        default: nil
        }
    }

    /// The S10 mode buttons' texts (`changeWeatherType(0/1/2)`), as catalog keys joined by "/".
    public static let modeKeys = [["LOC_WEATHER", "LOC_TEMP"], ["LOC_PRECIPITATION"], ["LOC_WIND_DIRECTION", "LOC_WIND_SPEED"]]

    /// nation.html in `mode`: each city of NationCtrl's list with its icon and values. Without an answer (while
    /// loading, after a failure), only the names. `unit` is `Units.getUnit` (the stored unit value).
    public static func weather(_ nation: NationResponse?, mode: Nationwide.Mode, unit: (String) -> String?) -> [NationLabel] {
        let (unit1, unit2) = Nationwide.unitKeys(mode)
        return Nationwide.weatherCities.map { city in
            let label = nation.map { Nationwide.weatherLabel($0, mode: mode, name: city.name) }
            var lines: [LabelLine] = []
            if let t = label?.text1 { lines.append(LabelLine(text: Js.display(t), unit: unit1.flatMap(unit) ?? "")) }
            if let t = label?.text2 { lines.append(LabelLine(text: Js.display(t), unit: unit2.flatMap(unit) ?? "")) }
            return NationLabel(name: city.name, top: city.top, left: city.left, icon: label?.icon, lines: lines)
        }
    }

    /// nation-air.html for the pollutant `type` (`pm2.5`, `pm10`, `o3`, `no2`, `so2`, `co`) in the air standard
    /// `airUnit`.
    public static func air(_ nation: NationResponse?, type: String, airUnit: String?) -> [NationLabel] {
        Nationwide.airCities.map { city in
            let value = nation.flatMap { Nationwide.airValue($0, type: type, name: city.name) }
            let background = nation.map { Nationwide.airColor($0, type: type, name: city.name, airUnit: airUnit) }
            return NationLabel(name: city.name, top: city.top, left: city.left,
                               lines: value.map { [LabelLine(text: Js.display($0))] } ?? [],
                               background: background ?? Nationwide.noGrade)
        }
    }
}

/// A situation of an S12 card: the bold hazard and level, then a line per `info`.
public struct WarningSituation: Hashable, Sendable {
    public let title: String
    public let lines: [String]

    public init(title: String, lines: [String]) {
        self.title = title
        self.lines = lines
    }
}

/// A card of kma-special.html: `name announcement`, the image, the situations, the note heading and the comment's
/// lines.
public struct WarningCard: Hashable, Sendable {
    public let heading: String
    public let imageUrl: String?
    public let situations: [WarningSituation]
    /// `special.type === 1 || special.type === 2`: the LOC_SPECIAL_WEATHER_NOTE heading.
    public let note: Bool
    public let comment: [String]

    public init(heading: String, imageUrl: String?, situations: [WarningSituation], note: Bool, comment: [String]) {
        self.heading = heading
        self.imageUrl = imageUrl
        self.situations = situations
        self.note = note
        self.comment = comment
    }
}

public enum WarningCards {
    /// The cards of kma-special.html for a list `Warnings.parse` returned; no card for anything but a list
    /// (`ng-if="specialList"` with a failed request, or a body that is not a list: the Cordova page repeats an object's
    /// values, a difference the Android port decided too, its B12). Texts are as the WebView renders them: AngularJS
    /// interpolation, then HTML white-space collapsing.
    public static func cards(_ list: JSONValue?) -> [WarningCard] {
        guard case .array(let items)? = list else { return [] }
        return items.map { special in
            let o = special.objectValue
            let situations: [WarningSituation] = Js.truthy(o?["situationList"]) ? repeated(o?["situationList"]).map(situation) : []
            let image = Js.display(o?["imageUrl"])
            return WarningCard(heading: ForecastPage.collapse(Js.display(o?["name"]) + " " + Js.display(o?["announcement"])),
                               imageUrl: image.isEmpty ? nil : image, situations: situations, note: isNoteType(o?["type"]),
                               comment: BoundHtml.lines(o?["comment"]))
        }
    }

    private static func situation(_ value: JSONValue) -> WarningSituation {
        let o = value.objectValue
        let lines: [String] = Js.truthy(o?["info"]) ? repeated(o?["info"]).map { info in
            let io = info.objectValue
            return ForecastPage.collapse(Js.display(io?["timeStr"]) + " " + Js.display(io?["location"]))
        } : []
        return WarningSituation(title: ForecastPage.collapse(Js.display(o?["weatherStr"]) + Js.display(o?["levelStr"])), lines: lines)
    }

    /// `special.type === 1 || special.type === 2`: strict equality with the numbers 1 and 2.
    private static func isNoteType(_ value: JSONValue?) -> Bool {
        guard case .number(let n)? = value else { return false }
        return n.double == 1 || n.double == 2
    }

    /// What `ng-repeat` walks: a list's items, an object's values; nothing for anything else.
    private static func repeated(_ value: JSONValue?) -> [JSONValue] {
        switch value {
        case .array(let a)?: a
        case .object(let o)?: o.map(\.value)
        default: []
        }
    }
}

/// `ng-bind-html`: the comment through `$sanitize`, as lines. `<br>` ends a line; other tags go, keeping their text,
/// except `script` and `style`, whose content goes too; comments go; entities become their characters, numeric ones as
/// the HTML parser reads them. White space collapses as in HTML: each run becomes one space, none at the start or end
/// of a line. A final `<br>` makes no empty line; two in a row make one. Port of the Android `BoundHtml`.
public enum BoundHtml {
    private static let br = #"<br\s*/?>"#
    private static let blocked = #"<(script|style)\b[^>]*>.*?</\1\s*>"#
    private static let comment = #"<!--.*?-->"#
    private static let tag = #"</?[A-Za-z][^>]*>"#
    private static let entity = #"&(#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z]+);"#
    private static let named = ["lt": "<", "gt": ">", "amp": "&", "quot": "\"", "apos": "'", "nbsp": "\u{A0}"]

    public static func lines(_ value: JSONValue?) -> [String] {
        let html = Js.display(value)
        if html.isEmpty { return [] }
        let cleaned = replace(replace(html, comment, []), blocked, [.caseInsensitive, .dotMatchesLineSeparators])
        let parts = split(cleaned, br).map { ForecastPage.collapse(decode(replace($0, tag, []))) }
        return parts.count > 1 && parts.last == "" ? Array(parts.dropLast()) : parts
    }

    private static func regex(_ pattern: String, _ options: NSRegularExpression.Options) -> NSRegularExpression {
        // The patterns are constants of this file.
        try! NSRegularExpression(pattern: pattern, options: options)
    }

    private static func matches(_ text: String, _ pattern: String, _ options: NSRegularExpression.Options) -> [NSTextCheckingResult] {
        regex(pattern, options).matches(in: text, range: NSRange(text.startIndex..., in: text))
    }

    /// `text` without the matches of `pattern` (`.` also matches line ends for the comment and blocked patterns).
    private static func replace(_ text: String, _ pattern: String, _ options: NSRegularExpression.Options) -> String {
        let all = options.union(pattern == comment ? [.dotMatchesLineSeparators] : [])
        return regex(pattern, all).stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
    }

    private static func split(_ text: String, _ pattern: String) -> [String] {
        var parts: [String] = []
        var start = text.startIndex
        for m in matches(text, pattern, [.caseInsensitive]) {
            let r = Range(m.range, in: text)!
            parts.append(String(text[start..<r.lowerBound]))
            start = r.upperBound
        }
        parts.append(String(text[start...]))
        return parts
    }

    /// The HTML parser's table for numeric references 0x80-0x9F (windows-1252 where it has a character).
    private static let c1: [Int64: UInt32] = [
        0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6,
        0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C,
        0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A,
        0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
    ]

    private static func decode(_ text: String) -> String {
        var out = ""
        var start = text.startIndex
        for m in matches(text, entity, []) {
            let whole = Range(m.range, in: text)!
            let e = text[Range(m.range(at: 1), in: text)!]
            out += text[start..<whole.lowerBound]
            let replacement: String?
            if e.hasPrefix("#x") || e.hasPrefix("#X") {
                replacement = codePoint(Int64(e.dropFirst(2), radix: 16))
            } else if e.hasPrefix("#") {
                replacement = codePoint(Int64(e.dropFirst()))
            } else {
                replacement = named[String(e)]
            }
            out += replacement ?? String(text[whole])
            start = whole.upperBound
        }
        return out + text[start...]
    }

    /// A numeric reference as the HTML parser reads it: U+FFFD for 0, a surrogate, a value past U+10FFFF or one too
    /// long to read, and the windows-1252 character for 0x80-0x9F where it has one.
    private static func codePoint(_ n: Int64?) -> String {
        var c: UInt32 = 0xFFFD
        if let n, n != 0, n <= 0x10FFFF, !(0xD800...0xDFFF).contains(n) { c = c1[n] ?? UInt32(n) }
        return String(Character(Unicode.Scalar(c)!))
    }
}
