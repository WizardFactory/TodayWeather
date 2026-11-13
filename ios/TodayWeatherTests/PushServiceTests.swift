import Foundation
import Testing
import TWData
import TWModel
import TWStorage
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

    /// The test host was opened, so its process requested the open registration once.
    @Test func anOpenedProcessRequestsTheOpenRegistration() async throws {
        for _ in 0..<100 where !AppStartup.shared.openRequested { try await Task.sleep(for: .milliseconds(100)) }
        #expect(AppStartup.shared.openRequested)
        #expect(AppStartup.shared.state != nil)
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
                                  tokenProvider: FixedTokenProvider(token: "token-b"), store: store,
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
