import Foundation
import TWModel

/// FCM tokens delivered while the app runs that are not registered yet, in order of arrival (IN-04, #2953):
/// `Library/Application Support/TodayWeather/push_tokens.json`, `{"tokens":[…]}`, replaced atomically on every
/// change. A token is stored here before its replacement is sent and removed only after the new token is stored in
/// the app state, so a process that ends in between leaves it to the next process (`PushSync.drain`). Changes within
/// a process are serialized by one lock shared by every instance (the app appends from the FCM callback while
/// `PushSync` removes, through separate instances); the app runs in one process at a time.
public final class PushTokenQueue: @unchecked Sendable {
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

    /// Adds `token` at the end, unless it is already the last one.
    public func append(_ token: String) throws {
        try lock.withLock {
            var tokens = try read()
            if let last = tokens.last, JSString.equal(last, token) { return }
            tokens.append(token)
            try write(tokens)
        }
    }

    /// The tokens not registered yet, oldest first.
    public func pending() throws -> [String] {
        try lock.withLock { try read() }
    }

    /// Removes the oldest token when it is `token` (the one just registered).
    public func removeFirst(_ token: String) throws {
        try lock.withLock {
            var tokens = try read()
            guard let first = tokens.first, JSString.equal(first, token) else { return }
            tokens.removeFirst()
            try write(tokens)
        }
    }

    /// A missing file is an empty queue, and so is a file that is not a queue (it is replaced by the next write).
    /// A file that exists but cannot be read now (data protection) throws.
    private func read() throws -> [String] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        let data = try Data(contentsOf: url)
        guard let list = (try? JSONValue.parse(data))?["tokens"]?.arrayValue else { return [] }
        return list.compactMap(\.stringValue)
    }

    private func write(_ tokens: [String]) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let doc = JSONValue.object(JSONObject([("tokens", .array(tokens.map(JSONValue.string)))]))
        try Data(doc.jsonText.utf8).write(to: url, options: .atomic)
    }
}
