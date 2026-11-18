import Foundation
import Testing
import TWData
import TWModel
import TWStorage

/// Records the requests it is given and answers `status` (nil: no answer, as a failed request). With `held`, every
/// request waits until `release()`; `waitForRequests(_:)` returns once that many were sent. Each continuation is
/// resumed exactly once (`release` also resumes the requests still waiting).
final class HeldTransport: PushTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var sent: [PushRequest] = []
    private var held: Bool
    private var waiting: [CheckedContinuation<Void, Never>] = []
    private var counters: [UUID: (Int, CheckedContinuation<Void, Never>)] = [:]
    let status: Int?

    init(status: Int? = 200, held: Bool = false) {
        self.status = status
        self.held = held
    }

    var requests: [PushRequest] { lock.withLock { sent } }

    func send(_ request: PushRequest) async -> Int? {
        let due: [CheckedContinuation<Void, Never>] = lock.withLock {
            sent.append(request)
            let n = sent.count
            let ready = counters.filter { $0.value.0 <= n }
            for id in ready.keys { counters.removeValue(forKey: id) }
            return ready.values.map(\.1)
        }
        for c in due { c.resume() }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            let wait = lock.withLock {
                if held { waiting.append(c) }
                return held
            }
            if !wait { c.resume() }
        }
        return status
    }

    /// Returns once at least `count` requests were sent, or at once when the waiting task is cancelled (the suite's
    /// time limit), so a registration that never sends fails its test instead of holding the run.
    func waitForRequests(_ count: Int) async {
        let id = UUID()
        await withTaskCancellationHandler {
            await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                let ready = lock.withLock {
                    if sent.count >= count || Task.isCancelled { return true }
                    counters[id] = (count, c)
                    return false
                }
                if ready { c.resume() }
            }
        } onCancel: {
            let waiter = lock.withLock { counters.removeValue(forKey: id) }
            waiter?.1.resume()
        }
    }

    /// Answers the held requests and every later one at once.
    func release() {
        let resumed = lock.withLock {
            held = false
            defer { waiting = [] }
            return waiting
        }
        for c in resumed { c.resume() }
    }
}

/// The state file as one process sees it: once `end()` is called, nothing more is saved (the process is gone).
final class ProcessStore: AppStateSaving, @unchecked Sendable {
    private let lock = NSLock()
    private let file: AppStateStore
    private var ended = false
    private var failures: Int

    init(_ file: AppStateStore, failures: Int = 0) {
        self.file = file
        self.failures = failures
    }

    struct Gone: Error {}

    func end() { lock.withLock { ended = true } }

    func save(_ state: AppState) throws {
        try lock.withLock {
            if ended { throw Gone() }
            if failures > 0 {
                failures -= 1
                throw Gone()
            }
            try file.save(state)
        }
    }
}

/// The app's files, shared by the simulated processes of one test; each process gets its own holder and queue.
struct Files {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-push-\(UUID().uuidString)")
    var file: AppStateStore { AppStateStore(url: dir.appendingPathComponent("app_state.json")) }
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
        try file.save(AppState(places: Self.places, placeIndex: 1,
                               push: PushState(type: "ios", fcmToken: token, records: Self.records),
                               migration: MigrationInfo(source: "", migratedAtMillis: 0, keys: [:])))
    }

    var storedToken: String? { (try? file.load())??.push.fcmToken }

    static func context(_ state: AppState) -> PushRegistration.Context? {
        PushRegistration.Context(deviceId: "DEVICE", language: "ko-KR", appVersion: "2.0.0", units: state.units,
                                 now: Date(timeIntervalSince1970: 1_794_020_400), zone: TimeZone(identifier: "Asia/Seoul")!)
    }

    /// A process: the holder takes over the stored state (as after the migration) and saves through `store`.
    @MainActor
    func process(_ transport: any PushTransport, store: ProcessStore? = nil,
                 context: @escaping @Sendable (AppState) -> PushRegistration.Context? = Files.context)
        throws -> (sync: PushSync, holder: AppStateHolder) {
        let holder = AppStateHolder(store: store ?? ProcessStore(file))
        if let state = try file.load() { holder.load(state) }
        return (PushSync(state: holder, queue: queue, transport: transport, context: context), holder)
    }
}

