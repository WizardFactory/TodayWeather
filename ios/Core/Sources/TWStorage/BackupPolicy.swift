import Foundation

/// What an iCloud backup and a device-to-device transfer carry of the app's own files (IN-16, #2965). The app's files
/// live in `Library/Application Support/TodayWeather/`, which iOS backs up unless a file is marked excluded:
///
/// - Backed up: `app_state.json` (places, the selected place, units, settings, alarms and their push records, and the
///   FCM token stored with them), so a restored device keeps them and the next open replaces the restored token on the
///   server with the new device's token (`PushSync.open`, as the Android app after a restore, AN-16).
/// - Excluded: `push_tokens.json` (tokens of this device's FCM installation not registered yet; a restored device has its
///   own installation and token) and the usage analytics records `analytics-choice` and `analytics-collection` (IN-15;
///   the new device starts without a choice, so the device region's default applies there, as on Android).
///
/// The weather cache is in `Library/Caches`, and the migration's copies of the WebKit database in `tmp`; iOS backs up
/// neither. The Cordova storage the migration reads (WebKit's `localStorage`, the App Group suite) and the standard
/// preferences with `CDVUUID` are not the app's to mark: they stay in the backup, as in the Cordova build.
///
/// iOS keeps the mark with the file, and an atomic write replaces the file, so every writer of an excluded file marks it
/// again after each write (`exclude(_:)`).
public enum BackupPolicy {
    /// The app's files in `Library/Application Support/TodayWeather/` that stay out of backups.
    public static let excludedFiles = ["push_tokens.json", "analytics-choice", "analytics-collection"]
    /// The app's files there that are backed up.
    public static let backedUpFiles = ["app_state.json"]

    /// Marks the file at `url` excluded from backups. False when the mark could not be set (the file is then backed up
    /// until its next write).
    @discardableResult
    public static func exclude(_ url: URL) -> Bool {
        var url = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        do {
            try url.setResourceValues(values)
            return true
        } catch {
            return false
        }
    }

    /// Whether the item at `url` carries the mark (read from the file system, not a cached value).
    public static func isExcluded(_ url: URL) -> Bool {
        let fresh = URL(fileURLWithPath: url.path)
        return (try? fresh.resourceValues(forKeys: [.isExcludedFromBackupKey]))?.isExcludedFromBackup ?? false
    }
}
