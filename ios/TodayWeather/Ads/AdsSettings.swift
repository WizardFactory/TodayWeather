import Foundation

/// The AdMob identifiers of the build (IN-15, #2964), from the Info.plist keys `GADApplicationIdentifier` and
/// `TWAdMobBannerUnit`, which the build fills from `TW_ADMOB_APP_ID_IOS` and `TW_ADMOB_BANNER_IOS`
/// (Support/TodayWeather.xcconfig). Debug builds always carry Google's test app ID and test banner unit, as the
/// Cordova builds without `--release` did; Release builds take the private values of ios/Private.xcconfig.
struct AdsSettings: Equatable {
    /// Google's documented sample app ID and test banner unit for iOS (client/package.json, make-client-config.mjs).
    static let testAppID = "ca-app-pub-3940256099942544~1458002511"
    static let testBannerUnit = "ca-app-pub-3940256099942544/2435281174"

    /// The app ID of a Release build without the private value (Support/TodayWeather.xcconfig): no AdMob app has it,
    /// and it only keeps the Ads SDK from stopping the app at launch.
    static let placeholderAppID = "ca-app-pub-0000000000000000~0000000000"

    let bannerUnit: String
    /// A Release build with real ad units (`clientConfig.releaseAds`): UMP is never bypassed.
    let releaseAds: Bool

    /// The settings of a build, or nil when it must request no ads: a value is missing or malformed, or a Release
    /// build carries Google's test values. A Release build never falls back to test ads.
    static func from(info: [String: Any], debug: Bool) -> AdsSettings? {
        guard let appID = info["GADApplicationIdentifier"] as? String,
              let unit = info["TWAdMobBannerUnit"] as? String,
              appID.wholeMatch(of: /ca-app-pub-[0-9]{16}~[0-9]{10}/) != nil,
              unit.wholeMatch(of: /ca-app-pub-[0-9]{16}\/[0-9]{10}/) != nil else { return nil }
        if debug {
            guard appID == testAppID, unit == testBannerUnit else { return nil }
            return AdsSettings(bannerUnit: unit, releaseAds: false)
        }
        guard appID != testAppID, appID != placeholderAppID, !unit.hasPrefix("ca-app-pub-3940256099942544/") else { return nil }
        return AdsSettings(bannerUnit: unit, releaseAds: true)
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
