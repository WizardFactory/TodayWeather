import SwiftUI

/// The native TodayWeather app (#2948). IN-07 (#2956) replaces the empty screen with the app shell.
@main
struct TodayWeatherApp: App {
    /// Starts analytics off and migrates the Cordova state (`AppStartup`), also when iOS starts the app in the
    /// background.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
