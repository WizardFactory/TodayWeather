import Foundation
import Testing
import TWData
import TWModel
import TWStorage

/// The timeline of the Cordova `Push.init` (IN-04 review, CODEX-IN04-1) against the requests the real Cordova code
/// sends on a virtual clock (`Golden/push-timed.json`, ios/tools/push/generate.py): send times and order, paths,
/// headers, bodies and the stored token, with scripted reply delays and failures.
struct PushTimingTests {
    static let golden: JSONObject = {
        let url = Bundle.module.url(forResource: "push-timed", withExtension: "json", subdirectory: "Golden")!
        return try! JSONValue.parse(Data(contentsOf: url)).objectValue!
    }()

    static let places: [Place] = golden["cities"]!.arrayValue!.map { c in
        let loc = c["location"]!
        return Place(currentPosition: c["currentPosition"]!.boolValue!, disable: c["disable"]!.boolValue!,
                     name: c["name"]?.stringValue, address: c["address"]?.stringValue, country: c["country"]?.stringValue,
                     location: Location(lat: loc["lat"]!.numberValue!.double, long: loc["long"]!.numberValue!.double),
                     source: c["source"]?.stringValue)
    }

    static func context(_ c: JSONValue) -> PushRegistration.Context {
        PushRegistration.Context(
            deviceId: golden["deviceId"]!.stringValue!, language: golden["language"]!.stringValue!,
            appVersion: golden["appVersion"]!.stringValue!,
            units: UnitSettings(temperatureUnit: "C", windSpeedUnit: "m/s", pressureUnit: "hPa", distanceUnit: "km",
                                precipitationUnit: "mm", airUnit: c["airUnit"]!.stringValue!),
            now: Date(timeIntervalSince1970: golden["now"]!.numberValue!.double / 1000),
            zone: TimeZone(identifier: c["zone"]!.stringValue!)!)
    }

    static func ms(_ v: JSONValue?) -> Duration { .milliseconds(Int(v!.numberValue!.text)!) }

    @Test func casesCoverTheTimings() {
        let names = Self.golden["cases"]!.arrayValue!.map { $0["name"]!.stringValue! }
        for name in ["token-before-post", "token-after-post", "first-token-before-post", "failed-put-before-post",
                     "slow-put-token-after-post", "slow-post-token-after-post"] {
            #expect(names.contains(name), "\(name)")
        }
    }

    /// Each case on a virtual clock: the open at 0 ms with the token of an event at 0 ms as the token FCM holds;
    /// later tokens arrive through the token queue at their times; replies come after their scripted delays.
    @Test(arguments: golden["cases"]!.arrayValue!.map { $0["name"]!.stringValue! })
    func requestsFollowTheCordovaTimeline(name: String) async throws {
        let c = try #require(Self.golden["cases"]!.arrayValue!.first { $0["name"]!.stringValue! == name })
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-timing-\(UUID().uuidString)")
        let store = AppStateStore(url: dir.appendingPathComponent("app_state.json"))
        let queue = PushTokenQueue(url: dir.appendingPathComponent("push_tokens.json"))
        let stored = c["storedToken"]?.stringValue
        try store.save(AppState(places: Self.places, placeIndex: 1,
                                push: PushState(type: "ios", fcmToken: stored,
                                                records: Self.golden["pushList"]!.arrayValue!.map { $0.objectValue! }),
                                migration: MigrationInfo(source: "", migratedAtMillis: 0, keys: [:])))
        let events = c["events"]!.arrayValue!.map { (at: Self.ms($0["at"]), token: $0["token"]!.stringValue!) }
        var delays: [String: Duration] = [:]
        for (method, ms) in c["delays"]?.objectValue ?? JSONObject() { delays[method] = Self.ms(ms) }
        let clock = VirtualClock()
        let transport = TimedTransport(clock: clock, fail: Set(c["fail"]!.arrayValue!.map { $0.stringValue! }),
                                       delays: delays)
        let ctx = Self.context(c)
        let sync = PushSync(store: store, queue: queue, transport: transport, clock: clock, context: { _ in ctx })

        let atOpen = events.first { $0.at == .zero }?.token
        let open = Task { await sync.open { atOpen } }
        #expect(await eventually { await sync.openStarts == 1 }, "\(name): the open ran")
        // Tokens before the post, the post at 3 s (the clock stops there until the post ran), tokens after it.
        let repostAt = Duration.seconds(3)
        for event in events where event.at > .zero {
            if event.at > repostAt, await sync.reposts == 0 {
                clock.advance(to: repostAt)
                #expect(await eventually { await sync.reposts == 1 }, "\(name): the post ran")
            }
            clock.advance(to: event.at)
            try queue.append(event.token)
            await sync.handleQueuedTokens()
        }
        if await sync.reposts == 0 {
            clock.advance(to: repostAt)
            #expect(await eventually { await sync.reposts == 1 }, "\(name): the post ran")
        }
        clock.advance(to: .seconds(3600))
        await transport.finishAll()
        let outcome = await open.value
        #expect(outcome != nil)
        #expect(await eventually { await sync.pendingReplies == 0 }, "\(name): every reply handled")

        let expected = c["requests"]!.arrayValue!
        let actual = transport.requests
        #expect(actual.map { "\($0.at) \($0.request.method)" } ==
                expected.map { "\(Self.ms($0["at"])) \($0["method"]!.stringValue!)" }, "\(name): send times and order")
        for (e, a) in zip(expected, actual) {
            let path = JSString.replaceFirst(JSString.replaceFirst(e["url"]!.stringValue!, "https://server", ""),
                                             "/v000902/", "/v000903/")
            #expect(a.request.path == path, "\(name)")
            #expect(a.request.headers == Dictionary(uniqueKeysWithValues: e["headers"]!.objectValue!.map {
                ($0.key, $0.value.stringValue!)
            }), "\(name) headers")
            #expect(a.request.body.sameText(e["data"]!),
                    "\(name) \(a.request.method) body:\n\(a.request.body.jsonText)\nexpected:\n\(e["data"]!.jsonText)")
        }
        #expect(try store.load()?.push.fcmToken == (events.last?.token ?? stored), "\(name): stored token")
        #expect(try queue.pending().isEmpty, "\(name): queue")
    }

    /// A token queued while the post is pending whose own handling has not run yet is replaced first when the post
    /// is due, so the post carries it (as the Cordova token callback runs before the timer).
    @Test func aTokenQueuedBeforeThePostIsReplacedFirst() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let clock = VirtualClock()
        let transport = TimedTransport(clock: clock)
        let sync = PushSync(store: files.store, queue: files.queue, transport: transport, clock: clock,
                            context: Files.context)
        let open = Task { await sync.open { nil } }
        #expect(await eventually { await sync.openStarts == 1 })
        #expect(transport.requests.isEmpty, "nothing before the post without a new token")
        clock.advance(to: .seconds(1))
        try files.queue.append("token-b")
        clock.advance(to: .seconds(3))
        let outcome = try #require(await open.value)
        #expect(outcome.requests.map(\.method) == ["POST"])
        #expect(transport.requests.map(\.request.method) == ["PUT", "POST"])
        #expect(transport.requests.map(\.at) == [.seconds(3), .seconds(3)])
        #expect(replacement(transport.requests.first?.request) == ["token-b", "token-a"])
        #expect(transport.requests.last?.request.body[0]?["fcmToken"] == "token-b")
        #expect(files.storedToken == "token-b")
        #expect(await eventually { await sync.pendingReplies == 0 })
    }
}
