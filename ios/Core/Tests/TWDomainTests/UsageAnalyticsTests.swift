import Foundation
import Testing
import TWDomain

/// The usage analytics consent (#2964 AC1, V22): grant, withdrawal and failed writes, the start's corroboration, screens
/// and the `att_status` property. Ported from the Android `AnalyticsTest` (AN-15) with the iOS user property of #2945.
/// Without a stored choice the device region decides (AK, 2026-11-24; `specs/analytics-default-on.md`): on outside the
/// EEA, the United Kingdom and Switzerland, off until the user opts in there and for an unknown region. The tests of the
/// choice itself run in an opt-in region (DE).
@MainActor
struct UsageAnalyticsTests {
    func make(_ records: MemoryRecords = MemoryRecords(),
              region: String? = "DE") -> (UsageAnalytics, FakeAnalyticsSdk, MemoryRecords) {
        let sdk = FakeAnalyticsSdk()
        return (UsageAnalytics(sdk: sdk, records: records, trafficType: "development", region: region), sdk, records)
    }

    /// In the EEA, the United Kingdom, Switzerland and an unknown region: off until the user opts in.
    @Test(arguments: ["DE", "FR", "GB", "CH", "NO", nil, "", "150"] as [String?])
    func offUntilTheUserOptsInWhereConsentIsAsked(region: String?) {
        let (analytics, sdk, records) = make(region: region)
        analytics.start()
        #expect(!analytics.collectsByDefault)
        #expect(!analytics.choice)
        #expect(sdk.calls == ["collection false", "consent false"])
        #expect(!analytics.track("favorite_change", ["action": .text("add")]))
        analytics.screen("tab.forecast")
        #expect(sdk.events.isEmpty)
        #expect(records.choice == nil, "no choice is written without the user")
    }

    /// Elsewhere collection starts without a stored choice, with analytics storage only, and writes no choice: a stored
    /// value keeps meaning that the user chose.
    @Test(arguments: ["KR", "US", "JP"])
    func onByDefaultElsewhere(region: String) throws {
        let (analytics, sdk, records) = make(region: region)
        var changes: [Bool] = []
        analytics.onChoiceChange = { changes.append($0) }
        analytics.start()
        #expect(analytics.collectsByDefault)
        #expect(analytics.choice && changes == [true])
        #expect(sdk.calls == ["collection false", "consent true", "collection true"],
                "collection stops first; the consent mode is set before collection starts")
        #expect(records.choice == nil, "the default is not written as a choice")
        #expect(records.collection, "the collection state is recorded")
        analytics.screen("tab.forecast")
        #expect(analytics.track("favorite_change", ["action": .text("add")]))
        #expect(sdk.events.map(\.name) == ["screen_view", "favorite_change"])

