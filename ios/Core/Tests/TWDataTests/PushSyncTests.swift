import Foundation
import Testing
import TWData
import TWModel
import TWStorage

/// A process's view of the app's files: a new instance per simulated process.
struct Files {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-push-\(UUID().uuidString)")
    var store: AppStateStore { AppStateStore(url: dir.appendingPathComponent("app_state.json")) }
    var log: PushReplacementLog { PushReplacementLog(url: dir.appendingPathComponent("push_replacements.json")) }

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
    var logEntries: [PushReplacementLog.Entry] { (try? log.entries()) ?? [] }

    static func context(_ state: AppState) -> PushRegistration.Context? {
        PushRegistration.Context(deviceId: "DEVICE", language: "ko-KR", appVersion: "2.0.0", units: state.units,
                                 now: Date(timeIntervalSince1970: 1_794_020_400), zone: TimeZone(identifier: "Asia/Seoul")!)
    }

    func sync(_ transport: any PushTransport,
              context: @escaping @Sendable (AppState) -> PushRegistration.Context? = Files.context) -> PushSync {
        PushSync(store: store, log: log, transport: transport, repostDelay: .zero, context: context)
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

/// `PushSync` handles each event on one actor over the stored state and the replacement log.
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
        #expect(files.logEntries.isEmpty)
    }

    @Test func openReplacesAChangedTokenAndStoresIt() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = RecordingTransport()
        let sync = files.sync(transport)
        let outcome = try #require(await sync.open { "token-b" })
        #expect(outcome.requests.map(\.method) == ["PUT", "POST"])
        #expect(replacement(transport.requests.first) == ["token-b", "token-a"])
        #expect(transport.requests.last?.body[0]?["fcmToken"] == "token-b")
        #expect(files.storedToken == "token-b")
        #expect(await eventually { await sync.pendingReplies == 0 })
        #expect(files.logEntries.isEmpty, "acknowledged")
    }

    /// Without a request context (no server URL or `Device-Id`) nothing is sent or stored, and the log waits.
    @Test func withoutAContextNothingIsSent() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        try files.log.append(old: "token-a", new: "token-b")
        let transport = RecordingTransport()
        let sync = files.sync(transport) { _ in nil }
        #expect(await sync.open { "token-c" } == nil)
        #expect(await sync.start().isEmpty)
        #expect(await sync.tokenArrived("token-d").isEmpty)
        #expect(transport.requests.isEmpty)
        #expect(files.storedToken == "token-a")
        #expect(files.logEntries.map(\.id) == [1])
    }

    /// Tokens B then C: replaced A→B, then B→C, in order of arrival; a reply that has not arrived holds nothing back.
    @Test func tokensAreReplacedInOrderWithoutWaitingForReplies() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HangingTransport()
        let sync = files.sync(transport)
        await sync.tokenArrived("token-b")
        await sync.tokenArrived("token-c")
        await sync.tokenArrived("token-c") // unchanged: nothing
        #expect(transport.requests.map(replacement) == [["token-b", "token-a"], ["token-c", "token-b"]])
        #expect(files.storedToken == "token-c")
        #expect(files.logEntries.map { "\($0.id):\($0.old ?? "-")→\($0.new)" } == ["1:token-a→token-b", "2:token-b→token-c"])
        transport.answerAll(200)
        #expect(await eventually { await sync.pendingReplies == 0 })
        #expect(files.logEntries.isEmpty, "removed when the replies arrived")
    }

    /// As in the Cordova app a failed request is not retried; the token is stored anyway and the entry acknowledged.
    @Test func aFailedReplacementStillStoresTheToken() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let sync = files.sync(RecordingTransport(status: nil))
        #expect(await sync.tokenArrived("token-b").map(\.method) == ["PUT"])
        #expect(files.storedToken == "token-b")
        #expect(await eventually { await sync.pendingReplies == 0 })
        #expect(files.logEntries.isEmpty)
    }

    /// A first token (none stored) also posts the list, as the Cordova token callback does; the replacement's `old`
    /// is null.
    @Test func aFirstTokenPostsTheList() async throws {
        let files = Files()
        try files.seed(token: nil)
        let transport = RecordingTransport()
        let sync = files.sync(transport)
        await sync.tokenArrived("token-b")
        #expect(transport.requests.map(\.method) == ["PUT", "POST"])
        #expect(transport.requests.first?.body["oldToken"] == .null)
        #expect(files.storedToken == "token-b")
        #expect(await eventually { await sync.pendingReplies == 0 })
    }

    /// The process start sends again, in `id` order, every entry an earlier process left, each with its own tokens;
    /// a second start of the same process sends nothing again.
    @Test func theProcessStartReplaysTheLeftEntriesInOrder() async throws {
        let files = Files()
        try files.seed(token: "token-c")
        try files.log.append(old: "token-a", new: "token-b")
        try files.log.append(old: "token-b", new: "token-c")
        let transport = HangingTransport()
        let sync = files.sync(transport)
        await sync.start()
        await sync.start()
        #expect(transport.requests.map(replacement) == [["token-b", "token-a"], ["token-c", "token-b"]])
        transport.answerAll(200)
        #expect(await eventually { await sync.pendingReplies == 0 })
        #expect(files.logEntries.isEmpty)
    }
}
