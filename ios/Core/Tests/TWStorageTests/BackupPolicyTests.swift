import Foundation
import Testing
@testable import TWStorage

/// Which of the app's files an iCloud backup or a device transfer carries (IN-16, #2965): the token queue is marked
/// excluded after every write (an atomic write replaces the file and with it the mark), the state file is backed up.
struct BackupPolicyTests {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-backup-\(UUID().uuidString)/TodayWeather")

    @Test func theTokenQueueStaysOutOfBackupsAfterEveryWrite() throws {
        let queue = PushTokenQueue(url: dir.appendingPathComponent("push_tokens.json"))
        try queue.append("token-b")
        #expect(BackupPolicy.isExcluded(queue.url), "first write")
        try queue.append("token-c")
        #expect(BackupPolicy.isExcluded(queue.url), "a replacement of the file")
        try queue.removeFirst("token-b")
        #expect(BackupPolicy.isExcluded(queue.url), "a removal")
        #expect(try queue.pending() == ["token-c"])
    }

    @Test func theStateFileIsBackedUp() throws {
        let store = AppStateStore(url: dir.appendingPathComponent("app_state.json"))
        try store.save(AppState())
        try store.save(AppState(placeIndex: 0))
        #expect(!BackupPolicy.isExcluded(store.url))
        #expect(!BackupPolicy.isExcluded(dir), "the directory is backed up, so the state file inside it is")
    }

    /// The policy names the files the app's stores write, at the paths of the app's container.
    @Test func thePolicyNamesTheAppsFiles() throws {
        #expect(BackupPolicy.excludedFiles.contains(try PushTokenQueue.standard().url.lastPathComponent))
        #expect(BackupPolicy.backedUpFiles == [try AppStateStore.standard().url.lastPathComponent])
        #expect(try PushTokenQueue.standard().url.deletingLastPathComponent()
                == AppStateStore.standard().url.deletingLastPathComponent())
        #expect(Set(BackupPolicy.excludedFiles).isDisjoint(with: BackupPolicy.backedUpFiles))
    }

    /// The mark is the file's own: a file without it is backed up, marking it is read back from the file system.
    @Test func theMarkIsReadFromTheFile() throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("other")
        try Data("x".utf8).write(to: file)
        #expect(!BackupPolicy.isExcluded(file))
        #expect(BackupPolicy.exclude(file))
        #expect(BackupPolicy.isExcluded(file))
        #expect(!BackupPolicy.exclude(dir.appendingPathComponent("missing")), "no file to mark")
    }
}
