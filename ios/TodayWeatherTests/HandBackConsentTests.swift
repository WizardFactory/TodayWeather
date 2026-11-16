import Foundation
import Testing
import TWDomain
import TWModel
import TWStorage
import UIKit
@testable import TodayWeather

/// The analytics choice in the rollback hand-back (IN-17, #2966; the Android `HandBackTest` consent cases): every write
/// of the choice, also a withdrawal without an earlier choice, hands the last saved state back at once with it; before the
/// stored choice applies, a grant stands only while the suite says `"true"` once anything was handed over. The suite is a
/// `UserDefaults` suite of the test's own; the choice files are in a temporary directory; the SDK is a double.
@MainActor
struct HandBackConsentTests {
    @MainActor
    final class Fixture {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("in17-consent-\(UUID().uuidString)")
        let suiteName = "in17-handback-\(UUID().uuidString)"
        let suite: UserDefaults
        let files: AnalyticsConsentFiles
        let writer: HandBackWriter
        let records: HandBackConsentRecords

        init() {
            suite = UserDefaults(suiteName: suiteName)!
            files = AnalyticsConsentFiles(directory: directory)
            let directory = self.directory
            writer = HandBackWriter(suite: suite, consent: { AnalyticsConsentFiles.storedChoice(in: directory) })
            records = HandBackConsentRecords(records: files, suite: suite, handBack: writer)
        }

        deinit {
            UserDefaults().removePersistentDomain(forName: suiteName)
            try? FileManager.default.removeItem(at: directory)
        }

        var marker: CordovaHandBack.Marker? { CordovaHandBack.parse(suite.string(forKey: CordovaHandBack.marker)) }
        var handedChoice: String? { suite.object(forKey: CordovaHandBack.consentKey) as? String }
    }

    static let state = AppState(places: [.currentPositionPlaceholder,
                                         Place(currentPosition: false, disable: false, name: "서울", address: "대한민국 서울특별시",
                                               country: "KR", location: Location(lat: 37.567, long: 126.978), source: "KMA")],
                                placeIndex: 1)

    final class Sdk: AnalyticsSdk {
        var collection: [Bool] = []
        func setCollectionEnabled(_ enabled: Bool) { collection.append(enabled) }
        func setConsent(analytics: Bool) {}
        func logEvent(_ name: String, _ parameters: [(String, AnalyticsParameter)]) {}
        func setUserProperty(_ value: String, forName name: String) {}
    }

    @Test func everyWriteOfTheChoiceIsHandedBackAWithdrawalWithoutAChoiceIncluded() {
        let f = Fixture()
        let analytics = UsageAnalytics(sdk: Sdk(), records: f.records, trafficType: "development")
        analytics.setCollectionEnabled(false)
        #expect(f.marker == nil, "nothing saved yet: nothing to hand back")
        f.writer.write(Self.state)
        #expect(f.marker?.generation == 1)
        #expect(f.handedChoice == "false")
        analytics.setCollectionEnabled(true)
        #expect(f.handedChoice == "true", "handed back at once, before the next start")
        #expect(f.marker?.generation == 2)
        analytics.setCollectionEnabled(false)
        #expect(f.handedChoice == "false")
        #expect(f.marker?.generation == 3)
        // A choice that cannot be written is removed and handed back as no choice.
        _ = f.records.removeChoice()
        #expect(f.handedChoice == nil)
        #expect(f.marker?.generation == 4)
        let cities = f.suite.string(forKey: "cities").flatMap { try? JSONValue.parse($0) }
        #expect(cities?.arrayValue?.map { $0["name"]?.stringValue } == [nil, "서울"], "with the last saved state")
    }

    @Test func aGrantStandsAtTheStartOnlyWhileTheSuiteSaysTrue() {
        let claim = #"{"schema":1,"generation":4,"writer":"cordova","complete":true,"keys":[]}"#
        let own = CordovaHandBack.markerText(generation: 5, writer: CordovaHandBack.native)
        func start(_ marker: String?, _ choice: String?, granted: Bool = true) -> (String?, Bool) {
            let f = Fixture()
            if granted { _ = f.files.writeChoice(true); _ = f.files.writeCollection(true) }
            f.suite.set(marker, forKey: CordovaHandBack.marker)
            f.suite.set(choice, forKey: CordovaHandBack.consentKey)
            // AppStartup's check, then the start of the choice.
            f.records.beforeStart()
            let analytics = UsageAnalytics(sdk: Sdk(), records: f.records, trafficType: "development")
            analytics.start()
            return (f.files.readChoice(), analytics.choice)
        }
        #expect(start(nil, nil) == ("true", true), "nothing handed over yet: an earlier grant stands")
        #expect(start(own, "true") == ("true", true), "its own hand-back")
        #expect(start(claim, "true") == ("true", true), "a fallback build that kept the grant")
        #expect(start(claim, "false") == ("false", false), "withdrawn in the fallback build")
        #expect(start(own, "false") == ("false", false), "withdrawn there while that build could not read the hand-back")
        #expect(start(claim, nil) == ("false", false), "no choice there: off")
        #expect(start(claim, "false", granted: false) == (nil, false), "no grant here: nothing is written")
        #expect(start(claim, "true", granted: false) == (nil, false), "a grant there is not carried over")
    }

    /// The check runs before the migration, so before this process hands its own choice back over the fallback build's.
    @Test func theStartChecksTheChoiceBeforeTheMigration() {
        let startup = AppStartup()
        var order: [String] = []
        startup.checkHandBackConsent = { order.append("consent") }
        startup.migrate = {
            order.append("migrate")
            throw CordovaSources.SourceError.unavailable("test")
        }
        startup.makePush = { _ in nil }
        startup.start(UIApplication.shared)
        #expect(order == ["consent", "migrate"])
    }
}