/// `[oldToken, newToken]` of a token replacement (`PUT /v000903/push`); empty for anything else.
func replacement(_ r: PushRequest?) -> [String?] {
    guard let r, r.method == "PUT", r.path == "/v000903/push" else { return [] }
    return [r.body["oldToken"]?.stringValue, r.body["newToken"]?.stringValue]
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

/// `PushSync` runs one registration at a time over the app state and the token queue, as the Android `PushSync`
/// (AN-04) does (`PushSyncTest`). A registration that never finishes fails its test instead of holding the run.
@MainActor
@Suite(.timeLimit(.minutes(1)))
struct PushSyncTests {
    @Test func openPostsTheListWithTheStoredToken() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HeldTransport()
        let outcome = try #require(await files.process(transport).sync.open { "token-a" })
        #expect(outcome.requests.map(\.method) == ["POST"])
        #expect(outcome.statuses == [200])
        #expect(transport.requests == outcome.requests)
        #expect(transport.requests.first?.body.arrayValue?.count == 2)
        #expect(transport.requests.first?.body[0]?["fcmToken"] == "token-a")
        #expect(files.storedToken == "token-a")
    }

    @Test func openReplacesAChangedTokenAndStoresIt() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HeldTransport()
        let outcome = try #require(await files.process(transport).sync.open { "token-b" })
        #expect(outcome.requests.map(\.method) == ["PUT", "POST"])
        #expect(replacement(transport.requests.first) == ["token-a", "token-b"])
        #expect(transport.requests.last?.body[0]?["fcmToken"] == "token-b")
        #expect(files.storedToken == "token-b")
    }

    /// Without a request context (no server URL or `Device-Id`) nothing is sent or stored, and queued tokens wait.
    @Test func nothingIsSentOrStoredWithoutAContext() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HeldTransport()
        let sync = try files.process(transport) { _ in nil }.sync
        #expect(await sync.receive(token: "token-b"))
        #expect(await sync.open { "token-c" } == nil)
        #expect(await sync.drain().isEmpty)
        #expect(transport.requests.isEmpty)
        #expect(files.storedToken == "token-a")
        #expect(try files.queue.pending() == ["token-b"])
    }

    /// Android `consecutiveTokensAreReplacedInOrder`: C arrives while B's replacement is in flight and waits for it.
    @Test func consecutiveTokensAreReplacedInOrder() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HeldTransport(held: true)
        let sync = try files.process(transport).sync
        async let b = sync.receive(token: "token-b")
        await transport.waitForRequests(1)
        async let c = sync.receive(token: "token-c")
        transport.release()
        _ = await (b, c)
        #expect(transport.requests.map(replacement) == [["token-a", "token-b"], ["token-b", "token-c"]])
        #expect(files.storedToken == "token-c")
        #expect(try files.queue.pending().isEmpty)
    }

    /// Android `aTokenArrivingDuringTheStartRegistrationWaitsForIt`: the open's PUT and POST first, then B→C.
    @Test func aTokenArrivingDuringTheOpenWaitsForIt() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HeldTransport(held: true)
        let sync = try files.process(transport).sync
        async let open = sync.open { "token-b" }
        await transport.waitForRequests(1)
        async let refresh = sync.receive(token: "token-c")
        transport.release()
        _ = await (open, refresh)
        #expect(transport.requests.map(\.method) == ["PUT", "POST", "PUT"])
        #expect(replacement(transport.requests[safe: 0]) == ["token-a", "token-b"])
        #expect(transport.requests[safe: 1]?.body[0]?["fcmToken"] == "token-b")
        #expect(replacement(transport.requests[safe: 2]) == ["token-b", "token-c"])
        #expect(files.storedToken == "token-c")
    }

    /// As in the Cordova and Android apps a failed request is not retried; the token is stored anyway and the next
    /// open posts the list with it.
    @Test func aFailedReplacementStillStoresTheToken() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let sync = try files.process(HeldTransport(status: nil)).sync
        #expect(await sync.receive(token: "token-b"))
        #expect(files.storedToken == "token-b")
        #expect(try files.queue.pending().isEmpty)
        let next = HeldTransport()
        _ = try await files.process(next).sync.open { "token-b" }
        #expect(next.requests.map(\.method) == ["POST"])
        #expect(next.requests.first?.body[0]?["fcmToken"] == "token-b")
    }

    /// #2953 AC3 (Android `PushTokenWorkTest`): a token arrives, its PUT is in flight when the process ends. The next
    /// process, started in the background, sends the PUT with the previous token as `oldToken` and stores the token.
    @Test func aReplacementInFlightWhenTheProcessEndedIsCompletedByTheNextProcess() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let inFlight = HeldTransport(held: true)
        let store1 = ProcessStore(files.file)
        let process1 = try files.process(inFlight, store: store1).sync
        let task = Task { await process1.receive(token: "token-c") }
        await inFlight.waitForRequests(1)
        #expect(replacement(inFlight.requests.first) == ["token-a", "token-c"])
        #expect(files.storedToken == "token-a", "stored only after the request returns")
        #expect(try files.queue.pending() == ["token-c"])
        store1.end() // process 1 ends with the PUT in flight

        let transport = HeldTransport()
        let outcomes = try await files.process(transport).sync.drain() // process 2, a background start
        #expect(outcomes.count == 1)
        #expect(transport.requests.count == 1)
        #expect(replacement(transport.requests.first) == ["token-a", "token-c"])
        #expect(transport.requests.first?.headers["Device-Id"] == "DEVICE")
        #expect(files.storedToken == "token-c")
        #expect(try files.queue.pending().isEmpty)

        inFlight.release() // process 1's task is gone; let it finish so no continuation is left
        _ = await task.value
        #expect(files.storedToken == "token-c")
    }

    /// The same when the next process is opened: the queued token first, then the open's list with it.
    @Test func aQueuedTokenIsRegisteredBeforeTheNextOpen() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        try files.queue.append("token-c") // process 1 ended after queueing the token
        let transport = HeldTransport()
        let outcome = try await files.process(transport).sync.open { "token-c" }
        #expect(outcome?.requests.map(\.method) == ["POST"])
        #expect(transport.requests.map(\.method) == ["PUT", "POST"])
        #expect(replacement(transport.requests.first) == ["token-a", "token-c"])
        #expect(transport.requests.last?.body[0]?["fcmToken"] == "token-c")
        #expect(files.storedToken == "token-c")
        #expect(try files.queue.pending().isEmpty)
    }

    /// A queued token the state already holds (the process ended after storing it) sends nothing and leaves the queue.
    @Test func aTokenAlreadyStoredIsDequeuedWithoutRequests() async throws {
        let files = Files()
        try files.seed(token: "token-c")
        try files.queue.append("token-c")
        let transport = HeldTransport()
        let outcomes = try await files.process(transport).sync.drain()
        #expect(outcomes.allSatisfy { $0.requests.isEmpty })
        #expect(transport.requests.isEmpty)
        #expect(try files.queue.pending().isEmpty)
    }

    /// A first token (none stored, or "") also posts the list, as the Cordova token callback does.
    @Test(arguments: [nil, ""] as [String?])
    func aFirstTokenPostsTheList(stored: String?) async throws {
        let files = Files()
        try files.seed(token: stored)
        let transport = HeldTransport()
        #expect(try await files.process(transport).sync.receive(token: "token-b"))
        #expect(transport.requests.map(\.method) == ["PUT", "POST"])
        #expect(transport.requests.first?.body["newToken"] == "token-b")
        #expect(transport.requests.first?.body["oldToken"] == (stored.map(JSONValue.string) ?? .null))
        #expect(files.storedToken == "token-b")
    }

    /// A blank token is ignored, as the Cordova token callback ignores it: nothing queued, sent or stored.
    @Test func aBlankTokenIsIgnored() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HeldTransport()
        #expect(try await files.process(transport).sync.receive(token: " \n"))
        #expect(transport.requests.isEmpty)
        #expect(try files.queue.pending().isEmpty)
        #expect(files.storedToken == "token-a")
    }

    /// A token that could not be stored stays queued, and the next process registers it again.
    @Test func aTokenThatCouldNotBeStoredStaysQueued() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let failing = ProcessStore(files.file, failures: 1)
        #expect(try await files.process(HeldTransport(), store: failing).sync.receive(token: "token-b"))
        #expect(files.storedToken == "token-a")
        #expect(try files.queue.pending() == ["token-b"])

        let transport = HeldTransport()
        _ = try await files.process(transport).sync.drain()
        #expect(replacement(transport.requests.first) == ["token-a", "token-b"])
        #expect(files.storedToken == "token-b")
        #expect(try files.queue.pending().isEmpty)
    }

    /// CODEX-IN04A-1: a token is queued when it arrives, also while an earlier registration is in flight (the
    /// Android app hands it to WorkManager at once). If the process ends then, the next one registers both in order.
    @Test func aTokenArrivingDuringARegistrationIsQueuedAtOnce() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let inFlight = HeldTransport(held: true)
        let store1 = ProcessStore(files.file)
        let process1 = try files.process(inFlight, store: store1).sync
        #expect(process1.enqueue(token: "token-b"))
        let task = Task { await process1.drain() }
        await inFlight.waitForRequests(1)
        #expect(process1.enqueue(token: "token-c"))
        #expect(try files.queue.pending() == ["token-b", "token-c"], "queued before B's PUT answered")
        store1.end() // process 1 ends with B's PUT in flight

        let transport = HeldTransport()
        _ = try await files.process(transport).sync.drain() // process 2, a background start
        #expect(transport.requests.map(replacement) == [["token-a", "token-b"], ["token-b", "token-c"]])
        #expect(files.storedToken == "token-c")
        #expect(try files.queue.pending().isEmpty)
        inFlight.release()
        _ = await task.value
    }

    /// CODEX-IN04A-2: a queued token leaves the queue only once a save holding it succeeded. The holder keeps a
    /// change whose save failed in memory; a later registration of the same token must not take that for stored.
    @Test func aTokenLeavesTheQueueOnlyAfterASuccessfulSave() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let failing = ProcessStore(files.file, failures: 2)
        let sync = try files.process(HeldTransport(), store: failing).sync
        #expect(await sync.receive(token: "token-b")) // PUT sent, save 1 fails
        _ = await sync.drain() // the holder shows token-b; save 2 fails
        #expect(files.storedToken == "token-a")
        #expect(try files.queue.pending() == ["token-b"])
        _ = await sync.drain() // save 3 succeeds
        #expect(files.storedToken == "token-b")
        #expect(try files.queue.pending().isEmpty)
    }

    /// IN-12's unit change (the Android `updateUnits`): the list posted again with the units saved by then.
    @Test func aUnitChangePostsTheListWithTheSavedUnits() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HeldTransport()
        let (sync, holder) = try files.process(transport)
        holder.change { $0.units.temperatureUnit = "F" }
        let outcome = await sync.updateUnits()
        #expect(outcome?.requests.map(\.method) == ["POST"])
        let posted = try #require(transport.requests.first?.body[0])
        #expect(posted["units"]?["temperatureUnit"] == "F")
        #expect(posted["fcmToken"] == "token-a")
        #expect(files.storedToken == "token-a")
    }

    /// A unit change while a token's registration is in flight waits for it and posts with the new token.
    @Test func aUnitChangeWaitsForARegistrationInFlight() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HeldTransport(held: true)
        let (sync, holder) = try files.process(transport)
        async let registered = sync.receive(token: "token-b")
        await transport.waitForRequests(1)
        holder.change { $0.units.temperatureUnit = "F" }
        async let units = sync.updateUnits()
        transport.release()
        _ = await (registered, units)
        #expect(transport.requests.map(\.method) == ["PUT", "POST"])
        #expect(transport.requests.last?.body[0]?["fcmToken"] == "token-b")
        #expect(transport.requests.last?.body[0]?["units"]?["temperatureUnit"] == "F")
    }

    /// Nothing is sent when the unit change could not be saved, nor without records or a token.
    @Test func aUnitChangeSendsNothingUnsavedOrWithoutAToken() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let failing = ProcessStore(files.file, failures: 2)
        let transport = HeldTransport()
        let (sync, holder) = try files.process(transport, store: failing)
        holder.change { $0.units.temperatureUnit = "F" } // save 1 fails
        #expect(await sync.updateUnits() == nil) // save 2 fails
        #expect(transport.requests.isEmpty)

        let none = Files()
        try none.seed(token: nil)
        let quiet = HeldTransport()
        #expect(try await none.process(quiet).sync.updateUnits()?.requests.isEmpty == true)
        #expect(quiet.requests.isEmpty)
    }

    /// The token is stored through the holder over the state as it is then: a change the UI made while the requests
    /// were in flight stays.
    @Test func storingTheTokenKeepsAChangeMadeMeanwhile() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HeldTransport(held: true)
        let (sync, holder) = try files.process(transport)
        async let registered = sync.receive(token: "token-b")
        await transport.waitForRequests(1)
        holder.change { $0.settings.theme = "dark" }
        transport.release()
        _ = await registered
        await holder.saved()
        let stored = try #require(try files.file.load())
        #expect(stored.push.fcmToken == "token-b")
        #expect(stored.settings.theme == "dark")
    }
}

