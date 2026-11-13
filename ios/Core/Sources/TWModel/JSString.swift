import Foundation

/// JavaScript string semantics: strings are sequences of UTF-16 code units, compared and searched unit by unit.
/// Swift's `String` compares by canonical equivalence (`"\u{E9}" == "e\u{301}"`, `"K" == "\u{212A}"`), and Foundation's
/// searches do too unless asked for a literal search, so every comparison the Cordova code makes with `===`, `==`,
/// `<`, `indexOf`, `split` or `replace` goes through these functions.
public enum JSString {
    /// `a === b` for two strings.
    public static func equal(_ a: String, _ b: String) -> Bool { a.utf16.elementsEqual(b.utf16) }

    /// `a < b` for two strings: code-unit order.
    public static func less(_ a: String, _ b: String) -> Bool { a.utf16.lexicographicallyPrecedes(b.utf16) }

    /// A hash consistent with ``equal(_:_:)``.
    public static func hash(_ s: String, into hasher: inout Hasher) {
        var count = 0
        for u in s.utf16 {
            hasher.combine(u)
            count += 1
        }
        hasher.combine(count)
    }

    /// The first index (in code units) of [sub] in [s] at or after [from], as `indexOf`; nil for -1.
    public static func indexOf(_ s: String, _ sub: String, from: Int = 0) -> Int? {
        let h = Array(s.utf16), n = Array(sub.utf16)
        if n.isEmpty { return min(max(from, 0), h.count) }
        guard h.count >= n.count else { return nil }
        var i = max(from, 0)
        while i + n.count <= h.count {
            if h[i] == n[0] && h[i..<i + n.count].elementsEqual(n) { return i }
            i += 1
        }
        return nil
    }

    /// `s.indexOf(sub) !== -1`.
    public static func includes(_ s: String, _ sub: String) -> Bool { indexOf(s, sub) != nil }

    /// `s.endsWith(suffix)`.
    public static func endsWith(_ s: String, _ suffix: String) -> Bool {
        let h = Array(s.utf16), n = Array(suffix.utf16)
        return h.count >= n.count && h[(h.count - n.count)...].elementsEqual(n)
    }

    /// `s.split(separator)` for a non-empty separator.
    public static func split(_ s: String, _ separator: String) -> [String] {
        let h = Array(s.utf16), n = Array(separator.utf16)
        precondition(!n.isEmpty, "empty separator")
        var parts: [String] = []
        var start = 0, i = 0
        while i + n.count <= h.count {
            if h[i..<i + n.count].elementsEqual(n) {
                parts.append(String(decoding: h[start..<i], as: UTF16.self))
                i += n.count
                start = i
            } else {
                i += 1
            }
        }
        parts.append(String(decoding: h[start...], as: UTF16.self))
        return parts
    }

    /// `s.replace(target, replacement)` with a string pattern: the first occurrence only (no `$` patterns used).
    public static func replaceFirst(_ s: String, _ target: String, _ replacement: String) -> String {
        guard let i = indexOf(s, target) else { return s }
        let h = Array(s.utf16), n = Array(target.utf16)
        return String(decoding: h[..<i], as: UTF16.self) + replacement + String(decoding: h[(i + n.count)...], as: UTF16.self)
    }

    /// Every occurrence of a non-empty [target] replaced (`s.replace(/target/g, replacement)` for a literal target).
    public static func replaceAll(_ s: String, _ target: String, _ replacement: String) -> String {
        split(s, target).joined(separator: replacement)
    }
}
