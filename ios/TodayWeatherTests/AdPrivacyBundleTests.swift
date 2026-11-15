import CryptoKit
import Foundation
import GoogleMobileAds
import Testing
import TWDomain
@testable import TodayWeather

/// The built app carries the Cordova build's tracking purpose strings and AdMob Info.plist entries (IN-15, #2964),
/// copied by ios/tools/import_ad_privacy.py, and Google's test AdMob identifiers in this Debug build. The app's AdMob
/// settings accept only valid identifiers, and a Release build never falls back to test ads.
struct AdPrivacyBundleTests {
    struct Provenance: Decodable {
        struct Locale: Decodable {
            let locale: String; let source: String; let commit: String; let source_sha256: String
            let output: String; let output_sha256: String; let value: String
        }
        struct Plugin: Decodable {
            let package: String; let version: String; let integrity: String; let plugin_xml_sha256: String
            let GADDelayAppMeasurementInit: Bool; let SKAdNetworkItems: [String]
        }
        let tracking: [Locale]
        let plugin: Plugin
    }

    static let iosDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()

    func provenance() throws -> Provenance {
        try JSONDecoder().decode(Provenance.self, from: Data(contentsOf: Self.iosDir.appendingPathComponent("provenance/ad-privacy.json")))
    }

    let info = Bundle.main.infoDictionary ?? [:]

