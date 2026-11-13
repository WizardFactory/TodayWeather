import Foundation
import Testing
import TWData
import TWModel
import TWStorage
@testable import TodayWeather

/// Gate G1 of #2948, push part (IN-04, #2953), run on a simulator by ios/tools/upgrade/run-upgrade-test.sh after the
/// IN-03 upgrade checks: the open registration of the updated app, with the token from a test double
/// (`TW_UPGRADE_TOKEN`: `token-a`, the token the Cordova app stored, or `token-b`) and the requests sent over HTTP to
/// the local recorder (`TW_UPGRADE_RECORDER`). The test build has no server URL, so the app's own starts sent nothing;
/// this test runs the same `PushService.open()` the app runs when it is opened, over the app's own state, token queue
/// and `Device-Id`. `TW_UPGRADE_PUSH_RUN` is `first` (the first open after the update) or `again` (the next one).
/// The host side (check_upgrade.py `push`) checks the recorded requests. Skipped without the variables.
@MainActor
struct PushUpgradeTests {
    nonisolated static let environment = ProcessInfo.processInfo.environment
    nonisolated static let enabled = environment["TW_UPGRADE_TOKEN"] != nil && environment["TW_UPGRADE_RECORDER"] != nil

    @Test(.enabled(if: enabled)) func migratedAlarmsAndAlertsAreRegisteredAgain() async throws {
        let token = try #require(Self.environment["TW_UPGRADE_TOKEN"])
        let recorder = try #require(Self.environment["TW_UPGRADE_RECORDER"])
        let run = Self.environment["TW_UPGRADE_PUSH_RUN"] ?? "first"
        let seed = try #require(UpgradeSeed.fromEnvironment())
        let seededToken = try #require(try seed.json("pushData2")["fcmToken"]?.stringValue)

        #expect(AppStartup.shared.push == nil, "the test build has no server URL: the app's own start sent nothing")
        let state = try #require(AppStartup.shared.state)
        let deviceId = try #require(AppStartup.shared.deviceId)
        #expect(deviceId == seed.deviceId)
        let records = state.push.records
        #expect(records.count == 4)

        let service = PushService(serverURL: recorder, deviceId: deviceId, tokenProvider: FixedTokenProvider(token: token),
                                  store: try AppStateStore.standard(), queue: try PushTokenQueue.standard())
        let outcome = try #require(await service.open()?.value)
        let changed = run == "first" && token != seededToken
        #expect(outcome.requests.map(\.method) == (changed ? ["PUT", "POST"] : ["POST"]))
        #expect(outcome.statuses.allSatisfy { $0 == 200 }, "every request reached the recorder: \(outcome.statuses)")
        if changed {
            #expect(outcome.requests[0].path == "/v000903/push")
            #expect(outcome.requests[0].body["newToken"]?.stringValue == token)
            #expect(outcome.requests[0].body["oldToken"]?.stringValue == seededToken)
        }
        let post = try #require(outcome.requests.last)
        #expect(post.path == "/v000903/push-list")
        #expect(outcome.requests.allSatisfy { $0.headers["Device-Id"] == seed.deviceId })
        let posted = try #require(post.body.arrayValue)
        let keys = posted.map { "\($0["cityIndex"]?.jsonText ?? "")/\($0["id"]?.jsonText ?? "")/\($0["category"]?.stringValue ?? "")" }
        #expect(posted.count == records.count)
        #expect(Set(keys).count == keys.count, "each alarm and alert once: \(keys)")
        for object in posted {
            #expect(object["type"] == "ios")
            #expect(object["uuid"]?.stringValue == seed.deviceId)
            #expect(object["fcmToken"]?.stringValue == token)
        }
        #expect(try AppStateStore.standard().load()?.push.fcmToken == token)
        #expect(try PushTokenQueue.standard().pending().isEmpty)
    }
}
