import Foundation
import TWModel

/// The app state file, `Library/Application Support/TodayWeather/app_state.json`. Every save replaces the whole
/// file atomically (written to a temporary file, then renamed), so a reader sees the old or the new state.
public struct AppStateStore: Sendable {
    public enum LoadError: Error {
        /// The file exists but cannot be read now (for example data protection before the first unlock).
        case unavailable(String)
        /// The file was read but is not an app state.
        case corrupt(String)
    }

    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    /// The store in the app's Application Support directory.
    public static func standard() throws -> AppStateStore {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                  appropriateFor: nil, create: true)
        return AppStateStore(url: support.appendingPathComponent("TodayWeather/app_state.json"))
    }

    /// The stored state, or nil when none was saved yet.
    public func load() throws(LoadError) -> AppState? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw .unavailable("\(error)")
        }
        do {
            return try AppState(json: JSONValue.parse(data))
        } catch {
            throw .corrupt("\(error)")
        }
    }

    public func save(_ state: AppState) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Self.encode(state).write(to: url, options: .atomic)
    }

    /// The file contents for `state`: compact JSON with members in a fixed order and the Cordova values in their
    /// own order and number texts, so the same state always gives the same bytes.
    public static func encode(_ state: AppState) -> Data {
        Data(state.json.jsonText.utf8)
    }

    /// The state in `data` (the inverse of `encode`).
    public static func decode(_ data: Data) throws -> AppState {
        try AppState(json: JSONValue.parse(data))
    }
}

/// Runs the Cordova migration once: a stored state that records a migration is returned unchanged, whatever the
/// sources or the clock say later. Without one, the sources are read (only read), migrated and saved. A state file
/// that exists but is not readable now stops the run (nothing is written), so a later start tries again; a corrupt
/// file is replaced by a new migration. IN-17 adds the rollback hand-back.
public struct MigrationRunner: Sendable {
    let store: AppStateStore
    let sources: @Sendable () throws -> CordovaSources
    let now: @Sendable () -> Date
    let zone: @Sendable () -> TimeZone
    let region: @Sendable () -> String?

    public init(store: AppStateStore, sources: @escaping @Sendable () throws -> CordovaSources,
                now: @escaping @Sendable () -> Date = Date.init,
                zone: @escaping @Sendable () -> TimeZone = { TimeZone.current },
                region: @escaping @Sendable () -> String?) {
        self.store = store
        self.sources = sources
        self.now = now
        self.zone = zone
        self.region = region
    }

    /// The state after the migration; a second call changes nothing.
    public func runIfNeeded() throws -> AppState {
        do {
            if let state = try store.load(), state.migration != nil { return state }
        } catch .corrupt {
            // migrate again below
        }
        let state = CordovaMigration.migrate(try sources(), region: region(), now: now(), zone: zone())
        try store.save(state)
        return state
    }
}

extension CordovaSources {
    /// Reads the Cordova storage of the app whose data container is `dataContainer`: the `localStorage` database
    /// of `app://localhost` and `suite` (the App Group suite). An existing database that cannot be copied throws
    /// (`WebKitLocalStorage.ReadError.unavailable`), so the migration waits; an unreadable copy counts as no
    /// `localStorage` and is recorded.
    public static func read(dataContainer: URL, suite: [String: Any]) throws -> CordovaSources {
        var sources = CordovaSources(suite: suite.mapValues(SuiteValue.from))
        guard let database = WebKitLocalStorage.locate(dataContainer: dataContainer) else { return sources }
        sources.localStorageFile = database.relativePath
        do {
            // Only the keys the migration reads, matched by UTF-16 code units as localStorage keys are.
            let wanted = suiteKeys + ["startupPage", "refreshInterval"]
            for (key, value) in try WebKitLocalStorage.readItems(at: database.url) {
                if let name = wanted.first(where: { JSString.equal($0, key) }) { sources.local[name] = value }
            }
        } catch WebKitLocalStorage.ReadError.unreadable(let reason) {
            sources.localStorageFile = "\(database.relativePath) (unreadable: \(reason))"
        }
        return sources
    }

    /// The suite's values for `suiteKeys`, from `UserDefaults(suiteName: CordovaMigration.suiteName)`.
    public static func suiteValues(_ defaults: UserDefaults) -> [String: Any] {
        var values: [String: Any] = [:]
        for key in suiteKeys {
            if let value = defaults.object(forKey: key) { values[key] = value }
        }
        return values
    }
}
