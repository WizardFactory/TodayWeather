import Foundation
import TWData
import TWModel
import TWStorage

/// The legacy push store as far as push registration touches it (IN-04 review, CODEX-IN04-4..5): records keyed by
/// `(type, cityIndex, id, fcmToken)` (server/lib/pushStore/mongo.js `keyQuery`, the SQLite `rec_key`);
/// `PUT /push {newToken, oldToken}` rewrites every record of the old token (`updateToken`; 403 without an old token,
/// routePushNotification.js), keeping one record when two collide; `POST /push-list` upserts each record by its key.
final class ServerModel: @unchecked Sendable {
    struct Key: Hashable, CustomStringConvertible {
        let type: String
        let cityIndex: String
        let id: String
        let token: String
        var description: String { "\(type)/\(cityIndex)/\(id)@\(token)" }
    }

    private let lock = NSLock()
    private var store: [Key: String] = [:]

    var keys: Set<Key> { lock.withLock { Set(store.keys) } }
    var tokens: Set<String> { Set(keys.map(\.token)) }

    /// The records as `type/cityIndex/id`, each once per token it is held under.
    var records: [String] { keys.map { "\($0.type)/\($0.cityIndex)/\($0.id)" }.sorted() }

    @discardableResult
    func apply(_ request: PushRequest) -> Int {
        lock.withLock {
            switch (request.method, request.path) {
            case ("PUT", "/v000903/push"):
                guard let new = request.body["newToken"]?.stringValue, let old = request.body["oldToken"]?.stringValue,
                      !new.isEmpty, !old.isEmpty else { return 403 }
                for key in store.keys where key.token == old {
                    let value = store.removeValue(forKey: key)!
                    store[Key(type: key.type, cityIndex: key.cityIndex, id: key.id, token: new)] = value
                }
                return 200
            case ("POST", "/v000903/push-list"):
                for record in request.body.arrayValue ?? [] {
                    guard let token = record["fcmToken"]?.stringValue else { continue }
                    let key = Key(type: record["type"]?.stringValue ?? "", cityIndex: record["cityIndex"]?.jsonText ?? "",
                                  id: record["id"]?.jsonText ?? "", token: token)
                    store[key] = record.jsonText
                }
                return 200
            default:
                return 404
            }
        }
    }
}

/// A transport in front of `ServerModel` whose test decides, per request, whether the server receives it at once
/// (`deliver`) and when the reply comes (`answer`). Replies left open are answered by `answerAll` before a test ends,
/// so no task stays suspended.
final class ScriptedServerTransport: PushTransport, @unchecked Sendable {
    struct Sent {
        let request: PushRequest
        let reply: PushReply
        let delivered: Bool
    }

    private let lock = NSLock()
    private var sent: [Sent] = []
    let server: ServerModel
    /// Whether the server receives the request (false: lost on the way).
    let deliver: @Sendable (PushRequest) -> Bool
    /// Whether the reply comes at once (false: the test answers it later).
    let answerAtOnce: @Sendable (PushRequest) -> Bool

    init(server: ServerModel, deliver: @escaping @Sendable (PushRequest) -> Bool = { _ in true },
         answerAtOnce: @escaping @Sendable (PushRequest) -> Bool = { _ in true }) {
        self.server = server
        self.deliver = deliver
        self.answerAtOnce = answerAtOnce
    }

    var requests: [Sent] { lock.withLock { sent } }

    func start(_ request: PushRequest) -> PushReply {
        let delivered = deliver(request)
        let status: Int? = delivered ? server.apply(request) : nil
        let reply = PushReply()
        lock.withLock { sent.append(Sent(request: request, reply: reply, delivered: delivered)) }
        if answerAtOnce(request) { reply.finish(status) }
        return reply
    }

    /// Answers request `index` with `status`, by default its status when delivered, else nil.
    func answer(_ index: Int, status: Int?? = .none) {
        let s = lock.withLock { sent[index] }
        s.reply.finish(status ?? (s.delivered ? 200 : nil))
    }

    func answerAll() {
        for s in lock.withLock({ sent }) { s.reply.finish(s.delivered ? 200 : nil) }
    }
}

/// A list post of `records` under `token`, as the Cordova app made before the update.
func seededServer(records: [JSONObject] = Files.records, token: String) -> ServerModel {
    let server = ServerModel()
    let ctx = Files.context(AppState())!
    server.apply(PushRegistration.postList(PushState(type: "ios", fcmToken: token, records: records), context: ctx))
    return server
}
