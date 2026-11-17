import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage

/// Records every request of its sessions (method, host and the path as sent, percent-encoded) and answers each at once
/// with an empty JSON object.
final class RouteRecorder: URLProtocol, @unchecked Sendable {
    struct Seen: Equatable {
        let method: String
        let host: String
        let path: String
    }

    nonisolated(unsafe) private static var seen: [Seen] = []
    private static let lock = NSLock()

    static var requests: [Seen] { lock.withLock { seen } }
    static func reset() { lock.withLock { seen = [] } }

    static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RouteRecorder.self]
        return URLSession(configuration: config)
    }()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let url = request.url!
        let entry = Seen(method: request.httpMethod ?? "GET", host: url.host ?? "", path: url.path(percentEncoded: true))
        Self.lock.withLock { Self.seen.append(entry) }
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [:])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// AC3 of #2967 (spec R8): every request the native client sends has a path the legacy server serves under `v000903`,
/// or is an exception the register lists with its decision (`Golden/server-routes/exceptions.json`). A port of the
/// Android `RequestPathsTest` (AN-18).
///
/// The production clients and transports send through `URLSession` to a recording protocol, so the paths are the
/// ones on the wire, encoded as the app encodes them (`WeatherRequests.requestURL`). The inputs take every branch of the
/// request builders: the Cordova corpus's weather cases (coordinates, the KMA town route with one to three parts, the
/// free-form fallback), geocoding by position and by address, the nation and warning pages, and every push flow. Each
/// path goes through the route table generated from `server/` (`ios/tools/server-routes/generate.py`; CI fails when it
/// is stale) as Express dispatches it (`ServerRoutes`). `RequestSitesTests` keeps these clients the only request sites.
@Suite(.serialized)
@MainActor
struct RequestPathsTests {
    static let legacyHost = "legacy.test.invalid"
    static let photoHost = "photos.test.invalid"
    static let feedPath = "/weather-photos.json"
    static let languages = ["ko-KR,ko;q=0.9", "en-US,en;q=0.9"]

    /// A request's route, the register entry that lists it, or what fails it (`problem`).
    struct Verdict {
        let method: String
        let path: String
        let match: ServerRoutes.Match?
        let exception: String?
        let problem: String?
        var route: String { match.map { "\($0.route.method ?? "") \($0.pattern)" } ?? "(no route)" }
    }

    let routes: ServerRoutes
    let register: [JSONValue]

    init() throws {
        routes = try ServerRoutes.load()
        register = try ServerRoutes.golden("exceptions.json")["exceptions"]?.arrayValue ?? []
    }