        // Again at the next start, still without a choice.
        let (restarted, restartedSdk, _) = make(records, region: region)
        restarted.start()
        #expect(restarted.choice && restartedSdk.collectionEnabled == true && records.choice == nil)
    }

    /// A stored choice wins over the region: "false" stays off where the default is on, "true" stays on where it is off.
    @Test func aStoredChoiceWinsOverTheRegion() {
        let declined = MemoryRecords()
        declined.choice = "false"
        let (off, offSdk, _) = make(declined, region: "KR")
        off.start()
        #expect(!off.choice && offSdk.calls == ["collection false", "consent false"])
        #expect(declined.choice == "false")

        let granted = MemoryRecords()
        granted.choice = "true"
        granted.collection = true
        let (on, onSdk, _) = make(granted, region: "DE")
        on.start()
        #expect(on.choice && onSdk.collectionEnabled == true)

        // An unconfirmed grant is withdrawn and written so, also where the default is on.
        let half = MemoryRecords()
        half.choice = "true"
        let (other, otherSdk, _) = make(half, region: "KR")
        other.start()
        #expect(!other.choice && otherSdk.collectionEnabled == false && half.choice == "false")
    }

    /// Turned off on the menu where the default is on: "false" is written and holds after a restart.
    @Test func turningTheDefaultOffHolds() {
        let records = MemoryRecords()
        let (analytics, sdk, _) = make(records, region: "KR")
        analytics.start()
        sdk.calls.removeAll()
        #expect(analytics.setCollectionEnabled(false))
        #expect(sdk.calls == ["collection false", "consent false"])
        #expect(!analytics.choice && records.choice == "false" && !records.collection)
        #expect(!analytics.track("favorite_change", ["action": .text("add")]))

        let (restarted, restartedSdk, _) = make(records, region: "KR")
        restarted.start()
        #expect(!restarted.choice && restartedSdk.collectionEnabled == false)
        #expect(restarted.setCollectionEnabled(true) && records.choice == "true", "on again writes true")
    }

    /// The collection state cannot be recorded while the default applies: everything stays off and still no choice is
    /// written, so the next start tries the default again.
    @Test func aFailedDefaultLeavesEverythingOffAndWritesNoChoice() {
        let records = MemoryRecords()
        records.failCollectionWrites = true
        let (analytics, sdk, _) = make(records, region: "KR")
        analytics.start()
        #expect(sdk.calls == ["collection false", "consent true", "collection true", "collection false", "consent false"])
        #expect(!analytics.choice && records.choice == nil)
        #expect(!analytics.track("favorite_change", ["action": .text("add")]))
        analytics.screen("tab.forecast")
        #expect(sdk.events.isEmpty)

        records.failCollectionWrites = false
        let (restarted, restartedSdk, _) = make(records, region: "KR")
        restarted.start()
        #expect(restarted.choice && restartedSdk.collectionEnabled == true && records.choice == nil)
    }

    @Test func grantEnablesCollectionWithAnalyticsStorageOnly() throws {
        let (analytics, sdk, records) = make()
        analytics.start()
        sdk.calls.removeAll()
        var changes: [Bool] = []
        analytics.onChoiceChange = { changes.append($0) }
        #expect(analytics.setCollectionEnabled(true))
        #expect(sdk.calls == ["collection false", "consent true", "collection true"],
                "collection stops first; the consent mode is set before collection starts")
        #expect(analytics.choice && changes == [true])
        #expect(records.choice == "true" && records.collection)
        #expect(analytics.track("favorite_change", ["action": .text("add")]))
        let event = try #require(sdk.events.last)
        #expect(event.name == "favorite_change")
        #expect(event.params.map(\.0) == ["action", "measurement_version", "traffic_type"])
        #expect(event.params.last?.1 == .text("development"))
    }

    @Test func withdrawalStopsCollectionAtOnceAndAfterARestart() {
        let records = MemoryRecords()
        let (analytics, sdk, _) = make(records)
        analytics.start()
        analytics.setCollectionEnabled(true)
        sdk.calls.removeAll()
        #expect(analytics.setCollectionEnabled(false))
        #expect(sdk.calls == ["collection false", "consent false"])
        #expect(!analytics.track("favorite_change", ["action": .text("remove")]))
        #expect(records.choice == "false" && !records.collection)

        let (restarted, restartedSdk, _) = make(records)
        restarted.start()
        #expect(!restarted.choice && restartedSdk.collectionEnabled == false)
    }

    @Test func aGrantSurvivesARestartOnlyWhenBothRecordsHoldIt() {
        let records = MemoryRecords()
        records.choice = "true"
        records.collection = true
        let (analytics, sdk, _) = make(records)
        analytics.start()
        #expect(analytics.choice && sdk.collectionEnabled == true)

        let half = MemoryRecords()
        half.choice = "true"
        half.collection = false
        let (other, otherSdk, _) = make(half)
        other.start()
        #expect(!other.choice && otherSdk.collectionEnabled == false)
        #expect(half.choice == "false", "the unconfirmed grant is withdrawn and written so")
    }

    /// A choice that cannot be written: the old grant is removed, collection is off and the menu shows 꺼짐.
    @Test func aFailedChoiceWriteWithdraws() {
        let records = MemoryRecords()
        let (analytics, sdk, _) = make(records)
        analytics.start()
        analytics.setCollectionEnabled(true)
        records.failChoiceWrites = true
        #expect(!analytics.setCollectionEnabled(false), "LOC_PRIVACY_SAVE_FAILED")
        #expect(!analytics.choice && records.choice == nil && sdk.collectionEnabled == false)

        records.failChoiceWrites = true
        #expect(!analytics.setCollectionEnabled(true))
        #expect(!analytics.choice && sdk.collectionEnabled == false, "an unsaved grant does not collect")
        #expect(!analytics.track("favorite_change", ["action": .text("add")]))
    }

    /// The collection state cannot be recorded: the grant is rolled back, so the start never restores half a grant.
    @Test func aFailedCollectionWriteRollsBack() {
        let records = MemoryRecords()
        let (analytics, sdk, _) = make(records)
        analytics.start()
        records.failCollectionWrites = true
        sdk.calls.removeAll()
        #expect(!analytics.setCollectionEnabled(true))
        #expect(sdk.calls == ["collection false", "consent true", "collection true", "collection false", "consent false"])
        #expect(!analytics.choice && records.choice == "false")
        #expect(!analytics.track("favorite_change", ["action": .text("add")]))
    }

    @Test func aFailedWithdrawalWriteStillHoldsAfterARestart() {
        let records = MemoryRecords()
        let (analytics, _, _) = make(records)
        analytics.start()
        analytics.setCollectionEnabled(true)
        records.failChoiceWrites = true
        records.failChoiceRemoval = true
        #expect(!analytics.setCollectionEnabled(false))
        #expect(records.choice == "true" && !records.collection, "the choice stayed, the collection state did not")
        records.failChoiceWrites = false
        let (restarted, sdk, _) = make(records)
        restarted.start()
        #expect(!restarted.choice && sdk.collectionEnabled == false)
    }

    @Test func screensAfterAnOptInOnly() {
        let (analytics, sdk, _) = make()
        analytics.start()
        analytics.screen("tab.forecast")
        analytics.setCollectionEnabled(true)
        #expect(sdk.events.isEmpty, "use before the choice is never sent")
        analytics.screen("tab.forecast")
        analytics.screen("tab.forecast")
        analytics.screen("tab.unknown")
        analytics.screen("units")
        #expect(sdk.events.map { $0.params.first!.1 } == [.text("tab.forecast"), .text("units")])
        #expect(sdk.events.allSatisfy { $0.params[1].1 == .text("Cordova") })
    }

    @Test func trackingStatusIsSentOnlyWhileCollecting() {
        let (analytics, sdk, _) = make()
        analytics.start()
        analytics.setAdTrackingStatus("denied")
        #expect(sdk.properties.isEmpty)
        analytics.setCollectionEnabled(true)
        #expect(sdk.properties.map(\.1) == ["denied"])
        analytics.setAdTrackingStatus("denied")
        analytics.setAdTrackingStatus("bogus")
        #expect(sdk.properties.count == 1)
        analytics.setCollectionEnabled(false)
        analytics.setCollectionEnabled(true)
        #expect(sdk.properties.map(\.1) == ["denied", "denied"], "set again after a later opt-in")
    }

    @Test func startRunsOnce() {
        let (analytics, sdk, _) = make()
        analytics.start()
        analytics.start()
        #expect(sdk.calls.count == 2)
    }
}
