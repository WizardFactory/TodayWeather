import Foundation
import TWModel
import TWStorage

/// The app state as push registration reads and writes it. In the app this is the `AppStateHolder` (IN-07), the
/// single writer of the state file, so a stored token never overwrites another writer's change.
public protocol PushStateAccess: Sendable {
    /// The state now; nil before the migration has finished.
    func pushState() async -> AppState?
    /// Stores `token` as the push token over the state as it is now; throws when it could not be saved.
    func storePushToken(_ token: String?) async throws
    /// The state once every change asked for before has been saved; throws when that save failed.
    func savedPushState() async throws -> AppState
}

extension AppStateHolder: PushStateAccess {
    public func pushState() async -> AppState? { state }

    public func storePushToken(_ token: String?) async throws {
        try await update { $0.push.fcmToken = token }
    }

    public func savedPushState() async throws -> AppState {
        try await update { _ in }
    }
}

/// Runs push registrations (`PushRegistration`) one at a time (IN-04, #2953): the Android `PushSync` and
/// `PushTokenWorker` of AN-04. Each reads the state, sends its requests one after the other, waiting for each
/// answer, and then stores the token, so tokens B then C are replaced A→B, then B→C.
///
/// Tokens FCM delivers while the app runs wait in `PushTokenQueue` (stored there before anything is sent; the
/// Android app hands them to WorkManager) and are registered in order of arrival by `drain()`, in this process or,
/// when it ends first, in the next one, in the foreground or in the background. A token leaves the queue only after
/// the state holds it, so the next process sends its replacement again from the token stored then. As in the Cordova
/// and Android apps, failed requests are not retried and the token is stored anyway; the next open posts the list with
/// it. `context` returns nil when no request can be built (no server URL or `Device-Id`): nothing is sent or stored
/// then, and queued tokens wait.
public actor PushSync {
    public struct Outcome: Sendable, Equatable {
        public let requests: [PushRequest]
        /// The HTTP status of each request; nil when it did not complete.
        public let statuses: [Int?]
    }

    private let state: any PushStateAccess
    private let queue: PushTokenQueue
    private let transport: any PushTransport
    private let context: @Sendable (AppState) -> PushRegistration.Context?
    /// The registration that runs last; the next one waits for it (the Android `Mutex`).
    private var tail: Task<Void, Never>?

    public init(state: any PushStateAccess, queue: PushTokenQueue, transport: any PushTransport,
                context: @escaping @Sendable (AppState) -> PushRegistration.Context?) {
        self.state = state
        self.queue = queue
        self.transport = transport
        self.context = context
    }

    /// What the Cordova `Push.init` does when the app is opened: queued tokens first, then the repair, the
    /// replacement of a changed token and the post of the list (when a token exists). `token` (the current FCM token,
    /// if one is known) is read when this registration's turn comes. Nil when no request can be built.
    public func open(token: @escaping @Sendable () async -> String?) async -> Outcome? {
        await serialized { [self] in
            _ = await self.registerQueued()
            guard let current = await self.state.pushState(), let ctx = self.context(current) else { return nil }
            let result = PushRegistration.onStart(current.push, places: current.places, token: await token(),
                                                  context: ctx)
            return await self.send(result, over: current)
        }
    }

    /// Stores `token` in the queue at once, without waiting for a registration in flight (the Android `onNewToken`
    /// hands it to WorkManager at once; CODEX-IN04A-1). A blank token is ignored, as the Cordova token callback ignores
    /// it. False when it could not be queued. `drain()` registers it.
    public nonisolated func enqueue(token: String) -> Bool {
        guard PushRegistration.accepts(token) else { return true }
        do {
            try queue.append(token)
            return true
        } catch {
            return false
        }
    }

    /// `enqueue(token:)`, then the registration of the queued tokens.
    @discardableResult
    public func receive(token: String) async -> Bool {
        guard enqueue(token: token) else { return false }
        _ = await drain()
        return true
    }

    /// `Push.updateUnits()` after a unit change (IN-12; the Android `updateUnits`): the list posted again with the
    /// units saved by then, after the registrations before it. The state is read once the changes asked for before
    /// are saved; when that save fails nothing is sent (the next open posts the list with the units then saved).
    @discardableResult
    public func updateUnits() async -> Outcome? {
        await serialized { [self] in
            guard let current = try? await self.state.savedPushState(), let ctx = self.context(current) else { return nil }
            let result = PushRegistration.onUnitsChanged(current.push, places: current.places, context: ctx)
            return await self.send(result, over: current)
        }
    }

    /// Registers the queued tokens in order of arrival (each like the Cordova token callback while the app runs).
    @discardableResult
    public func drain() async -> [Outcome] {
        await serialized { [self] in await self.registerQueued() }
    }

    private func registerQueued() async -> [Outcome] {
        var outcomes: [Outcome] = []
        while let token = try? queue.pending().first {
            guard let current = await state.pushState(), let ctx = context(current) else { break }
            let result = PushRegistration.onTokenRefresh(current.push, places: current.places, token: token,
                                                         context: ctx)
            // The token leaves the queue only after a save holding it succeeded, also when the state shows it
            // already (a change whose save failed stays shown; CODEX-IN04A-2).
            guard let outcome = await send(result, over: current, alwaysStore: true) else { break }
            outcomes.append(outcome)
            guard (try? queue.removeFirst(token)) != nil else { break }
        }
        return outcomes
    }

    /// Sends the requests in order, each after the answer to the one before, then stores a changed token (with
    /// `alwaysStore`, the token in any case) over the state as it is now. Nil when the token cannot be stored (the
    /// queue keeps it for the next process).
    private func send(_ result: PushRegistration.Result, over current: AppState, alwaysStore: Bool = false) async -> Outcome? {
        var statuses: [Int?] = []
        for request in result.requests { statuses.append(await transport.send(request)) }
        if alwaysStore || !JSString.same(result.state.fcmToken, current.push.fcmToken) {
            do {
                try await state.storePushToken(result.state.fcmToken)
            } catch {
                return nil
            }
        }
        return Outcome(requests: result.requests, statuses: statuses)
    }

    /// Runs `body` after every registration started before it.
    private func serialized<T: Sendable>(_ body: @escaping @Sendable () async -> T) async -> T {
        let previous = tail
        let task = Task<T, Never> {
            await previous?.value
            return await body()
        }
        tail = Task { _ = await task.value }
        return await task.value
    }
}
