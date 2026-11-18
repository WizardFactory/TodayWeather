import Foundation
import TWModel

/// The time picker O14 of S09 (IN-14, #2963; the Android `TimePicker` of AN-14): ionic-timepicker 0.5.1 (the
/// `WizardFactory/ionic-timepicker#e2d5cd3` fork the app bundles) with the app's configuration, 12-hour, a 5-minute step
/// and three buttons. `hours`, `minutes` and `meridian` are the texts the picker shows. Its anomalies are kept (AN-06):
/// noon opens as 12 AM, so Set turns 12:00 PM into 0, which S09 treats as Delete, and 12:30 PM into 00:30; Set at
/// 12:00 AM answers 0 as well.
public struct TimePicker: Equatable, Sendable {
    public var hours: String
    public var minutes: String
    public var meridian: String

    public static let step = 5
    public static let am = "AM"
    public static let pm = "PM"

    public init(hours: String, minutes: String, meridian: String) {
        self.hours = hours
        self.minutes = minutes
        self.meridian = meridian
    }

    /// `{{time.hours}} : {{time.minutes}} {{time.meridian}}`.
    public var heading: String { "\(hours) : \(minutes) \(meridian)" }

    /// 1 after 12, else one more.
    public func increaseHours() -> TimePicker {
        let h = Int(hours) ?? 0
        return with(hours: Self.pad(h != 12 ? h + 1 : 1))
    }

    /// 12 below 2, else one less.
    public func decreaseHours() -> TimePicker {
        let h = Int(hours) ?? 0
        return with(hours: Self.pad(h > 1 ? h - 1 : 12))
    }

    public func increaseMinutes() -> TimePicker {
        with(minutes: Self.pad(((Int(minutes) ?? 0) + Self.step) % 60))
    }

    public func decreaseMinutes() -> TimePicker {
        with(minutes: Self.pad(((Int(minutes) ?? 0) + 60 - Self.step) % 60))
    }

    public func changeMeridian() -> TimePicker {
        var t = self
        t.meridian = meridian == Self.am ? Self.pm : Self.am
        return t
    }

    /// Set: the seconds of the day; PM adds 12 hours except at 12, 12 AM is hour 0.
    public func seconds() -> Int {
        var h = Int(hours) ?? 0
        if meridian == Self.pm && h != 12 {
            h += 12
        } else if meridian == Self.am && h == 12 {
            h -= 12
        }
        return h * 3600 + (Int(minutes) ?? 0) * 60
    }

    /// `setMinSecs`: the input's hours, PM only above 12, and its minutes, as `toFixed(0)` with a leading zero.
    public static func of(_ inputTime: Int) -> TimePicker {
        var h = inputTime / 3600
        var meridian = am
        if h > 12 {
            meridian = pm
            h -= 12
        }
        let minutes = Int((Double(inputTime % 3600) / 60 + 0.5).rounded(.down))
        return TimePicker(hours: twoDigits(h), minutes: twoDigits(minutes), meridian: meridian)
    }

    private func with(hours: String? = nil, minutes: String? = nil) -> TimePicker {
        var t = self
        if let hours { t.hours = hours }
        if let minutes { t.minutes = minutes }
        return t
    }

    /// `padStart(2, '0')` of the opening values.
    private static func twoDigits(_ n: Int) -> String {
        let s = String(n)
        return s.count < 2 ? "0" + s : s
    }

    /// A number below 10 with a leading zero, as the arrows write it.
    private static func pad(_ n: Int) -> String {
        n < 10 ? "0\(n)" : String(n)
    }
}

/// An alarm row of S09: `secs2dateStr`, the local hour without padding and two-digit minutes.
public enum AlarmRow {
    public static func text(_ localSeconds: Int) -> String {
        let minutes = localSeconds % 3600 / 60
        return "\(localSeconds / 3600):\(minutes < 10 ? "0" : "")\(minutes)"
    }
}

/// A tap on a push notification (`_notificationCallback` with `tap`): the place index of its `cityIndex` data, a string,
/// by JavaScript's `parseInt`; nil when it is absent or no number. The index may be outside the places;
/// `setCityIndex` checks.
public enum NotificationTap {
    public static func placeIndex(_ cityIndex: String?) -> Double? {
        guard let cityIndex else { return nil }
        let n = JsNumber.parseInt(cityIndex)
        return n.isNaN ? nil : n
    }
}

