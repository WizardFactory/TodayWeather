import Foundation
import TWModel
import TWStorage

/// The Cordova `Push` service's timeline on one actor (IN-04, #2953; review rounds 1–3).
///
/// Every event (the process start, the open, a token that arrived, the list post 3 seconds after the open, a reply)
/// is handled on this actor, from reading the state to starting the requests, without suspending, so events never
/// interleave. Requests are started as `$http` starts them (`PushTransport.start`) and are not awaited before the next
/// event: a slow reply delays nothing. The list post is due `repostDelay` after the open began, on the injected clock,
/// whatever is in flight then.
///
/// Token replacements go through `PushReplacementLog`: when the Cordova code would send `PUT /push`, an entry
/// `{id, old, new}` is appended first, then the state takes `new`, then the request starts carrying the entry's `id`;
/// its reply, success or failure (Cordova does not retry), acknowledges that `id`. Every event first sets the state's
/// token to the last entry's `new` when they differ (a process may have ended between the two writes). At the process
/// start and at the open, the entries an earlier process left are sent again in `id` order, each with its own `old` and
/// `new`, before the open's list post, which posts with the state's token. `context` returns nil when no request can be
/// built (no server URL or `Device-Id`): nothing is sent or stored then, and the log waits.
public actor PushSync {
    public struct Outcome: Sendable, Equatable {
        public let requests: [PushRequest]
        /// The HTTP status of each request; nil when it did not complete.
        public let statuses: [Int?]
    }

    /// The points between the writes and sends of an event, for tests that end a process there (`crash`).
    public enum Step: Sendable, Equatable {
        case logAppended, stateStored, requestStarted, replyHandled, listPosted
    }

    private let store: AppStateStore
    private let log: PushReplacementLog
    private let transport: any PushTransport
    private let context: @Sendable (AppState) -> PushRegistration.Context?
    private let repostDelay: Duration
    private let timer: @Sendable (Duration) -> @Sendable () async -> Void
    /// Tests only: returns true to end this "process" after the given step (nothing more is written or sent).
    private let crash: (@Sendable (Step) -> Bool)?

    /// Log entries this process sent (new or again; never sent twice by one process); their replies acknowledge them.
    private var sentHere: Set<Int> = []
    private var replyWatchers: [UUID: Task<Void, Never>] = [:]
    /// Ended by `crash`.
    public private(set) var stopped = false
    /// Opens whose first step ran, and list posts that ran (observed by tests on a virtual clock).
    public private(set) var openStarts = 0
    public private(set) var reposts = 0
    public var pendingReplies: Int { replyWatchers.count }

    public init(store: AppStateStore, log: PushReplacementLog, transport: any PushTransport,
                repostDelay: Duration = .seconds(3),
                context: @escaping @Sendable (AppState) -> PushRegistration.Context?) {
        self.init(store: store, log: log, transport: transport, repostDelay: repostDelay, clock: ContinuousClock(),
                  crash: nil, context: context)
    }

    public init<C: Clock<Duration>>(store: AppStateStore, log: PushReplacementLog, transport: any PushTransport,
                                    repostDelay: Duration = .seconds(3), clock: C,
                                    crash: (@Sendable (Step) -> Bool)? = nil,
                                    context: @escaping @Sendable (AppState) -> PushRegistration.Context?) {
        self.store = store
        self.log = log
        self.transport = transport
        self.repostDelay = repostDelay
        self.timer = { delay in
            let deadline = clock.now.advanced(by: delay)
            return { try? await clock.sleep(until: deadline, tolerance: nil) }
        }
        self.crash = crash
        self.context = context
    }

    // MARK: - Events

    /// The process started (in the foreground or the background): the entries an earlier process left are sent again.
    @discardableResult
    public func start() -> [PushRequest] {
        guard !stopped, let (state, ctx) = reconciled() else { return [] }
        return recover(state, ctx).map(\.0)
    }

    /// A token FCM delivered while the app runs: the Cordova token callback. Returns the requests it started.
    @discardableResult
    public func tokenArrived(_ token: String) -> [PushRequest] {
        guard !stopped, let (state, ctx) = reconciled() else { return [] }
        _ = recover(state, ctx)
        return replace(token, state: state, ctx: ctx).map(\.0)
    }

    /// The Cordova `Push.init` when the app is opened. The list post is due `repostDelay` from now (its
    /// `setTimeout`). At once: the entries an earlier process left, then the repair and the token callback for `token`
    /// (the current FCM token, if one is known). When the post is due: the list with the state's token, when there is
    /// one. Returns, once their replies arrived, the requests of the open and of its post; nil when no request can be
    /// built.
    public func open(token: @escaping @Sendable () async -> String?) async -> Outcome? {
        let due = timer(repostDelay)
        let current = await token()
        guard !stopped, let (state, ctx) = reconciled() else { return nil }
        _ = recover(state, ctx)
        openStarts += 1
        let started = current.map { replace($0, state: state, ctx: ctx) } ?? []
        await due()
        let posted = repost()
        var statuses: [Int?] = []
        for (_, reply) in started + posted { statuses.append(await reply.status) }
        return Outcome(requests: (started + posted).map(\.0), statuses: statuses)
    }

    /// `_postPushList(pushList)` from the timer, with the token current then.
    private func repost() -> [(PushRequest, PushReply)] {
        guard !stopped, let (state, ctx) = reconciled() else { return [] }
        reposts += 1
        let result = PushRegistration.onStart(state.push, places: state.places, token: nil, context: ctx)
        let started = start(result.requests)
        if !started.isEmpty { _ = step(.listPosted) }
        return started
    }

    private func replied(_ id: UUID, entry: Int) {
        replyWatchers[id] = nil
        // `sentHere` keeps the id: an acknowledged entry can stay in the log behind an older one, and this process
        // must not send it again.
        guard !stopped, (try? log.acknowledge(entry)) != nil else { return }
        _ = step(.replyHandled)
    }

    // MARK: - Steps of an event (no suspension)

    /// The state and context, with the state's token set to the log's last `new` when they differ.
    private func reconciled() -> (AppState, PushRegistration.Context)? {
        guard var state = try? store.load(), let ctx = context(state) else { return nil }
        if let last = try? log.entries().last, !Self.same(last.new, state.push.fcmToken) {
            guard storeToken(last.new) else { return nil }
            state.push.fcmToken = last.new
        }
        return (state, ctx)
    }

    /// Sends again, in `id` order, the entries this process has not sent.
    private func recover(_ state: AppState, _ ctx: PushRegistration.Context) -> [(PushRequest, PushReply)] {
        guard let entries = try? log.entries() else { return [] }
        var started: [(PushRequest, PushReply)] = []
        for entry in entries where !sentHere.contains(entry.id) {
            guard !stopped else { break }
            started += sendReplacement(PushRegistration.replacement(entry.new, over: entry.old, context: ctx), entry.id)
        }
        return started
    }

    /// The Cordova token callback for `token`: log, state, then the requests (the replacement, and the list for a first
    /// token).
    private func replace(_ token: String, state: AppState, ctx: PushRegistration.Context) -> [(PushRequest, PushReply)] {
        let result = PushRegistration.onTokenRefresh(state.push, places: state.places, token: token, context: ctx)
        guard let put = result.requests.first, put.method == "PUT" else { return [] }
        guard let entry = try? log.append(old: state.push.fcmToken, new: token), step(.logAppended),
              storeToken(token), step(.stateStored) else { return [] }
        var started = sendReplacement(put, entry.id)
        for request in result.requests.dropFirst() where !stopped {
            started += start([request])
            _ = step(.requestStarted)
        }
        return started
    }

    private func sendReplacement(_ put: PushRequest, _ id: Int) -> [(PushRequest, PushReply)] {
        let started = start([put])
        sentHere.insert(id)
        let watcher = UUID()
        let reply = started[0].1
        replyWatchers[watcher] = Task {
            _ = await reply.status
            self.replied(watcher, entry: id)
        }
        _ = step(.requestStarted)
        return started
    }

    private func start(_ requests: [PushRequest]) -> [(PushRequest, PushReply)] {
        requests.map { ($0, transport.start($0)) }
    }

    /// False (and the actor stops) when the test's `crash` ends the process after `s`.
    private func step(_ s: Step) -> Bool {
        guard !stopped else { return false }
        if crash?(s) == true { stopped = true }
        return !stopped
    }

    /// Stores `token` over the state as stored now; false when it cannot be stored.
    private func storeToken(_ token: String) -> Bool {
        do {
            guard var current = try store.load() else { return false }
            if Self.same(token, current.push.fcmToken) { return true }
            current.push.fcmToken = token
            try store.save(current)
            return true
        } catch {
            return false
        }
    }

    private static func same(_ a: String?, _ b: String?) -> Bool {
        switch (a, b) {
        case (nil, nil): true
        case let (a?, b?): JSString.equal(a, b)
        default: false
        }
    }
}
