import Foundation
import os
import TWStorage
import UIKit

/// The start of every process, in the foreground or in the background (IN-03, #2952): analytics off, then the
/// Cordova migration and `Device-Id`. The migration reads files of the data container and the App Group, which
/// data protection hides before the first unlock after a restart. Until protected data is available the run waits;
/// a source or state file that exists but cannot be read stops the run without writing anything, and the run is
/// tried again when protected data becomes available and at the next start. So an unreadable source is never
/// recorded as the user's state, and `CDVUUID` is never replaced because its file could not be read.
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
            waitForProtectedData()
            return
        }
        loadState()
    }

    private func waitForProtectedData() {
        guard waiting == nil else { return }
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
    }

    private func loadState() {
        let home = URL(fileURLWithPath: NSHomeDirectory())
        do {
            let runner = MigrationRunner(
                store: try AppStateStore.standard(),
                sources: {
                    let group = FileManager.default
                        .containerURL(forSecurityApplicationGroupIdentifier: CordovaMigration.suiteName)
                    guard let defaults = UserDefaults(suiteName: CordovaMigration.suiteName) else {
                        throw CordovaSources.SourceError.unavailable("suite \(CordovaMigration.suiteName)")
                    }
                    let suite = try CordovaSources.suiteValues(defaults, groupContainer: group)
                    return try CordovaSources.read(dataContainer: home, suite: suite)
                },
                region: { CordovaRegion.from(preferredLanguages: Locale.preferredLanguages) })
            let state = try runner.runIfNeeded()
            self.state = state
            log.info("state ready: \(state.places.count) places, migration \(state.migration?.source ?? "none", privacy: .public)")
        } catch {
            log.error("state not loaded, tried again later: \(String(describing: error), privacy: .public)")
            waitForProtectedData()
        }
        do {
            deviceId = try DeviceIdentity.deviceId()
        } catch {
            log.error("Device-Id not read, tried again later: \(String(describing: error), privacy: .public)")
            waitForProtectedData()
        }
        startPush()
    }

    /// Push registration once the state and the `Device-Id` are loaded (a later retry of `loadState` creates it).
    private func startPush() {
        if push == nil, state != nil, let deviceId {
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
