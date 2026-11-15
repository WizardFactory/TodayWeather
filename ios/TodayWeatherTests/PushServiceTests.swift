import Foundation
import Testing
import TWData
import TWModel
import TWStorage
import UIKit
@testable import TodayWeather

/// A token provider of the tests: the token FCM would hold (installed by the test, never by the app).
struct FixedTokenProvider: PushTokenProvider {
    let token: String?
    func currentToken() async -> String? { token }
}

/// Records requests instead of sending them.
final class RecordingPushTransport: PushTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var sent: [PushRequest] = []
    var requests: [PushRequest] { lock.withLock { sent } }

    func send(_ request: PushRequest) async -> Int? {
        lock.withLock { sent.append(request) }
        return 200
    }
}

/// The test's own state holder over `store`, loaded with what `store` holds (as the app's holder after the migration).
@MainActor
func holder(_ store: AppStateStore) throws -> AppStateHolder {
    let holder = AppStateHolder(store: store)
    if let state = try store.load() { holder.load(state) }
    return holder
}

/// Runs inside the app on a simulator (IN-04, #2953).
@MainActor
struct PushServiceTests {
    /// The server URL is a private input: without it (CI, a checkout without `Private.xcconfig`) the app has no push
    /// service and sends nothing; the value must be an http(s) URL.
    @Test func theServerURLIsPrivateAndChecked() {
        let value = Bundle.main.object(forInfoDictionaryKey: "TWServerURL") as? String
        #expect(value != nil, "Info.plist carries TWServerURL (empty without Private.xcconfig)")
        #expect((PushService.serverURL(value) == nil) == (AppStartup.shared.push == nil))
        #expect(PushService.serverURL("") == nil)
        #expect(PushService.serverURL("https:") == nil)
        #expect(PushService.serverURL("ftp://example.invalid") == nil)
        #expect(PushService.serverURL("https://example.invalid") == "https://example.invalid")
    }

    /// The test host was opened, so its process requested the open registration once. (Whether the app's own state
    /// loaded depends on the App Group container, which an unsigned build lacks; IN-03 then refuses to migrate.)
    @Test func anOpenedProcessRequestsTheOpenRegistration() async throws {
        for _ in 0..<100 where !AppStartup.shared.openRequested { try await Task.sleep(for: .milliseconds(100)) }
        #expect(AppStartup.shared.openRequested)
    }

