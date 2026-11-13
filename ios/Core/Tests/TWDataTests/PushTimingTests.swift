import Foundation
import Testing
import TWData
import TWModel
import TWStorage

/// A sleep the test ends: `PushSync` waits on it for the list post after an open, and the test resumes it.
actor ManualSleep {
    private var waiting: [CheckedContinuation<Void, Never>] = []
    private(set) var durations: [Duration] = []

    func sleep(_ duration: Duration) async {
        durations.append(duration)
        await withCheckedContinuation { waiting.append($0) }
    }

    var isWaiting: Bool { !waiting.isEmpty }

    func release() {
        waiting.forEach { $0.resume() }
        waiting = []
    }

    /// Waits (real time, at most 5 s) until a sleep has started.
    nonisolated func untilWaiting() async {
        for _ in 0..<500 where await !isWaiting { try? await Task.sleep(for: .milliseconds(10)) }
    }
}

/// Records requests in order; requests whose method is in `fail` get no answer (nil), as a failed `$http` call.
final class OrderedTransport: PushTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var sent: [PushRequest] = []
    let fail: Set<String>

    init(fail: Set<String> = []) { self.fail = fail }

    var requests: [PushRequest] { lock.withLock { sent } }

    func send(_ request: PushRequest) async -> Int? {
        lock.withLock { sent.append(request) }
        return fail.contains(request.method) ? nil : 200
    }
}

/// The timing of the Cordova `Push.init` (IN-04 review, CODEX-IN04-1) against the requests the real Cordova code
/// sends on a virtual clock (`Golden/push-timed.json`, ios/tools/push/generate.py): the list is posted 3 seconds after
/// the open with the token current then, and a token that arrives before is replaced first.
struct PushTimingTests {
    static let golden: JSONObject = {
        let url = Bundle.module.url(forResource: "Golden/push-timed", withExtension: "json")!
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

    @Test func casesCoverTheTimings() {
        let names = Self.golden["cases"]!.arrayValue!.map { $0["name"]!.stringValue! }
        for name in ["token-before-post", "token-after-post", "first-token-before-post", "failed-put-before-post"] {
            #expect(names.contains(name), "\(name)")
        }
    }

    /// A token queued during the wait whose own registration has not run yet is replaced before the list post, so
    /// the post carries it (as in Cordova, where the token callback runs before the timer).
    @Test func aTokenQueuedDuringTheWaitIsReplacedBeforeThePost() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = OrderedTransport()
        let clock = ManualSleep()
        let sync = PushSync(store: files.store, queue: files.queue, transport: transport, sleep: { await clock.sleep($0) },
                            context: Files.context)
        let open = Task { await sync.open { nil } }
        await clock.untilWaiting()
        #expect(transport.requests.isEmpty, "nothing before the post without a new token")
        try files.queue.append("token-b")
        await clock.release()
        let outcome = try #require(await open.value)
        #expect(outcome.requests.map(\.method) == ["POST"])
        #expect(transport.requests.map(\.method) == ["PUT", "POST"])
        #expect(replacement(transport.requests.first) == ["token-b", "token-a"])
        #expect(transport.requests.last?.body[0]?["fcmToken"] == "token-b")
        #expect(files.storedToken == "token-b")
    }

    /// Each case: tokens at 0 ms are the token FCM holds at the open; later ones arrive through the token queue
    /// before or after the sleep for the list post ends. Requests, their order and bodies, and the stored token must be
    /// those of the Cordova code.
    @Test func requestsFollowTheCordovaTimeline() async throws {
        for c in Self.golden["cases"]!.arrayValue! {
            let name = c["name"]!.stringValue!
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-timing-\(UUID().uuidString)")
            let store = AppStateStore(url: dir.appendingPathComponent("app_state.json"))
            let queue = PushTokenQueue(url: dir.appendingPathComponent("push_tokens.json"))
            let stored = c["storedToken"]?.stringValue
            try store.save(AppState(places: Self.places, placeIndex: 1,
                                    push: PushState(type: "ios", fcmToken: stored,
                                                    records: Self.golden["pushList"]!.arrayValue!.map { $0.objectValue! }),
                                    migration: MigrationInfo(source: "", migratedAtMillis: 0, keys: [:])))
            let events = c["events"]!.arrayValue!.map { (at: Int($0["at"]!.numberValue!.text)!, token: $0["token"]!.stringValue!) }
            let fail = Set(c["fail"]!.arrayValue!.map { $0.stringValue! })
            let transport = OrderedTransport(fail: fail)
            let clock = ManualSleep()
            let ctx = Self.context(c)
            let sync = PushSync(store: store, queue: queue, transport: transport, sleep: { await clock.sleep($0) },
                                context: { _ in ctx })
            let atOpen = events.first { $0.at == 0 }?.token
            let open = Task { await sync.open { atOpen } }
            await clock.untilWaiting()
            for event in events where event.at > 0 && event.at < 3000 {
                try queue.append(event.token)
                _ = await sync.drain()
            }
            await clock.release()
            _ = await open.value
            for event in events where event.at >= 3000 {
                try queue.append(event.token)
                _ = await sync.drain()
            }
            #expect(await clock.durations == [.seconds(3)], "\(name): one wait of 3 s for the list post")
            let expected = c["requests"]!.arrayValue!
            let actual = transport.requests
            #expect(actual.map(\.method) == expected.map { $0["method"]!.stringValue! }, "\(name): order")
            for (e, a) in zip(expected, actual) {
                let path = JSString.replaceFirst(JSString.replaceFirst(e["url"]!.stringValue!, "https://server", ""),
                                                 "/v000902/", "/v000903/")
                #expect(a.path == path, "\(name)")
                #expect(a.headers == Dictionary(uniqueKeysWithValues: e["headers"]!.objectValue!.map { ($0.key, $0.value.stringValue!) }),
                        "\(name) headers")
                #expect(a.body.sameText(e["data"]!), "\(name) \(a.method) body:\n\(a.body.jsonText)\nexpected:\n\(e["data"]!.jsonText)")
            }
            #expect(try store.load()?.push.fcmToken == (events.last?.token ?? stored), "\(name): stored token")
            #expect(try queue.pending().isEmpty, "\(name): queue")
        }
    }
}
