import Foundation
import SQLite3
import TWModel

/// Reads the `localStorage` of the Cordova app's WKWebView (origin `app://localhost`) from WebKit's files in the
/// app's data container, without a web view and without opening WebKit's own files: the database and its
/// write-ahead log are copied to a temporary directory and the copy is read. So the source is never changed, and
/// the read works when the process starts in the background.
///
/// Layouts (all SQLite, table `ItemTable(key TEXT, value BLOB)` with UTF-16LE values):
/// - `origins`: WebKit's per-origin storage (iOS 17 and later):
///   `<root>/Default/<salted top origin>/<salted origin>/LocalStorage/localstorage.sqlite3`, where the
///   `<salted origin>` directory holds an `origin` file naming both origins. Verified on the iOS 26.5 simulator.
/// - `legacy`: the single-directory layout of earlier WebKit, `<root>/LocalStorage/app_localhost_0.localstorage`,
///   which WebKit moves into the per-origin layout when the origin's storage is next opened; it remains when the
///   Cordova app did not run after an iOS update.
///
/// `<root>` is `Library/WebKit/WebsiteData` on a device and `Library/WebKit/<bundle id>/WebsiteData` on the
/// simulator, which observed the second form.
public enum WebKitLocalStorage {
    public enum Layout: String, Sendable {
        case origins
        case legacy
    }

    public struct Database: Hashable, Sendable {
        public let url: URL
        /// The path relative to the data container.
        public let relativePath: String
        public let layout: Layout
    }

    public enum ReadError: Error, Equatable {
        /// The file exists but could not be copied (for example data protection before the first unlock).
        case unavailable(String)
        /// The copy is not a readable `localStorage` database.
        case unreadable(String)
    }

    /// The `localStorage` database of `scheme://host` in `dataContainer`, preferring the per-origin layout.
    public static func locate(dataContainer: URL, scheme: String = "app", host: String = "localhost") -> Database? {
        let fm = FileManager.default
        let webKit = dataContainer.appendingPathComponent("Library/WebKit", isDirectory: true)
        var roots = [webKit.appendingPathComponent("WebsiteData", isDirectory: true)]
        let children = (try? fm.contentsOfDirectory(at: webKit, includingPropertiesForKeys: nil)) ?? []
        for child in children.sorted(by: { $0.lastPathComponent < $1.lastPathComponent })
        where child.lastPathComponent != "WebsiteData" {
            roots.append(child.appendingPathComponent("WebsiteData", isDirectory: true))
        }
        func relative(_ url: URL) -> String {
            String(url.standardizedFileURL.path.dropFirst(dataContainer.standardizedFileURL.path.count + 1))
        }
        for root in roots {
            let defaultDir = root.appendingPathComponent("Default", isDirectory: true)
            let tops = (try? fm.contentsOfDirectory(at: defaultDir, includingPropertiesForKeys: nil)) ?? []
            for top in tops.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                let frames = (try? fm.contentsOfDirectory(at: top, includingPropertiesForKeys: nil)) ?? []
                for frame in frames.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                    let db = frame.appendingPathComponent("LocalStorage/localstorage.sqlite3")
                    guard fm.fileExists(atPath: db.path),
                          let data = try? Data(contentsOf: frame.appendingPathComponent("origin")),
                          let origins = OriginFile.parse(data),
                          origins.allSatisfy({ $0 == OriginFile.Origin(scheme: scheme, host: host, port: nil) }) else {
                        continue
                    }
                    return Database(url: db, relativePath: relative(db), layout: .origins)
                }
            }
        }
        for root in roots {
            let db = root.appendingPathComponent("LocalStorage/\(scheme)_\(host)_0.localstorage")
            if fm.fileExists(atPath: db.path) {
                return Database(url: db, relativePath: relative(db), layout: .legacy)
            }
        }
        return nil
    }

    /// All items of the database at `url`, read from a temporary copy of the file and its write-ahead log. A list,
    /// not a dictionary: keys are distinct by UTF-16 code units, which Swift `String` keys would not keep apart.
    public static func readItems(at url: URL) throws -> [(key: String, value: String)] {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("tw-localstorage-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: dir) }
        let copy = dir.appendingPathComponent("db.sqlite3")
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            try fm.copyItem(at: url, to: copy)
            // The log holds the recent writes (WebKit keeps the database in WAL mode). The index (-shm) is not
            // copied: SQLite rebuilds it from the log.
            let wal = URL(fileURLWithPath: url.path + "-wal")
            if fm.fileExists(atPath: wal.path) {
                try fm.copyItem(at: wal, to: URL(fileURLWithPath: copy.path + "-wal"))
            }
        } catch {
            throw ReadError.unavailable("\(error)")
        }
        return try query(copy)
    }

    private static func query(_ file: URL) throws -> [(key: String, value: String)] {
        var db: OpaquePointer?
        defer { sqlite3_close(db) }
        guard sqlite3_open_v2(file.path, &db, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK else {
            throw ReadError.unreadable(db.map { String(cString: sqlite3_errmsg($0)) } ?? "open")
        }
        var statement: OpaquePointer?
        defer { sqlite3_finalize(statement) }
        guard sqlite3_prepare_v2(db, "SELECT key, value FROM ItemTable", -1, &statement, nil) == SQLITE_OK else {
            throw ReadError.unreadable(String(cString: sqlite3_errmsg(db)))
        }
        var items: [(key: String, value: String)] = []
        while true {
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW else { throw ReadError.unreadable(String(cString: sqlite3_errmsg(db))) }
            guard let keyText = sqlite3_column_text(statement, 0) else { continue }
            let key = String(cString: keyText)
            switch sqlite3_column_type(statement, 1) {
            case SQLITE_BLOB:
                let count = Int(sqlite3_column_bytes(statement, 1))
                let bytes = sqlite3_column_blob(statement, 1).map { Data(bytes: $0, count: count) } ?? Data()
                items.append((key, String(data: bytes, encoding: .utf16LittleEndian) ?? ""))
            case SQLITE_TEXT:
                items.append((key, sqlite3_column_text(statement, 1).map { String(cString: $0) } ?? ""))
            default:
                continue
            }
        }
        return items
    }
}

