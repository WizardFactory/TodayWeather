import Foundation
import Testing
import TWData
import TWStorage
@testable import TodayWeather

/// Which of the app's files carry the backup exclusion (IN-16, #2965 AC2), written by the app's own stores in one directory
/// as in `Library/Application Support/TodayWeather/`: the token queue and both analytics records are excluded after every
/// write, the state file is backed up; the weather cache is under `Library/Caches`, which iOS does not back up.
@MainActor
struct BackupExclusionTests {
    @Test func theAppsStoresMarkExactlyThePolicysFiles() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("in16-backup-\(UUID().uuidString)/TodayWeather",
                                                                                isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let state = AppStateStore(url: dir.appendingPathComponent("app_state.json"))
        let queue = PushTokenQueue(url: dir.appendingPathComponent("push_tokens.json"))
        let analytics = AnalyticsConsentFiles(directory: dir)
        // Each written twice: the second write replaces the file (atomic), which drops a mark set only once.
        for round in 0..<2 {
            try state.save(AppState(placeIndex: round))
            try queue.append("token-\(round)")
            #expect(analytics.writeChoice(round == 0))
            #expect(analytics.writeCollection(round == 0))
        }
        let names = try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()
        #expect(names == ["analytics-choice", "analytics-collection", "app_state.json", "push_tokens.json"])
        let excluded = names.filter { BackupPolicy.isExcluded(dir.appendingPathComponent($0)) }
        #expect(excluded == BackupPolicy.excludedFiles.sorted())
        #expect(names.filter { !excluded.contains($0) } == BackupPolicy.backedUpFiles)
    }

    /// The app's stores use one directory in Application Support, and the weather cache is under Caches.
    @Test func theAppsPaths() throws {
        let support = try AppStateStore.standard().url.deletingLastPathComponent()
        #expect(support.path.hasSuffix("/Library/Application Support/TodayWeather"))
        #expect(try PushTokenQueue.standard().url.deletingLastPathComponent() == support)
        #expect(AnalyticsConsentFiles.standard().directory.standardizedFileURL.path == support.standardizedFileURL.path)
        let cache = try #require(AppLaunch.weatherCache())
        #expect(cache.path.contains("/Library/Caches/"), "\(cache.path)")
    }
}
