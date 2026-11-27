import Foundation
import Testing
@testable import TodayWeather

/// `traffic_type` from the install (#3228, AK 2026-11-27): a Release build with real units reports `internal` when its
/// bundle carries a provisioning profile (Xcode, ad hoc) or its App Store receipt is the TestFlight `sandboxReceipt`,
/// `production` otherwise (App Store installs carry neither); debug builds and test units stay `development`.
struct InstallTrafficTypeTests {
    static let release = AdsSettings(nativeUnit: "ca-app-pub-1234567890123456/1234567890",
                                     interstitialUnit: "ca-app-pub-1234567890123456/1234567891", releaseAds: true)
    static let test = AdsSettings(nativeUnit: AdsSettings.testNativeUnit, interstitialUnit: AdsSettings.testInterstitialUnit,
                                  releaseAds: false)
    static let all = [InstallSource(provisioned: false, sandboxReceipt: false), InstallSource(provisioned: true, sandboxReceipt: false),
                      InstallSource(provisioned: false, sandboxReceipt: true), InstallSource(provisioned: true, sandboxReceipt: true)]

    @Test func releaseBuildsFollowTheInstall() {
        #expect(AdsSettings.trafficType(Self.release, install: .init(provisioned: true, sandboxReceipt: false)) == "internal")
        #expect(AdsSettings.trafficType(Self.release, install: .init(provisioned: false, sandboxReceipt: true)) == "internal")
        #expect(AdsSettings.trafficType(Self.release, install: .init(provisioned: true, sandboxReceipt: true)) == "internal")
        #expect(AdsSettings.trafficType(Self.release, install: .init(provisioned: false, sandboxReceipt: false)) == "production")
    }

    @Test(arguments: all)
    func testUnitsAndDebugBuildsStayDevelopment(install: InstallSource) {
        #expect(AdsSettings.trafficType(Self.test, install: install) == "development")
        #expect(AdsSettings.trafficType(nil, install: install) == "development")
    }

    /// TestFlight installs keep their receipt at `…/StoreKit/sandboxReceipt`, App Store installs at `…/StoreKit/receipt`.
    @Test func onlyTheTestFlightReceiptCounts() {
        let base = URL(fileURLWithPath: "/private/var/mobile/Containers/Data/Application/X/StoreKit")
        #expect(InstallSource.isSandboxReceipt(base.appendingPathComponent("sandboxReceipt")))
        #expect(!InstallSource.isSandboxReceipt(base.appendingPathComponent("receipt")))
        #expect(!InstallSource.isSandboxReceipt(nil))
    }

    /// The test host is a simulator build: no provisioning profile and no TestFlight receipt.
    @Test func theProfileIsReadFromTheBundle() throws {
        #expect(InstallSource.read(Bundle.main) == InstallSource(provisioned: false, sandboxReceipt: false))
        let bundle = FileManager.default.temporaryDirectory.appendingPathComponent("provisioned-\(UUID().uuidString).app")
        try FileManager.default.createDirectory(at: bundle, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: bundle) }
        try Data().write(to: bundle.appendingPathComponent("embedded.mobileprovision"))
        #expect(InstallSource.read(try #require(Bundle(url: bundle))).provisioned)
    }
}
