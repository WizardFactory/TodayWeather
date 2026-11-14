import SwiftUI

/// The native TodayWeather app (#2948): the app shell (IN-07, #2956) over the state of the Cordova migration.
@main
struct TodayWeatherApp: App {
    /// Starts analytics off and migrates the Cordova state (`AppStartup`), also when iOS starts the app in the
    /// background.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var wasInBackground = false

    init() {
        // IN-15: ads, usage analytics and crash reporting follow the shell, which the migration creates.
        Monetization.shared.connect(AppLaunch.shared)
    }

    var body: some Scene {
        WindowGroup {
            RootView(launch: AppLaunch.shared)
                // A link that opened the app waits for the migration like every entry event.
                .onOpenURL { AppLaunch.shared.entries.submit(.link($0)) }
        }
        .onChange(of: scenePhase) { _, phase in
            // A warm start: back from the background (Cordova's `resume`).
            if phase == .background { wasInBackground = true }
            if phase == .active, wasInBackground {
                wasInBackground = false
                AppLaunch.shared.entries.submit(.resume)
            }
        }
    }
}
