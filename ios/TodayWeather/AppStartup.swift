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
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        AppStartup.shared.start(application)
        return true
    }
}
