import Foundation
import Testing
import TWData
import TWModel
import TWStorage
import UIKit
@testable import TodayWeather

/// Gate G1 of #2948, push part (IN-04, #2953), run on a simulator by ios/tools/upgrade/run-upgrade-test.sh after the
/// IN-03 upgrade checks: the open registration of the updated app, with the token from a test double
/// (`TW_UPGRADE_TOKEN`: `token-a`, the token the Cordova app stored, or `token-b`) and the requests sent over HTTP to
/// the local recorder (`TW_UPGRADE_RECORDER`). The test build has no server URL, so the app's own starts sent nothing.
/// The test goes through the app's start path (IN-04 review, CODEX-IN04-2): an `AppStartup` whose push service the test
/// builds (`makePush`: the recorder, the fixed token, the app's own state file and token queue) runs the migration
/// and `Device-Id` read, sends nothing at its start, and runs the open registration when the process becomes active
/// (`UIApplication.didBecomeActiveNotification`, posted by the test). `TW_UPGRADE_PUSH_RUN` is `first` (the first
/// open after the update) or `again` (the next one). The host side (check_upgrade.py `push`) checks the recorded
/// requests. Skipped without the variables; the script requires it passed.
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

        let store = try AppStateStore.standard()
        let queue = try PushTokenQueue.standard()
        let startup = AppStartup()
        startup.makePush = { id in
            PushService(serverURL: recorder, deviceId: id, tokenProvider: FixedTokenProvider(token: token), store: store,
                        queue: queue)
        }
        startup.start(UIApplication.shared)
        #expect(startup.deviceId == deviceId)
        #expect(startup.push != nil)
        try await Task.sleep(for: .milliseconds(500))
        #expect(startup.openTask == nil, "the start alone opens nothing")
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: UIApplication.shared)
        let outcome = try #require(await startup.openTask?.value)
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