    @Test func everyRequestIsAServedV000903RouteOrAListedException() async throws {
        RouteRecorder.reset()
        let cases = try Self.weatherCases()
        try await sendEveryRequest(cases)
        let all = RouteRecorder.requests
        let legacy = all.filter { $0.host == Self.legacyHost }
        let photos = all.filter { $0.host == Self.photoHost }
        #expect(all.count == legacy.count + photos.count, "requests only to the server and the feed: \(all)")

        let sent = Set(legacy.map(\.path))
        for c in cases {
            guard let text = c["url"]?.stringValue, let url = WeatherRequests.requestURL(text) else { continue }
            #expect(sent.contains(url.path(percentEncoded: true)), "\(c["name"]?.stringValue ?? ""): \(url) was not sent")
        }
        let verdicts = legacy.map { verdict($0.method, $0.path) }
        print(table(verdicts, feed: photos.count))

        let problems = verdicts.compactMap { v in v.problem.map { "\(v.method) \(v.path): \($0)" } }
        #expect(Array(Set(problems)).sorted() == [])
        #expect(Set(verdicts.map(\.route)) == Self.expected, "the routes the native client reaches")
        #expect(register.map { $0["id"]?.stringValue } == ["E1", "E2", "E3", "E4"])
        #expect(register.filter { $0["observedBy"]?.stringValue == "RequestPathsTests" }.map { $0["id"]?.stringValue }
                == ["E1", "E2"])
        #expect(Set(verdicts.compactMap(\.exception)) == ["E1"], "the server's exceptions the client still sends")
        #expect(!photos.isEmpty && photos.allSatisfy { $0.method == "GET" && $0.path == Self.feedPath },
                "E2: the photo feed, at its own URL: \(photos)")
    }

    /// The register lists requests, not routes: a request is an exception only when its method and path are the entry's
    /// and the entry's route answers it. Anything else the gateway's 404 route answers fails, as does a path no route
    /// serves, a route of another method, or another version.
    @Test func onlyARegisteredRequestIsAnException() {
        #expect(verdict("GET", "/weather/v000903/addr/London").exception == "E1")
        #expect(verdict("GET", "/weather/v000903/addr/1/2%20Abbey%20Road").exception == "E1")
        let others: [(String, String)] = [
            ("POST", "/weather/v000903/addr/London"),
            ("GET", "/geocode/v000903/not-a-route"),
            ("GET", "/weather/v000903/address/London"),
            ("GET", "/weather/v000903/addr/"),
            ("GET", "/v000903/kma/addr/a/b/c/d"),
            ("GET", "/v000903/push"),
            ("GET", "/weather/v000902/coord/37.5,127"),
        ]
        for (method, path) in others {
            let v = verdict(method, path)
            #expect(v.exception == nil, "\(method) \(path) is not E1")
            #expect(v.problem != nil, "\(method) \(path) must fail")
        }
        #expect(verdict("GET", "/weather/v000902/coord/37.5,127").problem == "not under v000903")
        #expect(verdict("GET", "/weather/v000903/coord/37.5,127").problem == nil)
    }

    /// The dispatch follows Express where these paths need it (the server's behavior, read from its source).
    @Test func theDispatchFollowsExpress() throws {
        func route(_ method: String, _ path: String) -> String? {
            routes.dispatch(method, path).map { "\($0.route.method ?? "") \($0.pattern)" }
        }
        // The versioned routers match any case; the gateway is case-sensitive, like CloudFront's path patterns.
        #expect(route("GET", "/V000903/KMA/special") == "GET /v000903/kma/special")
        #expect(route("GET", "/Weather/v000903/coord/37.5,127") == nil)
        // The gateway answers its other paths and methods with its 404 route.
        #expect(route("GET", "/weather/v000904/coord/37.5,127") == "ALL OWN_PATH")
        #expect(route("POST", "/geocode/v000903/coord/37.5,127") == "ALL OWN_PATH")
        // A trailing slash is optional; a mount ends at a slash; a route takes the whole rest of the path.
        #expect(route("PUT", "/v000903/push/") == "PUT /v000903/push")
        #expect(route("PUT", "/v000903/pushes") == nil)
        #expect(route("GET", "/v000903/kma/addr/a/b/c/d") == nil)
        // The method decides; HEAD reaches a GET route.
        #expect(route("GET", "/v000903/push") == nil)
        #expect(route("HEAD", "/v000903/kma/special") == "GET /v000903/kma/special")
        // Middleware run in order: v000803's authorization check comes before its routes, a router's own after its mount.
        let v000803 = try #require(routes.dispatch("GET", "/v000803/nation/KR"))
        #expect(v000803.passed.filter { $0.file.contains("v000803") }.map(\.handler)
                == ["function checkAuthorization(req, res, next)", "function timestamp(req, res, next)"])
        // The gateway comes before the session; its error handler (four parameters) does not run without an error.
        #expect(routes.dispatch("GET", "/weather/v000903/coord/37.5,127")?.passed.map(\.handler) == ["cors(…)"])
        #expect(routes.dispatch("GET", "/v000903/kma/special")?.passed.map(\.handler) == [
            "cors(…)", "session(…)", "favicon(…)", "bodyParser.json(…)", "bodyParser.urlencoded(…)", "cookieParser(…)",
            "express.static(…)", "i18n.init", "function timestamp(req, res, next)", "function timestamp(req, res, next)",
        ])
        // Other paths reach no route: the application's 404 handler answers them.
        #expect(route("GET", "/nowhere") == nil)
    }

    /// `method` `path` passes when a route of its method serves it under `v000903` behind reviewed middleware, or when a
    /// not-served register entry lists this request (its method and path) and names the route that answers it.
    func verdict(_ method: String, _ path: String) -> Verdict {
        let match = routes.dispatch(method, path)
        let listed = register.first { lists($0, method, path, match) }
        let problem: String?
        if !Self.versioned(path) {
            problem = "not under v000903"
        } else if listed != nil {
            problem = nil
        } else if let match {
            if match.route.method != method {
                problem = "answered by \(match.route.method ?? "") \(match.pattern) (\(match.route.source)), which the register does not list for it"
            } else if let unreviewed = match.passed.first(where: { Self.passed["\($0.file) \($0.handler ?? "")"] == nil }) {
                problem = "passes \(unreviewed.handler ?? "") (\(unreviewed.source)), which is not reviewed"
            } else {
                problem = nil
            }
        } else {
            problem = "no route of the legacy server answers it"
        }
        return Verdict(method: method, path: path, match: match, exception: listed?["id"]?.stringValue, problem: problem)
    }

    /// This not-served entry lists `method` `path`: its request's method and path, answered by its route.
    private func lists(_ entry: JSONValue, _ method: String, _ path: String, _ match: ServerRoutes.Match?) -> Bool {
        guard entry["kind"]?.stringValue == "not-served", let match, let request = entry["match"], let route = entry["route"],
              let pattern = request["path"]?.stringValue,
              let regex = try? NSRegularExpression(pattern: pattern) else { return false }
        let whole = regex.firstMatch(in: path, range: NSRange(path.startIndex..., in: path))
        return method == request["method"]?.stringValue && whole?.range == NSRange(path.startIndex..., in: path)
            && route["file"]?.stringValue == match.route.file && route["method"]?.stringValue == match.route.method
            && route["path"]?.stringValue == match.route.path
    }

    /// What the app sends, through the production clients and transports.
    private func sendEveryRequest(_ cases: [JSONValue]) async throws {
        let base = "http://\(Self.legacyHost)"
        let http = URLSessionGet(session: RouteRecorder.session)
        // W1–W3: every case of the Cordova corpus (coordinates; latitude 0 with an address; the KMA town route with one
        // to three parts; the free-form fallback; nothing to send).
        let weather = WeatherRepository(baseURL: base, cacheDirectory: nil, http: http)
        for c in cases {
            for language in Self.languages {
                _ = await weather.load(Self.place(c), units: Self.units(c["units"]), acceptLanguage: language, force: true)
            }
        }
        // G1, G2: a position (S01, S02), a prediction's full text (S01) and its terms joined (S02), a place abroad.
        let geocode = GeocodeClient(baseURL: base, http: http)
        for language in Self.languages {
            _ = await geocode.byLocation(Location(lat: 37.561, long: 126.979), acceptLanguage: language)
            _ = await geocode.byAddress("대한민국 서울특별시 중구 회현동", acceptLanguage: language)
            _ = await geocode.byAddress("회현동,중구,서울특별시", acceptLanguage: language)
            _ = await geocode.byAddress("Westminster Abbey, London, UK", acceptLanguage: language)
        }
        // N1, N2: S10 and S11 (region KR), S12.
        let nation = NationSource(baseURL: base, http: http)
        _ = await nation.nation(region: "KR", units: UnitSettings.defaults(region: "KR"), acceptLanguage: Self.languages[0])
        _ = await nation.special(acceptLanguage: Self.languages[0])
        // P1–P3: every flow of PushSync.
        try await pushFlows(base)
        // E2: the photo feed, at its own URL.
        let feed = WeatherPhotoFeed(url: URL(string: "http://\(Self.photoHost)\(Self.feedPath)"), http: http)
        _ = await feed.load()
    }

    private func pushFlows(_ base: String) async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HTTPPushTransport(baseURL: base, session: RouteRecorder.session)
        let (sync, _) = try files.process(transport)
        let flows: [(String, () async -> PushSync.Outcome?)] = [
            ("the app opens with a new token (P1, then P3)", { await sync.open { "token-b" } }),
            ("FCM delivers another token (P1)", {
                await sync.receive(token: "token-c")
                return nil
            }),
            ("a unit changes on S08 (P3)", { await sync.updateUnits() }),
            ("S09 saves the place's alarms (P3)", { await sync.postPlace(1) }),
            ("O06 is answered (P3)", { await sync.postList() }),
            ("S02 deletes the place (P2)", { await sync.removeCity(1) }),
        ]
        var sent = 0
        for (name, flow) in flows {
            let before = RouteRecorder.requests.count
            _ = await flow()
            #expect(RouteRecorder.requests.count > before, "\(name): nothing sent")
            sent += 1
        }
        #expect(sent == flows.count)
    }

    private func table(_ verdicts: [Verdict], feed: Int) -> String {
        var out = "Requests of the native client, dispatched by the route table of \(routes.app) (express \(routes.express)):\n"
        out += "| Method | A path on the wire | Sent | Route | Verdict |\n| --- | --- | --- | --- | --- |\n"
        var order: [String] = []
        var groups: [String: [Verdict]] = [:]
        for v in verdicts {
            if groups[v.route] == nil { order.append(v.route) }
            groups[v.route, default: []].append(v)
        }
        for key in order {
            let group = groups[key]!
            let v = group[0]
            let route = v.match.map { "\($0.route.method ?? "") \($0.pattern) (\($0.route.source))" } ?? "none"
            let verdict = v.exception.map { "\($0): not served" } ?? "served, v000903"
            out += "| \(v.method) | \(v.path) | \(group.count) | \(route) | \(verdict) |\n"
        }
        out += "| GET | {TW_WEATHER_PHOTOS_URL} | \(feed) | another host | E2 |"
        return out
    }

    static func weatherCases() throws -> [JSONValue] {
        let url = WeatherFixtures.corpus.deletingLastPathComponent().appendingPathComponent("requests.json")
        return try JSONValue.parse(Data(contentsOf: url)).arrayValue ?? []
    }

    static func place(_ c: JSONValue) -> Place {
        let geo = c["geoInfo"]
        let location: Location? = geo?["location"].flatMap { l in
            guard let lat = l["lat"]?.numberValue?.double, let long = l["long"]?.numberValue?.double else { return nil }
            return Location(lat: lat, long: long)
        }
        return Place(currentPosition: false, disable: false, address: geo?["address"]?.stringValue, location: location)
    }

    static func units(_ u: JSONValue?) -> UnitSettings {
        func text(_ key: String) -> String { u?[key]?.stringValue ?? "" }
        return UnitSettings(temperatureUnit: text("temperatureUnit"), windSpeedUnit: text("windSpeedUnit"),
                            pressureUnit: text("pressureUnit"), distanceUnit: text("distanceUnit"),
                            precipitationUnit: text("precipitationUnit"), airUnit: text("airUnit"))
    }

    /// `v000903` as the first path segment, or the second after `weather` or `geocode` (AN-06, #2948).
    static func versioned(_ path: String) -> Bool {
        path.range(of: "^/(?:weather/|geocode/)?v000903(?:/.*)?$", options: .regularExpression) != nil
    }

    /// The routes the native client reaches: W1, W2 (one to three parts), W3 (E1), G1, G2, N1, N2, P1–P3. The Android
    /// client reaches the same twelve.
    static let expected: Set<String> = [
        "GET /weather/:version(v000901|v000902|v000903)/coord/:loc",
        "GET /v000903/kma/addr/:region",
        "GET /v000903/kma/addr/:region/:city",
        "GET /v000903/kma/addr/:region/:city/:town",
        "ALL OWN_PATH",
        "GET /geocode/:version(v000903)/coord/:loc",
        "GET /geocode/:version(v000901|v000903)/addr/*",
        "GET /v000903/nation/:nation",
        "GET /v000903/kma/special",
        "PUT /v000903/push",
        "DELETE /v000903/push",
        "POST /v000903/push-list",
    ]

    /// The middleware these requests pass before their routes, each read to go on to the route (as reviewed for AN-18).
    static let passed: [String: String] = [
        "server/app.js cors(…)": "adds the CORS headers",
        "server/app.js session(…)": "reads or sets the session cookie",
        "server/app.js favicon(…)": "answers /favicon.ico only",
        "server/app.js bodyParser.json(…)": "parses a JSON body",
        "server/app.js bodyParser.urlencoded(…)": "parses a form body",
        "server/app.js cookieParser(…)": "parses the cookies",
        "server/app.js express.static(…)": "answers the files under server/public (img, lib, stylesheets) only",
        "server/app.js i18n.init": "sets the request's language",
        "server/routes/v000903/index.js function timestamp(req, res, next)": "logs the request",
        "server/routes/v000903/route.kma.v000903.js function timestamp(req, res, next)": "logs the request",
        "server/routes/v000803/route.nation.js function timestamp(req, res, next)": "logs the request",
        "server/routes/v000705/routePushNotification.js function (req, res, next)":
            "with PUSH_STORE=s3 hands the change to the push coordinator, which applies it; otherwise goes on",
        "server/routes/v000902/route.push.update.list.js function (req, res, next)": "the same, for the list",
    ]
}