    /// #2964 AC4: ko, en, ja, zh-Hans and zh-Hant, as the copies from client/resources/ios/tracking/ say.
    @Test func builtAppHasTheLocalizedTrackingPurposeStrings() throws {
        let records = try provenance().tracking
        #expect(records.map(\.locale) == ["ko", "en", "ja", "zh-Hans", "zh-Hant"])
        for record in records {
            #expect(record.source == "client/resources/ios/tracking/\(record.locale).lproj/InfoPlist.strings")
            #expect(record.commit.count == 40 && record.source_sha256 == record.output_sha256)
            let copy = try Data(contentsOf: Self.iosDir.appendingPathComponent(record.output))
            #expect(SHA256.hash(data: copy).map { String(format: "%02x", $0) }.joined() == record.output_sha256, "\(record.output)")
            let url = try #require(Bundle.main.url(forResource: "InfoPlist", withExtension: "strings", subdirectory: nil,
                                                   localization: record.locale), "\(record.locale)")
            let table = try #require(NSDictionary(contentsOf: url) as? [String: String], "\(record.locale)")
            #expect(table == ["NSUserTrackingUsageDescription": record.value], "\(record.locale)")
        }
        let english = try #require(records.first { $0.locale == "en" })
        #expect(info["NSUserTrackingUsageDescription"] as? String == english.value)
        #expect(Set(Bundle.main.localizations).isSuperset(of: ["ko", "en", "ja", "zh-Hans", "zh-Hant"]))
    }

    @Test func builtAppHasTheAdMobPluginEntries() throws {
        let plugin = try provenance().plugin
        #expect(plugin.package == "emi-indo-cordova-plugin-admob" && plugin.version == "3.0.4")
        let items = try #require(info["SKAdNetworkItems"] as? [[String: String]])
        #expect(items.map { $0["SKAdNetworkIdentifier"] ?? "" } == plugin.SKAdNetworkItems)
        #expect(items.count == 50)
        #expect(info["GADDelayAppMeasurementInit"] as? Bool == true)
    }

    /// Debug builds carry Google's documented test app ID and test banner unit.
    @Test func debugBuildUsesGoogleTestIdentifiers() {
        #expect(info["GADApplicationIdentifier"] as? String == AdsSettings.testAppID)
        #expect(info["TWAdMobBannerUnit"] as? String == AdsSettings.testBannerUnit)
        #expect(AdsSettings.current == AdsSettings(bannerUnit: AdsSettings.testBannerUnit, releaseAds: false))
        #expect(AdsSettings.trafficType(AdsSettings.current) == "development")
    }

    /// A Release build needs real identifiers: missing, malformed or test values mean no ads, never test ads.
    @Test func releaseSettingsRefuseMissingAndTestValues() {
        let real = ["GADApplicationIdentifier": "ca-app-pub-1234567890123456~1234567890",
                    "TWAdMobBannerUnit": "ca-app-pub-1234567890123456/1234567890"]
        #expect(AdsSettings.from(info: real, debug: false) == AdsSettings(bannerUnit: "ca-app-pub-1234567890123456/1234567890",
                                                                           releaseAds: true))
        #expect(AdsSettings.trafficType(AdsSettings.from(info: real, debug: false)) == "production")
        #expect(AdsSettings.from(info: [:], debug: false) == nil)
        #expect(AdsSettings.from(info: ["GADApplicationIdentifier": AdsSettings.placeholderAppID,
                                        "TWAdMobBannerUnit": real["TWAdMobBannerUnit"]!], debug: false) == nil,
                "the placeholder of a build without the private value")
        #expect(AdsSettings.from(info: ["GADApplicationIdentifier": "", "TWAdMobBannerUnit": ""], debug: false) == nil)
        #expect(AdsSettings.from(info: ["GADApplicationIdentifier": AdsSettings.testAppID,
                                        "TWAdMobBannerUnit": AdsSettings.testBannerUnit], debug: false) == nil)
        #expect(AdsSettings.from(info: ["GADApplicationIdentifier": real["GADApplicationIdentifier"]!,
                                        "TWAdMobBannerUnit": AdsSettings.testBannerUnit], debug: false) == nil)
        #expect(AdsSettings.from(info: ["GADApplicationIdentifier": "ca-app-pub-123~1", "TWAdMobBannerUnit": "x"], debug: false) == nil)
        #expect(AdsSettings.from(info: real, debug: true) == nil, "a Debug build never takes real units")
    }

    /// Each banner request applies the #2945 rule to the live state: `npa=1` unless it may be personalized.
    @Test @MainActor func bannerRequestsCarryNpaUnlessPersonalized() {
        let platform = StatePlatform()
        let banner = AdMobBanner(unitID: AdsSettings.testBannerUnit, platform: platform, track: { _, _ in })
        let gdpr = [AdConsentRecord(gdprApplies: 0, purposeConsents: nil), AdConsentRecord(gdprApplies: 1, purposeConsents: "1111"),
                    AdConsentRecord(gdprApplies: 1, purposeConsents: "1100")]
        for status in [TrackingStatus.authorized, .denied, .restricted, .notDetermined, .unavailable] {
            for record in gdpr {
                platform.state = (status, record)
                let extras = banner.request().adNetworkExtras(for: Extras.self) as? Extras
                let personalized = status == .authorized && record.purposeConsents != "1100"
                #expect((extras?.additionalParameters as? [String: String]) == (personalized ? nil : ["npa": "1"]),
                        "\(status) \(record)")
            }
        }
    }
}

/// An `AdsPlatform` that only answers the privacy state (the banner's request rule).
@MainActor
final class StatePlatform: AdsPlatform {
    var state: (TrackingStatus, AdConsentRecord) = (.notDetermined, AdConsentRecord(gdprApplies: 0, purposeConsents: nil))
    var canRequestAds: Bool { false }
    var consentStatus: AdsConsentStatus { .unknown }
    var privacyOptionsRequired = false
    var privacyOptionsShown = 0
    func requestConsentUpdate(_ done: @escaping @MainActor (String?) -> Void) { done("unused") }
    func loadConsentForm(_ done: @escaping @MainActor ((any AdsConsentForm)?, String?) -> Void) { done(nil, "unused") }
    func startSdk(_ ready: @escaping @MainActor () -> Void) {}
    func presentPrivacyOptions(_ done: @escaping @MainActor (String?) -> Void) { privacyOptionsShown += 1; done(nil) }
    func privacyState() -> (TrackingStatus, AdConsentRecord) { state }
}
