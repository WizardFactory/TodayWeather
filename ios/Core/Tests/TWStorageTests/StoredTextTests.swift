import Foundation
import SQLite3
import Testing
import TWModel
@testable import TWStorage

/// Stored texts are parsed as strict JSON (`TWModel.JSONValue`, as `JSON.parse` reads what `JSON.stringify` wrote)
/// and stored strings and keys are compared by UTF-16 code units, as the Cordova code compares them. Swift `String`
/// equality would treat canonically equivalent texts (`"\u{E9}"`, `"e\u{301}"`) as one.
struct StoredTextTests {
    /// The number views follow kotlinx `JsonPrimitive` on the stored text, as the Android port does.
    @Test func numberViewsFollowTheStoredText() {
        #expect(CordovaMigration.int32(Fixtures.json(" 2 ")) == 2)
        #expect(CordovaMigration.int32(Fixtures.json("-0")) == 0)
        #expect(CordovaMigration.int32(Fixtures.json("2.0")) == nil) // Kotlin "2.0".toIntOrNull() is null
        #expect(CordovaMigration.int32(Fixtures.json("2147483648")) == nil)
        #expect(CordovaMigration.int32(Fixtures.json("\"2\"")) == nil)
        #expect(CordovaMigration.looseInt(Fixtures.json("\"2\"")) == 2)
        #expect(CordovaMigration.double(Fixtures.json("-0.13")) == -0.13)
        // JSON.parse reads 1e400 as Infinity; the coordinates check then rejects it, the list is not malformed.
        let state = Fixtures.migrate(CordovaSources(local: ["cities": #"[{"currentPosition":true,"location":{"lat":1e400,"long":0}}]"#]))
        #expect(state.places[0].location == nil)
        #expect(state.migration?.keys["cities"] == "migrated")
    }

    @Test func textsThatAreNotJSONAreMalformed() {
        for text in ["[1,]", "01", "undefined", "", "{'a':1}", "NaN", "1 2"] {
            let state = Fixtures.migrate(CordovaSources(local: ["cityIndex": text]))
            #expect(state.migration?.keys["cityIndex"] == "malformed", "\(text)")
        }
        // A repeated member keeps the last value, as JSON.parse does.
        #expect(Fixtures.migrate(CordovaSources(local: ["expandShortChart": "true",
                                                         "units": #"{"airUnit":"aircn","airUnit":"aqicn"}"#])).units.airUnit
                == "aqicn")
    }

    /// Two member names that differ only by normalization are two members, through the migration and the state
    /// file.
    @Test func canonicallyEquivalentKeysStayApart() throws {
        let nfc = "caf\u{E9}", nfd = "cafe\u{301}"
        #expect(nfc == nfd) // Swift String equality
        #expect(!JSString.equal(nfc, nfd))
        let cities = #"[{"currentPosition":true,"disable":true},{"name":"café","address":"a","café":1,"café":2,"loadTime":"x"}]"#
        let state = Fixtures.migrate(CordovaSources(local: ["cities": cities]))
        let kept = try #require(state.places[1].cordova)
        #expect(kept.count == 4) // name, address and both café keys; loadTime is a cache
        #expect(kept[nfc] == .number(1))
        #expect(kept[nfd] == .number(2))
        #expect(JSString.equal(try #require(state.places[1].name), nfd))
        #expect(state.places[1] != Place(currentPosition: false, disable: false, name: nfc, address: "a", cordova: kept))

        let stored = try AppStateStore.decode(AppStateStore.encode(state))
        #expect(stored == state)
        #expect(stored.places[1].cordova?.count == 4)
        #expect(JSString.equal(try #require(stored.places[1].name), nfd))
    }

    /// `address.indexOf("대한민국")` in `_getSimpleCityInfo` compares code units: a decomposed (NFD) address does
    /// not contain the precomposed word, so the Cordova code prefixes it again; Swift's `contains` would not.
    @Test func decomposedHangulFollowsIndexOf() throws {
        let address = "대한민국 서울특별시 중구 명동".decomposedStringWithCanonicalMapping
        let cities = "[{\"currentPosition\":true,\"disable\":true},{\"name\":\"명동\",\"source\":\"KMA\",\"address\":\"\(address)\"}]"
        let legacy = #"{"type":"ios","alarmList":[{"cityIndex":1,"time":0}]}"#
        let state = Fixtures.migrate(CordovaSources(local: ["cities": cities, "pushData": legacy]))
        let town = try #require(state.push.records.first?["town"]?.objectValue)
        let first = try #require(town["first"]?.stringValue)
        #expect(JSString.equal(first, "대한민국".decomposedStringWithCanonicalMapping))
        #expect(!JSString.equal(first, "서울특별시"))
        #expect(!JSString.equal(first, "대한민국"))
    }

    /// The database's keys are distinct by code units, and the migration takes only the exact names it reads.
    @Test func localStorageKeysAreMatchedByCodeUnits() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-ls-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("Library/WebKit/WebsiteData/LocalStorage/app_localhost_0.localstorage")
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try writeItems(file, [("caf\u{E9}", "1"), ("cafe\u{301}", "2"), ("cityIndex", "0"),
                              ("cities", #"[{"currentPosition":true}]"#)])
        let items = try WebKitLocalStorage.readItems(at: file)
        #expect(items.count == 4)
        let sources = try CordovaSources.read(dataContainer: dir, suite: [:])
        #expect(Set(sources.local.keys) == ["cityIndex", "cities"])
        #expect(Fixtures.migrate(sources).placeIndex == 0)
    }

    private func writeItems(_ file: URL, _ items: [(String, String)]) throws {
        var db: OpaquePointer?
        defer { sqlite3_close(db) }
        try #require(sqlite3_open(file.path, &db) == SQLITE_OK)
        try #require(sqlite3_exec(db, "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB NOT NULL ON CONFLICT FAIL)", nil, nil, nil) == SQLITE_OK)
        for (key, value) in items {
            var statement: OpaquePointer?
            try #require(sqlite3_prepare_v2(db, "INSERT INTO ItemTable VALUES (?, ?)", -1, &statement, nil) == SQLITE_OK)
            let units = Array(value.utf16)
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            sqlite3_bind_text16(statement, 1, Array(key.utf16), Int32(key.utf16.count * 2), transient)
            units.withUnsafeBytes { _ = sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32($0.count), transient) }
            try #require(sqlite3_step(statement) == SQLITE_DONE)
            sqlite3_finalize(statement)
        }
    }
}
