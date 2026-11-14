import Foundation
import TWData
import TWModel
import TWStorage

/// The legacy Mongo push store as far as push registration touches it (IN-04 review, CODEX-IN04-4..6, -12): documents
/// with the key `(type, cityIndex, id, fcmToken)` (server/lib/pushStore/mongo.js `keyQuery`); `PUT /push {newToken,
/// oldToken}` sets the token of every document of the old token (`updateToken`, `update` with `multi: true`; 403
/// without an old token, routePushNotification.js), so a document moved onto a key that another document already has
/// stays beside it (two documents, two notifications; `removeDuplicateAlarms` skips FCM-only documents); `POST
/// /push-list` upserts each record (`update(keyQuery, doc, {upsert: true})`: the first document with the key, or a new
/// one); `DELETE /push {fcmToken}` without `cityIndex` removes every document of the token.
final class ServerModel: @unchecked Sendable {
    struct Key: Hashable, CustomStringConvertible {
        let type: String
        let cityIndex: String
        let id: String
        let token: String
        var description: String { "\(type)/\(cityIndex)/\(id)@\(token)" }
    }

    private let lock = NSLock()
    private var documents: [(key: Key, value: String)] = []

    /// The documents' keys, each once per document (a duplicate appears twice).
    var keys: [Key] { lock.withLock { documents.map(\.key) } }
    var tokens: Set<String> { Set(keys.map(\.token)) }

    /// The documents as `type/cityIndex/id`, one entry per document.
    var records: [String] { keys.map { "\($0.type)/\($0.cityIndex)/\($0.id)" }.sorted() }

    @discardableResult
    func apply(_ request: PushRequest) -> Int {
        lock.withLock {
            switch (request.method, request.path) {
            case ("PUT", "/v000903/push"):
                guard let new = request.body["newToken"]?.stringValue, let old = request.body["oldToken"]?.stringValue,
                      !new.isEmpty, !old.isEmpty else { return 403 }
                for i in documents.indices where documents[i].key.token == old {
                    let key = documents[i].key
                    documents[i].key = Key(type: key.type, cityIndex: key.cityIndex, id: key.id, token: new)
                }
                return 200
            case ("POST", "/v000903/push-list"):
                for record in request.body.arrayValue ?? [] {
                    guard let token = record["fcmToken"]?.stringValue else { continue }
                    let key = Key(type: record["type"]?.stringValue ?? "", cityIndex: record["cityIndex"]?.jsonText ?? "",
                                  id: record["id"]?.jsonText ?? "", token: token)
                    if let i = documents.firstIndex(where: { $0.key == key }) {
                        documents[i].value = record.jsonText
                    } else {
                        documents.append((key, record.jsonText))
                    }
                }
                return 200
            case ("DELETE", "/v000903/push"):
                // Without `cityIndex`: every document of the token (`removeWithResult`, `tokenQuery`).
                guard let token = request.body["fcmToken"]?.stringValue, !token.isEmpty else { return 403 }
                documents.removeAll { $0.key.token == token }
                return 200
            default:
                return 404
            }
        }
    }
}

/// A transport in front of `ServerModel` whose requests reach the server only when the test delivers them, in any
/// order it chooses (`deliver`: applied and answered; `drop`: lost, answered nil). A test answers every request
/// before it ends, so no task stays suspended.
final class DeliveredServerTransport: PushTransport, @unchecked Sendable {
    enum Fate: Equatable { case pending, delivered, dropped }

    struct Sent {
        let request: PushRequest
        let reply: PushReply
        var fate: Fate
    }

    private let lock = NSLock()
    private var sent: [Sent] = []
    let server: ServerModel

    init(server: ServerModel) { self.server = server }

    var requests: [Sent] { lock.withLock { sent } }
    var pending: [Int] { lock.withLock { sent.indices.filter { sent[$0].fate == .pending } } }

    func start(_ request: PushRequest) -> PushReply {
        let reply = PushReply()
        lock.withLock { sent.append(Sent(request: request, reply: reply, fate: .pending)) }
        return reply
    }

    func deliver(_ index: Int) {
        let s: Sent? = lock.withLock {
            guard sent[index].fate == .pending else { return nil }
            sent[index].fate = .delivered
            return sent[index]
        }
        guard let s else { return }
        s.reply.finish(server.apply(s.request))
    }

    func drop(_ index: Int) {
        let s: Sent? = lock.withLock {
            guard sent[index].fate == .pending else { return nil }
            sent[index].fate = .dropped
            return sent[index]
        }
        s?.reply.finish(nil)
    }

    func dropAll() { for i in pending { drop(i) } }
}

/// A list post of `records` under `token`, as the Cordova app made before the update.
func seededServer(records: [JSONObject] = Files.records, token: String) -> ServerModel {
    let server = ServerModel()
    let ctx = Files.context(AppState())!
    server.apply(PushRegistration.postList(PushState(type: "ios", fcmToken: token, records: records), context: ctx))
    return server
}

/// Opens with `token` and delivers the requests of `transport` (as `pump` does) until the open returned and nothing is
/// in flight.
@discardableResult
func openPumped(_ sync: PushSync, _ transport: DeliveredServerTransport, token: String?,
                pick: ([Int]) -> Int = { $0[0] }) async -> PushSync.Outcome? {
    final class Done: @unchecked Sendable {
        private let lock = NSLock()
        private var value = false
        var isSet: Bool { lock.withLock { value } }
        func set() { lock.withLock { value = true } }
    }
    let done = Done()
    let open = Task {
        let outcome = await sync.open { token }
        done.set()
        return outcome
    }
    for _ in 0..<2000 where !done.isSet {
        await pump(transport, sync, pick: pick)
        try? await Task.sleep(for: .milliseconds(2))
    }
    let outcome = await open.value
    await pump(transport, sync, pick: pick)
    return outcome
}

/// Delivers the requests of `transport` until none is pending and `sync` has nothing in flight; `pick` chooses which
/// pending request goes next (by default the oldest). Returns false when it did not settle within 10 s.
@discardableResult
func pump(_ transport: DeliveredServerTransport, _ sync: PushSync,
          pick: ([Int]) -> Int = { $0[0] }) async -> Bool {
    for _ in 0..<1000 {
        let settled = await eventually {
            if !transport.pending.isEmpty { return true }
            let recovering = await sync.isRecovering
            let replies = await sync.pendingReplies
            return !recovering && replies == 0
        }
        guard settled else { return false }
        let pending = transport.pending
        if pending.isEmpty { return true }
        transport.deliver(pick(pending))
    }
    return false
}
