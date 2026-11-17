import Foundation
import SwiftUI
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

    /// What UIKit keeps for a session of this app: the name and the role, no class name; and whatever session the
    /// test host was restored with, its window comes from the app's scene delegate.
    @Test func aSessionIsKeptByTheConfigurationsName() throws {
        let app = UIApplication.shared
        let scene = try #require(app.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        #expect(app.delegate is AppDelegate)
        // Also for a session an earlier SwiftUI build kept (adopted).
        #expect(scene.delegate is SceneDelegate, "the app's windows come from its scene delegate")
        #expect((scene.delegate as? SceneDelegate)?.window?.rootViewController != nil)
        // The configuration the app delegate answers UIKit with, for every new session.
        try expectKeptByName(AppDelegate.configuration(for: scene.session.role))
        // The host's own session: from Info.plist on a clean install. A simulator that ran a SwiftUI build of this app
        // before IN-17 restores that build's session (made in code, kept with SwiftUI's delegate class and no name);
        // the scene delegate above covers it, and the session is not this build's to check.
        if let name = scene.session.configuration.name {
            #expect(name == AppDelegate.sceneConfiguration)
            try expectKeptByName(scene.session.configuration)
        }
    }

    private func expectKeptByName(_ configuration: UISceneConfiguration) throws {
        #expect(configuration.name == AppDelegate.sceneConfiguration)
        #expect(configuration.delegateClass == SceneDelegate.self)
        let data = try NSKeyedArchiver.archivedData(withRootObject: configuration, requiringSecureCoding: true)
        let archive = try #require(try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
        let texts = (archive["$objects"] as? [Any] ?? []).compactMap { $0 as? String }
        #expect(texts.contains("Default Configuration"))
        #expect(!texts.contains { $0.contains("Delegate") }, "no delegate class name is kept: \(texts)")
    }

    /// A scene restored with an earlier build's delegate gets the app's scene delegate and window; one that has it
    /// already is left alone.
    @Test func aSceneOfAnEarlierBuildsSessionIsAdopted() throws {
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let own = try #require(scene.delegate as? SceneDelegate)
        #expect(SceneDelegate.adopt(scene) == nil, "this build's delegate stays")
        #expect(scene.delegate === own)
        // As UIKit restores an earlier SwiftUI build's session: a delegate of another class, no window of the app's.
        let foreign = ForeignSceneDelegate()
        scene.delegate = foreign
        defer { scene.delegate = own; own.window?.makeKeyAndVisible() }
        let adopted = try #require(SceneDelegate.adopt(scene))
        #expect(scene.delegate === adopted)
        #expect(adopted.window?.windowScene === scene)
        #expect(adopted.window?.rootViewController is UIHostingController<RootView>)
        adopted.window?.isHidden = true
    }

    final class ForeignSceneDelegate: UIResponder, UIWindowSceneDelegate {}

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