    /// The real start path: an `AppStartup` with the migrated state and a push service
    /// given by the test (recording transport, fixed token, its own files and state holder; so it runs with or without
    /// the App Group)
    /// sends nothing when it starts, and runs the open registration when the process becomes active, once.
    @Test func theFirstActivationRunsTheOpenRegistration() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-push-\(UUID().uuidString)")
        let store = AppStateStore(url: dir.appendingPathComponent("app_state.json"))
        let queue = PushTokenQueue(url: dir.appendingPathComponent("push_tokens.json"))
        try store.save(Self.state(token: "token-a"))
        let state = try holder(store)
        let transport = RecordingPushTransport()
        let startup = AppStartup()
        startup.migrate = { Self.state(token: "token-a") }
        startup.makePush = { id in
            PushService(serverURL: "https://push.test.invalid", deviceId: id, tokenProvider: FixedTokenProvider(token: "token-b"),
                        state: state, queue: queue, transport: transport)
        }
        startup.start(UIApplication.shared)
        #expect(startup.push != nil)
        try await Task.sleep(for: .milliseconds(300))
        #expect(startup.openTask == nil && transport.requests.isEmpty, "a start alone sends nothing")
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: UIApplication.shared)
        let outcome = try #require(await startup.openTask?.value)
        #expect(outcome.requests.map(\.method) == ["PUT", "POST"])
        #expect(transport.requests == outcome.requests)
        #expect(outcome.requests.allSatisfy { $0.headers["Device-Id"] == startup.deviceId })
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: UIApplication.shared)
        try await Task.sleep(for: .milliseconds(300))
        #expect(transport.requests.count == 2, "once per process")
    }

    /// A token delivered before the open is queued and registered in the process (the Android `onNewToken`), also
    /// when the process was started in the background and never opened: the replacement, then the stored token.
    @Test func aTokenIsRegisteredWithoutAnOpen() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-push-\(UUID().uuidString)")
        let store = AppStateStore(url: dir.appendingPathComponent("app_state.json"))
        let queue = PushTokenQueue(url: dir.appendingPathComponent("push_tokens.json"))
        try store.save(Self.state(token: "token-a"))
        let transport = RecordingPushTransport()
        let service = PushService(serverURL: "https://push.test.invalid", deviceId: "DEVICE",
                                  tokenProvider: FixedTokenProvider(token: nil), state: try holder(store), queue: queue,
                                  transport: transport)
        service.resume()
        service.receive(token: "token-c")
        #expect(try queue.pending() == ["token-c"], "queued when it arrives (CODEX-IN04A-1)")
        for _ in 0..<100 where (try? store.load())?.push.fcmToken != "token-c" {
            try await Task.sleep(for: .milliseconds(50))
        }
        #expect(transport.requests.map(\.method) == ["PUT"])
        #expect(transport.requests.first?.body["oldToken"] == "token-a")
        #expect(transport.requests.first?.body["newToken"] == "token-c")
        #expect(try store.load()?.push.fcmToken == "token-c")
        #expect(try queue.pending().isEmpty)
    }

    static func state(token: String) -> AppState {
        let record = JSONObject([("cityIndex", 1), ("id", 2), ("time", "2026-11-07T22:40:00.000Z"),
                                 ("dayOfWeek", [true, true, true, true, true, true, true]), ("enable", true),
                                 ("category", "alarm")])
        return AppState(places: [.currentPositionPlaceholder,
                                 Place(currentPosition: false, disable: false, name: "London",
                                       location: Location(lat: 51.51, long: -0.13), source: "VC")],
                        placeIndex: 1, push: PushState(fcmToken: token, records: [record]),
                        migration: MigrationInfo(source: "", migratedAtMillis: 0, keys: [:]))
    }

    /// The open registration runs once per service (once per process in the app), with `Device-Id` and `type: "ios"`.
    @Test func theOpenRegistrationRunsOnce() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-push-\(UUID().uuidString)")
        let store = AppStateStore(url: dir.appendingPathComponent("app_state.json"))
        let record = JSONObject([("cityIndex", 1), ("id", 2), ("time", "2026-11-07T22:40:00.000Z"),
                                 ("dayOfWeek", [true, true, true, true, true, true, true]), ("enable", true),
                                 ("category", "alarm")])
        try store.save(AppState(places: [.currentPositionPlaceholder,
                                         Place(currentPosition: false, disable: false, name: "London",
                                               location: Location(lat: 51.51, long: -0.13), source: "VC")],
                                placeIndex: 1, push: PushState(fcmToken: "token-a", records: [record]),
                                migration: MigrationInfo(source: "", migratedAtMillis: 0, keys: [:])))
        let transport = RecordingPushTransport()
        let service = PushService(serverURL: "https://push.test.invalid", deviceId: "DEVICE",
                                  tokenProvider: FixedTokenProvider(token: "token-b"), state: try holder(store),
                                  queue: PushTokenQueue(url: dir.appendingPathComponent("push_tokens.json")),
                                  transport: transport)
        let outcome = try #require(await service.open()?.value)
        #expect(service.open() == nil, "once")
        #expect(outcome.requests.map(\.method) == ["PUT", "POST"])
        #expect(transport.requests == outcome.requests)
        #expect(outcome.requests.allSatisfy { $0.headers["Device-Id"] == "DEVICE" })
        let posted = try #require(outcome.requests.last?.body[0])
        #expect(posted["type"] == "ios")
        #expect(posted["fcmToken"] == "token-b")
        #expect(posted["appVersion"]?.stringValue == Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
        #expect(try store.load()?.push.fcmToken == "token-b")
    }
}
