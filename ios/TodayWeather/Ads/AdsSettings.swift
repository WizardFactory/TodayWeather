import Foundation

/// A matching iOS app ID and two distinct format-specific ad units from the built app bundle.
struct AdsSettings: Equatable {
    /// Google's iOS demo units for Native Advanced and Interstitial (developers.google.com/admob/ios/test-ads).
    static let testAppID = "ca-app-pub-3940256099942544~1458002511"
    static let testNativeUnit = "ca-app-pub-3940256099942544/3986624511"
    static let testInterstitialUnit = "ca-app-pub-3940256099942544/4411468910"

    /// The app ID of a Release build without the private value (Support/App.xcconfig): no AdMob app has it,
    /// and it only keeps the Ads SDK from stopping the app at launch.
    static let placeholderAppID = "ca-app-pub-0000000000000000~0000000000"

    let nativeUnit: String
    let interstitialUnit: String
    /// A Release build with real ad units (`clientConfig.releaseAds`): UMP is never bypassed.
    let releaseAds: Bool

    /// The settings of a build, or nil when it must request no ads: a value is missing or malformed, or a Release
    /// build carries Google's test values. A Release build never falls back to test ads.
    static func from(info: [String: Any], debug: Bool) -> AdsSettings? {
        guard let appID = info["GADApplicationIdentifier"] as? String,
              let native = info["TWAdMobNativeUnit"] as? String,
              let interstitial = info["TWAdMobInterstitialUnit"] as? String,
              let app = appID.wholeMatch(of: /(ca-app-pub-[0-9]{16})~[0-9]{10}/),
              native != interstitial else { return nil }
        for unit in [native, interstitial] {
            guard let match = unit.wholeMatch(of: /(ca-app-pub-[0-9]{16})\/[0-9]{10}/),
                  match.1 == app.1 else { return nil }
        }
        if debug {
            guard appID == testAppID, native == testNativeUnit, interstitial == testInterstitialUnit else { return nil }
        } else {
            guard app.1 != "ca-app-pub-3940256099942544", app.1 != "ca-app-pub-0000000000000000" else { return nil }
        }
        return AdsSettings(nativeUnit: native, interstitialUnit: interstitial, releaseAds: !debug)
    }

    /// This build: `DEBUG` is the Debug configuration's compilation condition.
    static var current: AdsSettings? {
        #if DEBUG
        from(info: Bundle.main.infoDictionary ?? [:], debug: true)
        #else
        from(info: Bundle.main.infoDictionary ?? [:], debug: false)
        #endif
    }

    /// `traffic_type` of the analytics events: `development` unless the build has real ad units and is no debug build.
    static func trafficType(_ settings: AdsSettings?) -> String {
        settings?.releaseAds == true ? "production" : "development"
    }
}
