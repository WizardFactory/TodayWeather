import Foundation
import TWModel

/// The startup gate of app.js (L362-L367): S01 opens while the stored `startVersion` is missing or below
/// `Util.startVersion`; otherwise the first tab follows the startup-page setting. Port of the Android `StartGate`.
public enum StartGate {
    /// `Util.startVersion` (service.util.js L33).
    public static let version = 1.0

    /// What closing S01 stores (`TwStorage.set("startVersion", Util.startVersion)`).
    public static let closed: JSONValue = .number(1)

    /// `startVersion === null || Util.startVersion > Number(startVersion)`, with `stored` as `TwStorage.get` returns it
    /// (the migrated `cordovaExtras.startVersion`). A value that is not a number (`NaN`) keeps the gate closed, as the
    /// comparison is false.
    public static func shows(_ stored: JSONValue?) -> Bool {
        guard let stored, !stored.isNull else { return true }
        return version > Js.number(stored)
    }
}

/// Where the app opens once its state is loaded.
public enum StartScreen: Equatable, Sendable {
    /// S01, the start page (IN-10).
    case start
    /// The shell on a tab.
    case tab(ShellTab)

    /// The gate for `startVersion` and the startup-page setting.
    public static func first(startVersion: JSONValue?, startupPage: String?) -> StartScreen {
        StartGate.shows(startVersion) ? .start : .tab(StartupPage.tab(startupPage))
    }
}
