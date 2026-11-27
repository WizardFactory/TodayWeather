import Foundation
import Testing
import TWDomain
@testable import TodayWeather

/// `traffic_type` from the install environment (#3228): a Release build with real units reports `internal` when
/// StoreKit's `AppTransaction` says TestFlight (`sandbox`) or Xcode, `production` from the App Store; debug builds and
/// test units stay `development`. Events before the read resolves, and after a failed read, keep the build's value:
/// `internal` when the bundle carries a provisioning profile, else `production`; the read never holds analytics or ads.
@MainActor
struct InstallTrafficTypeTests {
    static let release = AdsSettings(nativeUnit: "ca-app-pub-1234567890123456/1234567890",
                                     interstitialUnit: "ca-app-pub-1234567890123456/1234567891", releaseAds: true)
    static let test = AdsSettings(nativeUnit: AdsSettings.testNativeUnit, interstitialUnit: AdsSettings.testInterstitialUnit,
                                  releaseAds: false)

    @Test func releaseBuildsFollowTheInstallEnvironment() {
        for provisioned in [false, true] {
            #expect(AdsSettings.trafficType(Self.release, environment: .sandbox, provisioned: provisioned) == "internal")
            #expect(AdsSettings.trafficType(Self.release, environment: .xcode, provisioned: provisioned) == "internal")
            #expect(AdsSettings.trafficType(Self.release, environment: .production, provisioned: provisioned) == "production")
        }
        #expect(AdsSettings.trafficType(Self.release) == "production", "unresolved or failed read")
    }

    /// Without an environment (before the read resolves, or after it failed) a build carrying a provisioning profile
    /// (development, ad hoc or enterprise signing: a locally signed Release build) is `internal`; App Store and TestFlight
    /// builds carry none and stay `production`.
    @Test func withoutAnEnvironmentAProvisionedBuildIsInternal() {
        #expect(AdsSettings.trafficType(Self.release, environment: nil, provisioned: true) == "internal")
        #expect(AdsSettings.trafficType(Self.release, environment: nil, provisioned: false) == "production")
    }

    @Test(arguments: [nil, InstallEnvironment.production, .sandbox, .xcode])
    func testUnitsAndDebugBuildsStayDevelopment(environment: InstallEnvironment?) {
        for provisioned in [false, true] {
            #expect(AdsSettings.trafficType(Self.test, environment: environment, provisioned: provisioned) == "development")
            #expect(AdsSettings.trafficType(nil, environment: environment, provisioned: provisioned) == "development")
        }
    }

    /// The test host is a simulator build: no provisioning profile in its bundle.
    @Test func theProfileIsReadFromTheBundle() throws {
        #expect(!InstallEnvironment.provisioned(Bundle.main))
        let bundle = FileManager.default.temporaryDirectory.appendingPathComponent("provisioned-\(UUID().uuidString).app")
        try FileManager.default.createDirectory(at: bundle, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: bundle) }
        try Data().write(to: bundle.appendingPathComponent("embedded.mobileprovision"))
        #expect(InstallEnvironment.provisioned(try #require(Bundle(url: bundle))))
    }

    func make(_ settings: AdsSettings?) -> (Monetization, PrivacyRowsTests.Sdk) {
        let sdk = PrivacyRowsTests.Sdk()
        let analytics = UsageAnalytics(sdk: sdk, records: PrivacyRowsTests.Records(),
                                       trafficType: AdsSettings.trafficType(settings), region: "KR")
        analytics.start()
        return (Monetization(analytics: analytics, settings: settings), sdk)
    }

    @Test(arguments: [(InstallEnvironment.sandbox, "internal"), (.xcode, "internal"), (.production, "production")])
    func eventsAfterTheReadCarryItsValue(environment: InstallEnvironment, expected: String) async throws {
        let (monetization, sdk) = make(Self.release)
        let gate = AsyncStream<Void>.makeStream()
        let task = try #require(monetization.resolveTrafficType(provisioned: false) {
            for await _ in gate.stream { break }
            return environment
        })
        #expect(monetization.analytics.track("favorite_change", ["action": .text("add")]), "not held by the read")
        gate.continuation.yield()
        await task.value
        #expect(monetization.analytics.track("favorite_change", ["action": .text("remove")]))
        #expect(sdk.trafficTypes == ["production", expected])
    }

    @Test func aFailedReadKeepsProduction() async throws {
        let (monetization, sdk) = make(Self.release)
        await (try #require(monetization.resolveTrafficType(provisioned: false) { nil })).value
        #expect(monetization.analytics.track("favorite_change", ["action": .text("add")]))
        #expect(sdk.trafficTypes == ["production"])
    }

    @Test func aFailedReadOfAProvisionedBuildIsInternal() async throws {
        let (monetization, sdk) = make(Self.release)
        await (try #require(monetization.resolveTrafficType(provisioned: true) { nil })).value
        #expect(monetization.analytics.track("favorite_change", ["action": .text("add")]))
        #expect(sdk.trafficTypes == ["internal"])
    }

    @Test func testUnitsReadNothing() {
        for settings in [Self.test, nil] {
            let (monetization, _) = make(settings)
            #expect(monetization.resolveTrafficType { Issue.record("read"); return .sandbox } == nil)
        }
    }
}
