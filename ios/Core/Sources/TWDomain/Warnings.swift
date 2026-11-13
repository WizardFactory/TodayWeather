import Foundation
import TWModel

/// Weather warnings (S12, KmaSpecialCtrl.parseSpecialData); port of Kotlin `Warnings`. Dates use JavaScript's
/// proleptic Gregorian calendar computed here, with Foundation's `TimeZone` for the offsets.
public enum Warnings {
    /// Formats each announcement as the WebView's `toLocaleDateString() + ' ' + toLocaleTimeString()` in
    /// [timeZoneId] and turns newlines in the comment into `<br>`. Like the Cordova code, it stops at the first item
    /// whose comment is not a string and keeps the items processed so far.
    public static func parse(_ list: JSONValue, languageTag: String, timeZoneId: String) -> JSONValue {
        guard case .array(let items) = list else { return list }
        let zone = TimeZone(identifier: timeZoneId) ?? TimeZone(identifier: "UTC")!
        var out = items
        for (i, item) in items.enumerated() {
            guard case .object(let o) = item else { break }  // special.announcement on a non-object (or comment.replace) throws
            let millis = jsDate(o["announcement"], zone: zone)
            let text = millis.map { localDateTime($0, zone: zone, languageTag: languageTag) } ?? "Invalid Date Invalid Date"
            var updated = o.setting("announcement", .string(text))
            out[i] = .object(updated)
            guard case .string(let comment) = o["comment"] else { break }
            updated = updated.setting("comment", .string(comment.replacingOccurrences(of: "\n", with: "<br>")))
            out[i] = .object(updated)
        }
        return .array(out)
    }

    private static let maxTime: Int64 = 8_640_000_000_000_000

    /// `new Date(value)` as JavaScriptCore (the Cordova iOS app's engine) reads the forms the server could send; nil
    /// for an Invalid Date. ISO strings: month 1–12, day 1 to the month's last day, hour 0–24 (24 only at 24:00:00,
    /// a fraction allowed), minute 0–59, second 0–60 (60 is the next minute; its fraction is ignored), offsets up to
    /// ±23:59. A date alone is UTC; a date and time without an offset is local time in [zone]. Numbers are
    /// milliseconds within ±8.64e15.
    ///
    /// V8 (the Node corpus and the Android port) differs in two rules, recorded by ios/tools/corpus/compare_jsc.py in
    /// ios/tools/corpus/differences.md: it rolls days past the month's end over to the next month and rejects
    /// second 60. The other rules agree on the corpus cases.
    public static func jsDate(_ value: JSONValue?, zone: TimeZone = TimeZone(identifier: "UTC")!) -> Int64? {
        guard let value else { return nil }
        switch value {
        case .null: return 0
        case .number(let n):
            let d = n.double
            return d.isFinite && abs(d) <= Double(maxTime) ? Int64(d) : nil
        case .string(let s): return parseISO(s, zone: zone)
        default: return nil
        }
    }

    private static func parseISO(_ s: String, zone: TimeZone) -> Int64? {
        var p = Array(s.utf8)[...]
        func digits(_ n: Int) -> Int? {
            guard p.count >= n, p.prefix(n).allSatisfy({ $0 >= 48 && $0 <= 57 }) else { return nil }
            let v = Int(String(decoding: p.prefix(n), as: UTF8.self))!
            p = p.dropFirst(n)
            return v
        }
        func take(_ c: Character) -> Bool {
            guard p.first == c.asciiValue else { return false }
            p = p.dropFirst()
            return true
        }
        var year: Int
        if p.first == UInt8(ascii: "+") || p.first == UInt8(ascii: "-") {
            let negative = p.first == UInt8(ascii: "-")
            p = p.dropFirst()
            guard let y = digits(6) else { return nil }
            year = negative ? -y : y
        } else {
            guard let y = digits(4) else { return nil }
            year = y
        }
        guard take("-"), let month = digits(2), take("-"), let day = digits(2) else { return nil }
        var hour = 0, minute = 0, second = 0, millis = 0
        var hasTime = false
        var offsetMillis: Int64 = 0
        var hasOffset = false
        if take("T") {
            hasTime = true
            guard let h = digits(2), take(":"), let m = digits(2) else { return nil }
            hour = h
            minute = m
            if take(":") {
                guard let sec = digits(2) else { return nil }
                second = sec
                if take(".") {
                    var fraction = ""
                    while let c = p.first, c >= 48, c <= 57 {
                        fraction.append(Character(UnicodeScalar(c)))
                        p = p.dropFirst()
                    }
                    guard !fraction.isEmpty else { return nil }
                    millis = Int(String((fraction + "00").prefix(3)))!
                }
            }
            if take("Z") {
                hasOffset = true
            } else if let sign = p.first, sign == UInt8(ascii: "+") || sign == UInt8(ascii: "-") {
                p = p.dropFirst()
                guard let oh = digits(2), take(":"), let om = digits(2) else { return nil }
                if oh > 23 || om > 59 { return nil }
                offsetMillis = (sign == UInt8(ascii: "-") ? -1 : 1) * (Int64(oh) * 3_600_000 + Int64(om) * 60_000)
                hasOffset = true
            }
        }
        guard p.isEmpty else { return nil }
        if !(1...12).contains(month) || day < 1 || day > daysInMonth(year: year, month: month) || minute > 59 || second > 60 {
            return nil
        }
        if hour > 24 || (hour == 24 && (minute != 0 || second != 0)) { return nil }
        if second == 60 { millis = 0 }
        let days = Int64(daysFromCivil(year: year, month: month, day: 1) + (day - 1))
        let fields = days * 86_400_000 + Int64(hour) * 3_600_000 + Int64(minute) * 60_000 + Int64(second) * 1000 + Int64(millis)
        var t = fields - offsetMillis
        if hasTime && !hasOffset { t = localToUTC(fields, zone: zone) }
        return abs(t) <= maxTime ? t : nil
    }

