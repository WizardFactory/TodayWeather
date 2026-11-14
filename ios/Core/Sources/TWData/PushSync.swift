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
    func wasIssued(_ token: String) throws -> Bool
}

extension AppStateStore: PushStateStore {}

extension PushReplacementLog: PushLogStore {}

/// The Cordova `Push` service's timeline on one actor (IN-04, #2953; review rounds 1–9).
///
/// Every event (the process start, the open, a token that arrived, the list post 3 seconds after the open, a reply)
/// is handled on this actor, from reading the state to starting the requests, without suspending, so events never
/// interleave. Requests are started as `$http` starts them (`PushTransport.start`) and are not awaited before the next
/// event. The list post is due `repostDelay` after the open began, on the injected clock.
///
/// Token replacements go through the replacement log: when the Cordova code would send `PUT /push`, an entry
/// `{id, old, new}` is appended first, then the state takes `new`, then the request starts; its reply, success or
/// failure (Cordova does not retry), acknowledges that `id`. Every event first sets the state's token to the last
/// entry's `new` when they differ.
///
/// Entries this process did not send were left by an earlier one: their requests may have reached the server, in
/// part or not at all. The legacy store is Mongo: a `PUT` moves documents onto a token that may already hold them and
/// keeps both, so sending a replacement again, or posting an older token's list again, can duplicate records
/// (review round 8, CODEX-IN04-12); removing documents is unsafe too, since the legacy list post answers 200 when a
/// record failed to save and a removal can arrive late (round 9, CODEX-IN04-13, -14). Recovery therefore only posts
/// the list with the newest token (an upsert: one document per record under it), as Cordova's next open does, and
/// acknowledges the entries when it succeeded (2xx); otherwise they stay for the next process. Documents under an
/// older token can stay, as Cordova leaves them. While a recovery runs, or while entries wait that this process has
/// not handled, new tokens are logged and recovered in turn instead of replaced with a `PUT`, and a list post that
/// falls due waits until the entries were handled (CODEX-IN04-11). A `PUT` goes only to a value that never held this
/// installation's documents (the log's `issued` values): a value that comes back is recovered the same way, so a
/// `PUT` never moves documents onto documents.
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

    /// Log entries this process sent or recovered; one process never handles an entry twice.
    private var sentHere: Set<Int> = []
    /// Tasks waiting for replies of replacements sent outside a recovery, owned by this actor.
    private var replyWatchers: [UUID: Task<Void, Never>] = [:]
    /// The recovery of left entries, owned by this actor; nil when none runs.
    private var recovery: Task<Void, Never>?
    /// A list post fell due during the recovery.
    private var postAfterRecovery = false
    /// Token observations handled so far (the token callback, the open's token): a provider value read while another
    /// observation was handled is older than it and is dropped (CODEX-IN04-8).
    private var observations = 0
    /// Opens whose first step ran, and list posts that fell due (observed by tests on a virtual clock).
    public private(set) var openStarts = 0
    public private(set) var reposts = 0
    public var pendingReplies: Int { replyWatchers.count }
    public var isRecovering: Bool { recovery != nil }

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

    /// The process started (in the foreground or the background): the entries an earlier process left are recovered.
    public func start() {
        guard reconciled() != nil else { return }
        recover()
    }

    /// A token FCM delivered while the app runs: the Cordova token callback. Returns the requests it started (none
    /// while entries wait for a recovery: the recovery handles it in turn).
    @discardableResult
    public func tokenArrived(_ token: String) -> [PushRequest] {
        // A blank token is ignored by the callback, so it is no observation (CODEX-IN04-10).
        if PushRegistration.accepts(token) { observations += 1 }
        guard let (state, ctx) = reconciled() else { return [] }
        recover()
        return replace(token, state: state, ctx: ctx).map(\.0)
    }

    /// The Cordova `Push.init` when the app is opened. The list post is due `repostDelay` from now (its
    /// `setTimeout`). At once: the recovery of left entries, then the repair and the token callback for `token` (the
    /// current FCM token, if one is known). When the post is due: the list with the state's token, when there is one
    /// (after the recovery, if one runs). Returns, once their replies arrived, the requests of the open and of its post
    /// that it started itself; nil when no request can be built.
    ///
    /// The token is read from `token` (the SDK's current token) while the actor runs other events. A token the callback
    /// delivered meanwhile (`tokenArrived`) is newer than any value the read can still return late, or as new, and FCM
    /// delivers every later change through the callback, so a value whose read overlapped another observation is
    /// dropped: observations count on the actor when the read starts and are compared when it ends. Only accepted
    /// tokens are observations; a blank value is ignored, as by the Cordova callback.
    public func open(token: @escaping @Sendable () async -> String?) async -> Outcome? {
        let due = timer(repostDelay)
        let seen = observations
        let read = await token()
        let current = observations == seen ? read : nil
        if PushRegistration.accepts(current) { observations += 1 }
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

    /// `_postPushList(pushList)` with the token current now; after the recovery when entries wait (CODEX-IN04-11).
    private func postList() -> [(PushRequest, PushReply)] {
        if !inOrder() {
            postAfterRecovery = true
            recover()
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
    /// token); while entries wait for a recovery, only log and state (the recovery handles it).
    private func replace(_ token: String, state: AppState, ctx: PushRegistration.Context) -> [(PushRequest, PushReply)] {
        let result = PushRegistration.onTokenRefresh(state.push, places: state.places, token: token, context: ctx)
        guard let put = result.requests.first, put.method == "PUT" else { return [] }
        // A value that held this installation's documents before (it came back) is not replaced onto: the move
        // could join documents still under it; the recovery posts its list instead (review round 9). Unknown when
        // the log cannot be read: recovered too.
        let returning = (try? log.wasIssued(token)) ?? true
        guard let entry = try? log.append(old: state.push.fcmToken, new: token), storeToken(token) else { return [] }
        // Sent here only when every entry before it was handled by this process; otherwise a recovery handles it
        // (also when the recovery could not start yet: the next event starts it, CODEX-IN04-11).
        if returning || !inOrder(except: entry.id) {
            recover()
            return []
        }
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

    /// No recovery runs and every entry in the log (but `id`) was handled by this process: only then is a new replacement
    /// or a list post sent at once, so no hop overtakes one that waits (CODEX-IN04-11). False when the log cannot be
    /// read.
    private func inOrder(except id: Int? = nil) -> Bool {
        guard recovery == nil, let entries = try? log.entries() else { return false }
        return entries.allSatisfy { $0.id == id || sentHere.contains($0.id) }
    }

    /// Starts the recovery when entries wait that this process has not sent.
    private func recover() {
        guard recovery == nil, let entries = try? log.entries(),
              entries.contains(where: { !sentHere.contains($0.id) }) else { return }
        recovery = Task { await self.recoverEntries() }
    }

    /// Recovers the waiting entries, and those appended meanwhile, in rounds: the list post with the newest token;
    /// when it succeeded (2xx), the entries are acknowledged, otherwise they stay for the next process. A post that
    /// fell due meanwhile goes out after the recovery.
    private func recoverEntries() async {
        while let round = nextRecovery() {
            if await Self.allSucceeded(round.post) {
                for id in round.entries { try? log.acknowledge(id) }
            }
        }
        recovery = nil
        if postAfterRecovery && inOrder() {
            postAfterRecovery = false
            _ = postList()
        }
    }

    private static func allSucceeded(_ started: [(PushRequest, PushReply)]) async -> Bool {
        var all = true
        for (_, reply) in started {
            let status = await reply.status
            if !(status.map { (200..<300).contains($0) } ?? false) { all = false }
        }
        return all
    }

    /// Starts the next recovery round over the entries this process has not handled: their ids and the started list
    /// post with the newest token (none without records or token).
    private func nextRecovery() -> (entries: [Int], post: [(PushRequest, PushReply)])? {
        guard let (state, ctx) = reconciled(), let entries = try? log.entries() else { return nil }
        let waiting = entries.filter { !sentHere.contains($0.id) }
        guard !waiting.isEmpty else { return nil }
        sentHere.formUnion(waiting.map(\.id))
        let post = start(PushRegistration.onStart(state.push, places: state.places, token: nil, context: ctx).requests)
        return (waiting.map(\.id), post)
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
