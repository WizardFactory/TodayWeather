import Foundation

/// A JSON number that keeps the text it was read or written with.
///
/// The Cordova app passes numbers through as JavaScript numbers; the corpus comparison needs to know whether a
/// value was sent as an integer or with a fraction, and two numbers are equal when their texts are (as in
/// kotlinx.serialization's `JsonPrimitive`). Numbers built from a `Double` get JavaScript's text for it
/// (`Number.prototype.toString`), so they compare equal to what Node wrote into the corpus.
public struct JSONNumber: Sendable, Hashable, CustomStringConvertible {
    /// The number as it appears in JSON.
    public let text: String
    /// The value, as JavaScript's `Number(text)` reads it.
    public let double: Double

    /// A number read from JSON text, kept verbatim.
    public init(text: String) {
        self.text = text
        self.double = Double(text) ?? .nan
    }

    /// A number written as JavaScript prints it; non-finite values print as JavaScript does (JSON has no form for them).
    public init(_ value: Double) {
        self.text = JSNumberFormat.string(value)
        self.double = value
    }

    /// True when the text has no fraction or exponent (`5`, `-12`), as opposed to `5.0` or `1e3`.
    public var isInteger: Bool { !text.contains(where: { $0 == "." || $0 == "e" || $0 == "E" }) }

    public var description: String { text }

    public static func == (a: JSONNumber, b: JSONNumber) -> Bool { a.text == b.text }
    public func hash(into hasher: inout Hasher) { hasher.combine(text) }
}

/// An object whose members keep JavaScript's order: array-index keys first in ascending order, then the other
/// keys in insertion order. Replacing a member keeps its position, as assignment does in JavaScript.
public struct JSONObject: Sendable, Hashable, Sequence {
    /// A member name compared and hashed by UTF-16 code units, as JavaScript property keys are: canonically
    /// equivalent names (`"\u{E9}"`, `"e\u{301}"`) are two members.
    private struct Key: Hashable, Sendable {
        let name: String
        static func == (a: Key, b: Key) -> Bool { JSString.equal(a.name, b.name) }
        func hash(into hasher: inout Hasher) { JSString.hash(name, into: &hasher) }
    }

    private var order: [String] = []
    private var storage: [Key: JSONValue] = [:]

    public init() {}

    public init(_ pairs: [(String, JSONValue)]) {
        for (k, v) in pairs { self[k] = v }
    }

    /// The keys in JavaScript's own-property order.
    public var keys: [String] {
        let indices = order.filter(Self.isArrayIndex)
        if indices.isEmpty { return order }
        return indices.sorted { UInt64($0)! < UInt64($1)! } + order.filter { !Self.isArrayIndex($0) }
    }

    public var count: Int { order.count }
    public var isEmpty: Bool { order.isEmpty }

    public subscript(key: String) -> JSONValue? {
        get { storage[Key(name: key)] }
        set {
            if let newValue {
                if storage.updateValue(newValue, forKey: Key(name: key)) == nil { order.append(key) }
            } else if storage.removeValue(forKey: Key(name: key)) != nil {
                order.removeAll { JSString.equal($0, key) }
            }
        }
    }

    public func contains(_ key: String) -> Bool { storage[Key(name: key)] != nil }

    /// A copy with [key] set (kept in place when it exists), like Kotlin's `map + (key to value)`.
    public func setting(_ key: String, _ value: JSONValue) -> JSONObject {
        var copy = self
        copy[key] = value
        return copy
    }

    /// A copy without [key].
    public func removing(_ key: String) -> JSONObject {
        var copy = self
        copy[key] = nil
        return copy
    }

    public func makeIterator() -> AnyIterator<(key: String, value: JSONValue)> {
        var it = keys.makeIterator()
        let storage = storage
        return AnyIterator { it.next().map { ($0, storage[Key(name: $0)]!) } }
    }

