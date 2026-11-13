import Foundation

/// A JSON value as the Cordova app stored it (`JSON.stringify` text). Numbers that are whole and fit `Int` are
/// `.int`, as JavaScript does not distinguish them; other numbers are `.double`.
public enum JSONValue: Hashable, Sendable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public subscript(key: String) -> JSONValue? {
        if case .object(let members) = self { return members[key] }
        return nil
    }

    public var objectValue: [String: JSONValue]? {
        if case .object(let members) = self { return members }
        return nil
    }

    public var arrayValue: [JSONValue]? {
        if case .array(let items) = self { return items }
        return nil
    }

    /// A JSON string's content (no conversion from other types).
    public var stringValue: String? {
        if case .string(let text) = self { return text }
        return nil
    }

    public var boolValue: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    /// A JSON number that is a 32-bit integer (Kotlin `intOrNull` on the number's text, as Android checks it).
    public var int32Value: Int? {
        if case .int(let value) = self, value >= Int(Int32.min), value <= Int(Int32.max) { return value }
        return nil
    }

    /// Any JSON number as a `Double`.
    public var doubleValue: Double? {
        switch self {
        case .int(let value): return Double(value)
        case .double(let value): return value
        default: return nil
        }
    }

    /// Parses JSON text as JavaScript's `JSON.parse` does (fragments allowed, surrounding white space ignored).
    public static func parse(_ text: String) -> JSONValue? {
        var parser = JSONParser(Array(text.utf8))
        guard let value = parser.parseValue(depth: 0) else { return nil }
        parser.skipWhitespace()
        return parser.atEnd ? value : nil
    }
}

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int.self) {
            self = .int(value)
        } else if let value = try? container.decode(Double.self) {
            self = JSONValue.number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .int(let value): try container.encode(value)
        case .double(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    /// A finite number; whole values that fit `Int` become `.int`, so a stored state reads back equal.
    static func number(_ value: Double) -> JSONValue {
        if value.rounded() == value, value >= -9.007_199_254_740_992e15, value <= 9.007_199_254_740_992e15 {
            return .int(Int(value))
        }
        return .double(value)
    }
}

/// RFC 8259 parser over UTF-8 bytes. Lone surrogate escapes, which JavaScript strings can hold but Swift strings
/// cannot, become U+FFFD.
private struct JSONParser {
    let bytes: [UInt8]
    var index = 0

    init(_ bytes: [UInt8]) { self.bytes = bytes }

    var atEnd: Bool { index >= bytes.count }

    mutating func skipWhitespace() {
        while index < bytes.count, [0x20, 0x09, 0x0A, 0x0D].contains(bytes[index]) { index += 1 }
    }

    mutating func parseValue(depth: Int) -> JSONValue? {
        guard depth < 512 else { return nil }
        skipWhitespace()
        guard index < bytes.count else { return nil }
        switch bytes[index] {
        case UInt8(ascii: "{"): return parseObject(depth: depth)
        case UInt8(ascii: "["): return parseArray(depth: depth)
        case UInt8(ascii: "\""): return parseString().map(JSONValue.string)
        case UInt8(ascii: "t"): return literal("true", .bool(true))
        case UInt8(ascii: "f"): return literal("false", .bool(false))
        case UInt8(ascii: "n"): return literal("null", .null)
        default: return parseNumber()
        }
    }

    mutating func literal(_ word: String, _ value: JSONValue) -> JSONValue? {
        let w = Array(word.utf8)
        guard index + w.count <= bytes.count, Array(bytes[index..<index + w.count]) == w else { return nil }
        index += w.count
        return value
    }

    mutating func parseObject(depth: Int) -> JSONValue? {
        index += 1
        var members: [String: JSONValue] = [:]
        skipWhitespace()
        if index < bytes.count, bytes[index] == UInt8(ascii: "}") {
            index += 1
            return .object(members)
        }
        while true {
            skipWhitespace()
            guard index < bytes.count, bytes[index] == UInt8(ascii: "\""), let key = parseString() else { return nil }
            skipWhitespace()
            guard index < bytes.count, bytes[index] == UInt8(ascii: ":") else { return nil }
            index += 1
            guard let value = parseValue(depth: depth + 1) else { return nil }
            members[key] = value // JSON.parse keeps the last duplicate
            skipWhitespace()
            guard index < bytes.count else { return nil }
            if bytes[index] == UInt8(ascii: ",") { index += 1; continue }
            if bytes[index] == UInt8(ascii: "}") { index += 1; return .object(members) }
            return nil
        }
    }

    mutating func parseArray(depth: Int) -> JSONValue? {
        index += 1
        var items: [JSONValue] = []
        skipWhitespace()
        if index < bytes.count, bytes[index] == UInt8(ascii: "]") {
            index += 1
            return .array(items)
        }
        while true {
            guard let value = parseValue(depth: depth + 1) else { return nil }
            items.append(value)
            skipWhitespace()
            guard index < bytes.count else { return nil }
            if bytes[index] == UInt8(ascii: ",") { index += 1; continue }
            if bytes[index] == UInt8(ascii: "]") { index += 1; return .array(items) }
            return nil
        }
    }

    mutating func hex4() -> UInt16? {
        guard index + 4 <= bytes.count else { return nil }
        var value: UInt16 = 0
        for b in bytes[index..<index + 4] {
            let digit: UInt8
            switch b {
            case UInt8(ascii: "0")...UInt8(ascii: "9"): digit = b - UInt8(ascii: "0")
            case UInt8(ascii: "a")...UInt8(ascii: "f"): digit = b - UInt8(ascii: "a") + 10
            case UInt8(ascii: "A")...UInt8(ascii: "F"): digit = b - UInt8(ascii: "A") + 10
            default: return nil
            }
            value = value << 4 | UInt16(digit)
        }
        index += 4
        return value
    }

    mutating func parseString() -> String? {
        index += 1
        var units: [UInt16] = []
        var raw: [UInt8] = []
        func flush() {
            if !raw.isEmpty { units.append(contentsOf: String(decoding: raw, as: UTF8.self).utf16); raw.removeAll() }
        }
        while index < bytes.count {
            let b = bytes[index]
            if b == UInt8(ascii: "\"") {
                index += 1
                flush()
                return decodeUTF16(units)
            }
            if b < 0x20 { return nil }
            if b == UInt8(ascii: "\\") {
                flush()
                index += 1
                guard index < bytes.count else { return nil }
                let e = bytes[index]
                index += 1
                switch e {
                case UInt8(ascii: "\""): units.append(0x22)
                case UInt8(ascii: "\\"): units.append(0x5C)
                case UInt8(ascii: "/"): units.append(0x2F)
                case UInt8(ascii: "b"): units.append(0x08)
                case UInt8(ascii: "f"): units.append(0x0C)
                case UInt8(ascii: "n"): units.append(0x0A)
                case UInt8(ascii: "r"): units.append(0x0D)
                case UInt8(ascii: "t"): units.append(0x09)
                case UInt8(ascii: "u"):
                    guard let unit = hex4() else { return nil }
                    units.append(unit)
                default: return nil
                }
                continue
            }
            raw.append(b)
            index += 1
        }
        return nil
    }

    func decodeUTF16(_ units: [UInt16]) -> String {
        var scalars = String.UnicodeScalarView()
        var iterator = units.makeIterator()
        var decoder = UTF16()
        loop: while true {
            switch decoder.decode(&iterator) {
            case .scalarValue(let scalar): scalars.append(scalar)
            case .emptyInput: break loop
            case .error: scalars.append("\u{FFFD}")
            }
        }
        return String(scalars)
    }

    mutating func parseNumber() -> JSONValue? {
        let start = index
        func digits() -> Int {
            let from = index
            while index < bytes.count, bytes[index] >= UInt8(ascii: "0"), bytes[index] <= UInt8(ascii: "9") { index += 1 }
            return index - from
        }
        if index < bytes.count, bytes[index] == UInt8(ascii: "-") { index += 1 }
        guard index < bytes.count else { return nil }
        if bytes[index] == UInt8(ascii: "0") {
            index += 1
        } else if digits() == 0 {
            return nil
        }
        var integral = true
        if index < bytes.count, bytes[index] == UInt8(ascii: ".") {
            index += 1
            integral = false
            guard digits() > 0 else { return nil }
        }
        if index < bytes.count, bytes[index] == UInt8(ascii: "e") || bytes[index] == UInt8(ascii: "E") {
            index += 1
            integral = false
            if index < bytes.count, bytes[index] == UInt8(ascii: "+") || bytes[index] == UInt8(ascii: "-") { index += 1 }
            guard digits() > 0 else { return nil }
        }
        let text = String(decoding: bytes[start..<index], as: UTF8.self)
        if integral, let value = Int(text) { return .int(value) }
        guard let value = Double(text), value.isFinite else { return nil }
        return JSONValue.number(value)
    }
}
