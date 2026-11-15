import Foundation

/// An error in JSON text, with the byte offset where it was found.
public struct JSONParseError: Error, CustomStringConvertible {
    public let offset: Int
    public let message: String
    public var description: String { "JSON error at byte \(offset): \(message)" }
}

/// A strict RFC 8259 parser that keeps member order and number texts (Foundation's parser keeps neither).
struct JSONParser {
    private let bytes: [UInt8]
    private var i = 0

    init(_ data: Data) { bytes = [UInt8](data) }

    mutating func parseDocument() throws -> JSONValue {
        // A UTF-8 byte order mark is not JSON, but tolerate it as JSON.parse's callers usually strip it.
        if bytes.starts(with: [0xEF, 0xBB, 0xBF]) { i = 3 }
        skipWhitespace()
        let value = try parseValue(depth: 0)
        skipWhitespace()
        if i != bytes.count { throw error("trailing characters") }
        return value
    }

    private func error(_ message: String) -> JSONParseError { JSONParseError(offset: i, message: message) }

    private mutating func skipWhitespace() {
        while i < bytes.count, bytes[i] == 0x20 || bytes[i] == 0x0A || bytes[i] == 0x0D || bytes[i] == 0x09 { i += 1 }
    }

    private mutating func expect(_ literal: String, _ value: JSONValue) throws -> JSONValue {
        let l = Array(literal.utf8)
        guard i + l.count <= bytes.count, Array(bytes[i..<i + l.count]) == l else { throw error("invalid literal") }
        i += l.count
        return value
    }

    private mutating func parseValue(depth: Int) throws -> JSONValue {
        guard depth < 512 else { throw error("nesting too deep") }
        guard i < bytes.count else { throw error("unexpected end") }
        switch bytes[i] {
        case UInt8(ascii: "{"): return try parseObject(depth: depth)
        case UInt8(ascii: "["): return try parseArray(depth: depth)
        case UInt8(ascii: "\""): return .string(try parseString())
        case UInt8(ascii: "t"): return try expect("true", .bool(true))
        case UInt8(ascii: "f"): return try expect("false", .bool(false))
        case UInt8(ascii: "n"): return try expect("null", .null)
        default: return .number(try parseNumber())
        }
    }

    private mutating func parseObject(depth: Int) throws -> JSONValue {
        i += 1
        var object = JSONObject()
        skipWhitespace()
        if i < bytes.count, bytes[i] == UInt8(ascii: "}") {
            i += 1
            return .object(object)
        }
        while true {
            skipWhitespace()
            guard i < bytes.count, bytes[i] == UInt8(ascii: "\"") else { throw error("expected a member name") }
            let key = try parseString()
            skipWhitespace()
            guard i < bytes.count, bytes[i] == UInt8(ascii: ":") else { throw error("expected ':'") }
            i += 1
            skipWhitespace()
            // A repeated name keeps its first position and the last value, as JSON.parse does.
            object[key] = try parseValue(depth: depth + 1)
            skipWhitespace()
            guard i < bytes.count else { throw error("unexpected end in an object") }
            if bytes[i] == UInt8(ascii: ",") { i += 1; continue }
            if bytes[i] == UInt8(ascii: "}") { i += 1; return .object(object) }
            throw error("expected ',' or '}'")
        }
    }

    private mutating func parseArray(depth: Int) throws -> JSONValue {
        i += 1
        var array: [JSONValue] = []
        skipWhitespace()
        if i < bytes.count, bytes[i] == UInt8(ascii: "]") {
            i += 1
            return .array(array)
        }
        while true {
            skipWhitespace()
            array.append(try parseValue(depth: depth + 1))
            skipWhitespace()
            guard i < bytes.count else { throw error("unexpected end in an array") }
            if bytes[i] == UInt8(ascii: ",") { i += 1; continue }
            if bytes[i] == UInt8(ascii: "]") { i += 1; return .array(array) }
            throw error("expected ',' or ']'")
        }
    }

    private mutating func parseNumber() throws -> JSONNumber {
        let start = i
        func digits() -> Int {
            let s = i
            while i < bytes.count, bytes[i] >= 0x30, bytes[i] <= 0x39 { i += 1 }
            return i - s
        }
        if i < bytes.count, bytes[i] == UInt8(ascii: "-") { i += 1 }
        guard i < bytes.count else { throw error("invalid number") }
        if bytes[i] == UInt8(ascii: "0") {
            i += 1
        } else if digits() == 0 {
            throw error("invalid number")
        }
        if i < bytes.count, bytes[i] == UInt8(ascii: ".") {
            i += 1
            if digits() == 0 { throw error("invalid number") }
        }
        if i < bytes.count, bytes[i] == UInt8(ascii: "e") || bytes[i] == UInt8(ascii: "E") {
            i += 1
            if i < bytes.count, bytes[i] == UInt8(ascii: "+") || bytes[i] == UInt8(ascii: "-") { i += 1 }
            if digits() == 0 { throw error("invalid number") }
        }
        return JSONNumber(text: String(decoding: bytes[start..<i], as: UTF8.self))
    }

    private static func hexValue(_ b: UInt8) -> UInt16? {
        switch b {
        case 0x30...0x39: return UInt16(b - 0x30)
        case 0x41...0x46: return UInt16(b - 0x41 + 10)
        case 0x61...0x66: return UInt16(b - 0x61 + 10)
        default: return nil
        }
    }

    private mutating func parseString() throws -> String {
        i += 1
        var units: [UInt16] = []
        var runStart = i
        // Text between escapes, as UTF-16; invalid UTF-8 (overlong forms, encoded surrogates, bytes above F4,
        // truncated sequences) is an error, not a replacement character.
        func flushRun() throws {
            guard runStart < i else { return }
            let failed = transcode(bytes[runStart..<i].makeIterator(), from: UTF8.self, to: UTF16.self,
                                   stoppingOnError: true) { units.append($0) }
            if failed { throw JSONParseError(offset: runStart, message: "invalid UTF-8 in a string") }
        }
        while true {
            guard i < bytes.count else { throw error("unterminated string") }
            let b = bytes[i]
            if b == UInt8(ascii: "\"") {
                try flushRun()
                i += 1
                // Lone surrogates from \u escapes become U+FFFD (Swift strings hold Unicode scalars only).
                return String(decoding: units, as: UTF16.self)
            }
            if b < 0x20 { throw error("control character in a string") }
            if b == UInt8(ascii: "\\") {
                try flushRun()
                i += 1
                guard i < bytes.count else { throw error("unterminated escape") }
                let e = bytes[i]
                i += 1
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
                    // Exactly four ASCII hex digits (UInt16(_:radix:) would also take a sign).
                    guard i + 4 <= bytes.count else { throw error("\\u must be followed by 4 hex digits") }
                    var v: UInt16 = 0
                    for b in bytes[i..<i + 4] {
                        guard let digit = Self.hexValue(b) else { throw error("invalid \\u escape") }
                        v = v << 4 | digit
                    }
                    units.append(v)
                    i += 4
                default: throw error("invalid escape")
                }
                runStart = i
                continue
            }
            i += 1
        }
    }
}
