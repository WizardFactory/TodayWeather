import Foundation
import TWStorage

/// Sends push API requests as the Cordova `$http` does: `start` sends the request at once and returns; the reply
/// comes later. Requests started one after another leave in that order, and a slow reply holds nothing back.
public protocol PushTransport: Sendable {
    func start(_ request: PushRequest) -> PushReply
}

/// The reply to a started request: its HTTP status, or nil when the request did not complete. `finish` sets it once
/// (later calls change nothing); every waiter of `status` is resumed exactly once, also when its task is cancelled
/// (with nil).
public final class PushReply: Sendable {
    private struct State {
        var done = false
        var status: Int?
        var waiters: [UUID: CheckedContinuation<Int?, Never>] = [:]
    }

    private let state = Mutex(State())

    public init() {}

    /// A reply that is already there.
    public static func finished(_ status: Int?) -> PushReply {
        let reply = PushReply()
        reply.finish(status)
        return reply
    }

    public func finish(_ status: Int?) {
        let waiters: [CheckedContinuation<Int?, Never>] = state.withLock { s in
            guard !s.done else { return [] }
            s.done = true
            s.status = status
            defer { s.waiters = [:] }
            return Array(s.waiters.values)
        }
        for w in waiters { w.resume(returning: status) }
    }

    public var isFinished: Bool { state.withLock { $0.done } }

    /// The status once the reply is there; nil at once when the waiting task is cancelled.
    public var status: Int? {
        get async {
            let id = UUID()
            return await withTaskCancellationHandler {
                await withCheckedContinuation { (c: CheckedContinuation<Int?, Never>) in
                    let ready: Int?? = state.withLock { s in
                        if s.done { return .some(s.status) }
                        if Task.isCancelled { return .some(nil) }
                        s.waiters[id] = c
                        return .none
                    }
                    if let ready { c.resume(returning: ready) }
                }
            } onCancel: {
                let waiter = state.withLock { $0.waiters.removeValue(forKey: id) }
                waiter?.resume(returning: nil)
            }
        }
    }
}

/// A value guarded by a lock (`Synchronization.Mutex` needs macOS 15 / iOS 18; the package supports 14 / 17).
final class Mutex<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    init(_ value: Value) { self.value = value }

    func withLock<T>(_ body: (inout Value) throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body(&value)
    }
}

/// `PushTransport` over HTTP to the legacy server at `baseURL` (the Cordova `clientConfig.serverUrl`, without the
/// path version), with the Cordova app's 10-second timeout. The body is the request's compact JSON text in UTF-8, as
/// `angular.toJson` writes it. `start` resumes the URLSession task before it returns, so requests leave in the order
/// they were started. Failures are not retried: the Cordova app does not retry either, and the list is posted again on
/// the next open.
public struct HTTPPushTransport: PushTransport {
    public let baseURL: String
    private let session: URLSession
    /// `$httpProvider.defaults.headers.common.Accept`.
    public static let accept = "application/json, text/plain, */*"

    public init(baseURL: String, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func start(_ request: PushRequest) -> PushReply {
        var base = baseURL
        while base.hasSuffix("/") { base.removeLast() }
        guard let url = URL(string: base + request.path) else { return .finished(nil) }
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        r.httpMethod = request.method
        // Angular's `$http` default, which the Cordova requests carry next to their own headers.
        r.setValue(Self.accept, forHTTPHeaderField: "Accept")
        for (name, value) in request.headers { r.setValue(value, forHTTPHeaderField: name) }
        r.httpBody = Data(request.body.jsonText.utf8)
        let reply = PushReply()
        let task = session.dataTask(with: r) { _, response, error in
            reply.finish(error == nil ? (response as? HTTPURLResponse)?.statusCode : nil)
        }
        task.resume()
        return reply
    }
}
