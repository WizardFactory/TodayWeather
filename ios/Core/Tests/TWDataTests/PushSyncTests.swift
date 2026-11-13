import Foundation
import Testing
import TWData
import TWModel
import TWStorage

/// Records the requests it is given; answers `status` (nil: no answer, as a failed request).
final class RecordingTransport: PushTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var sent: [PushRequest] = []
    let status: Int?

    init(status: Int? = 200) { self.status = status }

    var requests: [PushRequest] { lock.withLock { sent } }

    func send(_ request: PushRequest) async -> Int? {
        lock.withLock { sent.append(request) }
        return status
    }
}

/// Takes a request and never answers: the process "ends" with the request in flight.
final class HangingTransport: PushTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var sent: [PushRequest] = []

    var requests: [PushRequest] { lock.withLock { sent } }

    func send(_ request: PushRequest) async -> Int? {
        lock.withLock { sent.append(request) }
        await withCheckedContinuation { (_: CheckedContinuation<Void, Never>) in } // never resumed
        return nil
    }
}

/// Answers after 20 ms and counts the requests in flight.
final class SlowTransport: PushTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var inFlight = 0
    private(set) var maxInFlight = 0
    private(set) var count = 0

    func send(_ request: PushRequest) async -> Int? {
        lock.withLock {
            inFlight += 1
            count += 1
            maxInFlight = max(maxInFlight, inFlight)
        }
        try? await Task.sleep(for: .milliseconds(20))
        lock.withLock { inFlight -= 1 }
        return 200
    }
}

/// A process's view of the app's files: a new instance per simulated process.
struct Files {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-push-\(UUID().uuidString)")
    var store: AppStateStore { AppStateStore(url: dir.appendingPathComponent("app_state.json")) }
    var queue: PushTokenQueue { PushTokenQueue(url: dir.appendingPathComponent("push_tokens.json")) }

    static let places = [
        Place(currentPosition: true, disable: true),
        Place(currentPosition: false, disable: false, name: "명동", address: "대한민국 서울특별시 중구 명동", country: "KR",
              location: Location(lat: 37.56, long: 126.98), source: "KMA"),
    ]
    static let records: [JSONObject] = [
        JSONObject([("cityIndex", 1), ("id", 1), ("startTime", "2026-11-07T22:00:00.000Z"),
                    ("endTime", "2026-11-08T13:00:00.000Z"), ("enable", true), ("category", "alert")]),
        JSONObject([("cityIndex", 1), ("id", 2), ("time", "2026-11-07T22:40:00.000Z"),
                    ("dayOfWeek", [false, true, true, true, true, true, false]), ("enable", true), ("category", "alarm")]),
    ]

    func seed(token: String?) throws {
        try store.save(AppState(places: Self.places, placeIndex: 1,
                                push: PushState(type: "ios", fcmToken: token, records: Self.records),
                                migration: MigrationInfo(source: "", migratedAtMillis: 0, keys: [:])))
    }

    var storedToken: String? { (try? store.load())??.push.fcmToken }

    static func context(_ state: AppState) -> PushRegistration.Context? {
        PushRegistration.Context(deviceId: "DEVICE", language: "ko-KR", appVersion: "2.0.0", units: state.units,
                                 now: Date(timeIntervalSince1970: 1_794_020_400), zone: TimeZone(identifier: "Asia/Seoul")!)
    }

    func sync(_ transport: any PushTransport,
              context: @escaping @Sendable (AppState) -> PushRegistration.Context? = Files.context) -> PushSync {
        PushSync(store: store, queue: queue, transport: transport, repostDelay: .zero, context: context)
    }
}

