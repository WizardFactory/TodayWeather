import Foundation
import Testing
@testable import TodayWeather

/// The analytics defaults of the Cordova build are in the app's Info.plist, and Firebase starts only with a
/// configuration file in the bundle (the private input; CI builds have none).
struct AnalyticsDefaultsTests {
    @Test func infoPlistRepeatsTheCordovaDefaults() {
        let info = Bundle.main.infoDictionary ?? [:]
        for key in ["FIREBASE_ANALYTICS_COLLECTION_ENABLED", "GOOGLE_ANALYTICS_DEFAULT_ALLOW_ANALYTICS_STORAGE",
                    "GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_STORAGE", "GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_USER_DATA",
                    "GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS",
                    "GOOGLE_ANALYTICS_IDFV_COLLECTION_ENABLED", "GOOGLE_ANALYTICS_REGISTRATION_WITH_AD_NETWORK_ENABLED",
                    "FirebaseAutomaticScreenReportingEnabled"] {
            #expect(info[key] as? Bool == false, "\(key)")
        }
    }

    @Test @MainActor func firebaseStartsOnlyWithAConfiguration() {
        let configured = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil
        #expect(AnalyticsGuard.firebaseConfigured == configured)
    }
}
