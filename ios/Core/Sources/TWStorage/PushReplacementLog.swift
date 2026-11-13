import Foundation
import TWModel

/// The durable, ordered log of token replacements (IN-04 review round 3, CODEX-IN04-4..5):
/// `Library/Application Support/TodayWeather/push_replacements.json`,
/// `{"nextId":N,"dropped":K,"entries":[{"id":1,"old":"…"|null,"new":"…","acked":false}]}`, replaced atomically on every
/// change.
///
/// The legacy server keys a record by `(type, cityIndex, id, fcmToken)`, `PUT /push` rewrites the records of the old
/// token and `POST /push-list` upserts by that key, so a lost replacement is not healed by a list post, while
/// replaying the hops in order changes nothing already applied. An entry is appended when the Cordova code would send
/// the `PUT` (`old` nil for a first token), before the request starts; the app state's token is the last entry's `new`.
/// A reply (success or failure) acknowledges exactly its entry's `id`; entries leave the log only as an acknowledged
/// prefix, so the entries left are always a suffix of the hops sent, ending with the newest, and replaying all of them in
/// `id` order brings the server's records to the last `new`. At most `capacity` entries are kept: beyond that the
/// oldest is dropped and counted in `dropped`.
public final class PushReplacementLog: @unchecked Sendable {
    public struct Entry: Hashable, Sendable {
        public let id: Int
        public let old: String?
        public let new: String
        public let acked: Bool

        public init(id: Int, old: String?, new: String, acked: Bool = false) {
            self.id = id
            self.old = old
            self.new = new
            self.acked = acked
        }

        /// Equality compares the tokens by UTF-16 code units.
        public static func == (a: Entry, b: Entry) -> Bool {
            a.id == b.id && a.acked == b.acked && JSString.equal(a.new, b.new)
                && (a.old == nil) == (b.old == nil) && JSString.equal(a.old ?? "", b.old ?? "")
        }

        public func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }

    public struct Contents: Equatable, Sendable {
        public var nextId = 1
        public var dropped = 0
        public var entries: [Entry] = []
    }

    public static let capacity = 64

    public let url: URL
    private static let lock = NSLock()

    public init(url: URL) {
        self.url = url
    }

    /// The log next to the app state file.
    public static func standard() throws -> PushReplacementLog {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                  appropriateFor: nil, create: true)
        return PushReplacementLog(url: support.appendingPathComponent("TodayWeather/push_replacements.json"))
    }

    public func contents() throws -> Contents {
        try Self.lock.withLock { try read() }
    }

    public func entries() throws -> [Entry] {
        try contents().entries
    }

    /// Appends the replacement of `old` by `new` and returns its entry.
    @discardableResult
    public func append(old: String?, new: String) throws -> Entry {
        try Self.lock.withLock {
            var c = try read()
            let entry = Entry(id: c.nextId, old: old, new: new)
            c.nextId += 1
            c.entries.append(entry)
            while c.entries.count > Self.capacity {
                c.entries.removeFirst()
                c.dropped += 1
            }
            try write(c)
            return entry
        }
    }

    /// Records the reply of entry `id`, then removes the acknowledged entries at the front.
    public func acknowledge(_ id: Int) throws {
        try Self.lock.withLock {
            var c = try read()
            guard let i = c.entries.firstIndex(where: { $0.id == id }) else { return }
            let e = c.entries[i]
            c.entries[i] = Entry(id: e.id, old: e.old, new: e.new, acked: true)
            while let first = c.entries.first, first.acked { c.entries.removeFirst() }
            try write(c)
        }
    }

    /// Clears the acknowledgement of the entries `ids` (a new process replays them all again: an entry an earlier
    /// process saw answered behind an unanswered one must be applied again after it).
    public func reopen(_ ids: Set<Int>) throws {
        try Self.lock.withLock {
            var c = try read()
            guard c.entries.contains(where: { ids.contains($0.id) && $0.acked }) else { return }
            c.entries = c.entries.map { ids.contains($0.id) ? Entry(id: $0.id, old: $0.old, new: $0.new) : $0 }
            try write(c)
        }
    }

    /// A missing file is an empty log, and so is a file that is not a log (it is replaced by the next write). A file
    /// that exists but cannot be read now (data protection) throws.
    private func read() throws -> Contents {
        guard FileManager.default.fileExists(atPath: url.path) else { return Contents() }
        let data = try Data(contentsOf: url)
        guard let doc = try? JSONValue.parse(data), let list = doc["entries"]?.arrayValue,
              let next = doc["nextId"]?.numberValue.flatMap({ Int($0.text) }) else { return Contents() }
        var c = Contents(nextId: next, dropped: doc["dropped"]?.numberValue.flatMap { Int($0.text) } ?? 0)
        for v in list {
            guard let id = v["id"]?.numberValue.flatMap({ Int($0.text) }), let new = v["new"]?.stringValue else { continue }
            c.entries.append(Entry(id: id, old: v["old"]?.stringValue, new: new, acked: v["acked"]?.boolValue ?? false))
        }
        return c
    }

    private func write(_ c: Contents) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let entries = c.entries.map { e in
            JSONValue.object(JSONObject([("id", .number(e.id)), ("old", e.old.map(JSONValue.string) ?? .null),
                                         ("new", .string(e.new)), ("acked", .bool(e.acked))]))
        }
        let doc = JSONValue.object(JSONObject([("nextId", .number(c.nextId)), ("dropped", .number(c.dropped)),
                                               ("entries", .array(entries))]))
        try Data(doc.jsonText.utf8).write(to: url, options: .atomic)
    }
}