/// WebKit's `origin` file: the top-frame origin and the frame origin, each a protocol, a host and an optional
/// port, written by `WTF::Persistence::Encoder` (string: UInt32 length, Bool is8Bit, Latin-1 bytes or UTF-16LE
/// units; optional: Bool, then UInt16).
enum OriginFile {
    struct Origin: Equatable {
        var scheme: String
        var host: String
        var port: UInt16?

        /// WebKit compares origins by code units.
        static func == (a: Origin, b: Origin) -> Bool {
            JSString.equal(a.scheme, b.scheme) && JSString.equal(a.host, b.host) && a.port == b.port
        }
    }

    static func parse(_ data: Data) -> [Origin]? {
        var bytes = [UInt8](data)[...]
        func byte() -> UInt8? { bytes.popFirst() }
        func uint32() -> UInt32? {
            guard bytes.count >= 4 else { return nil }
            let value = bytes.prefix(4).enumerated().reduce(UInt32(0)) { $0 | UInt32($1.element) << (8 * $1.offset) }
            bytes = bytes.dropFirst(4)
            return value
        }
        func string() -> String? {
            guard let length = uint32().map(Int.init), length < 4096, let is8Bit = byte() else { return nil }
            if is8Bit == 1 {
                guard bytes.count >= length else { return nil }
                defer { bytes = bytes.dropFirst(length) }
                return String(bytes.prefix(length).map { Character(Unicode.Scalar($0)) })
            }
            guard bytes.count >= length * 2 else { return nil }
            defer { bytes = bytes.dropFirst(length * 2) }
            return String(data: Data(bytes.prefix(length * 2)), encoding: .utf16LittleEndian)
        }
        func origin() -> Origin? {
            guard let scheme = string(), let host = string(), let hasPort = byte() else { return nil }
            if hasPort == 0 { return Origin(scheme: scheme, host: host, port: nil) }
            guard bytes.count >= 2, let lo = byte(), let hi = byte() else { return nil }
            return Origin(scheme: scheme, host: host, port: UInt16(lo) | UInt16(hi) << 8)
        }
        guard let top = origin(), let frame = origin(), bytes.isEmpty else { return nil }
        return [top, frame]
    }
}
