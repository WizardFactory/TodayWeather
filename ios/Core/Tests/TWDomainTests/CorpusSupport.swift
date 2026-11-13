import Foundation
import Testing
import TWModel

/// The golden corpus copied from android/ (ios/tools/import_corpus.py), read from the test bundle.
enum Corpus {
    static var root: URL { Bundle.module.resourceURL!.appendingPathComponent("Corpus", isDirectory: true) }

    static func read(_ name: String) throws -> JSONValue {
        try JSONValue.parse(Data(contentsOf: root.appendingPathComponent(name)))
    }

    /// File names under `conversion/`, sorted as Kotlin's `File.sorted()` (by path).
    static func conversionNames() throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("conversion").path)
            .filter { $0.hasSuffix(".json") }
            .sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) }
    }

    /// The repository's ios/ directory (ios/Core/Tests/TWDomainTests/<file>), for files kept outside the bundle.
    static let iosDir = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
}

/// The values where the Cordova code gives another result under JavaScriptCore (the iOS app's engine) than under Node,
/// as ios/tools/corpus/compare_jsc.py recorded them. For exactly these values the iOS expectation is the
/// JavaScriptCore output; every other value stays on the shared corpus.
struct JavaScriptCoreDifference {
    let file: String
    let section: String?
    let index: Int?
    let path: [JSONValue]
    let node: JSONValue
    let javaScriptCore: JSONValue

    static func all() throws -> [JavaScriptCoreDifference] {
        let url = Bundle.module.resourceURL!.appendingPathComponent("JavaScriptCore/differences.json")
        let record = try JSONValue.parse(Data(contentsOf: url))
        return try (record["differences"]?.arrayValue ?? []).map { d in
            JavaScriptCoreDifference(
                file: s(d["file"])!, section: s(d["section"]), index: d["index"]?.numberValue.map { Int($0.double) },
                path: d["path"]?.arrayValue ?? [],
                node: try JSONValue.parse(s(d["node"])!), javaScriptCore: try JSONValue.parse(s(d["javaScriptCore"])!))
        }
    }

    /// [caseValue] with this difference's JavaScriptCore value at its path. Fails when the corpus no longer has the
    /// recorded Node value there (the record is stale: rerun the tool).
    func apply(to caseValue: JSONValue, sourceLocation: SourceLocation = #_sourceLocation) -> JSONValue {
        let current = value(caseValue, path[...])
        #expect(current.map { jsonDifference(node, $0, "") == nil } == true,
                "\(file)[\(index ?? -1)] \(path): the corpus value is \(current?.jsonText ?? "absent"), recorded \(node.jsonText)",
                sourceLocation: sourceLocation)
        return replacing(caseValue, path[...], javaScriptCore)
    }

    private func value(_ v: JSONValue, _ path: ArraySlice<JSONValue>) -> JSONValue? {
        guard let head = path.first else { return v }
        switch head {
        case .string(let k): return v[k].flatMap { value($0, path.dropFirst()) }
        case .number(let n): return v[Int(n.double)].flatMap { value($0, path.dropFirst()) }
        default: return nil
        }
    }

    private func replacing(_ v: JSONValue, _ path: ArraySlice<JSONValue>, _ new: JSONValue) -> JSONValue {
        guard let head = path.first else { return new }
        switch (v, head) {
        case (.object(let o), .string(let k)):
            guard let child = o[k] else { return v }
            return .object(o.setting(k, replacing(child, path.dropFirst(), new)))
        case (.array(var a), .number(let n)):
            let i = Int(n.double)
            guard a.indices.contains(i) else { return v }
            a[i] = replacing(a[i], path.dropFirst(), new)
            return .array(a)
        default: return v
        }
    }
}

/// A corpus case list: `[{args, expected}]`; an undefined Cordova result is omitted from the JSON and reads as null.
func cases(_ e: JSONValue?) -> [(args: [JSONValue], expected: JSONValue)] {
    (e?.arrayValue ?? []).map { ($0["args"]?.arrayValue ?? [], $0["expected"] ?? .null) }
}

/// The content of a string or number (Kotlin's `jsonPrimitive.content`), nil for null and containers.
func s(_ e: JSONValue?) -> String? {
    switch e {
    case .string(let v): return v
    case .number(let n): return n.text
    case .bool(let b): return b ? "true" : "false"
    default: return nil
    }
}

/// An argument that the generator wrote as null for undefined.
func arg(_ e: JSONValue?) -> JSONValue? { e?.isNull == false ? e : nil }

func double(_ e: JSONValue?) -> Double { e?.numberValue?.double ?? .nan }
func int(_ e: JSONValue?) -> Int { Int(double(e)) }

/// The first difference between two JSON trees: member names and their order, array lengths, value types, strings
/// and number texts (so integers and fractional numbers stay apart). nil when the trees are the same.
func jsonDifference(_ expected: JSONValue?, _ actual: JSONValue?, _ path: String) -> String? {
    switch (expected, actual) {
    case (nil, nil): return nil
    case (.object(let e)?, .object(let a)?):
        if e.keys != a.keys { return "\(path): keys \(e.keys) != \(a.keys)" }
        for k in e.keys {
            if let d = jsonDifference(e[k], a[k], "\(path).\(k)") { return d }
        }
        return nil
    case (.array(let e)?, .array(let a)?):
        if e.count != a.count { return "\(path): size \(e.count) != \(a.count)" }
        for i in e.indices {
            if let d = jsonDifference(e[i], a[i], "\(path)[\(i)]") { return d }
        }
        return nil
    default:
        let et = expected?.jsonText ?? "undefined", at = actual?.jsonText ?? "undefined"
        return et == at ? nil : "\(path): \(et) != \(at)"
    }
}

/// Expects two JSON trees to be the same (``jsonDifference(_:_:_:)``).
func expectJSON(_ expected: JSONValue?, _ actual: JSONValue?, _ path: String,
                sourceLocation: SourceLocation = #_sourceLocation) {
    let d = jsonDifference(expected, actual, path)
    #expect(d == nil, "\(d ?? "")", sourceLocation: sourceLocation)
}
