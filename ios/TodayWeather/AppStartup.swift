import Foundation
import os
import TWStorage
import UIKit

/// The start of every process, in the foreground or in the background (IN-03, #2952): analytics off, then the
/// Cordova migration and `Device-Id`. The migration reads files of the data container and the App Group, which
/// data protection hides before the first unlock after a restart; until protected data is available the run
/// waits, so it never records an empty source as the user's state.
@MainActor
final class AppStartup {
    static let shared = AppStartup()

    private let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "startup")
    private var waiting: NSObjectProtocol?

    /// The app state after the migration; nil until it ran.
    private(set) var state: AppState?
    /// The `Device-Id` for the legacy server (`CDVUUID`).
    private(set) var deviceId: String?

    func start(_ application: UIApplication) {
        AnalyticsGuard.start()
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
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        AppStartup.shared.start(application)
        return true
    }
}
