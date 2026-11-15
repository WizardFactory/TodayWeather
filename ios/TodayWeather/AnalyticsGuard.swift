import FirebaseAnalytics
import FirebaseCore
import Foundation

/// Analytics is off until the user opts in (IN-15); a Cordova opt-in does not carry over (#2948).
///
/// The Cordova opt-in left the SDK's persisted collection flag on (standard `UserDefaults`
/// `/google/measurement/measurement_enabled_state`), which overrides the `Info.plist` default
/// `FIREBASE_ANALYTICS_COLLECTION_ENABLED = false`. So collection is disabled and every consent type denied before
/// Firebase starts, and again right after, before anything else runs. Without the private
/// `GoogleService-Info.plist` Firebase is not configured at all and sends nothing.
enum AnalyticsGuard {
    static let consentDenied: [ConsentType: ConsentStatus] = [
        .analyticsStorage: .denied, .adStorage: .denied, .adUserData: .denied, .adPersonalization: .denied,
    ]

    /// Runs first in `application(_:didFinishLaunchingWithOptions:)`.
    static func start(bundle: Bundle = .main) {
        disable()
        guard let path = bundle.path(forResource: "GoogleService-Info", ofType: "plist"),
              let options = FirebaseOptions(contentsOfFile: path) else {
            return
        }
        FirebaseApp.configure(options: options)
        disable()
    }

    static var firebaseConfigured: Bool { FirebaseApp.app() != nil }

    private static func disable() {
        Analytics.setAnalyticsCollectionEnabled(false)
        Analytics.setConsent(consentDenied)
    }
}
