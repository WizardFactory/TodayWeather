import Foundation
import TWModel

/// FCM tokens delivered while the app runs, in order of arrival, until their replacement on the server has been
/// answered (IN-04, #2953): `Library/Application Support/TodayWeather/push_tokens.json`, replaced atomically on every
/// change, `{"tokens":[{"token":"…"},{"token":"…","sentOver":"…"|null}]}`.
///
/// A token is stored on arrival. When its replacement is sent (`PUT /push`, the moment the Cordova token callback
/// takes the token) it is marked `sentOver` the token it replaced, and the app state takes the token; it is removed
/// when the reply arrives (the Cordova app does not retry a failure either). A marked token left by a process that
/// ended first is sent again by the next process. Changes are serialized by one lock shared by every instance (the
/// FCM callback appends while `PushSync` marks and removes); the app runs in one process at a time.
public final class PushTokenQueue: @unchecked Sendable {
    public struct Entry: Hashable, Sendable {
        public let token: String
        /// Whether the replacement was sent, and over which token (nil: none was stored).
        public let sent: Sent

        public enum Sent: Hashable, Sendable {
            case notYet
            case over(String?)
        }

        public init(token: String, sent: Sent = .notYet) {
            self.token = token
            self.sent = sent
        }

        public static func == (a: Entry, b: Entry) -> Bool {
            guard JSString.equal(a.token, b.token) else { return false }
            switch (a.sent, b.sent) {
            case (.notYet, .notYet): return true
            case let (.over(x), .over(y)):
                switch (x, y) {
                case (nil, nil): return true
                case let (x?, y?): return JSString.equal(x, y)
                default: return false
                }
            default: return false
            }
        }

        public func hash(into hasher: inout Hasher) { JSString.hash(token, into: &hasher) }
    }

    public let url: URL
    private static let lock = NSLock()
    private var lock: NSLock { Self.lock }

    public init(url: URL) {
        self.url = url
    }

    /// The queue next to the app state file.
    public static func standard() throws -> PushTokenQueue {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                  appropriateFor: nil, create: true)
        return PushTokenQueue(url: support.appendingPathComponent("TodayWeather/push_tokens.json"))
    }

    /// Adds `token` at the end, unless it is already the last one and not sent yet.
    public func append(_ token: String) throws {
        try lock.withLock {
            var entries = try read()
            if let last = entries.last, last.sent == .notYet, JSString.equal(last.token, token) { return }
            entries.append(Entry(token: token))
            try write(entries)
        }
    }

    /// Every entry, oldest first.
    public func entries() throws -> [Entry] {
        try lock.withLock { try read() }
    }

    /// The tokens, oldest first.
    public func pending() throws -> [String] {
        try entries().map(\.token)
    }

    /// Marks the oldest unsent `token` as sent over `old`.
    public func markSent(_ token: String, over old: String?) throws {
        try lock.withLock {
            var entries = try read()
            guard let i = entries.firstIndex(where: { $0.sent == .notYet && JSString.equal($0.token, token) }) else { return }
            entries[i] = Entry(token: token, sent: .over(old))
            try write(entries)
        }
    }

    /// Removes the oldest entry of `token` that was sent (`sent: true`) or not (`false`).
    public func remove(_ token: String, sent: Bool) throws {
        try lock.withLock {
            var entries = try read()
            guard let i = entries.firstIndex(where: { ($0.sent != .notYet) == sent && JSString.equal($0.token, token) })
            else { return }
            entries.remove(at: i)
            try write(entries)
        }
    }

    /// A missing file is an empty queue, and so is a file that is not a queue (it is replaced by the next write).
    /// A file that exists but cannot be read now (data protection) throws.
    private func read() throws -> [Entry] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        let data = try Data(contentsOf: url)
        guard let list = (try? JSONValue.parse(data))?["tokens"]?.arrayValue else { return [] }
        return list.compactMap { v in
            if let token = v.stringValue { return Entry(token: token) }
            guard let token = v["token"]?.stringValue else { return nil }
            guard let over = v.objectValue?["sentOver"] else { return Entry(token: token) }
            return Entry(token: token, sent: .over(over.stringValue))
        }
    }

    private func write(_ entries: [Entry]) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let list = entries.map { e -> JSONValue in
            var o = JSONObject([("token", .string(e.token))])
            if case .over(let old) = e.sent { o["sentOver"] = old.map(JSONValue.string) ?? .null }
            return .object(o)
        }
        let doc = JSONValue.object(JSONObject([("tokens", .array(list))]))
        try Data(doc.jsonText.utf8).write(to: url, options: .atomic)
    }
}
