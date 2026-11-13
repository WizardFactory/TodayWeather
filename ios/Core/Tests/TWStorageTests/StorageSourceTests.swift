import CryptoKit
import Foundation
import Testing
@testable import TWStorage

/// Reading the WebKit `localStorage` files (each layout), the state file and `Device-Id`.
struct WebKitLocalStorageTests {
    @Test func perOriginLayoutOnTheSimulator() throws {
        let db = try #require(WebKitLocalStorage.locate(dataContainer: Fixtures.container("simulator")))
        #expect(db.layout == .origins)
        #expect(db.relativePath.hasPrefix("Library/WebKit/net.wizardfactory.todayweather/WebsiteData/Default/"))
        let items = try WebKitLocalStorage.readItems(at: db.url)
        // The newest writes are only in the write-ahead log of the captured database.
        #expect(Set(items.keys) == ["cities", "cityIndex", "cityList", "daumServiceKeys", "units", "settingsInfo",
                                    "expandShortChart", "startVersion", "pushData2", "twAnalyticsConsentV1"])
        #expect(items["cityIndex"] == "2")
        #expect(items["settingsInfo"] == #"{"startupPage":"1","refreshInterval":"30","theme":"dark"}"#)
        #expect(items["cities"]?.contains("명동") == true)
    }

    @Test func perOriginLayoutOnADevice() throws {
        let db = try #require(WebKitLocalStorage.locate(dataContainer: Fixtures.container("device")))
        #expect(db.layout == .origins)
        #expect(db.relativePath.hasPrefix("Library/WebKit/WebsiteData/Default/"))
        #expect(try WebKitLocalStorage.readItems(at: db.url)["cityIndex"] == "2")
    }

    @Test func singleDirectoryLayout() throws {
        let db = try #require(WebKitLocalStorage.locate(dataContainer: Fixtures.container("legacy")))
        #expect(db.layout == .legacy)
        let items = try WebKitLocalStorage.readItems(at: db.url)
        #expect(items["guideVersion"] == "1")
        #expect(items["startupPage"] == "2")
        #expect(items["cities"]?.contains("부산") == true)
    }

    @Test func anotherOriginIsNotRead() {
        #expect(WebKitLocalStorage.locate(dataContainer: Fixtures.container("other-origin")) == nil)
        #expect(WebKitLocalStorage.locate(dataContainer: Fixtures.container("none")) == nil)
    }

    @Test func originFile() throws {
        let simulator = try #require(WebKitLocalStorage.locate(dataContainer: Fixtures.container("simulator")))
        let data = try Data(contentsOf: simulator.url.deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("origin"))
        let app = OriginFile.Origin(scheme: "app", host: "localhost", port: nil)
        #expect(OriginFile.parse(data) == [app, app])
        #expect(OriginFile.parse(data.dropLast()) == nil)
        var withPort = Data([5, 0, 0, 0, 1]) + Data("https".utf8) + Data([9, 0, 0, 0, 1]) + Data("localhost".utf8)
        withPort += Data([1, 0x50, 0x1F])
        #expect(OriginFile.parse(withPort + withPort)?.first == OriginFile.Origin(scheme: "https", host: "localhost", port: 8016))
    }

    /// The migration only reads: the WebKit files keep their bytes and no file is added next to them.
    @Test func readingLeavesTheSourceUnchanged() throws {
        let dir = Fixtures.container("simulator")
        let before = try snapshot(dir)
        _ = try CordovaSources.read(dataContainer: dir, suite: [:])
        #expect(try snapshot(dir) == before)
    }

    @Test func aDatabaseThatIsNotSQLiteIsUnreadable() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-ls-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let db = dir.appendingPathComponent("Library/WebKit/WebsiteData/LocalStorage/app_localhost_0.localstorage")
        try FileManager.default.createDirectory(at: db.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("not a database".utf8).write(to: db)
        let sources = try CordovaSources.read(dataContainer: dir, suite: ["cityIndex": "1"])
        #expect(sources.local.isEmpty)
        #expect(sources.localStorageFile?.contains("(unreadable:") == true)
        #expect(sources.suite["cityIndex"] == .string("1"))
    }

    private func snapshot(_ dir: URL) throws -> [String: String] {
        var out: [String: String] = [:]
        let files = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: nil)!
        for case let url as URL in files where !url.hasDirectoryPath {
            out[url.path] = SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
        }
        return out
    }
}

struct MigrationRunnerTests {
    private func tempStore() -> AppStateStore {
        AppStateStore(url: FileManager.default.temporaryDirectory
            .appendingPathComponent("tw-state-\(UUID().uuidString)/TodayWeather/app_state.json"))
    }

    private func runner(_ store: AppStateStore, _ sources: @escaping @Sendable () throws -> CordovaSources,
                        now: Date = Fixtures.now) -> MigrationRunner {
        MigrationRunner(store: store, sources: sources, now: { now }, zone: { Fixtures.seoul }, region: { "KR" })
    }

