import Foundation
import TWModel

/// JavaScript value semantics over JSON, so the Swift core decides exactly as the Cordova code (port of
/// android/core-domain Js.kt). A Swift `nil` stands for JavaScript `undefined` (an absent property); `.null`
/// is `null`.
public enum Js {
    /// JavaScript ToNumber.
    public static func number(_ value: JSONValue?) -> Double {
        guard let value else { return .nan }
        switch value {
        case .null: return 0
        case .string(let s): return stringToNumber(s)
        case .bool(let b): return b ? 1 : 0
        case .number(let n): return n.double
        case .array(let a):
            switch a.count {
            case 0: return 0
            case 1:
                switch a[0] {
                case .array, .object: return number(a[0])
                default: return number(.string(string(a[0])))
                }
            default: return .nan
            }
        case .object: return .nan
        }
    }

    static func stringToNumber(_ s: String) -> Double {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return 0 }
        if t.hasPrefix("0x") || t.hasPrefix("0X") {
            return Int64(t.dropFirst(2), radix: 16).map(Double.init) ?? .nan
        }
        switch t {
        case "Infinity", "+Infinity": return .infinity
        case "-Infinity": return -.infinity
        default:
            if t.contains(where: { $0.isLetter && $0 != "e" && $0 != "E" }) { return .nan }
            guard t.unicodeScalars.allSatisfy({ "0123456789+-.eE".unicodeScalars.contains($0) }) else { return .nan }
            return Double(t) ?? .nan
        }
    }

    /// JavaScript ToBoolean.
    public static func truthy(_ value: JSONValue?) -> Bool {
        guard let value else { return false }
        switch value {
        case .null: return false
        case .string(let s): return !s.isEmpty
        case .bool(let b): return b
        case .number(let n): return n.double != 0 && !n.double.isNaN
        case .array, .object: return true
        }
    }

    /// `value != undefined` (loose): neither undefined nor null.
    public static func present(_ value: JSONValue?) -> Bool {
        guard let value else { return false }
        return !value.isNull
    }

    /// `a > b` for a number literal b.
    public static func greater(_ value: JSONValue?, _ b: Double) -> Bool { number(value) > b }

    /// `a >= b` for a number literal b.
    public static func greaterOrEqual(_ value: JSONValue?, _ b: Double) -> Bool { number(value) >= b }

    private static func isPrimitive(_ v: JSONValue) -> Bool {
        switch v {
        case .string, .number, .bool: return true
        default: return false
        }
    }

    /// JavaScript `a == b` for primitives (objects compare by identity, which JSON cannot express: never equal here
    /// unless both are the same container value, as the Kotlin port's reference check on one parsed tree).
    public static func looseEquals(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
        let aNullish = a == nil || a!.isNull
        let bNullish = b == nil || b!.isNull
        if aNullish || bNullish { return aNullish && bNullish }
        let a = a!, b = b!
        if isPrimitive(a) && isPrimitive(b) {
            if case .string(let x) = a, case .string(let y) = b { return x == y }
            return number(a) == number(b)
        }
        return false
    }

    /// `a == number`.
    public static func looseEquals(_ a: JSONValue?, _ b: Double) -> Bool { looseEquals(a, .number(b)) }

    /// JavaScript ToString for primitives.
    public static func string(_ value: JSONValue?) -> String {
        guard let value else { return "undefined" }
        switch value {
        case .null: return "null"
        case .string(let s): return s
        case .bool(let b): return b ? "true" : "false"
        case .number: return numberToString(number(value))
        case .array, .object: return "[object Object]"
        }
    }

    /// JavaScript Number.prototype.toString().
    public static func numberToString(_ d: Double) -> String { JSNumberFormat.string(d) }

    /// `Math.round` as the Kotlin port computes it: floor(d + 0.5).
    public static func round(_ d: Double) -> Double {
        if d.isNaN || d.isInfinite { return d }
        return (d + 0.5).rounded(.down)
    }

    /// `parseFloat(d.toFixed(digits))`. toFixed rounds the exact binary value half away from zero.
    public static func toFixedNumber(_ d: Double, _ digits: Int) -> Double {
        if d.isNaN || d.isInfinite { return d }
        return Double(exactRounded(abs(d), digits).map { (d < 0 ? "-" : "") + $0 } ?? numberToString(d)) ?? d
    }

    /// `x.toFixed(digits)`: the exact binary value rounded half up, "-" for negative values (also "-0").
    public static func toFixed(_ d: Double, _ digits: Int) -> String {
        if d.isNaN || d.isInfinite || abs(d) >= 1e21 { return numberToString(d) }
        return (d < 0 ? "-" : "") + (exactRounded(abs(d), digits) ?? numberToString(abs(d)))
    }

    /// The exact decimal value of a non-negative double rounded half up to [digits] fraction digits, in plain
    /// notation (Java's `BigDecimal(d).setScale(digits, HALF_UP).toPlainString()`). printf prints the exact binary
    /// value when asked for enough digits (a double has at most 1074 fraction digits); the rounding is done here.
    static func exactRounded(_ d: Double, _ digits: Int) -> String? {
        guard d >= 0, d.isFinite, digits >= 0, digits <= 100 else { return nil }
        let exact = String(format: "%.1100f", d)
        guard let dot = exact.firstIndex(of: ".") else { return nil }
        var intDigits = Array(exact[..<dot].utf8)
        let fraction = Array(exact[exact.index(after: dot)...].utf8)
        var kept = Array(fraction.prefix(digits))
        let roundUp = fraction.count > digits && fraction[digits] >= UInt8(ascii: "5")
        if roundUp {
            var carry = true
            var i = kept.count - 1
            while carry && i >= 0 {
                if kept[i] == UInt8(ascii: "9") { kept[i] = UInt8(ascii: "0") } else { kept[i] += 1; carry = false }
                i -= 1
            }
            i = intDigits.count - 1
            while carry && i >= 0 {
                if intDigits[i] == UInt8(ascii: "9") { intDigits[i] = UInt8(ascii: "0") } else { intDigits[i] += 1; carry = false }
                i -= 1
            }
            if carry { intDigits.insert(UInt8(ascii: "1"), at: 0) }
        }
        let int = String(decoding: intDigits, as: UTF8.self)
        return digits == 0 ? int : int + "." + String(decoding: kept, as: UTF8.self)
    }

    /// AngularJS `{{value}}` (`$interpolate`'s stringify): "" for undefined and null, numbers as JavaScript prints
    /// them, containers as JSON.
    public static func display(_ value: JSONValue?) -> String {
        guard let value else { return "" }
        switch value {
        case .null: return ""
        case .string(let s): return s
        case .number, .bool: return string(value)
        case .array, .object: return value.jsonText
        }
    }

    private enum Primitive { case string(String), number(Double) }

    /// ToPrimitive for the relational operators: a string, or a number for everything else.
    private static func primitive(_ value: JSONValue?) -> Primitive {
        guard let value else { return .number(.nan) }
        switch value {
        case .null: return .number(0)
        case .string(let s): return .string(s)
        case .number, .bool: return .number(number(value))
        case .array(let a): return .string(a.map { $0.isNull ? "" : string($0) }.joined(separator: ","))
        case .object: return .string("[object Object]")
        }
    }

    /// `a >= b` of two values: strings by UTF-16 code units, anything else as numbers (NaN is never greater or equal).
    public static func greaterOrEqual(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
        let x = primitive(a), y = primitive(b)
        if case .string(let sx) = x, case .string(let sy) = y { return !sx.utf16.lexicographicallyPrecedes(sy.utf16) }
        func num(_ p: Primitive) -> Double {
            switch p {
            case .string(let s): return stringToNumber(s)
            case .number(let d): return d
            }
        }
        let nx = num(x), ny = num(y)
        return !nx.isNaN && !ny.isNaN && nx >= ny
    }

    /// A number literal as JSON.
    public static func json(_ d: Double) -> JSONValue { .number(d) }

    /// `a > b` of two strings by UTF-16 code units (JavaScript's string comparison).
    static func stringGreater(_ a: String, _ b: String) -> Bool { b.utf16.lexicographicallyPrecedes(a.utf16) }
}
