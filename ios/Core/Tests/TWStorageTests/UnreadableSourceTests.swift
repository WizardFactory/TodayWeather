import Foundation
import Testing
import TWModel
@testable import TWStorage

/// CODEX-IN03-1: a source that exists but cannot be read now (permissions, data protection) is not "absent". The
/// run stops without writing the state file, and a later run migrates the real state.
struct UnreadableSourceTests {
    static let frame = "Library/WebKit/WebsiteData/Default/f9AcWHYBxL6WjU1A4od9MQFyz7ECQ1l7U7Bh7K2PAss/f9AcWHYBxL6WjU1A4od9MQFyz7ECQ1l7U7Bh7K2PAss"

    /// A writable copy of the device-layout fixture (3 places in `localStorage`).
    private func container() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-unreadable-\(UUID().uuidString)")
        try FileManager.default.copyItem(at: Fixtures.container("device"), to: dir)
        return dir
    }

    private func setMode(_ url: URL, _ mode: Int) throws {
        try FileManager.default.setAttributes([.posixPermissions: mode], ofItemAtPath: url.path)
    }

    private func runner(_ dir: URL, _ store: AppStateStore) -> MigrationRunner {
        MigrationRunner(store: store, sources: { try CordovaSources.read(dataContainer: dir, suite: [:]) },
                        now: { Fixtures.now }, zone: { Fixtures.seoul }, region: { "KR" })
    }

    @Test(arguments: [
        "Library/WebKit", "Library/WebKit/WebsiteData", "Library/WebKit/WebsiteData/Default",
        String(frame.dropLast(44)), frame, frame + "/origin", frame + "/LocalStorage",
        frame + "/LocalStorage/localstorage.sqlite3", frame + "/LocalStorage/localstorage.sqlite3-wal",
    ])
    func anUnreadableSourceStopsTheRunUntilItCanBeRead(path: String) throws {
        let dir = try container()
        let target = dir.appendingPathComponent(path)
        let isDirectory = (try? target.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        let store = AppStateStore(url: dir.appendingPathComponent("Library/Application Support/TodayWeather/app_state.json"))
        try setMode(target, 0)
        defer {
            try? setMode(target, isDirectory ? 0o755 : 0o644)
            try? FileManager.default.removeItem(at: dir)
        }
        #expect(throws: (any Error).self) { _ = try runner(dir, store).runIfNeeded() }
        #expect(!FileManager.default.fileExists(atPath: store.url.path), "no state written while \(path) is unreadable")

        try setMode(target, isDirectory ? 0o755 : 0o644)
        let state = try runner(dir, store).runIfNeeded()
        #expect(state.places.count == 3)
        #expect(state.placeIndex == 2)
        #expect(state.migration?.source.hasPrefix("cities=localStorage") == true)
    }

    /// Genuine absence still migrates: no WebKit storage at all (an update from 1.0.10).
    @Test func noWebKitStorageIsAbsence() throws {
        let dir = try container()
        defer { try? FileManager.default.removeItem(at: dir) }
        try FileManager.default.removeItem(at: dir.appendingPathComponent("Library/WebKit"))
        #expect(try WebKitLocalStorage.locate(dataContainer: dir) == nil)
        let sources = try CordovaSources.read(dataContainer: dir, suite: Fixtures.suiteKeys("v1.0.10"))
        #expect(Fixtures.migrate(sources).places.count == 2)
    }

    @Test func anUnreadableStateDirectoryIsNotAbsence() throws {
        let dir = try container()
        let parent = dir.appendingPathComponent("Library/Application Support/TodayWeather")
        let store = AppStateStore(url: parent.appendingPathComponent("app_state.json"))
        try store.save(AppState(migration: MigrationInfo(source: "", migratedAtMillis: 1, keys: [:])))
        try setMode(parent, 0)
        defer {
            try? setMode(parent, 0o755)
            try? FileManager.default.removeItem(at: dir)
        }
        #expect(throws: AppStateStore.LoadError.self) { _ = try store.load() }
        #expect(throws: (any Error).self) { _ = try runner(dir, store).runIfNeeded() }
        try setMode(parent, 0o755)
        #expect(try store.load()?.migration?.migratedAtMillis == 1)
    }

    /// The suite: an unreadable preferences file, or no App Group container, stops the run; no file is absence.
    @Test func anUnreadableSuiteIsNotAbsence() throws {
        let group = FileManager.default.temporaryDirectory.appendingPathComponent("tw-group-\(UUID().uuidString)")
        let prefs = group.appendingPathComponent("Library/Preferences")
        try FileManager.default.createDirectory(at: prefs, withIntermediateDirectories: true)
        let name = "TWStorageTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer {
            defaults.removePersistentDomain(forName: name)
            try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: prefs.path)
            try? FileManager.default.removeItem(at: group)
        }
        defaults.set("1", forKey: "cityIndex")
        #expect(try CordovaSources.suiteValues(defaults, groupContainer: group)["cityIndex"] as? String == "1")
        #expect(throws: (any Error).self) { _ = try CordovaSources.suiteValues(defaults, groupContainer: nil) }

        let file = prefs.appendingPathComponent("\(CordovaMigration.suiteName).plist")
        try Data(contentsOf: Fixtures.root.appendingPathComponent("suites/current.plist")).write(to: file)
        try setMode(file, 0)
        #expect(throws: (any Error).self) { _ = try CordovaSources.suiteValues(defaults, groupContainer: group) }
        try setMode(file, 0o644)
        try setMode(prefs, 0)
        #expect(throws: (any Error).self) { _ = try CordovaSources.suiteValues(defaults, groupContainer: group) }
    }

    /// `CDVUUID`: an unreadable standard preferences file must not lead to a new identifier.
    @Test func anUnreadablePreferencesFileCreatesNoDeviceId() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-prefs-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let name = "TWStorageTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        let file = dir.appendingPathComponent("net.wizardfactory.todayweather.plist")
        defer {
            defaults.removePersistentDomain(forName: name)
            try? FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
            try? FileManager.default.removeItem(at: dir)
        }
        try PropertyListSerialization.data(fromPropertyList: ["CDVUUID": "A"], format: .binary, options: 0).write(to: file)
        try setMode(file, 0)
        #expect(throws: (any Error).self) { _ = try DeviceIdentity.deviceId(defaults: defaults, preferencesFile: file) { UUID() } }
        #expect(defaults.object(forKey: "CDVUUID") == nil)

        // A readable file without the key, or no file: the identifier is created as the plugin does.
        try setMode(file, 0o644)
        let vendor = UUID()
        #expect(try DeviceIdentity.deviceId(defaults: defaults, preferencesFile: file) { vendor } == vendor.uuidString)
        try FileManager.default.removeItem(at: file)
        #expect(try DeviceIdentity.deviceId(defaults: defaults, preferencesFile: file) { UUID() } == vendor.uuidString)
    }
}

