import Foundation
import TWModel
import TWStorage

/// The app state as `PushSync` reads and writes it (`AppStateStore`).
public protocol PushStateStore: Sendable {
    func load() throws -> AppState?
    func save(_ state: AppState) throws
}

/// The token replacement log as `PushSync` uses it (`PushReplacementLog`).
public protocol PushLogStore: Sendable {
    func entries() throws -> [PushReplacementLog.Entry]
    func append(old: String?, new: String) throws -> PushReplacementLog.Entry
    func acknowledge(_ id: Int) throws
    func reopen(_ ids: Set<Int>) throws
}

extension AppStateStore: PushStateStore {}

extension PushReplacementLog: PushLogStore {}

/// The Cordova `Push` service's timeline on one actor (IN-04, #2953; review rounds 1–4).
///
/// Every event (the process start, the open, a token that arrived, the list post 3 seconds after the open, a reply)
/// is handled on this actor, from reading the state to starting the requests, without suspending, so events never
/// interleave. Requests are started as `$http` starts them (`PushTransport.start`) and are not awaited before the next
/// event. The list post is due `repostDelay` after the open began, on the injected clock.
///
/// Token replacements go through the replacement log: when the Cordova code would send `PUT /push`, an entry
/// `{id, old, new}` is appended first, then the state takes `new`, then the request starts; its reply, success or
/// failure (Cordova does not retry), acknowledges that `id`. Every event first sets the state's token to the last
/// entry's `new` when they differ. At the process start and at the open, the entries not sent by this process are
/// replayed strictly one after another in `id` order (the next starts when the previous reply arrived), an entry
/// without `old` followed by the list post with its token, so the server applies the hops in order. While the replay
/// runs, new replacements are appended and sent by it in turn, and a list post that falls due waits for its end.
/// A failed read or write ends the event; the next event or start completes it. `context` returns nil when no request
/// can be built (no server URL or `Device-Id`): nothing is sent or stored then, and the log waits.
public actor PushSync {
    public struct Outcome: Sendable, Equatable {
        public let requests: [PushRequest]
        /// The HTTP status of each request; nil when it did not complete.
        public let statuses: [Int?]
    }

    private let store: any PushStateStore
    private let log: any PushLogStore
    private let transport: any PushTransport
    private let context: @Sendable (AppState) -> PushRegistration.Context?
    private let repostDelay: Duration
    private let timer: @Sendable (Duration) -> @Sendable () async -> Void

    /// Log entries this process sent (new or replayed); one process never sends an entry twice.
    private var sentHere: Set<Int> = []
    /// Tasks waiting for replies of replacements sent outside a replay, owned by this actor.
    private var replyWatchers: [UUID: Task<Void, Never>] = [:]
    /// The replay of left entries, owned by this actor; nil when none runs.
    private var replay: Task<Void, Never>?
    /// A list post fell due during the replay.
    private var postAfterReplay = false
    /// Token observations handled so far (the token callback, the open's token): a provider value read while another
    /// observation was handled is older than it and is dropped (CODEX-IN04-8).
    private var observations = 0
    /// Opens whose first step ran, and list posts that fell due (observed by tests on a virtual clock).
    public private(set) var openStarts = 0
    public private(set) var reposts = 0
    public var pendingReplies: Int { replyWatchers.count }
    public var isReplaying: Bool { replay != nil }

    public init(store: any PushStateStore, log: any PushLogStore, transport: any PushTransport,
                repostDelay: Duration = .seconds(3),
                context: @escaping @Sendable (AppState) -> PushRegistration.Context?) {
        self.init(store: store, log: log, transport: transport, repostDelay: repostDelay, clock: ContinuousClock(),
                  context: context)
    }

    public init<C: Clock<Duration>>(store: any PushStateStore, log: any PushLogStore, transport: any PushTransport,
                                    repostDelay: Duration = .seconds(3), clock: C,
                                    context: @escaping @Sendable (AppState) -> PushRegistration.Context?) {
        self.store = store
        self.log = log
        self.transport = transport
        self.repostDelay = repostDelay
        self.timer = { delay in
            let deadline = clock.now.advanced(by: delay)
            return { try? await clock.sleep(until: deadline, tolerance: nil) }
        }
        self.context = context
    }

    // MARK: - Events

    /// The process started (in the foreground or the background): the entries an earlier process left are replayed.
    public func start() {
        guard reconciled() != nil else { return }
        recover()
    }

    /// A token FCM delivered while the app runs: the Cordova token callback. Returns the requests it started (none
    /// while a replay runs: the replay sends them in turn).
    @discardableResult
    public func tokenArrived(_ token: String) -> [PushRequest] {
        observations += 1
        guard let (state, ctx) = reconciled() else { return [] }
        recover()
        return replace(token, state: state, ctx: ctx).map(\.0)
    }

    /// The Cordova `Push.init` when the app is opened. The list post is due `repostDelay` from now (its
    /// `setTimeout`). At once: the replay of left entries, then the repair and the token callback for `token` (the
    /// current FCM token, if one is known). When the post is due: the list with the state's token, when there is one
    /// (after the replay, if one runs). Returns, once their replies arrived, the requests of the open and of its post
    /// that it started itself; nil when no request can be built.
    ///
    /// The token is read from `token` (the SDK's current token) while the actor runs other events. A token the callback
    /// delivered meanwhile (`tokenArrived`) is newer than any value the read can still return late, or as new, and FCM
    /// delivers every later change through the callback, so a value whose read overlapped another observation is
    /// dropped: observations count on the actor when the read starts and are compared when it ends.
    public func open(token: @escaping @Sendable () async -> String?) async -> Outcome? {
        let due = timer(repostDelay)
        let seen = observations
        let read = await token()
        let current = observations == seen ? read : nil
        if current != nil { observations += 1 }
        guard let (state, ctx) = reconciled() else { return nil }
        recover()
        openStarts += 1
        let started = current.map { replace($0, state: state, ctx: ctx) } ?? []
        await due()
        reposts += 1
        let posted = postList()
        var statuses: [Int?] = []
        for (_, reply) in started + posted { statuses.append(await reply.status) }
        return Outcome(requests: (started + posted).map(\.0), statuses: statuses)
    }

    // MARK: - Steps (no suspension)

    /// `_postPushList(pushList)` with the token current now; after the replay when one runs.
    private func postList() -> [(PushRequest, PushReply)] {
        if replay != nil {
            postAfterReplay = true
            return []
        }
        guard let (state, ctx) = reconciled() else { return [] }
        return start(PushRegistration.onStart(state.push, places: state.places, token: nil, context: ctx).requests)
    }

    /// The state and context, with the state's token set to the log's last `new` when they differ; nil when they
    /// cannot be read or written now.
    private func reconciled() -> (AppState, PushRegistration.Context)? {
        guard var state = try? store.load(), let ctx = context(state), let entries = try? log.entries() else {
            return nil
        }
        if let last = entries.last?.new, !Self.same(last, state.push.fcmToken) {
            guard storeToken(last) else { return nil }
            state.push.fcmToken = last
        }
        return (state, ctx)
    }

    /// The Cordova token callback for `token`: log, state, then the requests (the replacement, and the list for a first
    /// token); while a replay runs, only log and state (the replay sends it).
    private func replace(_ token: String, state: AppState, ctx: PushRegistration.Context) -> [(PushRequest, PushReply)] {
        let result = PushRegistration.onTokenRefresh(state.push, places: state.places, token: token, context: ctx)
        guard let put = result.requests.first, put.method == "PUT",
              let entry = try? log.append(old: state.push.fcmToken, new: token), storeToken(token) else { return [] }
        if replay != nil { return [] }
        sentHere.insert(entry.id)
        // One unit: the replacement and, for a first token, its list post; acknowledged when all of them replied.
        let started = start(result.requests)
        let replies = started.map(\.1)
        let id = UUID()
        replyWatchers[id] = Task {
            for reply in replies { _ = await reply.status }
            self.replied(id, entry: entry.id)
        }
        return started
    }

    private func replied(_ watcher: UUID, entry: Int) {
        replyWatchers[watcher] = nil
        try? log.acknowledge(entry)
    }

    /// Starts the replay when entries wait that this process has not sent.
    private func recover() {
        guard replay == nil, let entries = try? log.entries() else { return }
        let waiting = Set(entries.map(\.id).filter { !sentHere.contains($0) })
        // Each waiting entry is applied again, also one an earlier process saw answered behind an unanswered one,
        // so none may leave the log before its replay was answered.
        guard !waiting.isEmpty, (try? log.reopen(waiting)) != nil else { return }
        replay = Task { await self.replayEntries() }
    }

    /// Sends the waiting entries one after another in `id` order, each as one unit: the replacement and, for an entry
    /// without `old`, the list post with its token (Cordova's first-token path). A unit is complete when all its
    /// requests replied; then its entry is acknowledged and the next unit starts (CODEX-IN04-4). Then the list post
    /// that fell due meanwhile.
    private func replayEntries() async {
        while let next = nextToReplay() {
            for reply in next.replies { _ = await reply.status }
            try? log.acknowledge(next.entry)
        }
        replay = nil
        if postAfterReplay {
            postAfterReplay = false
            _ = postList()
        }
    }

    private func nextToReplay() -> (entry: Int, replies: [PushReply])? {
        guard let (state, ctx) = reconciled(),
              let entry = (try? log.entries())?.first(where: { !sentHere.contains($0.id) }) else { return nil }
        sentHere.insert(entry.id)
        var replies = [transport.start(PushRegistration.replacement(entry.new, over: entry.old, context: ctx))]
        if entry.old == nil {
            var push = state.push
            push.fcmToken = entry.new
            replies += start(PushRegistration.onStart(push, places: state.places, token: nil, context: ctx).requests)
                .map(\.1)
        }
        return (entry.id, replies)
    }

    private func start(_ requests: [PushRequest]) -> [(PushRequest, PushReply)] {
        requests.map { ($0, transport.start($0)) }
    }

    /// Stores `token` over the state as stored now; false when it cannot be stored.
    private func storeToken(_ token: String?) -> Bool {
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
