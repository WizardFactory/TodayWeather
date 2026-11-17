import Foundation
import Testing
import TWData
import TWModel
import TWStorage
@testable import TodayWeather

/// The rollback hand-back on a simulator (IN-17, #2966 AC2), run by ios/tools/upgrade/run-handback-test.sh between the
/// Cordova builds it installs. `TW_HANDBACK_STEP` names the step: `edit` changes places, alarms, units, the theme and
/// the analytics choice after the update from the seeded Cordova 1.1.1 build; `adopt` starts after a fallback Cordova
/// build claimed the state and changed it; `withdrawn` after the fallback build withdrew the analytics choice.
/// `TW_HANDBACK_CLAIM` is the generation of the fallback build's claim. The app's own start (the host process) ran the
/// migration and the first hand-back; the test goes on through the app's state holder and analytics. Skipped without the
/// step, so ordinary test runs do not depend on it; the script requires each step passed.
@MainActor
struct HandBackUpgradeTests {
    nonisolated static let environment = ProcessInfo.processInfo.environment
    nonisolated static let step = environment["TW_HANDBACK_STEP"]
    let claim = HandBackUpgradeTests.environment["TW_HANDBACK_CLAIM"].flatMap { Int($0) }
    let zone = TimeZone.current
    /// 명동's first alarm moved from 07:40 to 08:10 in the native app (S09).
    static let movedAlarm = 8 * 3600 + 10 * 60

    var holder: AppStateHolder { AppLaunch.shared.holder }
    var suite: UserDefaults { UserDefaults(suiteName: CordovaMigration.suiteName)! }

    /// Step 2: the edits of the native app reach the suite, in the texts the Cordova app reads.
    @Test(.enabled(if: step == "edit")) func editsInTheNativeApp() async throws {
        let migrated = try #require(AppStartup.shared.state)
        #expect(migrated.places.map(\.name) == [nil, "명동", "London"])
        #expect(migrated.migration?.handBackGeneration == nil, "the shipped 1.1.1 claims nothing")
        #expect(AppHandBack.writer != nil, "the build has the App Group: it hands back")
        // The state of the first load is handed back before any change (no choice: the migration carries none).
        let first = try await awaitHandBack(consent: nil)
        let now = Date()
        holder.change { s in
            // S02: London deleted with its alarm (IN-11); 부산 added and selected.
            let removed = PlaceList.remove(s, 2)
            var next = removed
            next.push.records = removed.push.records.filter { PushRecords.cityIndex($0) != 2 }
            let busan = Place(currentPosition: false, disable: false, name: "부산", address: "대한민국 부산광역시", country: "KR",
                              location: Location(lat: 35.18, long: 129.08), source: "KMA")
            next = PlaceList.selectLast(PlaceList.add(next, busan)!)
            // S09: 명동's first alarm at 08:10 (IN-14).
            let settings = AlarmSettings.load(next.push.records, cityIndex: 1, places: next.places, now: now, zone: zone)
            let row = settings.rows(zone: zone).first { $0.seconds == 7 * 3600 + 40 * 60 }!.index
            let saved = settings.pick(row, seconds: Self.movedAlarm, places: next.places, now: now, zone: zone)
                .toSave(now: now, zone: zone)!
            next.push = PushRegistration.onPlaceSaved(next.push, places: next.places, list: saved, index: 1, context: nil).state
            // Settings: Celsius and the light theme (IN-12).
            next.units.temperatureUnit = "C"
            next.settings.theme = "light"
            s = next
        }
        // The menu's analytics withdrawal (IN-15), handed back at once.
        #expect(Monetization.shared.analytics.setCollectionEnabled(false))
        let handed = try await awaitHandBack(consent: "false")
        #expect(handed.generation > first.generation)
        #expect(names() == [nil, "명동", "부산"])
        #expect(suite.string(forKey: "cityIndex") == "2")
        #expect(json("units")["temperatureUnit"] == "C")
        #expect(json("settingsInfo")["theme"] == "light")
        let records = json("pushData2")["pushList"]?.arrayValue?.compactMap(\.objectValue) ?? []
        #expect(Set(records.compactMap(PushRecords.cityIndex)) == [1], "London's alarm is gone; 부산 has none")
        let moved = records.filter { PushRecords.category($0) == "alarm" && PushRecords.id($0) == 2 }
        #expect(moved.map { PushRecords.localSeconds($0["time"], zone: zone) } == [Self.movedAlarm])
        #expect(json("pushData2")["fcmToken"] == "token-a")
        #expect(suite.object(forKey: "pushData") == nil)
    }