/// CODEX-IN03-2: record times must be ASCII ISO instants, as Kotlin's `\d` (ASCII) accepts; other digits drop the
/// record instead of crashing the start.
struct RecordTimeTests {
    static let nonASCII = [
        "٢٠٢٦-١١-١٣T٠٧:٠٠:٠٠Z",              // Arabic-Indic
        "２０２６-１１-１３T０７:００:００.０００Z", // fullwidth
        "२०२६-११-१३T०७:००:००Z",              // Devanagari
        "2026-11-1३T07:00:00Z",              // one non-ASCII digit
    ]

    @Test(arguments: nonASCII) func nonASCIIDigitsAreNoInstant(text: String) {
        #expect(!CordovaMigration.validInstant(text))
    }

    @Test(arguments: nonASCII) func aRecordWithNonASCIIDigitsIsDropped(text: String) throws {
        let push = """
        {"type":"ios","pushList":[
         {"cityIndex":1,"id":1,"category":"alert","enable":true,"startTime":"2026-11-12T22:00:00.000Z","endTime":"2026-11-13T13:00:00.000Z"},
         {"cityIndex":1,"id":2,"category":"alarm","enable":true,"time":"\(text)","dayOfWeek":[true,true,true,true,true,true,true]},
         {"cityIndex":1,"id":3,"category":"alert","enable":true,"startTime":"\(text)","endTime":"2026-11-13T13:00:00.000Z"}
        ]}
        """
        let cities = #"[{"currentPosition":true,"disable":true},{"name":"A","address":"a"}]"#
        let state = Fixtures.migrate(CordovaSources(local: ["cities": cities, "cityIndex": "1", "pushData2": push]))
        #expect(state.push.records.map { $0["id"] } == [.number(1)])
        #expect(state.migration?.keys["pushData2"] == "partial")
        #expect(state.migration?.keys["pushData2.records"] == "2 dropped, 0 orphan")
        #expect(state.places.count == 2)
        #expect(state.placeIndex == 1)
    }

    /// A legacy alarm time with non-ASCII digits is no ISO text (Kotlin's ASCII `\d`): the time becomes null.
    @Test(arguments: nonASCII) func aLegacyTimeWithNonASCIIDigitsBecomesNull(text: String) throws {
        let legacy = "{\"alarmList\":[{\"cityIndex\":0,\"time\":\"\(text)\"}]}"
        let state = Fixtures.migrate(CordovaSources(local: ["pushData": legacy]))
        try #require(state.push.records.count == 2)
        #expect(state.push.records[1]["time"] == .null)
    }
}
