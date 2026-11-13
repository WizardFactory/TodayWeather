import Foundation
import Testing
import TWData
import TWModel
import TWStorage

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

/// `PushSync` handles each event on one actor over the stored state and the token queue.
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
        #expect(try files.queue.entries() == [PushTokenQueue.Entry(token: "token-b")])
    }

    /// Tokens B then C: replaced A→B, then B→C, in order of arrival, whichever call comes first; the open's token is
    /// compared with the newest stored one.
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
        #expect(await eventually { (try? files.queue.pending().isEmpty) == true })
    }

    /// A reply that has not arrived holds nothing back: the next token's replacement is sent at once, over the token
    /// stored when the first was sent (as the Cordova token callback stores it).
    @Test func aSlowReplyHoldsNothingBack() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HangingTransport()
        let sync = files.sync(transport)
        try files.queue.append("token-b")
        await sync.handleQueuedTokens()
        try files.queue.append("token-c")
        await sync.handleQueuedTokens()
        await sync.handleQueuedTokens() // in flight: not sent again
        #expect(transport.requests.map(replacement) == [["token-b", "token-a"], ["token-c", "token-b"]])
        #expect(files.storedToken == "token-c")
        #expect(try files.queue.entries() == [PushTokenQueue.Entry(token: "token-b", sent: .over("token-a")),
                                              PushTokenQueue.Entry(token: "token-c", sent: .over("token-b"))])
        transport.answerAll(200)
        #expect(await eventually { await sync.pendingReplies == 0 })
        #expect(try files.queue.entries().isEmpty, "removed when the replies arrived")
    }

    /// As in the Cordova app a failed request is not retried; the token is stored anyway and the next open posts
    /// the list with it.
    @Test func aFailedReplacementStillStoresTheToken() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        try files.queue.append("token-b")
        let sync = files.sync(RecordingTransport(status: nil))
        let outcomes = await sync.drain()
        #expect(outcomes.map(\.statuses) == [[nil]])
        #expect(files.storedToken == "token-b")
        #expect(await eventually { await sync.pendingReplies == 0 })
        #expect(try files.queue.pending().isEmpty)
    }

    /// The process ends after the token was stored in the queue and before it was handled: the next process sends
    /// the replacement and stores the token.
    @Test func aTokenStoredBeforeTheProcessEndedIsRegisteredByTheNextProcess() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        try files.queue.append("token-c") // process 1 ends here
        let transport = RecordingTransport()
        let sync = files.sync(transport) // process 2
        let outcomes = await sync.drain()
        #expect(outcomes.count == 1)
        #expect(transport.requests.count == 1)
        #expect(replacement(transport.requests.first) == ["token-c", "token-a"])
        #expect(transport.requests.first?.headers["Device-Id"] == "DEVICE")
        #expect(files.storedToken == "token-c")
        #expect(await eventually { await sync.pendingReplies == 0 })
        #expect(try files.queue.pending().isEmpty)
    }

    /// The process ends while the replacement is in flight: the state already holds the token (stored when it was
    /// sent, as in Cordova) and the queue entry says over which token it was sent, so the next process sends the
    /// replacement again (the server's replacement of a token it no longer has changes nothing) and removes the entry
    /// when the reply arrives.
    @Test func aReplacementInFlightWhenTheProcessEndedIsCompletedByTheNextProcess() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let hanging = HangingTransport()
        let process1 = files.sync(hanging)
        try files.queue.append("token-c")
        await process1.handleQueuedTokens()
        #expect(hanging.requests.map(replacement) == [["token-c", "token-a"]])
        #expect(files.storedToken == "token-c")
        #expect(try files.queue.entries() == [PushTokenQueue.Entry(token: "token-c", sent: .over("token-a"))])
        // Process 1 ends here: its reply never arrives for it.

        let transport = RecordingTransport()
        let process2 = files.sync(transport)
        let outcomes = await process2.drain()
        #expect(outcomes.count == 1)
        #expect(transport.requests.map(replacement) == [["token-c", "token-a"]])
        #expect(files.storedToken == "token-c")
        #expect(await eventually { await process2.pendingReplies == 0 })
        #expect(try files.queue.pending().isEmpty)
        // The simulated process 1 is still in memory here; answer its request so none of its tasks stays suspended.
        hanging.answerAll(nil)
        #expect(await eventually { await process1.pendingReplies == 0 })
        #expect(try files.queue.pending().isEmpty)
    }

    /// A queued token the state already holds sends nothing and leaves the queue.
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
