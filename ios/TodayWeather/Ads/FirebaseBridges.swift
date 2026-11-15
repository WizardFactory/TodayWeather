import FirebaseAnalytics
import FirebaseCore
import FirebaseRemoteConfig
import Foundation
import TWDomain

/// Firebase Analytics as the Cordova plugin (cordova-plugin-firebasex) called it (IN-15, #2964). Events and user
/// properties go out only while `UsageAnalytics` has collection enabled; without the private `GoogleService-Info.plist`
/// Firebase is not configured and nothing is logged.
@MainActor
final class FirebaseAnalyticsSdk: AnalyticsSdk {
    func setCollectionEnabled(_ enabled: Bool) {
        Analytics.setAnalyticsCollectionEnabled(enabled)
    }

    func setConsent(analytics: Bool) {
        Analytics.setConsent([
            .analyticsStorage: analytics ? .granted : .denied,
            .adStorage: .denied, .adUserData: .denied, .adPersonalization: .denied,
        ])
    }

    func logEvent(_ name: String, _ parameters: [(String, AnalyticsParameter)]) {
        guard AnalyticsGuard.firebaseConfigured else { return }
        var values: [String: Any] = [:]
        for (key, value) in parameters {
            switch value {
            case .text(let text): values[key] = text
            case .integer(let number): values[key] = NSNumber(value: number)
            }
        }
        Analytics.logEvent(name, parameters: values)
    }

    func setUserProperty(_ value: String, forName name: String) {
        guard AnalyticsGuard.firebaseConfigured else { return }
        Analytics.setUserProperty(value, forName: name)
    }
}

/// Remote Config as `Monetization.loadConfig` called it through the plugin: defaults, settings, the activated values,
/// then fetch-and-activate. Only with a configured Firebase app.
@MainActor
final class FirebaseBannerConfigSource: BannerConfigSource {
    private let config = RemoteConfig.remoteConfig()

    func setDefaults(_ defaults: [String: String], done: @escaping @MainActor (Bool) -> Void) {
        config.setDefaults(defaults.mapValues { $0 as NSString })
        done(true)
    }

    func setSettings(fetchTimeoutSeconds: Double, minimumFetchIntervalSeconds: Double,
                     done: @escaping @MainActor (Bool) -> Void) {
        let settings = RemoteConfigSettings()
        settings.fetchTimeout = fetchTimeoutSeconds
        settings.minimumFetchInterval = minimumFetchIntervalSeconds
        config.configSettings = settings
        done(true)
    }

    func loadActivated(done: @escaping @MainActor (Bool) -> Void) {
        let once = Once(done)
        config.ensureInitialized { error in
            let ok = error == nil
            Task { @MainActor in once.call(ok) }
        }
    }

    func fetchAndActivate(done: @escaping @MainActor (Bool) -> Void) {
        let once = Once(done)
        config.fetchAndActivate { status, error in
            let ok = error == nil && status != .error
            Task { @MainActor in once.call(ok) }
        }
    }

    func values() -> [String: String] {
        var values: [String: String] = [:]
        for key in [RemoteBannerPolicy.enabledKey, RemoteBannerPolicy.delayKey] {
            values[key] = config.configValue(forKey: key).stringValue
        }
        return values
    }
}
