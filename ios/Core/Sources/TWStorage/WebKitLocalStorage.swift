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
        /// The copy is not a readable `localStorage` database (not SQLite, corrupt, no `ItemTable`): it cannot become
        /// readable later, so the migration records it and goes on with the suite.
        case unreadable(String)
    }

    /// The `localStorage` database of `scheme://host` in `dataContainer`, preferring the per-origin layout; nil when
    /// there is none. A directory, `origin` file or database that exists but cannot be read now throws
    /// `CordovaSources.SourceError.unavailable` (CODEX-IN03-1): that is not absence, and the migration must wait.
    public static func locate(dataContainer: URL, scheme: String = "app", host: String = "localhost") throws -> Database? {
        let webKit = dataContainer.appendingPathComponent("Library/WebKit", isDirectory: true)
        guard try FileProbe.exists(webKit) else { return nil } // no WebKit storage at all (an update from 1.0.10)
        var roots = [webKit.appendingPathComponent("WebsiteData", isDirectory: true)]
        for child in try FileProbe.list(webKit) where child.lastPathComponent != "WebsiteData" {
            if try FileProbe.isDirectory(child) { roots.append(child.appendingPathComponent("WebsiteData", isDirectory: true)) }
        }
        func relative(_ url: URL) -> String {
            String(url.standardizedFileURL.path.dropFirst(dataContainer.standardizedFileURL.path.count + 1))
        }
        let wanted = OriginFile.Origin(scheme: scheme, host: host, port: nil)
        for root in roots {
            let defaultDir = root.appendingPathComponent("Default", isDirectory: true)
            guard try FileProbe.exists(defaultDir) else { continue }
            for top in try FileProbe.list(defaultDir) where try FileProbe.isDirectory(top) {
                for frame in try FileProbe.list(top) where try FileProbe.isDirectory(frame) {
                    let db = frame.appendingPathComponent("LocalStorage/localstorage.sqlite3")
                    let originFile = frame.appendingPathComponent("origin")
                    guard try FileProbe.exists(db), try FileProbe.exists(originFile) else { continue }
                    guard let origins = OriginFile.parse(try FileProbe.read(originFile)),
                          origins.allSatisfy({ $0 == wanted }) else {
                        continue
                    }
                    return Database(url: db, relativePath: relative(db), layout: .origins)
                }
            }
        }
        for root in roots {
            let db = root.appendingPathComponent("LocalStorage/\(scheme)_\(host)_0.localstorage")
            if try FileProbe.exists(db) {
                return Database(url: db, relativePath: relative(db), layout: .legacy)
            }
        }
        return nil
    }

    /// All items of the database at `url`, read from a temporary copy of the file and its write-ahead log. A list,
    /// not a dictionary: keys are distinct by UTF-16 code units, which Swift `String` keys would not keep apart.
    /// A database or log that cannot be copied now throws `CordovaSources.SourceError.unavailable`; a copy that is
    /// no `localStorage` database throws `ReadError.unreadable`.
    public static func readItems(at url: URL) throws -> [(key: String, value: String)] {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("tw-localstorage-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: dir) }
        let copy = dir.appendingPathComponent("db.sqlite3")
        // The log holds the recent writes (WebKit keeps the database in WAL mode). The index (-shm) is not copied:
        // SQLite rebuilds it from the log.
        let wal = URL(fileURLWithPath: url.path + "-wal")
        let hasLog = try FileProbe.exists(wal)
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            try fm.copyItem(at: url, to: copy)
            if hasLog { try fm.copyItem(at: wal, to: URL(fileURLWithPath: copy.path + "-wal")) }
        } catch {
            throw CordovaSources.SourceError.unavailable("\(url.path): \(error.localizedDescription)")
        }
        return try query(copy)
    }

    /// SQLite results that mean the copy is no `localStorage` database, as opposed to a failure to read it now.
    private static let notADatabase: Set<Int32> = [SQLITE_NOTADB, SQLITE_CORRUPT, SQLITE_ERROR, SQLITE_FORMAT, SQLITE_EMPTY]

    private static func failure(_ db: OpaquePointer?, _ code: Int32) -> Error {
        let message = db.map { String(cString: sqlite3_errmsg($0)) } ?? String(cString: sqlite3_errstr(code))
        return notADatabase.contains(code & 0xFF) ? ReadError.unreadable(message)
            : CordovaSources.SourceError.unavailable("localStorage copy: \(message)")
    }

    private static func query(_ file: URL) throws -> [(key: String, value: String)] {
        var db: OpaquePointer?
        defer { sqlite3_close(db) }
        let opened = sqlite3_open_v2(file.path, &db, SQLITE_OPEN_READWRITE, nil)
        guard opened == SQLITE_OK else { throw failure(db, opened) }
        var statement: OpaquePointer?
        defer { sqlite3_finalize(statement) }
        let prepared = sqlite3_prepare_v2(db, "SELECT key, value FROM ItemTable", -1, &statement, nil)
        guard prepared == SQLITE_OK else { throw failure(db, prepared) }
        var items: [(key: String, value: String)] = []
        while true {
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW else { throw failure(db, step) }
            guard let keyText = sqlite3_column_text(statement, 0) else { continue }
            let key = String(cString: keyText)
            switch sqlite3_column_type(statement, 1) {
            case SQLITE_BLOB:
                // UTF-16LE code units; a lone surrogate (JavaScript strings can hold one) becomes U+FFFD, as in
                // `TWModel`'s parser, instead of losing the whole value.
                let count = Int(sqlite3_column_bytes(statement, 1)) / 2
                let units = sqlite3_column_blob(statement, 1).map {
                    Array(UnsafeBufferPointer(start: $0.assumingMemoryBound(to: UInt8.self), count: count * 2))
                } ?? []
                let utf16 = stride(from: 0, to: units.count, by: 2).map { UInt16(units[$0]) | UInt16(units[$0 + 1]) << 8 }
                items.append((key, String(decoding: utf16, as: UTF16.self)))
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
