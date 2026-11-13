import Foundation
import Testing
import TWModel
import TWStorage
@testable import TodayWeather

/// What the Cordova app reported after seeding (ios/tools/upgrade/seed-cordova.js).
struct UpgradeSeed: Decodable {
    let deviceId: String
    let analyticsChoice: Bool
    let sdkCollectionEnabled: Bool
    let storage: [String: String?]
    let suite: [String: String?]

    /// `TW_UPGRADE_SEED` (base64 JSON), set only by ios/tools/upgrade/run-upgrade-test.sh.
    static func fromEnvironment() -> UpgradeSeed? {
        guard let text = ProcessInfo.processInfo.environment["TW_UPGRADE_SEED"],
              let data = Data(base64Encoded: text) else { return nil }
        return try? JSONDecoder().decode(UpgradeSeed.self, from: data)
    }

    func json(_ key: String) throws -> JSONValue {
        try #require((storage[key] ?? nil).flatMap { try? JSONValue.parse($0) }, "seeded \(key)")
    }
}

/// The update from the Cordova 1.1.1 build (gate G1 of #2948, state part), run on a simulator by
/// ios/tools/upgrade/run-upgrade-test.sh after it seeded the Cordova app and installed this build over it: once
/// after the first start (`TW_UPGRADE_PHASE=first`) and once after a restart (`restart`). `TW_UPGRADE_SOURCE` is
/// `localStorage` or `suite` (the WebKit storage removed, as after an update from 1.0.10). Skipped without the
/// seed, so ordinary test runs do not depend on it.
@MainActor
struct CordovaUpgradeTests {
    nonisolated static let enabled = ProcessInfo.processInfo.environment["TW_UPGRADE_SEED"] != nil
    let source = ProcessInfo.processInfo.environment["TW_UPGRADE_SOURCE"] ?? "localStorage"
    let home = URL(fileURLWithPath: NSHomeDirectory())

    @Test(.enabled(if: enabled)) func migratedStateMatchesTheCordovaState() throws {
        let seed = try #require(UpgradeSeed.fromEnvironment())
        let state = try #require(AppStartup.shared.state)

        let cities = try #require(seed.json("cities").arrayValue)
        try #require(state.places.count == cities.count)
        for (place, city) in zip(state.places, cities) {
            #expect(same(place.name, city["name"]?.stringValue))
            #expect(same(place.address, city["address"]?.stringValue))
            #expect(place.currentPosition == (city["currentPosition"]?.boolValue == true))
            #expect(place.disable == (city["disable"]?.boolValue ?? false))
            let loc = city["location"]?.objectValue
            #expect(place.location?.lat == loc?["lat"]?.numberValue?.double)
            #expect(place.location?.long == loc?["long"]?.numberValue?.double)
        }
        #expect(state.placeIndex == (try seed.json("cityIndex").numberValue.flatMap { Int($0.text) }))
        let units = try #require(seed.json("units").objectValue)
        for key in UnitSettings.keys {
            #expect(state.units.value(key) == units[key]?.stringValue, "\(key)")
        }
        #expect(state.units.temperatureUnit == "F")
        #expect(state.settings == Settings(startupPage: "1", refreshInterval: "30", theme: "dark"))
        let push = try #require(seed.json("pushData2").objectValue)
        #expect(state.push.records == push["pushList"]?.arrayValue?.compactMap(\.objectValue))
        #expect(state.push.records.count == 4)
        #expect(state.push.fcmToken == "token-a")
        #expect(state.expandShortChart)
        #expect(state.cordovaExtras["startVersion"] == (try seed.json("startVersion")))

        let info = try #require(state.migration)
        let other = source == "suite" ? "localStorage" : "suite"
        #expect(info.source.contains("cities=\(source)"))
        #expect(!info.source.contains("=\(other)"), "every key from \(source): \(info.source)")
        #expect(info.keys["twAnalyticsConsentV1"] == "ignored")
        if source == "suite" {
            #expect(info.localStorageFile == nil)
        } else {
            #expect(info.localStorageFile?.hasSuffix("LocalStorage/localstorage.sqlite3") == true)
        }
    }

    @Test(.enabled(if: enabled)) func deviceIdIsTheCordovaValue() throws {
        let seed = try #require(UpgradeSeed.fromEnvironment())
        #expect(AppStartup.shared.deviceId == seed.deviceId)
        #expect(UserDefaults.standard.string(forKey: "CDVUUID") == seed.deviceId)
    }

    /// The Cordova storage is only read: the suite and (in the localStorage run) the WebKit database still hold the
    /// seeded values.
    @Test(.enabled(if: enabled)) func sourcesAreKept() throws {
        let seed = try #require(UpgradeSeed.fromEnvironment())
        let suite = try #require(UserDefaults(suiteName: CordovaMigration.suiteName))
        #expect(suite.string(forKey: "cities") == (seed.suite["cities"] ?? nil))
        #expect(suite.string(forKey: "twAnalyticsConsentV1") == "true")
        let database = WebKitLocalStorage.locate(dataContainer: home)
        if source == "suite" {
            #expect(database == nil)
        } else {
            let items = try WebKitLocalStorage.readItems(at: try #require(database).url)
            func item(_ key: String) -> String? { items.first { JSString.equal($0.key, key) }?.value }
            #expect(same(item("cities"), seed.storage["cities"] ?? nil))
            #expect(item("twAnalyticsConsentV1") == "true")
        }
    }

    @Test(.enabled(if: enabled)) func aSecondRunChangesNothing() throws {
        let store = try AppStateStore.standard()
        let bytes = try Data(contentsOf: store.url)
        let runner = MigrationRunner(store: store, sources: {
            let suite = UserDefaults(suiteName: CordovaMigration.suiteName).map(CordovaSources.suiteValues) ?? [:]
            return try CordovaSources.read(dataContainer: URL(fileURLWithPath: NSHomeDirectory()), suite: suite)
        }, now: { Date().addingTimeInterval(86_400) }, region: { "US" })
        let again = try runner.runIfNeeded()
        #expect(again == AppStartup.shared.state)
        #expect(try Data(contentsOf: store.url) == bytes)
    }

    /// The Cordova app had analytics on (checked before the update by the script); the native app turned the SDK's
    /// persisted collection flag and the analytics consent off.
    @Test(.enabled(if: enabled)) func analyticsIsOffAlthoughCordovaOptedIn() throws {
        let seed = try #require(UpgradeSeed.fromEnvironment())
        #expect(seed.analyticsChoice && seed.sdkCollectionEnabled, "the Cordova opt-in was in place")
        #expect(AnalyticsGuard.firebaseConfigured, "the test build carries a Firebase configuration")
        let flag = UserDefaults.standard.object(forKey: "/google/measurement/measurement_enabled_state") as? Int
        #expect(flag != nil && flag != 1, "persisted collection flag: \(String(describing: flag))")
        let consent = UserDefaults(suiteName: "APMAnalyticsSuiteName")?.dictionary(forKey: "consent_settings_3p")
        #expect(consent?["analytics_storage"] as? String == "denied")
    }
}

/// Code-unit equality of two optional texts, as the Cordova code compares strings.
private func same(_ a: String?, _ b: String?) -> Bool {
    switch (a, b) {
    case (nil, nil): true
    case let (a?, b?): JSString.equal(a, b)
    default: false
    }
}
