import Foundation
import os
import TWStorage
import UIKit

/// The start of every process, in the foreground or in the background (IN-03, #2952): analytics off, then the
/// Cordova migration and `Device-Id`. The migration reads files of the data container and the App Group, which
/// data protection hides before the first unlock after a restart; until protected data is available the run
/// waits, so it never records an empty source as the user's state.
///
/// After the migration, push (IN-04, #2953): tokens FCM delivered are registered in every process; the open
/// registration (the Cordova `Push.init`) runs once, when the process first becomes active, so not for a start in
/// the background (a push or a background task) until the user opens the app.
@MainActor
final class AppStartup {
    static let shared = AppStartup()

    private let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "startup")
    private var waiting: NSObjectProtocol?

    /// The app state after the migration; nil until it ran.
    private(set) var state: AppState?
    /// The `Device-Id` for the legacy server (`CDVUUID`).
    private(set) var deviceId: String?
    /// Push registration; nil before the migration and in a build without a server URL.
    private(set) var push: PushService?
    /// The process became active (the app was opened) at least once.
    private(set) var openRequested = false
    private let messaging = MessagingBridge()
    private var activeObserver: NSObjectProtocol?

    func start(_ application: UIApplication) {
        AnalyticsGuard.start()
        messaging.start(application)
        activeObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { _ in
            MainActor.assumeIsolated { AppStartup.shared.didBecomeActive() }
        }
        guard application.isProtectedDataAvailable else {
            log.info("protected data unavailable; the migration waits")
            waiting = NotificationCenter.default.addObserver(
                forName: UIApplication.protectedDataDidBecomeAvailableNotification, object: nil, queue: .main
            ) { _ in
                MainActor.assumeIsolated {
                    let startup = AppStartup.shared
                    if let waiting = startup.waiting { NotificationCenter.default.removeObserver(waiting) }
                    startup.waiting = nil
                    startup.loadState()
                }
            }
            return
        }
        loadState()
    }

    private func loadState() {
        do {
            let runner = MigrationRunner(
                store: try AppStateStore.standard(),
                sources: {
                    let suite = UserDefaults(suiteName: CordovaMigration.suiteName).map(CordovaSources.suiteValues) ?? [:]
                    return try CordovaSources.read(dataContainer: URL(fileURLWithPath: NSHomeDirectory()), suite: suite)
                },
                region: { CordovaRegion.from(preferredLanguages: Locale.preferredLanguages) })
            let state = try runner.runIfNeeded()
            self.state = state
            log.info("state ready: \(state.places.count) places, migration \(state.migration?.source ?? "none", privacy: .public)")
        } catch {
            log.error("state not loaded: \(String(describing: error), privacy: .public)")
        }
        deviceId = DeviceIdentity.deviceId()
        if state != nil, let deviceId {
            push = PushService.production(deviceId: deviceId)
            if push == nil { log.info("no server URL: push registration off") }
            push?.resume()
            if openRequested { push?.open() }
        }
    }

    /// The first activation of the process runs the open registration (after the migration, if it still waits).
    private func didBecomeActive() {
        if let activeObserver { NotificationCenter.default.removeObserver(activeObserver) }
        activeObserver = nil
        guard !openRequested else { return }
        openRequested = true
        push?.open()
    }

    /// A token from FCM: stored in the token queue first (also before the migration ran), then registered.
    func receive(token: String) {
        do {
            try PushTokenQueue.standard().append(token)
        } catch {
            log.error("token not queued: \(String(describing: error), privacy: .public)")
            return
        }
        push?.resume()
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        AppStartup.shared.start(application)
        return true
    }
}
