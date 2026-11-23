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

    @Test func debugBuildUsesGoogleTestIdentifiers() {
        #expect(info["GADApplicationIdentifier"] as? String == AdsSettings.testAppID)
        #expect(info["TWAdMobBannerUnit"] == nil)
        #expect(AdsSettings.current == AdsSettings(nativeUnit: AdsSettings.testNativeUnit,
                                                   interstitialUnit: AdsSettings.testInterstitialUnit, releaseAds: false))
        #expect(AdsSettings.trafficType(AdsSettings.current) == "development")
        var swapped = info
        swapped["TWAdMobNativeUnit"] = AdsSettings.testInterstitialUnit
        swapped["TWAdMobInterstitialUnit"] = AdsSettings.testNativeUnit
        #expect(AdsSettings.from(info: swapped, debug: true) == nil)
    }

    /// The ad-free capture build (`run-manual-capture.sh --no-ads`, #3122) has empty unit values: no ads in either
    /// configuration, so `Monetization` starts no UMP, no SDK and no request. The app itself has no switch for it.
    @Test func emptyUnitsMeanNoAds() {
        for debug in [true, false] {
            let appID = debug ? AdsSettings.testAppID : "ca-app-pub-1234567890123456~1234567890"
            let empty = ["GADApplicationIdentifier": appID, "TWAdMobNativeUnit": "", "TWAdMobInterstitialUnit": ""]
            #expect(AdsSettings.from(info: empty, debug: debug) == nil)
        }
    }

    @Test func releaseRequiresDistinctUnitsFromItsOwnPublisher() {
        let native = "ca-app-pub-1234567890123456/1234567890"
        let interstitial = "ca-app-pub-1234567890123456/1234567891"
        let configured = ["GADApplicationIdentifier": "ca-app-pub-1234567890123456~1234567890",
                          "TWAdMobNativeUnit": native, "TWAdMobInterstitialUnit": interstitial]
        let release = AdsSettings.from(info: configured, debug: false)
        #expect(release == AdsSettings(nativeUnit: native, interstitialUnit: interstitial, releaseAds: true))
        #expect(AdsSettings.trafficType(release) == "production")
        for (key, invalid) in [("GADApplicationIdentifier", AdsSettings.placeholderAppID),
                               ("GADApplicationIdentifier", AdsSettings.testAppID),
                               ("TWAdMobNativeUnit", interstitial), ("TWAdMobNativeUnit", AdsSettings.testNativeUnit),
                               ("TWAdMobInterstitialUnit", AdsSettings.testInterstitialUnit),
                               ("TWAdMobInterstitialUnit", "ca-app-pub-1111111111111111/1234567890"),
                               ("TWAdMobNativeUnit", "malformed")] {
            var candidate = configured
            candidate[key] = invalid
            #expect(AdsSettings.from(info: candidate, debug: false) == nil)
        }
        for key in configured.keys {
            var candidate = configured
            candidate.removeValue(forKey: key)
            #expect(AdsSettings.from(info: candidate, debug: false) == nil)
        }
        #expect(AdsSettings.from(info: configured, debug: true) == nil)
    }

    /// Every SDK request uses the live #2945 privacy decision.
    @Test @MainActor func adRequestsCarryNpaUnlessPersonalized() {
        let platform = StatePlatform()
        let gdpr = [AdConsentRecord(gdprApplies: 0, purposeConsents: nil), AdConsentRecord(gdprApplies: 1, purposeConsents: "1111"),
                    AdConsentRecord(gdprApplies: 1, purposeConsents: "1100")]
        for status in [TrackingStatus.authorized, .denied, .restricted, .notDetermined, .unavailable] {
            for record in gdpr {
                platform.state = (status, record)
                let extras = platform.makeRequest().adNetworkExtras(for: Extras.self) as? Extras
                let personalized = status == .authorized && record.purposeConsents != "1100"
                #expect((extras?.additionalParameters as? [String: String]) == (personalized ? nil : ["npa": "1"]),
                        "\(status) \(record)")
            }
        }
    }
}

/// An `AdsPlatform` that only answers the privacy state (the shared request rule).
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
