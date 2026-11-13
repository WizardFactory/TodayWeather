import Foundation

/// App state storage and the migration from the Cordova app (IN-03, #2952): `AppState` in `AppStateStore`,
/// `CordovaMigration` (the per-key rules), `WebKitLocalStorage` and the App Group suite as its sources,
/// `MigrationRunner` and `DeviceIdentity`. Foundation and SQLite only, so it is tested with `swift test`.
public enum TWStorage {}
