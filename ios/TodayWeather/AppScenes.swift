import SwiftUI
import UIKit
import WidgetKit

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

    private var warmStarts: WarmStarts?
    private var restoredSessions: NSObjectProtocol?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // IN-15: ads, usage analytics and crash reporting follow the shell, which the migration creates.
        Monetization.shared.connect(AppLaunch.shared)
        // IN-16: the weather pages' share button.
        WeatherShare.shared.connect(AppLaunch.shared)
        // IN-14: a tap that started the app reaches the delegate only when it is set before the launch finishes.
        NotificationEvents.shared.start()
        AppStartup.shared.start(application)
        warmStarts = WarmStarts { AppLaunch.shared.entries.submit(.resume) }
        observeRestoredSessions()
        return true
    }

    /// A session an earlier build kept with a configuration made in code (this app's SwiftUI `App` builds before IN-17,
    /// on development and test devices) is restored by UIKit with that configuration's delegate,
    /// `SwiftUI.AppSceneDelegate`, which shows nothing here: a blank window (seen on the iOS 26.5 simulator). Such a
    /// scene gets this build's `SceneDelegate` and window when it connects (`SceneDelegate.adopt`).
    private func observeRestoredSessions() {
        restoredSessions = NotificationCenter.default.addObserver(forName: UIScene.willConnectNotification, object: nil,
                                                                  queue: .main) { note in
            // Delivered on the main queue; the scene does not leave it.
            nonisolated(unsafe) let connecting = note.object as? UIWindowScene
            MainActor.assumeIsolated {
                if let scene = connecting { _ = SceneDelegate.adopt(scene) }
            }
        }
    }

    /// UIKit asks for every new session, and again at a start for a session kept with a configuration made in code
    /// (seen on the iOS 26.5 simulator: a session of this app's earlier SwiftUI `App` builds got this configuration).
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        Self.configuration(for: connectingSceneSession.role)
    }

    /// `Info.plist`'s configuration by its name, which is all UIKit then keeps with the session.
    static func configuration(for role: UISceneSession.Role) -> UISceneConfiguration {
        UISceneConfiguration(name: sceneConfiguration, sessionRole: role)
    }
}

/// The app's warm starts (Cordova's `resume`): each return from the background to the active state, whichever window
/// comes forward, as SwiftUI's app-wide scene phase reported them. An activation without a background before it (the
/// launch, or a return from Notification Center) is none.
@MainActor
final class WarmStarts {
    private var wasInBackground = false
    private var observers: [NSObjectProtocol] = []

    init(center: NotificationCenter = .default, onResume: @escaping @MainActor () -> Void) {
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) {
            [weak self] _ in
            MainActor.assumeIsolated { self?.wasInBackground = true }
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) {
            [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.wasInBackground else { return }
                self.wasInBackground = false
                onResume()
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
        submit(options.urlContexts.map(\.url) + Self.webLinks(options.userActivities))
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        Monetization.shared.refreshTrackingStatus()
        WidgetStore.activated(at: Date())
        WidgetCenter.shared.reloadAllTimelines()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        submit(URLContexts.map(\.url))
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        submit(Self.webLinks([userActivity]))
    }

    /// The Universal Links of `activities` (`link.todayweather.ai`, #3097): only a web-browsing activity's page URL;
    /// Handoff and other activities with a page URL open nothing (specs/deeplink.md §6.2.4).
    static func webLinks(_ activities: some Sequence<NSUserActivity>) -> [URL] {
        activities.compactMap { $0.activityType == NSUserActivityTypeBrowsingWeb ? $0.webpageURL : nil }
    }

    /// A connecting application scene whose delegate is not this build's (a session restored with an earlier build's
    /// configuration made in code) gets a `SceneDelegate` with its window; nil when the scene already has one.
    @discardableResult
    static func adopt(_ scene: UIWindowScene) -> SceneDelegate? {
        guard scene.session.role == .windowApplication, !(scene.delegate is SceneDelegate) else { return nil }
        let delegate = SceneDelegate()
        scene.delegate = delegate
        delegate.show(in: scene)
        return delegate
    }

    /// The window with the root view; a second call for the same scene changes nothing.
    private func show(in scene: UIWindowScene) {
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
