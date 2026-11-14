import Foundation
import Testing
import TWDomain

/// The usage analytics consent (#2964 AC1, V22): grant, withdrawal and failed writes, the start's corroboration, screens
/// and the `att_status` property. Ported from the Android `AnalyticsTest` (AN-15) with the iOS user property of #2945.
@MainActor
struct UsageAnalyticsTests {
    func make(_ records: MemoryRecords = MemoryRecords()) -> (UsageAnalytics, FakeAnalyticsSdk, MemoryRecords) {
        let sdk = FakeAnalyticsSdk()
        return (UsageAnalytics(sdk: sdk, records: records, trafficType: "development"), sdk, records)
    }

    @Test func offUntilTheUserOptsIn() {
        let (analytics, sdk, records) = make()
        analytics.start()
        #expect(!analytics.choice)
        #expect(sdk.calls == ["collection false", "consent false"])
        #expect(!analytics.track("favorite_change", ["action": .text("add")]))
        analytics.screen("tab.forecast")
        #expect(sdk.events.isEmpty)
        #expect(records.choice == nil, "no choice is written without the user")
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