    /// Local wall-clock milliseconds in [zone] to a time value: the offset at the guessed instant, checked once more
    /// at the result (times in a spring-forward gap move forward, as V8 and java.util.Calendar do).
    private static func localToUTC(_ local: Int64, zone: TimeZone) -> Int64 {
        func offset(_ t: Int64) -> Int64 {
            Int64(zone.secondsFromGMT(for: Date(timeIntervalSince1970: Double(t) / 1000))) * 1000
        }
        let first = local - offset(local)
        let second = local - offset(first)
        return second
    }

    static func daysInMonth(year: Int, month: Int) -> Int {
        if month == 2 { return year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) ? 29 : 28 }
        return [4, 6, 9, 11].contains(month) ? 30 : 31
    }

    /// Days from 1970-01-01 to a proleptic Gregorian date (H. Hinnant's algorithm).
    static func daysFromCivil(year: Int, month: Int, day: Int) -> Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (month + 9) % 12
        let doy = (153 * mp + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    /// The proleptic Gregorian date of a day count from 1970-01-01.
    static func civilFromDays(_ z0: Int) -> (year: Int, month: Int, day: Int) {
        let z = z0 + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (yoe + era * 400 + (m <= 2 ? 1 : 0), m, d)
    }

    /// ICU (Chromium) default short date and medium time per language, as the WebView prints them.
    public static func localDateTime(_ millis: Int64, zone: TimeZone, languageTag: String) -> String {
        let offset = Int64(zone.secondsFromGMT(for: Date(timeIntervalSince1970: Double(millis) / 1000))) * 1000
        let local = millis + offset
        let dayMillis: Int64 = 86_400_000
        let days = local >= 0 ? local / dayMillis : (local - dayMillis + 1) / dayMillis
        let inDay = local - days * dayMillis
        let (y, mo, d) = civilFromDays(Int(days))
        let h = Int(inDay / 3_600_000)
        let mi = String(format: "%02d", Int(inDay / 60_000 % 60))
        let s = String(format: "%02d", Int(inDay / 1000 % 60))
        let h12 = h % 12 == 0 ? 12 : h % 12
        let am = h < 12
        let hh = String(format: "%02d", h)
        let language = (languageTag.split(separator: "-", maxSplits: 1).first.map(String.init) ?? "").lowercased()
        switch language {
        case "ko": return "\(y). \(mo). \(d). \(am ? "오전" : "오후") \(h12):\(mi):\(s)"
        case "ja": return "\(y)/\(mo)/\(d) \(h):\(mi):\(s)"
        case "de": return "\(d).\(mo).\(y) \(hh):\(mi):\(s)"
        case "zh":
            if languageTag.caseInsensitiveCompare("zh-TW") == .orderedSame || languageTag.contains("Hant") {
                return "\(y)/\(mo)/\(d) \(am ? "上午" : "下午")\(h12):\(mi):\(s)"
            }
            return "\(y)/\(mo)/\(d) \(hh):\(mi):\(s)"
        default: return "\(mo)/\(d)/\(y) \(h12):\(mi):\(s) \(am ? "AM" : "PM")"
        }
    }
}