    /// Step 5: the native start adopts the fallback build's state, hands it back, and a grant here is handed back too.
    @Test(.enabled(if: step == "adopt")) func adoptsWhatTheFallbackBuildChanged() async throws {
        let state = try #require(AppStartup.shared.state)
        let claim = try #require(claim)
        #expect(state.migration?.handBackGeneration == claim)
        // The fallback build's edits (handback-cordova.js edit): 부산 deleted, 대전 added and selected with an alarm, °F, dark.
        #expect(state.places.map(\.name) == [nil, "명동", "대전"])
        #expect(state.placeIndex == 2)
        #expect(state.units.temperatureUnit == "F")
        #expect(state.settings.theme == "dark")
        let daejeon = state.push.records.filter { PushRecords.cityIndex($0) == 2 }
        #expect(daejeon.map { PushRecords.localSeconds($0["time"], zone: zone) } == [9 * 3600])
        let moved = state.push.records.filter { PushRecords.cityIndex($0) == 1 && PushRecords.id($0) == 2 }
        #expect(moved.map { PushRecords.localSeconds($0["time"], zone: zone) } == [Self.movedAlarm],
                "the native edit came back through the fallback build")
        #expect(state.push.fcmToken == "token-a")
        // The grant made in the fallback build is not carried over: the withdrawal made here stands.
        #expect(AnalyticsConsentFiles.standard().readChoice() == "false")
        #expect(!Monetization.shared.analytics.choice)
        #expect(try await awaitHandBack(consent: "false").generation == claim + 1)
        #expect(Monetization.shared.analytics.setCollectionEnabled(true))
        #expect(try await awaitHandBack(consent: "true").generation == claim + 2)
    }

    /// Step 7: the fallback build withdrew the choice after the grant here: collection stays off at this start.
    @Test(.enabled(if: step == "withdrawn")) func aWithdrawalInTheFallbackBuildHolds() async throws {
        let state = try #require(AppStartup.shared.state)
        let claim = try #require(claim)
        #expect(state.migration?.handBackGeneration == claim)
        #expect(state.places.map(\.name) == [nil, "명동", "대전"])
        #expect(AnalyticsConsentFiles.standard().readChoice() == "false")
        #expect(!Monetization.shared.analytics.choice)
        #expect(try await awaitHandBack(consent: "false").generation == claim + 1)
    }

    /// Waits until the suite holds the saved state's texts with `consent` under a complete native marker (the holder hands
    /// back its first load and every save), and returns that marker.
    func awaitHandBack(consent: String?) async throws -> CordovaHandBack.Marker {
        var last = ""
        for _ in 0..<150 {
            await holder.saved()
            if let saved = holder.state {
                let texts = CordovaHandBack.texts(saved, consent: consent)
                let marker = CordovaHandBack.parse(suite.object(forKey: CordovaHandBack.marker) as? String)
                let different = texts.filter { ($0.text != (suite.object(forKey: $0.key) as? String)) }.map(\.key)
                if let marker, marker.writer == "native", marker.complete, marker.keys == CordovaHandBack.keys, different.isEmpty {
                    return marker
                }
                last = "marker \(String(describing: marker)), different keys \(different)"
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        Issue.record("no hand-back of the saved state: \(last)")
        throw CancellationError()
    }

    func json(_ key: String) -> JSONValue {
        (suite.string(forKey: key).flatMap { try? JSONValue.parse($0) }) ?? .null
    }

    func names() -> [String?] { json("cities").arrayValue?.map { $0["name"]?.stringValue } ?? [] }
}
