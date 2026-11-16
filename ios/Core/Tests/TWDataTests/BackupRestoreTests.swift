import Foundation
import Testing
import TWData
import TWModel
import TWStorage

/// A restore from an iCloud backup or a device transfer (IN-16, #2965): the app's files come back as `BackupPolicy`
/// marks them (the state file, not the token queue), the standard preferences bring back `CDVUUID`, and the new device's
/// Firebase installation has a new FCM token. The open then re-registers push with the new token and the restored
/// `Device-Id`, as the Android app after a restore (AN-16). Nothing is sent to a server: the transport is a double.
@MainActor
@Suite(.timeLimit(.minutes(1)))
struct BackupRestoreTests {
    /// The old device's app directory and the restored copy on the new device.
    struct Devices {
        let old = FileManager.default.temporaryDirectory.appendingPathComponent("tw-old-\(UUID().uuidString)/TodayWeather")
        let new = FileManager.default.temporaryDirectory.appendingPathComponent("tw-new-\(UUID().uuidString)/TodayWeather")
        /// The standard preferences of both devices (restored with the backup), with the old device's `CDVUUID`.
        let suite = "tw-restore-\(UUID().uuidString)"

        /// The old device: the migrated state with alarms and its token, a token its FCM delivered that was not
        /// registered yet, and `CDVUUID`.
        func seed(storedToken: String?) throws {
            try AppStateStore(url: old.appendingPathComponent("app_state.json")).save(
                AppState(places: Files.places, placeIndex: 1,
                         push: PushState(type: "ios", fcmToken: storedToken, records: Files.records),
                         migration: MigrationInfo(source: "", migratedAtMillis: 0, keys: [:])))
            // Two tokens: the second write replaces the queue file (atomic), as the app's writes do.
            let queue = PushTokenQueue(url: old.appendingPathComponent("push_tokens.json"))
            try queue.append("token-queued-on-old-device-1")
            try queue.append("token-queued-on-old-device")
            try #require(UserDefaults(suiteName: suite)).set("CDV-OLD", forKey: DeviceIdentity.key)
        }

        /// What a backup carries to the new device: every file without the exclusion mark.
        func restore() throws -> [String] {
            let fm = FileManager.default
            try fm.createDirectory(at: new, withIntermediateDirectories: true)
            var copied: [String] = []
            for name in try fm.contentsOfDirectory(atPath: old.path).sorted() {
                let item = old.appendingPathComponent(name)
                if BackupPolicy.isExcluded(item) { continue }
                try fm.copyItem(at: item, to: new.appendingPathComponent(name))
                copied.append(name)
            }
            return copied
        }

        /// The new device's `Device-Id`: the restored `CDVUUID`, although its vendor identifier is new.
        func deviceId() throws -> String? {
            try DeviceIdentity.deviceId(defaults: try #require(UserDefaults(suiteName: suite)),
                                        preferencesFile: new.appendingPathComponent("no-such.plist")) { UUID() }
        }

        /// The new device's first process over the restored files.
        @MainActor
        func process(_ transport: HeldTransport, deviceId: String) throws -> (PushSync, AppStateHolder, PushTokenQueue) {
            let file = AppStateStore(url: new.appendingPathComponent("app_state.json"))
            let holder = AppStateHolder(store: ProcessStore(file))
            if let state = try file.load() { holder.load(state) }
            let queue = PushTokenQueue(url: new.appendingPathComponent("push_tokens.json"))
            let sync = PushSync(state: holder, queue: queue, transport: transport) { state in
                PushRegistration.Context(deviceId: deviceId, language: "ko-KR", appVersion: "2.0.0", units: state.units,
                                         now: Date(timeIntervalSince1970: 1_794_020_400), zone: TimeZone(identifier: "Asia/Seoul")!)
            }
            return (sync, holder, queue)
        }

        func storedToken() throws -> String? {
            try AppStateStore(url: new.appendingPathComponent("app_state.json")).load()?.push.fcmToken
        }

