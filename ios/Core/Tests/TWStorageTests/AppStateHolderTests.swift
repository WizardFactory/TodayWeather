import Foundation
import Testing
@testable import TWStorage

/// The single owner of the app state (IN-07, #2956): changes show at once, are saved in order, a failed save is
/// repeated with the next write, and another writer's update returns once saved.
@MainActor
struct AppStateHolderTests {
    final class RecordingStore: AppStateSaving, @unchecked Sendable {
        private let lock = NSLock()
        private var saves: [AppState] = []
        private var failures: Int

        init(failures: Int = 0) { self.failures = failures }

        var saved: [AppState] { lock.withLock { saves } }

        func save(_ state: AppState) throws {
            try lock.withLock {
                if failures > 0 {
                    failures -= 1
                    throw CocoaError(.fileWriteNoPermission)
                }
                saves.append(state)
            }
        }
    }

    @Test func nothingIsWrittenBeforeTheMigration() async {
        let store = RecordingStore()
        let holder = AppStateHolder(store: store)
        holder.change { $0.settings.theme = "dark" }
        await holder.saved()
        #expect(holder.state == nil)
        #expect(store.saved.isEmpty)
        await #expect(throws: AppStateHolder.NotLoaded.self) { try await holder.update { $0.push.fcmToken = "t" } }
    }

    @Test func changesShowAtOnceAndAreSavedInOrder() async {
        let store = RecordingStore()
        let holder = AppStateHolder(store: store)
        holder.load(AppState())
        holder.load(AppState(settings: Settings(theme: "old")))
        #expect(holder.state?.settings.theme == "light", "a second load is ignored")
        for theme in ["dark", "photo", "old", "light", "dark"] {
            holder.change { $0.settings.theme = theme }
            #expect(holder.state?.settings.theme == theme, "shown before it is saved")
        }
        holder.change { $0.settings.startupPage = "2" }
        await holder.saved()
        #expect(store.saved.map(\.settings.theme) == ["dark", "photo", "old", "light", "dark", "dark"])
        #expect(store.saved.last?.settings.startupPage == "2")
        #expect(store.saved.last == holder.state)
    }

    @Test func aFailedSaveIsWrittenWithTheNextChange() async {
        let store = RecordingStore(failures: 1)
        let holder = AppStateHolder(store: store)
        holder.load(AppState())
        holder.change { $0.settings.theme = "dark" }
        await holder.saved()
        #expect(store.saved.isEmpty)
        #expect(holder.state?.settings.theme == "dark", "the change stays shown")
        holder.change { $0.settings.refreshInterval = "60" }
        await holder.saved()
        #expect(store.saved.count == 1)
        #expect(store.saved.last?.settings.theme == "dark")
        #expect(store.saved.last?.settings.refreshInterval == "60")
    }

    /// IN-04's token write: through the holder, after the screen changes before it, keeping them.
    @Test func anotherWritersUpdateKeepsTheScreenChanges() async throws {
        let store = RecordingStore()
        let holder = AppStateHolder(store: store)
        holder.load(AppState())
        holder.change { $0.settings.theme = "old" }
        let saved = try await holder.update { $0.push.fcmToken = "token-2" }
        #expect(saved.settings.theme == "old")
        #expect(saved.push.fcmToken == "token-2")
        #expect(store.saved.count == 2)
        #expect(store.saved.last == saved)
        let failing = AppStateHolder(store: RecordingStore(failures: 1))
        failing.load(AppState())
        await #expect(throws: CocoaError.self) { try await failing.update { $0.push.fcmToken = "x" } }
        #expect(failing.state?.push.fcmToken == "x", "shown, and saved with the next write")
    }

    /// The holder writes through the real state file atomically; the file ends with the newest state.
    @Test func theStateFileEndsWithTheNewestState() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("holder-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = AppStateStore(url: dir.appendingPathComponent("app_state.json"))
        let holder = AppStateHolder(store: store)
        holder.load(AppState())
        for i in 0..<20 { holder.change { $0.settings.refreshInterval = String(i) } }
        await holder.saved()
        #expect(try store.load()?.settings.refreshInterval == "19")
    }
}
