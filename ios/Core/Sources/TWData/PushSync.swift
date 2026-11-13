import Foundation
import TWModel
import TWStorage

/// The Cordova `Push` service's timeline on one actor (IN-04, #2953; review CODEX-IN04-1..3).
///
/// Every event — the open, a token that arrived, the list post 3 seconds after the open, a reply — is handled on this
/// actor, synchronously from reading the state to starting the requests, so events never interleave inside one
/// another. Requests are started as `$http` starts them (`PushTransport.start`) and are not awaited before the next
/// event: a slow reply delays nothing. The token is stored when its replacement is sent, as the Cordova token callback
/// does. The list post is due `repostDelay` after the open began, on `clock`, whatever is in flight then.
///
/// Durability: a token FCM delivers is first stored in `PushTokenQueue`. When its replacement is sent the entry is
/// marked with the token it replaced and the state takes the new token; the entry is removed when the reply arrives
/// (failed or not: Cordova does not retry). An entry marked by a process that ended before its reply is sent again
/// by the next process. `context` returns nil when no request can be built (no server URL or `Device-Id`): nothing is
/// sent or stored then, and queued tokens wait.
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
    private let repostDelay: Duration
    /// A sleep until a delay after the moment it is made, on the injected clock.
    private let timer: @Sendable (Duration) -> @Sendable () async -> Void

    /// Queue entries this process sent and whose replies have not arrived, per token.
    private var sentHere: [String: Int] = [:]
    /// The tasks that wait for replies of queued tokens, owned by this actor; each ends when its replies arrived.
    private var replyWatchers: [UUID: Task<Void, Never>] = [:]
    /// Opens whose first step ran, and list posts that ran (observed by tests on a virtual clock).
    public private(set) var openStarts = 0
    public private(set) var reposts = 0
    public var pendingReplies: Int { replyWatchers.count }

    public init(store: AppStateStore, queue: PushTokenQueue, transport: any PushTransport,
                repostDelay: Duration = .seconds(3),
                context: @escaping @Sendable (AppState) -> PushRegistration.Context?) {
        self.init(store: store, queue: queue, transport: transport, repostDelay: repostDelay, clock: ContinuousClock(),
                  context: context)
    }

    public init<C: Clock<Duration>>(store: AppStateStore, queue: PushTokenQueue, transport: any PushTransport,
                                    repostDelay: Duration = .seconds(3), clock: C,
                                    context: @escaping @Sendable (AppState) -> PushRegistration.Context?) {
        self.store = store
        self.queue = queue
        self.transport = transport
        self.repostDelay = repostDelay
        self.timer = { delay in
            let deadline = clock.now.advanced(by: delay)
            return { try? await clock.sleep(until: deadline, tolerance: nil) }
        }
        self.context = context
    }

    /// The Cordova `Push.init` when the app is opened. The list post is due `repostDelay` from now (its
    /// `setTimeout`). At once: the queued tokens, then the repair and the token callback for `token` (the current FCM
    /// token, if one is known): the replacement of a changed token, and the list for a first token. When the post is
    /// due: tokens queued and not yet handled, then the list with the token stored then, when there is one. Returns,
    /// once their replies arrived, the requests of the open and of its post (not those of queued tokens); nil when no
    /// request can be built.
    public func open(token: @escaping @Sendable () async -> String?) async -> Outcome? {
        let due = timer(repostDelay)
        let current = await token()
        guard let started = openStart(token: current) else { return nil }
        await due()
        let posted = repost()
        var statuses: [Int?] = []
        for (_, reply) in started + posted { statuses.append(await reply.status) }
        return Outcome(requests: (started + posted).map(\.0), statuses: statuses)
    }

    /// Handles the queued tokens now (each like the Cordova token callback) and returns their requests once the
    /// replies arrived, one outcome per token.
    public func drain() async -> [Outcome] {
        var outcomes: [Outcome] = []
        for group in registerQueued() {
            var statuses: [Int?] = []
            for (_, reply) in group { statuses.append(await reply.status) }
            outcomes.append(Outcome(requests: group.map(\.0), statuses: statuses))
        }
        return outcomes
    }

    /// Handles the queued tokens now and returns the requests it started, without waiting for replies.
    @discardableResult
    public func handleQueuedTokens() -> [PushRequest] {
        registerQueued().flatMap { $0.map(\.0) }
    }

    // MARK: - Events (each runs on the actor without suspending)

    private func openStart(token: String?) -> [(PushRequest, PushReply)]? {
        _ = registerQueued()
        guard let state = try? store.load(), let ctx = context(state) else { return nil }
        openStarts += 1
        let result = PushRegistration.onStart(state.push, places: state.places, token: token, context: ctx,
                                              repost: false)
        let started = start(result.requests)
        storeToken(result.state.fcmToken, over: state)
        return started
    }

    /// `_postPushList(pushList)` from the timer, with the token current then.
    private func repost() -> [(PushRequest, PushReply)] {
        _ = registerQueued()
        reposts += 1
        guard let state = try? store.load(), let ctx = context(state) else { return [] }
        return start(PushRegistration.onStart(state.push, places: state.places, token: nil, context: ctx).requests)
    }

    /// The queued tokens in order of arrival; entries this process sent wait for their replies.
    private func registerQueued() -> [[(PushRequest, PushReply)]] {
        guard let entries = try? queue.entries() else { return [] }
        var groups: [[(PushRequest, PushReply)]] = []
        var seen: [String: Int] = [:]
        for entry in entries {
            guard let state = try? store.load(), let ctx = context(state) else { break }
            switch entry.sent {
            case .over(let old):
                let key = Self.key(entry.token)
                seen[key, default: 0] += 1
                if seen[key]! <= sentHere[key, default: 0] { continue } // sent by this process, reply pending
                // Sent by a process that ended before the reply: send the replacement again.
                let started = start([PushRegistration.replacement(entry.token, over: old, context: ctx)])
                watch(entry.token, started)
                groups.append(started)
            case .notYet:
                let result = PushRegistration.onTokenRefresh(state.push, places: state.places, token: entry.token,
                                                             context: ctx)
                if result.requests.isEmpty {
                    guard (try? queue.remove(entry.token, sent: false)) != nil else { return groups }
                    continue
                }
                // Marked and stored before anything is sent, so a process that ends now leaves it to the next one.
                guard (try? queue.markSent(entry.token, over: state.push.fcmToken)) != nil,
                      storeToken(result.state.fcmToken, over: state) else { return groups }
                let started = start(result.requests)
                watch(entry.token, started)
                groups.append(started)
            }
        }
        return groups
    }

    private func replied(_ id: UUID, token: String) {
        try? queue.remove(token, sent: true)
        let key = Self.key(token)
        sentHere[key, default: 1] -= 1
        replyWatchers[id] = nil
    }

    // MARK: - Helpers

    private func start(_ requests: [PushRequest]) -> [(PushRequest, PushReply)] {
        requests.map { ($0, transport.start($0)) }
    }

    /// Waits, in a task this actor owns, for the replies of a queued token's requests, then removes the entry.
    private func watch(_ token: String, _ started: [(PushRequest, PushReply)]) {
        sentHere[Self.key(token), default: 0] += 1
        let id = UUID()
        let replies = started.map(\.1)
        replyWatchers[id] = Task {
            for reply in replies { _ = await reply.status }
            self.replied(id, token: token)
        }
    }

    /// Stores `token` over the state as stored now when it differs from `state`'s; false when it cannot be stored.
    @discardableResult
    private func storeToken(_ token: String?, over state: AppState) -> Bool {
        let changed = switch (token, state.push.fcmToken) {
        case (nil, nil): false
        case let (new?, old?): !JSString.equal(new, old)
        default: true
        }
        guard changed else { return true }
        do {
            guard var current = try store.load() else { return false }
            current.push.fcmToken = token
            try store.save(current)
            return true
        } catch {
            return false
        }
    }

    /// A dictionary key that keeps texts apart by UTF-16 code units.
    private static func key(_ token: String) -> String {
        token.utf16.map { String($0, radix: 16) }.joined(separator: ".")
    }
}
