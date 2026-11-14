import Foundation
import Observation

/// Where the holder saves the state: the state file (`AppStateStore`), or a double in tests.
public protocol AppStateSaving: Sendable {
    func save(_ state: AppState) throws
}

extension AppStateStore: AppStateSaving {}

/// The single owner of the app state for the UI (IN-07, #2956), from the end of the Cordova migration on: every state
/// write of the process goes through it. A change shows at once (`state`) and is saved in the order it was made; each
/// save writes the whole state as it was after that change, one save after the other, so the file always ends with the
/// newest state. A save that fails leaves the change shown; the next save writes it with the later changes, as the
/// Android `AppStateHolder` retries a failed screen change with the next write.
///
/// Other writers of the process (IN-04's push token sync) call `update`, which applies their change the same way and
/// returns once it is saved. Nothing else writes the state file after the migration.
@MainActor
@Observable
public final class AppStateHolder {
    /// The state; nil until the migration has finished (`load`).
    public private(set) var state: AppState?

    @ObservationIgnored private let store: any AppStateSaving
    @ObservationIgnored private var lastSave: Task<Void, any Error>?

    public init(store: any AppStateSaving) {
        self.store = store
    }

    /// The state the migration produced (and saved): the holder takes it over. Later calls are ignored.
    public func load(_ migrated: AppState) {
        guard state == nil else { return }
        state = migrated
    }

    /// A change of the UI: shown at once and saved after the changes before it. Ignored before `load`.
    public func change(_ update: (inout AppState) -> Void) {
        _ = enqueue(update)
    }

    /// Another writer's change: applied like `change`, returning the state once it is saved; throws when that save
    /// failed (the change stays shown and is saved again with the next write) or when the state is not loaded yet.
    @discardableResult
    public func update(_ update: (inout AppState) -> Void) async throws -> AppState {
        guard let (saved, task) = enqueue(update) else { throw NotLoaded() }
        try await task.value
        return saved
    }

    /// Waits until every save requested so far has finished (successfully or not).
    public func saved() async {
        _ = await lastSave?.result
    }

    public struct NotLoaded: Error {}

    private func enqueue(_ update: (inout AppState) -> Void) -> (AppState, Task<Void, any Error>)? {
        guard var next = state else { return nil }
        update(&next)
        state = next
        let previous = lastSave, store = self.store, snapshot = next
        let task = Task.detached {
            _ = await previous?.result
            try store.save(snapshot)
        }
        lastSave = task
        return (next, task)
    }
}
