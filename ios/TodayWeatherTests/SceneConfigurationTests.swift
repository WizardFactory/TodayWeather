import Foundation
import Testing
import UIKit
@testable import TodayWeather

/// The scene configuration a fallback Cordova build can restore (IN-17, #2966): UIKit keeps each scene session with its
/// configuration across updates. A configuration from `Info.plist` is kept by its name alone and resolved in the build
/// that starts; one made in code (SwiftUI's `App`) is kept with its delegate's class name, which the Cordova build does
/// not have (it then opened to a black window). The Cordova builds (cordova-ios 8) declare `Default Configuration`.
@MainActor
struct SceneConfigurationTests {
    @Test func infoPlistDeclaresTheConfigurationTheCordovaBuildsName() throws {
        let manifest = try #require(Bundle.main.object(forInfoDictionaryKey: "UIApplicationSceneManifest") as? [String: Any])
        let roles = try #require(manifest["UISceneConfigurations"] as? [String: Any])
        let list = try #require(roles["UIWindowSceneSessionRoleApplication"] as? [[String: Any]])
        try #require(list.count == 1)
        #expect(list[0]["UISceneConfigurationName"] as? String == "Default Configuration")
        let delegate = try #require(list[0]["UISceneDelegateClassName"] as? String)
        #expect(NSClassFromString(delegate) == SceneDelegate.self)
        #expect(list[0]["UISceneStoryboardFile"] == nil)
    }

    /// What UIKit keeps for a session of this app: the name and the role, no class name.
    @Test func aSessionIsKeptByTheConfigurationsName() throws {
        let app = UIApplication.shared
        let scene = try #require(app.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        #expect(scene.delegate is SceneDelegate, "the app's windows come from its scene delegate")
        #expect(app.delegate is AppDelegate)
        // The session's own configuration, and the one the app delegate answers UIKit with.
        for configuration in [scene.session.configuration, AppDelegate.configuration(for: scene.session.role)] {
            #expect(configuration.name == AppDelegate.sceneConfiguration)
            #expect(configuration.delegateClass == SceneDelegate.self)
            let data = try NSKeyedArchiver.archivedData(withRootObject: configuration, requiringSecureCoding: true)
            let archive = try #require(try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
            let texts = (archive["$objects"] as? [Any] ?? []).compactMap { $0 as? String }
            #expect(texts.contains("Default Configuration"))
            #expect(!texts.contains { $0.contains("Delegate") }, "no delegate class name is kept: \(texts)")
        }
    }

    /// The warm start the SwiftUI `App` took from its scene phase: once per return from the background.
    @Test func aReturnFromTheBackgroundIsOneWarmStart() {
        let center = NotificationCenter()
        var resumes = 0
        let starts = WarmStarts(center: center) { resumes += 1 }
        center.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        #expect(resumes == 0, "the launch's activation is no warm start")
        center.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        #expect(resumes == 0)
        center.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        center.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        #expect(resumes == 1, "once, not again for an activation without a background before it")
        withExtendedLifetime(starts) {}
    }
}