/// `Push.removePushListByCityIndex` through `PushSync.removeCity` (IN-11, #2960; the Android `PushSyncTest` removal
/// cases of AN-11): the records of the index are dropped and saved before `DELETE /v000903/push` is sent; the request's
/// shape is compared with the Cordova iOS request in `PushRegistrationTests.removalsMatchCordova` (TWStorageTests).
@MainActor
@Suite(.timeLimit(.minutes(1)))
struct PushRemovalTests {
    @Test func aPlacesAlarmsAreSavedAwayThenDeleted() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HeldTransport()
        let outcome = try #require(try await files.process(transport).sync.removeCity(1))
        #expect(outcome.requests.map(\.method) == ["DELETE"])
        let request = try #require(transport.requests.first)
        #expect(request.path == "/v000903/push")
        #expect(request.headers == ["Content-Type": "application/json", "Device-Id": "DEVICE"])
        #expect(request.body.jsonText == #"{"cityIndex":1,"fcmToken":"token-a"}"#)
        let saved = try #require(try files.file.load())
        #expect(saved.push.records.isEmpty, "the records of index 1 are saved away")
        #expect(saved.push.fcmToken == "token-a")
    }

    /// A24: only the records of the index go; a later place's records keep their index.
    @Test func otherRecordsAreNotRenumbered() async throws {
        let files = Files()
        var records = Files.records
        records.append(JSONObject([("cityIndex", 2), ("id", 1), ("time", "2026-11-07T22:40:00.000Z"),
                                   ("dayOfWeek", [true, true, true, true, true, true, true]), ("enable", true), ("category", "alarm")]))
        try files.file.save(AppState(places: Files.places, placeIndex: 1, push: PushState(type: "ios", fcmToken: "token-a", records: records),
                                     migration: MigrationInfo(source: "", migratedAtMillis: 0, keys: [:])))
        _ = try await files.process(HeldTransport()).sync.removeCity(1)
        let saved = try #require(try files.file.load())
        #expect(saved.push.records.map { $0["cityIndex"] } == [2])
    }

    @Test func aRegistrationIDStandsInForAMissingToken() async throws {
        let files = Files()
        try files.file.save(AppState(places: Files.places, placeIndex: 1,
                                     push: PushState(registrationId: "reg-1", type: "ios", fcmToken: nil, records: Files.records),
                                     migration: MigrationInfo(source: "", migratedAtMillis: 0, keys: [:])))
        let transport = HeldTransport()
        _ = try await files.process(transport).sync.removeCity(1)
        #expect(transport.requests.first?.body.jsonText == #"{"cityIndex":1,"registrationId":"reg-1"}"#)
    }

    /// Without a token or a registration ID Cordova returns before anything: no request, the records stay.
    @Test func nothingWithoutATokenOrARegistrationID() async throws {
        let files = Files()
        try files.seed(token: nil)
        let transport = HeldTransport()
        let outcome = try #require(try await files.process(transport).sync.removeCity(1))
        #expect(outcome.requests.isEmpty && transport.requests.isEmpty)
        #expect(try files.file.load()?.push.records.count == 2)
    }

    /// The records cannot be saved (a full disk): nothing is sent and nothing fails (as #2925 F1).
    @Test func nothingIsSentWhenTheRecordsCannotBeSaved() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HeldTransport()
        let store = ProcessStore(files.file, failures: 1)
        #expect(try await files.process(transport, store: store).sync.removeCity(1) == nil)
        #expect(transport.requests.isEmpty)
    }

    /// Without a request context (no server URL or `Device-Id`) nothing is removed or sent.
    @Test func nothingWithoutAContext() async throws {
        let files = Files()
        try files.seed(token: "token-a")
        let transport = HeldTransport()
        #expect(try await files.process(transport) { _ in nil }.sync.removeCity(1) == nil)
        #expect(transport.requests.isEmpty)
        #expect(try files.file.load()?.push.records.count == 2)
    }
}
