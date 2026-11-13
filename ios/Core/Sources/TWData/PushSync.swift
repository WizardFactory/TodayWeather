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

    private let repostDelay: Duration
    private let sleep: @Sendable (Duration) async -> Void

    public init(store: AppStateStore, queue: PushTokenQueue, transport: any PushTransport,
                repostDelay: Duration = .seconds(3),
                sleep: @escaping @Sendable (Duration) async -> Void = { try? await Task.sleep(for: $0) },
                context: @escaping @Sendable (AppState) -> PushRegistration.Context?) {
        self.repostDelay = repostDelay
        self.sleep = sleep
        self.store = store
        self.queue = queue
        self.transport = transport
        self.context = context
    }

    /// What the Cordova `Push.init` does when the app is opened, on its timeline. At once: queued tokens, then the
    /// repair and the token callback for `token` (the current FCM token, if one is known; read when this registration's
    /// turn comes): the replacement of a changed token, and the list for a first token. `repostDelay` (3 s, the
    /// `setTimeout` of `loadPushInfo`) later, as one more registration: tokens queued meanwhile, each replaced as the
    /// token callback does, then the list with the token stored then, when there is one. Registrations that start
    /// during the wait (`drain()`) run before the post. Nil when no request can be built; the outcome holds the
    /// requests of both steps (not those of queued tokens).
    public func open(token: @escaping @Sendable () async -> String?) async -> Outcome? {
        let start: Outcome? = await serialized { [self] in
            _ = await self.registerQueued()
            guard let state = try? self.store.load(), let ctx = self.context(state) else { return nil }
            let result = PushRegistration.onStart(state.push, places: state.places, token: await token(), context: ctx,
                                                  repost: false)
            return await self.send(result, over: state)
        }
        guard let start else { return nil }
        await sleep(repostDelay)
        let post: Outcome? = await serialized { [self] in
            _ = await self.registerQueued()
            guard let state = try? self.store.load(), let ctx = self.context(state) else { return nil }
            // `_postPushList` with the token current at the timer.
            let result = PushRegistration.onStart(state.push, places: state.places, token: nil, context: ctx)
            return await self.send(result, over: state)
        }
        guard let post else { return start }
        return Outcome(requests: start.requests + post.requests, statuses: start.statuses + post.statuses)
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