    /// Equality ignores member order, as JSON object equality does; use ``JSONValue/sameText(_:)`` for order.
    public static func == (a: JSONObject, b: JSONObject) -> Bool { a.storage == b.storage }
    public func hash(into hasher: inout Hasher) { hasher.combine(storage) }

    /// ECMAScript array index: a canonical decimal integer below 2^32 - 1.
    static func isArrayIndex(_ key: String) -> Bool {
        guard let first = key.utf8.first, key.utf8.count <= 10, key.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }) else { return false }
        if first == 48 && key.utf8.count > 1 { return false }
        return UInt64(key)! < 4_294_967_295
    }
}

/// A JSON tree that keeps what the comparison with the Cordova code needs: member order, and each number's text
/// (so integers and fractional numbers stay apart). A Swift `nil` `JSONValue?` stands for JavaScript `undefined`
/// (an absent property); ``null`` is JSON null.
public enum JSONValue: Sendable, Hashable, CustomStringConvertible {
    case null
    case bool(Bool)
    case number(JSONNumber)
    case string(String)
    case array([JSONValue])
    case object(JSONObject)

    /// A number written as JavaScript prints it.
    public static func number(_ value: Double) -> JSONValue { .number(JSONNumber(value)) }
    public static func number(_ value: Int) -> JSONValue { .number(JSONNumber(text: String(value))) }

    public var objectValue: JSONObject? { if case .object(let o) = self { return o } else { return nil } }
    public var arrayValue: [JSONValue]? { if case .array(let a) = self { return a } else { return nil } }
    public var stringValue: String? { if case .string(let s) = self { return s } else { return nil } }
    public var numberValue: JSONNumber? { if case .number(let n) = self { return n } else { return nil } }
    public var boolValue: Bool? { if case .bool(let b) = self { return b } else { return nil } }
    public var isNull: Bool { if case .null = self { return true } else { return false } }

    /// Member [key] of an object; nil for anything else or an absent member.
    public subscript(key: String) -> JSONValue? { objectValue?[key] }
    /// Element [index] of an array; nil out of range or for anything else.
    public subscript(index: Int) -> JSONValue? {
        guard let a = arrayValue, index >= 0, index < a.count else { return nil }
        return a[index]
    }

    /// Parses JSON text (RFC 8259), keeping member order and number texts.
    public static func parse(_ data: Data) throws -> JSONValue {
        var parser = JSONParser(data)
        return try parser.parseDocument()
    }
    public static func parse(_ text: String) throws -> JSONValue { try parse(Data(text.utf8)) }

    /// Compact JSON with members in order and numbers in their kept text (JSON.stringify's form for corpus values).
    public var jsonText: String {
        var out = ""
        write(to: &out, sortedKeys: false)
        return out
    }

    /// `JSON.stringify` of the value with object keys sorted by UTF-16 code units, numbers in JavaScript's form:
    /// the canonical text the corpus generator hashes.
    public var canonicalText: String {
        var out = ""
        write(to: &out, sortedKeys: true)
        return out
    }

    public var description: String { jsonText }

    /// True when both trees have the same members in the same order and the same number texts.
    public func sameText(_ other: JSONValue) -> Bool { JSString.equal(jsonText, other.jsonText) }

    /// Equality as JSON values: strings by UTF-16 code units (JavaScript's `===`), numbers by their text, objects by
    /// their members regardless of order.
    public static func == (a: JSONValue, b: JSONValue) -> Bool {
        switch (a, b) {
        case (.null, .null): return true
        case let (.bool(x), .bool(y)): return x == y
        case let (.number(x), .number(y)): return x == y
        case let (.string(x), .string(y)): return JSString.equal(x, y)
        case let (.array(x), .array(y)): return x == y
        case let (.object(x), .object(y)): return x == y
        default: return false
        }
    }

