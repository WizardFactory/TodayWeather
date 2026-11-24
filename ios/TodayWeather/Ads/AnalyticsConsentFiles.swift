import Foundation
import TWDomain
import TWStorage

/// The usage analytics choice and the SDK's collection state (IN-15, #2964) as two small files in
/// `Library/Application Support/TodayWeather/`, each written atomically: `analytics-choice` holds `true` or `false`
/// (the Cordova key `twAnalyticsConsentV1`), `analytics-collection` holds `true` or `false` after the SDK calls (the
/// plugin's persisted flag). A write reports failure, so a grant that could not be stored never survives. A missing
/// choice file is no choice, for which the device region's default applies (2026-11-24; it writes only the collection
/// state, never the choice); a choice file that cannot be read or holds anything but `true` leaves collection off. A
/// collection file that is missing or cannot be read counts as collection off. Both files are excluded from backups
/// (`BackupPolicy`, IN-16).
@MainActor
final class AnalyticsConsentFiles: AnalyticsConsentRecords {
    let directory: URL

    init(directory: URL) {
        self.directory = directory
    }

    /// The app's records.
    static func standard() -> AnalyticsConsentFiles {
        AnalyticsConsentFiles(directory: standardDirectory)
    }

    nonisolated static var standardDirectory: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("TodayWeather", isDirectory: true)
    }

    private var choiceURL: URL { directory.appendingPathComponent("analytics-choice") }
    private var collectionURL: URL { directory.appendingPathComponent("analytics-collection") }

    func readChoice() -> String? { Self.storedChoice(in: directory) }

    /// The stored choice in `directory`, read from any thread (the rollback hand-back reads it when it writes, IN-17): nil
    /// only when there is no file. A file that exists but cannot be read is `unreadable`, and any other content is returned
    /// as it is, so only a readable `true` collects and the region default (2026-11-24) applies only to a missing choice.
    /// The hand-back writes only `true` or `false` and removes its key for anything else.
    nonisolated static func storedChoice(in directory: URL) -> String? {
        let url = directory.appendingPathComponent("analytics-choice")
        guard let data = try? Data(contentsOf: url) else {
            return FileManager.default.fileExists(atPath: url.path) ? unreadable : nil
        }
        return String(data: data, encoding: .utf8) ?? unreadable
    }

    /// What `storedChoice` returns for a choice file that exists but cannot be read.
    nonisolated static let unreadable = "unreadable"

    func writeChoice(_ value: Bool) -> Bool { write(value, to: choiceURL) }

    func removeChoice() -> Bool {
        do {
            try FileManager.default.removeItem(at: choiceURL)
            return true
        } catch {
            return !FileManager.default.fileExists(atPath: choiceURL.path)
        }
    }

    func readCollection() -> Bool {
        (try? Data(contentsOf: collectionURL)).flatMap { String(data: $0, encoding: .utf8) } == "true"
    }

    func writeCollection(_ enabled: Bool) -> Bool { write(enabled, to: collectionURL) }

    private func write(_ value: Bool, to url: URL) -> Bool {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data((value ? "true" : "false").utf8).write(to: url, options: [.atomic])
            // Out of backups and transfers (IN-16): a restored device starts without a choice. The atomic write
            // replaced the file, so the mark is set again.
            BackupPolicy.exclude(url)
            return true
        } catch {
            return false
        }
    }
}