/// The foreground popup O07 (TabCtrl's `notificationEvent`) for a message the iOS plugin hands over while the app is
/// open: `_notificationCallback` takes the title and body of `aps.alert` (iOS), else the data's `body`; the popup's
/// template is the title, a break when both are there, then the body.
public enum ForegroundMessage {
    public static func template(title: String?, body: String?) -> String {
        var template = title ?? ""
        if let body, !body.isEmpty {
            if !template.isEmpty { template += "<br>" }
            template += body
        }
        return template
    }

    /// The template for a message's payload (the APNs `userInfo` as JSON). Nil where the Cordova callback throws before
    /// broadcasting (an `aps` without `alert`), so no popup shows. A non-string title or body counts as absent where it
    /// is falsy and is written as JavaScript's `String` otherwise.
    public static func template(payload: JSONObject) -> String? {
        let title: JSONValue?
        let message: JSONValue?
        if let aps = payload["aps"], Js.truthy(aps) {
            // `result.aps.alert.title`: a string alert has no members; no alert throws.
            guard let alert = aps.objectValue?["alert"], alert != .null else { return nil }
            title = alert.objectValue?["title"]
            message = alert.objectValue?["body"]
        } else {
            title = payload["title"]
            message = payload["body"]
        }
        return template(title: Js.truthy(title) ? text(title) : nil, body: Js.truthy(message) ? text(message) : nil)
    }

    /// The lines of the popup's HTML template: split at its breaks, tags removed and the common entities decoded, as
    /// the WebView shows them.
    public static func lines(_ template: String) -> [String] {
        template.components(separatedBy: "<br>").map(plainText)
    }

    static func text(_ value: JSONValue?) -> String {
        switch value {
        case .string(let s): s
        case .number(let n): n.text
        case .bool(let b): b ? "true" : "false"
        case .array, .object: value.map { _ in "[object Object]" } ?? ""
        default: ""
        }
    }

    static func plainText(_ html: String) -> String {
        var out = ""
        var inTag = false
        for c in html {
            if c == "<" { inTag = true; continue }
            if c == ">" && inTag { inTag = false; continue }
            if !inTag { out.append(c) }
        }
        for (entity, char) in [("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&nbsp;", "\u{A0}"), ("&amp;", "&")] {
            out = out.replacingOccurrences(of: entity, with: char)
        }
        return out
    }
}

/// JavaScript number conversions the alarms need.
public enum JsNumber {
    /// `parseInt(s)` without a radix: leading white space (ECMAScript's), a sign, `0x` for hexadecimal, then the digits
    /// before anything else; NaN without digits.
    public static func parseInt(_ s: String) -> Double {
        let scalars = Array(s.unicodeScalars)
        var i = 0
        while i < scalars.count, isWhiteSpace(scalars[i]) { i += 1 }
        var sign = 1.0
        if i < scalars.count, scalars[i] == "+" || scalars[i] == "-" {
            if scalars[i] == "-" { sign = -1 }
            i += 1
        }
        var radix = 10.0
        if i + 1 < scalars.count, scalars[i] == "0", scalars[i + 1] == "x" || scalars[i + 1] == "X" {
            radix = 16
            i += 2
        }
        var value = 0.0
        var digits = 0
        while i < scalars.count, let d = digit(scalars[i]), Double(d) < radix {
            value = value * radix + Double(d)
            digits += 1
            i += 1
        }
        return digits == 0 ? .nan : sign * value
    }

    static func digit(_ s: Unicode.Scalar) -> Int? {
        switch s.value {
        case 0x30...0x39: Int(s.value - 0x30)
        case 0x41...0x46: Int(s.value - 0x41 + 10)
        case 0x61...0x66: Int(s.value - 0x61 + 10)
        default: nil
        }
    }

    /// ECMAScript WhiteSpace and LineTerminator.
    static func isWhiteSpace(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0xFEFF, 0x2028, 0x2029: true
        default: s.properties.generalCategory == .spaceSeparator
        }
    }
}
