import Foundation
import TWModel

/// The legacy server's routes as `ios/tools/server-routes/generate.py` read them from `server/`
/// (`Golden/server-routes/routes.json`), dispatched as Express 4.13.4 does (`lib/router/index.js` `handle` and
/// `trim_prefix`, `lib/router/layer.js` `match`); a port of the Android `ServerRoutes` (AN-18):
/// - each router tries its layers in registration order, starting with `server/app.js`;
/// - a middleware or mount matches a prefix of the path that ends at `/`, `.` or the end (any path for `/`); a mount goes
///   on in its router with the prefix removed, and back here when nothing there answered;
/// - a route matches the whole rest of the path and its method (`ALL` any method; `HEAD` a `GET` route too);
/// - middleware are taken to call `next()`, so callers check which ones a request passed; error handlers (four
///   parameters) do not run for a request without an error.
/// Paths are matched as sent, percent-encoded, as Express matches `req.url`.
struct ServerRoutes {
    struct Layer {
        let file: String
        let line: Int
        let kind: String
        let method: String?
        let path: String
        let regex: NSRegularExpression
        let matchesAll: Bool
        let router: String?
        let handler: String?
        let arity: Int?

        var source: String { "\(file):\(line)" }

        /// The part of `path` this layer matches from its start (all of it for a route), or nil.
        func match(_ path: String) -> String? {
            if matchesAll { return "" }
            let range = NSRange(path.startIndex..., in: path)
            guard let m = regex.firstMatch(in: path, range: range), m.range.location == 0,
                  let r = Range(m.range, in: path) else { return nil }
            return String(path[r])
        }
    }

    /// The route that answers, the mounts that led to it, and the middleware that ran before it.
    struct Match {
        let route: Layer
        let mounts: [Layer]
        let passed: [Layer]

        /// The route's pattern under its mounts, e.g. `/v000903/kma/addr/:region`.
        var pattern: String {
            let joined = (mounts.map(\.path) + [route.path]).filter { $0 != "/" }.joined()
            return joined.isEmpty ? "/" : joined
        }
    }

    let app: String
    let express: String
    let routers: [String: [Layer]]

    /// The route `method` `path` reaches, or nil when none does (the application's 404 handler answers).
    func dispatch(_ method: String, _ path: String) -> Match? {
        var passed: [Layer] = []
        return dispatch(app, method, path, [], &passed)
    }

    private func dispatch(_ file: String, _ method: String, _ path: String, _ mounts: [Layer],
                          _ passed: inout [Layer]) -> Match? {
        for layer in routers[file] ?? [] {
            guard let matched = layer.match(path) else { continue }
            if layer.kind == "route" {
                if layer.method == "ALL" || layer.method == method || (method == "HEAD" && layer.method == "GET") {
                    return Match(route: layer, mounts: mounts, passed: passed)
                }
                continue
            }
            let utf16 = Array(path.utf16)
            let length = matched.utf16.count
            if length < utf16.count {
                let next = utf16[length]
                if next != UInt16(UInt8(ascii: "/")) && next != UInt16(UInt8(ascii: ".")) { continue }
            }
            switch layer.kind {
            case "middleware":
                if (layer.arity ?? 0) <= 3 { passed.append(layer) }
            case "mount":
                var rest = String(path.dropFirst(matched.count))
                if !rest.hasPrefix("/") { rest = "/" + rest }
                if let found = dispatch(layer.router!, method, rest, mounts + [layer], &passed) { return found }
            default:
                fatalError("unknown layer kind \(layer.kind) at \(layer.source)")
            }
        }
        return nil
    }

    static func load() throws -> ServerRoutes {
        let table = try golden("routes.json")
        var routers: [String: [Layer]] = [:]
        for router in table["routers"]?.arrayValue ?? [] {
            let file = router["file"]?.stringValue ?? ""
            routers[file] = try (router["layers"]?.arrayValue ?? []).map { try layer(file, $0) }
        }
        for layer in routers.values.joined() where layer.kind == "mount" {
            guard let target = layer.router, routers[target] != nil else {
                throw RouteTableError(message: "\(layer.source) mounts \(layer.router ?? "nil"), which the table lacks")
            }
        }
        return ServerRoutes(app: table["app"]?.stringValue ?? "", express: table["express"]?.stringValue ?? "",
                            routers: routers)
    }

    struct RouteTableError: Error, CustomStringConvertible {
        let message: String
        var description: String { message }
    }

    /// A file of `Golden/server-routes/`.
    static func golden(_ name: String) throws -> JSONValue {
        guard let url = Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Golden/server-routes") else {
            throw RouteTableError(message: "Golden/server-routes/\(name) is missing")
        }
        return try JSONValue.parse(Data(contentsOf: url))
    }

    private static func layer(_ file: String, _ l: JSONValue) throws -> Layer {
        let options: NSRegularExpression.Options = l["ignoreCase"]?.boolValue == true ? [.caseInsensitive] : []
        let pattern = l["regex"]?.stringValue ?? ""
        return Layer(file: file, line: Int(l["line"]?.numberValue?.double ?? 0), kind: l["kind"]?.stringValue ?? "",
                     method: l["method"]?.stringValue, path: l["path"]?.stringValue ?? "",
                     regex: try NSRegularExpression(pattern: pattern, options: options),
                     matchesAll: l["matchesAll"]?.boolValue == true, router: l["router"]?.stringValue,
                     handler: l["handler"]?.stringValue, arity: l["arity"]?.numberValue.map { Int($0.double) })
    }
}
