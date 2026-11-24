import Foundation
import Testing

/// Parity row I12 (CODEX-IN18P1-3): crash reports are collected whatever the analytics choice, as the Cordova build's
/// Crashlytics plugin did (`FIREBASE_CRASHLYTICS_COLLECTION_ENABLED` on). With no Firebase project in the tests this is
/// checked in the app's sources and Info.plist: Crashlytics starts in one place, only when Firebase is configured and
/// not under the analytics choice; nothing turns its collection off; the analytics choice reaches only Analytics.
struct CrashReportingSourceTests {
    static let ios = ParityChecklistTests.ios
    static func source(_ path: String) throws -> String {
        try String(contentsOf: ios.appendingPathComponent(path), encoding: .utf8)
    }
    static func appSources() -> [String: String] {
        var out: [String: String] = [:]
        let dir = ios.appendingPathComponent("TodayWeather")
        guard let walker = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: nil) else { return out }
        for case let file as URL in walker where file.pathExtension == "swift" {
            out[file.path.replacingOccurrences(of: dir.path + "/", with: "")] = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
        }
        return out
    }

    @Test func crashReportsDoNotFollowTheAnalyticsChoice() throws {
        let sources = Self.appSources()
        #expect(sources.count > 20, "\(sources.count) app sources")
        // Crashlytics starts in one place: `Monetization.attach`, under the Firebase configuration only.
        let starts = sources.filter { $0.value.contains("Crashlytics.crashlytics()") }.keys.sorted()
        #expect(starts == ["Ads/Monetization.swift"])
        let monetization = try #require(sources["Ads/Monetization.swift"])
        let start = try #require(monetization.range(of: "Crashlytics.crashlytics()"))
        // The code (not the comments) of the function up to the start: the enclosing condition is the configuration's.
        let code = monetization[..<start.lowerBound].split(separator: "\n").suffix(8)
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.hasPrefix("//") }
        #expect(code.last { $0.hasPrefix("if ") } == "if AnalyticsGuard.firebaseConfigured {", "started with a configured Firebase app")
        #expect(!code.contains { $0.contains("choice") || $0.contains("allowed") || $0.contains("region") || $0.contains("ByDefault") },
                "not under the analytics choice or its region default: \(code)")
        // Nothing turns crash collection off or ties it to the choice.
        let off = sources.filter { $0.value.contains("setCrashlyticsCollectionEnabled") || $0.value.contains("isCrashlyticsCollectionEnabled") }
        #expect(off.isEmpty, "no source changes Crashlytics' collection: \(off.keys.sorted())")
        let plist = try Self.source("Support/Info.plist")
        #expect(!plist.contains("FirebaseCrashlyticsCollectionEnabled"), "Info.plist keeps Crashlytics' default (on)")
        // The analytics choice reaches Analytics only.
        let bridges = try #require(sources["Ads/FirebaseBridges.swift"])
        #expect(bridges.contains("Analytics.setAnalyticsCollectionEnabled(enabled)"))
        #expect(!bridges.contains("Crashlytics"))
    }

    /// The default of usage analytics without a stored choice (2026-11-24) follows the device's region setting, not the
    /// app's language: the app's analytics read `Locale.current.region`, once, where `Monetization` creates them, and
    /// nothing turns collection on before that (the guard runs before and after `FirebaseApp.configure()`, and the
    /// Info.plist defaults stay off).
    @Test func theAnalyticsDefaultFollowsTheDeviceRegion() throws {
        let sources = Self.appSources()
        let regionReads = sources.filter { $0.value.contains("Locale.current.region") }.keys.sorted()
        #expect(regionReads == ["Ads/Monetization.swift"])
        let monetization = try #require(sources["Ads/Monetization.swift"])
        #expect(monetization.contains("region: Locale.current.region?.identifier"))
        let enables = sources.filter { $0.value.contains("setAnalyticsCollectionEnabled(true)") }.keys.sorted()
        #expect(enables.isEmpty, "collection is enabled only through the bridge's choice: \(enables)")
        let guardSource = try #require(sources["AnalyticsGuard.swift"])
        let configure = try #require(guardSource.range(of: "FirebaseApp.configure(options: options)"))
        #expect(guardSource[..<configure.lowerBound].contains("disable()") && guardSource[configure.upperBound...].contains("disable()"))
        let plist = try Self.source("Support/Info.plist")
        for key in ["FIREBASE_ANALYTICS_COLLECTION_ENABLED", "GOOGLE_ANALYTICS_DEFAULT_ALLOW_ANALYTICS_STORAGE",
                    "GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_STORAGE", "GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_USER_DATA",
                    "GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS"] {
            let entry = try #require(plist.range(of: "<key>\(key)</key>"), "\(key)")
            #expect(plist[entry.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("<false/>"), "\(key)")
        }
    }
}