    @Test func runsOnceAndASecondRunChangesNothing() throws {
        let store = tempStore()
        defer { try? FileManager.default.removeItem(at: store.url.deletingLastPathComponent().deletingLastPathComponent()) }
        let container = Fixtures.container("simulator")
        let suite = Fixtures.suiteKeys("current").mapValues(SuiteValue.from)
        let first = try runner(store) {
            var s = try CordovaSources.read(dataContainer: container, suite: [:])
            s.suite = suite
            return s
        }.runIfNeeded()
        let bytes = try Data(contentsOf: store.url)
        #expect(first.placeIndex == 2)

        // Later starts return the stored state, even when the sources or the clock changed.
        let again = try runner(store, { CordovaSources(local: ["cityIndex": "0"]) },
                               now: Fixtures.now.addingTimeInterval(3600)).runIfNeeded()
        #expect(again == first)
        #expect(try Data(contentsOf: store.url) == bytes)
        #expect(try store.load() == first)
    }

    @Test func aStateThatCannotBeReadStopsTheRun() throws {
        let store = tempStore()
        let root = store.url.deletingLastPathComponent().deletingLastPathComponent()
        defer { try? FileManager.default.removeItem(at: root) }
        try store.save(AppState(migration: MigrationInfo(source: "", migratedAtMillis: 1, keys: [:])))
        try FileManager.default.setAttributes([.posixPermissions: 0], ofItemAtPath: store.url.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: store.url.path) }
        #expect(throws: AppStateStore.LoadError.self) {
            _ = try runner(store) { CordovaSources(local: ["cityIndex": "0"]) }.runIfNeeded()
        }
    }

    @Test func aSourceThatCannotBeReadWritesNothing() throws {
        let store = tempStore()
        struct Unavailable: Error {}
        #expect(throws: Unavailable.self) { _ = try runner(store) { throw Unavailable() }.runIfNeeded() }
        #expect(!FileManager.default.fileExists(atPath: store.url.path))
    }

    @Test func aCorruptStateIsMigratedAgain() throws {
        let store = tempStore()
        defer { try? FileManager.default.removeItem(at: store.url.deletingLastPathComponent().deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: store.url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{".utf8).write(to: store.url)
        let state = try runner(store) { CordovaSources(local: ["expandShortChart": "true"]) }.runIfNeeded()
        #expect(state.expandShortChart)
        #expect(try store.load() == state)
    }
}

struct DeviceIdentityTests {
    private func defaults() -> (UserDefaults, String) {
        let name = "TWStorageTests.\(UUID().uuidString)"
        return (UserDefaults(suiteName: name)!, name)
    }

    @Test func theStoredCordovaValueIsKept() {
        let (d, name) = defaults()
        defer { d.removePersistentDomain(forName: name) }
        d.set("2DB8F90F-9B44-4F2C-8DF8-5403EE530A0E", forKey: "CDVUUID")
        var asked = false
        let id = DeviceIdentity.deviceId(defaults: d) { asked = true; return UUID() }
        #expect(id == "2DB8F90F-9B44-4F2C-8DF8-5403EE530A0E")
        #expect(!asked)
    }

    @Test func anAbsentValueIsCreatedFromTheVendorIdentifier() {
        let (d, name) = defaults()
        defer { d.removePersistentDomain(forName: name) }
        let vendor = UUID()
        #expect(DeviceIdentity.deviceId(defaults: d) { vendor } == vendor.uuidString)
        #expect(d.string(forKey: "CDVUUID") == vendor.uuidString)
        #expect(DeviceIdentity.deviceId(defaults: d) { UUID() } == vendor.uuidString)
    }

    @Test func withoutAVendorIdentifierNothingIsStored() {
        let (d, name) = defaults()
        defer { d.removePersistentDomain(forName: name) }
        #expect(DeviceIdentity.deviceId(defaults: d) { nil } == nil)
        #expect(d.object(forKey: "CDVUUID") == nil)
    }
}

struct JSONValueTests {
    @Test func parsesAsJSONParseDoes() {
        #expect(JSONValue.parse(" 2 ") == .int(2))
        #expect(JSONValue.parse("2.0") == .int(2))
        #expect(JSONValue.parse("-0.13") == .double(-0.13))
        #expect(JSONValue.parse("1e400") == nil)
        #expect(JSONValue.parse("\"\\ud83c\\udf27 \\u00e9\"") == .string("🌧 é"))
        #expect(JSONValue.parse("\"\\ud83c\"") == .string("\u{FFFD}"))
        #expect(JSONValue.parse(#"{"a":1,"a":2}"#) == .object(["a": .int(2)]))
        #expect(JSONValue.parse("[1,]") == nil)
        #expect(JSONValue.parse("") == nil)
        #expect(JSONValue.parse("01") == nil)
        #expect(JSONValue.parse("undefined") == nil)
        #expect(JSONValue.parse("2147483648")?.int32Value == nil)
    }
}
