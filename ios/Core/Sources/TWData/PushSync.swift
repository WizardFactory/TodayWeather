import Foundation
import TWModel
import TWStorage

/// Runs push registrations (`PushRegistration`) one at a time (IN-04, #2953; the Android `PushSync` of AN-04).
/// Each reads the stored state, sends its requests and stores the token before the next one starts, so tokens B then
/// C are replaced A→B, then B→C.
///
/// Tokens FCM delivers while the app runs wait in `PushTokenQueue` (stored there before anything is sent) and are
/// registered in order of arrival by `drain()`; a token leaves the queue only after the state holds it, so a process
/// that ends first leaves it to the next one, which sends the replacement again (the server's replacement of a token
/// it no longer has changes nothing). As in the Cordova app, failed requests are not retried and the token is stored
/// anyway; the next open posts the list with it. `context` returns nil when no request can be built (no server URL or
/// `Device-Id`): nothing is sent or stored then, and queued tokens wait.
public actor PushSync {
    public struct Outcome: Sendable, Equatable {
        public let requests: [PushRequest]
        /// The HTTP status of each request; nil when it did not complete.
        public let statuses: [Int?]
    }

    private let store: AppStateStore
    private let queue: PushTokenQueue
    private let transport: any PushTransport
    private let context: @Sendable (AppState) -> PushRegistration.Context?
    /// The registration that runs last; the next one waits for it.
    private var tail: Task<Void, Never>?

    public init(store: AppStateStore, queue: PushTokenQueue, transport: any PushTransport,
                context: @escaping @Sendable (AppState) -> PushRegistration.Context?) {
        self.store = store
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
            guard let state = try? self.store.load(), let ctx = self.context(state) else { return nil }
            let result = PushRegistration.onStart(state.push, places: state.places, token: await token(), context: ctx)
            return await self.send(result, over: state)
        }
    }

    /// Registers the queued tokens in order of arrival (each like the Cordova token callback while the app runs).
    public func drain() async -> [Outcome] {
        await serialized { [self] in await self.registerQueued() }
    }

    private func registerQueued() async -> [Outcome] {
        var outcomes: [Outcome] = []
        while let token = try? queue.pending().first {
            guard let state = try? store.load(), let ctx = context(state) else { break }
            let result = PushRegistration.onTokenRefresh(state.push, places: state.places, token: token, context: ctx)
            guard let outcome = await send(result, over: state) else { break }
            outcomes.append(outcome)
            guard (try? queue.removeFirst(token)) != nil else { break }
        }
        return outcomes
    }

    /// Sends the requests in order, then stores a changed token over the state as stored now. Nil when the token
    /// cannot be stored (the queue keeps it for the next process).
    private func send(_ result: PushRegistration.Result, over state: AppState) async -> Outcome? {
        var statuses: [Int?] = []
        for request in result.requests { statuses.append(await transport.send(request)) }
        let changed = switch (result.state.fcmToken, state.push.fcmToken) {
        case (nil, nil): false
        case let (new?, old?): !JSString.equal(new, old)
        default: true
        }
        if changed {
            do {
                guard var current = try store.load() else { return nil }
                current.push.fcmToken = result.state.fcmToken
                try store.save(current)
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