/// `[newToken, oldToken]` of a token replacement (`PUT /v000903/push`); empty for anything else.
func replacement(_ r: PushRequest?) -> [String?] {
    guard let r, r.method == "PUT", r.path == "/v000903/push" else { return [] }
    return [r.body["newToken"]?.stringValue, r.body["oldToken"]?.stringValue]
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

/// `PushSync` runs one registration at a time over the stored state and the token queue.
struct PushSyncTests {
    @Test func openPostsTheListWithTheStoredToken() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = RecordingTransport()
        let outcome = try #require(await files.sync(transport).open { "token-a" })
        #expect(outcome.requests.map(\.method) == ["POST"])
        #expect(outcome.statuses == [200])
        #expect(transport.requests == outcome.requests)
        #expect(transport.requests.first?.body.arrayValue?.count == 2)
        #expect(files.storedToken == "token-a")
    }

    @Test func openReplacesAChangedTokenAndStoresIt() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = RecordingTransport()
        let outcome = try #require(await files.sync(transport).open { "token-b" })
        #expect(outcome.requests.map(\.method) == ["PUT", "POST"])
        #expect(replacement(transport.requests.first) == ["token-b", "token-a"])
        #expect(transport.requests.last?.body[0]?["fcmToken"] == "token-b")
        #expect(files.storedToken == "token-b")
    }

    /// Without a request context (no server URL or `Device-Id`) nothing is sent or stored, and queued tokens wait.
    @Test func withoutAContextNothingIsSent() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        try files.queue.append("token-b")
        let transport = RecordingTransport()
        let sync = files.sync(transport) { _ in nil }
        #expect(await sync.open { "token-c" } == nil)
        #expect(await sync.drain().isEmpty)
        #expect(transport.requests.isEmpty)
        #expect(files.storedToken == "token-a")
        #expect(try files.queue.pending() == ["token-b"])
    }

    /// Tokens B then C: replaced A→B, then B→C, one registration at a time, in order of arrival. An open registers
    /// queued tokens first, so its current token is compared with the newest stored one, whichever call comes first.
    @Test func queuedTokensAreReplacedInOrder() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        try files.queue.append("token-b")
        try files.queue.append("token-c")
        let transport = RecordingTransport()
        let sync = files.sync(transport)
        async let first = sync.drain()
        async let open = sync.open { "token-c" }
        _ = await (first, open)
        let methods = transport.requests.map { $0.method + " " + $0.path }
        #expect(replacement(transport.requests[safe: 0]) == ["token-b", "token-a"])
        #expect(replacement(transport.requests[safe: 1]) == ["token-c", "token-b"])
        #expect(methods.count == 3 && methods.last == "POST /v000903/push-list", "\(methods)")
        #expect(files.storedToken == "token-c")
        #expect(try files.queue.pending().isEmpty)
    }

    /// Registrations started together never overlap: at most one request is in flight.
    @Test func registrationsRunOneAtATime() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = SlowTransport()
        let sync = files.sync(transport)
        try files.queue.append("token-b")
        await withTaskGroup(of: Void.self) { group in
            group.addTask { _ = await sync.drain() }
            group.addTask { _ = await sync.open { "token-b" } }
            group.addTask { _ = await sync.open { "token-b" } }
            group.addTask { _ = await sync.drain() }
        }
        #expect(transport.maxInFlight == 1)
        #expect(transport.count == 3, "PUT a→b, then a POST for each open")
        #expect(files.storedToken == "token-b")
    }

    /// As in the Cordova app a failed request is not retried; the token is stored anyway and the next open posts
    /// the list with it.
    @Test func aFailedReplacementStillStoresTheToken() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        try files.queue.append("token-b")
        let outcomes = await files.sync(RecordingTransport(status: nil)).drain()
        #expect(outcomes.map(\.statuses) == [[nil]])
        #expect(files.storedToken == "token-b")
        #expect(try files.queue.pending().isEmpty)
    }

    /// The process ends after the token was stored in the queue and before it was sent: the next process sends
    /// the replacement and stores the token.
    @Test func aTokenStoredBeforeTheProcessEndedIsRegisteredByTheNextProcess() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        try files.queue.append("token-c") // process 1 ends here
        let transport = RecordingTransport()
        let outcomes = await files.sync(transport).drain() // process 2
        #expect(outcomes.count == 1)
        #expect(transport.requests.count == 1)
        #expect(replacement(transport.requests.first) == ["token-c", "token-a"])
        #expect(transport.requests.first?.headers["Device-Id"] == "DEVICE")
        #expect(files.storedToken == "token-c")
        #expect(try files.queue.pending().isEmpty)
    }

    /// The process ends while the replacement is in flight: nothing was stored, so the next process sends it again
    /// (the server's replacement of an old token it no longer has changes nothing) and stores the token.
    @Test func aReplacementInFlightWhenTheProcessEndedIsCompletedByTheNextProcess() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let hanging = HangingTransport()
        let process1 = files.sync(hanging)
        try files.queue.append("token-c")
        let task = Task { await process1.drain() }
        for _ in 0..<200 where hanging.requests.isEmpty { try await Task.sleep(for: .milliseconds(10)) }
        #expect(replacement(hanging.requests.first) == ["token-c", "token-a"])
        #expect(files.storedToken == "token-a", "stored only after the request returns")
        #expect(try files.queue.pending() == ["token-c"])
        _ = task // process 1 ends: its task never continues

        let transport = RecordingTransport()
        let outcomes = await files.sync(transport).drain() // process 2, same files
        #expect(outcomes.count == 1)
        #expect(replacement(transport.requests.first) == ["token-c", "token-a"])
        #expect(files.storedToken == "token-c")
        #expect(try files.queue.pending().isEmpty)
    }

    /// A queued token the state already holds (the process ended after storing it) sends nothing and leaves the queue.
    @Test func aTokenAlreadyStoredIsDequeuedWithoutRequests() async throws {
        let files = Files()
        try files.seed(token: "token-c")
        try files.queue.append("token-c")
        let transport = RecordingTransport()
        let outcomes = await files.sync(transport).drain()
        #expect(outcomes.allSatisfy { $0.requests.isEmpty })
        #expect(transport.requests.isEmpty)
        #expect(try files.queue.pending().isEmpty)
    }

    /// A first token (none stored) also posts the list, as the Cordova token callback does.
    @Test func aFirstTokenPostsTheList() async throws {
        let files = Files()
        try files.seed(token: nil)
        try files.queue.append("token-b")
        let transport = RecordingTransport()
        _ = await files.sync(transport).drain()
        #expect(transport.requests.map(\.method) == ["PUT", "POST"])
        #expect(replacement(transport.requests.first).first == "token-b")
        #expect(transport.requests.first?.body["oldToken"] == .null)
        #expect(files.storedToken == "token-b")
    }
}
