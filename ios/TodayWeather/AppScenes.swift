import SwiftUI
import UIKit

/// The app's process delegate (`@main`): the start of every process (`AppStartup`, also when iOS starts the app in the
/// background) and the app's warm starts.
///
/// The app uses UIKit's scene life cycle with a scene configuration read from `Info.plist` (`Default Configuration`,
/// `SceneDelegate`), not SwiftUI's `App` (IN-17, #2966). UIKit keeps each scene session with its configuration across
/// updates: a configuration from `Info.plist` is kept by its name and resolved again in the build that starts, while
/// SwiftUI's `App` makes one in code that is kept with the class name `SwiftUI.AppSceneDelegate`, which a fallback
/// Cordova build (rollback hand-back) restored without having it, and opened to a black window. The Cordova builds
/// declare the same configuration name with their own delegate, so either build restores the other's session with its
/// own scene delegate.
@main
final class AppDelegate: NSObject, UIApplicationDelegate {
    /// `Info.plist`'s scene configuration, the name the Cordova builds use too (cordova-ios 8).
    static let sceneConfiguration = "Default Configuration"

    private var wasInBackground = false
    private var observers: [NSObjectProtocol] = []

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // IN-15: ads, usage analytics and crash reporting follow the shell, which the migration creates.
        Monetization.shared.connect(AppLaunch.shared)
        // IN-16: the weather pages' share button.
        WeatherShare.shared.connect(AppLaunch.shared)
        // IN-14: a tap that started the app reaches the delegate only when it is set before the launch finishes.
        NotificationEvents.shared.start()
        AppStartup.shared.start(application)
        observeWarmStarts()
        observeForeignSessions()
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        UISceneConfiguration(name: Self.sceneConfiguration, sessionRole: connectingSceneSession.role)
    }

    /// A warm start: the app is back from the background (Cordova's `resume`), whichever window comes forward.
    private func observeWarmStarts() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) {
            [weak self] _ in
            MainActor.assumeIsolated { self?.wasInBackground = true }
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) {
            [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.wasInBackground else { return }
                self.wasInBackground = false
                AppLaunch.shared.entries.submit(.resume)
            }
        })
    }

    /// A session UIKit restored with a configuration that is not this build's (kept with a class name by a build that
    /// made it in code, such as SwiftUI's `App` of this app's builds before IN-17): the scene gets this build's delegate
    /// and window, so the app shows whatever the session was kept with.
    private func observeForeignSessions() {
        observers.append(NotificationCenter.default.addObserver(forName: UIScene.willConnectNotification, object: nil,
                                                                queue: .main) { note in
            // Delivered on the main queue; the scene does not leave it.
            nonisolated(unsafe) let connecting = note.object as? UIWindowScene
            MainActor.assumeIsolated {
                guard let scene = connecting, scene.session.role == .windowApplication,
                      !(scene.delegate is SceneDelegate) else { return }
                let delegate = SceneDelegate()
                scene.delegate = delegate
                delegate.show(in: scene)
            }
        })
    }
}

/// One window of the app: the shell's root view (`RootView`) over the app's launch (`AppLaunch.shared`), as SwiftUI's
/// `WindowGroup` hosted it. A link that opens the app waits for the migration like every entry event.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        show(in: scene)
        submit(options.urlContexts.map(\.url) + options.userActivities.compactMap(\.webpageURL))
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        submit(URLContexts.map(\.url))
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        submit([userActivity.webpageURL].compactMap { $0 })
    }

    /// The window with the root view; a second call for the same scene changes nothing.
    func show(in scene: UIWindowScene) {
        guard window == nil else { return }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = UIHostingController(rootView: RootView(launch: AppLaunch.shared))
        window.makeKeyAndVisible()
        self.window = window
    }

    private func submit(_ links: [URL]) {
        for url in links { AppLaunch.shared.entries.submit(.link(url)) }
    }
}