    public func hash(into hasher: inout Hasher) {
        switch self {
        case .null: hasher.combine(0)
        case .bool(let b): hasher.combine(1); hasher.combine(b)
        case .number(let n): hasher.combine(2); hasher.combine(n)
        case .string(let s): hasher.combine(3); JSString.hash(s, into: &hasher)
        case .array(let a): hasher.combine(4); hasher.combine(a)
        case .object(let o): hasher.combine(5); hasher.combine(o)
        }
    }

    private func write(to out: inout String, sortedKeys: Bool) {
        switch self {
        case .null: out += "null"
        case .bool(let b): out += b ? "true" : "false"
        case .number(let n): out += sortedKeys ? JSNumberFormat.string(n.double) : n.text
        case .string(let s): JSONValue.quote(s, into: &out)
        case .array(let a):
            out += "["
            for (i, v) in a.enumerated() {
                if i > 0 { out += "," }
                v.write(to: &out, sortedKeys: sortedKeys)
            }
            out += "]"
        case .object(let o):
            out += "{"
            let keys = sortedKeys ? o.keys.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) } : o.keys
            for (i, k) in keys.enumerated() {
                if i > 0 { out += "," }
                JSONValue.quote(k, into: &out)
                out += ":"
                o[k]!.write(to: &out, sortedKeys: sortedKeys)
            }
            out += "}"
        }
    }

    /// JSON.stringify's string quoting.
    static func quote(_ s: String, into out: inout String) {
        out += "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if u.value < 0x20 {
                    out += String(format: "\\u%04x", u.value)
                } else {
                    out.unicodeScalars.append(u)
                }
            }
        }
        out += "\""
    }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral,
    ExpressibleByBooleanLiteral, ExpressibleByArrayLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(integerLiteral value: Int) { self = .number(value) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
}

/// JavaScript's `Number.prototype.toString()` (ECMAScript Number::toString, radix 10): the shortest digits that
/// read back as the same double, in plain notation from 1e-7 (exclusive) up to 1e21, else exponential.
public enum JSNumberFormat {
    public static func string(_ d: Double) -> String {
        if d.isNaN { return "NaN" }
        if d.isInfinite { return d > 0 ? "Infinity" : "-Infinity" }
        if d == 0 { return "0" }
        let (digits, n) = shortestDigits(abs(d))
        let k = digits.count
        var s = d < 0 ? "-" : ""
        if k <= n && n <= 21 {
            s += digits + String(repeating: "0", count: n - k)
        } else if 0 < n && n <= 21 {
            s += String(digits.prefix(n)) + "." + String(digits.dropFirst(n))
        } else if -6 < n && n <= 0 {
            s += "0." + String(repeating: "0", count: -n) + digits
        } else {
            let e = n - 1
            let mantissa = k == 1 ? digits : String(digits.prefix(1)) + "." + String(digits.dropFirst())
            s += mantissa + "e" + (e >= 0 ? "+" : "-") + String(abs(e))
        }
        return s
    }

    /// The shortest round-trip decimal digits of a positive finite double (no leading or trailing zeros) and the
    /// exponent n with value = 0.digits × 10^n. Swift's `description` already prints the shortest round-trip form.
    static func shortestDigits(_ d: Double) -> (String, Int) {
        let text = d.description  // e.g. "123.45", "1e-07", "1.5e+300", "5e-324"
        var mantissa = text
        var exponent = 0
        if let e = text.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            mantissa = String(text[..<e])
            exponent = Int(text[text.index(after: e)...])!
        }
        var intPart = mantissa
        var fracPart = ""
        if let dot = mantissa.firstIndex(of: ".") {
            intPart = String(mantissa[..<dot])
            fracPart = String(mantissa[mantissa.index(after: dot)...])
        }
        var digits = intPart + fracPart
        var n = intPart.count + exponent
        while digits.hasPrefix("0") {
            digits.removeFirst()
            n -= 1
        }
        while digits.hasSuffix("0") { digits.removeLast() }
        return (digits, n)
    }
}