        func cleanUp() {
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: old.deletingLastPathComponent())
            try? FileManager.default.removeItem(at: new.deletingLastPathComponent())
        }
    }

    /// Every request carries the restored `Device-Id`, and none the old device's unregistered token.
    func expectRestoredIdentity(_ requests: [PushRequest]) {
        for r in requests {
            #expect(r.headers["Device-Id"] == "CDV-OLD", "\(r.method) \(r.path)")
            #expect(!r.body.jsonText.contains("token-queued-on-old-device"), "\(r.method) \(r.path)")
            if r.method == "POST" {
                #expect(r.body.arrayValue?.allSatisfy { $0["uuid"] == "CDV-OLD" } == true, "the body's uuid")
            }
        }
    }

    @Test func theBackupCarriesTheStateButNotTheTokenQueue() throws {
        let d = Devices()
        defer { d.cleanUp() }
        try d.seed(storedToken: "token-old")
        #expect(try d.restore() == ["app_state.json"])
        #expect(try d.deviceId() == "CDV-OLD", "the restored CDVUUID, not a new vendor identifier")
    }

    /// The new device's token is known at the open: the restored token is replaced, then the list is posted with it.
    @Test func theOpenReplacesTheRestoredTokenWithTheNewOne() async throws {
        let d = Devices()
        defer { d.cleanUp() }
        try d.seed(storedToken: "token-old")
        _ = try d.restore()
        let transport = HeldTransport()
        let (sync, _, queue) = try d.process(transport, deviceId: try #require(try d.deviceId()))
        let outcome = try #require(await sync.open { "token-new" })
        #expect(outcome.requests.map(\.method) == ["PUT", "POST"])
        #expect(replacement(transport.requests.first) == ["token-old", "token-new"])
        #expect(transport.requests.last?.path == "/v000903/push-list")
        #expect(transport.requests.last?.body.arrayValue?.count == 2, "every restored alarm and alert")
        #expect(transport.requests.last?.body.arrayValue?.allSatisfy { $0["fcmToken"] == "token-new" } == true)
        expectRestoredIdentity(transport.requests)
        #expect(try d.storedToken() == "token-new")
        #expect(try queue.pending().isEmpty)
    }

    /// The new device has no FCM token yet when it opens (FCM issues it after the APNs registration): the list is posted
    /// with the restored token, as Cordova's repost does; when the new token arrives it replaces the restored one.
    @Test func aTokenArrivingAfterTheOpenReplacesTheRestoredOne() async throws {
        let d = Devices()
        defer { d.cleanUp() }
        try d.seed(storedToken: "token-old")
        _ = try d.restore()
        let transport = HeldTransport()
        let (sync, _, queue) = try d.process(transport, deviceId: try #require(try d.deviceId()))
        let opened = try #require(await sync.open { nil })
        #expect(opened.requests.map(\.method) == ["POST"])
        #expect(await sync.receive(token: "token-new"))
        #expect(transport.requests.map(\.method) == ["POST", "PUT"])
        #expect(replacement(transport.requests.last) == ["token-old", "token-new"])
        expectRestoredIdentity(transport.requests)
        #expect(try d.storedToken() == "token-new")
        #expect(try queue.pending().isEmpty)
    }

    /// A restored state without a stored FCM token (a backup taken before the old device had one): the new token is a
    /// first token, so its registration also posts the list, with the restored `Device-Id`.
    @Test func aRestoredStateWithoutATokenRegistersTheNewToken() async throws {
        let d = Devices()
        defer { d.cleanUp() }
        try d.seed(storedToken: nil)
        _ = try d.restore()
        let transport = HeldTransport()
        let (sync, _, _) = try d.process(transport, deviceId: try #require(try d.deviceId()))
        let outcome = try #require(await sync.open { "token-new" })
        #expect(outcome.requests.map(\.method) == ["PUT", "POST", "POST"])
        #expect(replacement(transport.requests.first) == [nil, "token-new"])
        #expect(transport.requests.dropFirst().allSatisfy { r in
            r.body.arrayValue?.allSatisfy { $0["fcmToken"] == "token-new" } == true
        })
        expectRestoredIdentity(transport.requests)
        #expect(try d.storedToken() == "token-new")
    }
}
