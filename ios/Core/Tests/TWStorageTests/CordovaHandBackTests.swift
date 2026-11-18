import Foundation
import Testing
import TWModel
@testable import TWStorage

/// The hand-back to a fallback Cordova build (IN-17, #2966; the Android `CordovaHandBackTest` of AN-17): the native state
/// in the texts the Cordova app writes, the contract's marker and the native start's re-migration after the fallback
/// build claimed the state.
struct CordovaHandBackTests {
    static let cities = #"[{"currentPosition":true,"address":null,"location":null,"currentWeather":null,"timeTable":null,"timeChart":null,"dayTable":null,"dayChart":null,"disable":true,"photo":null,"loadTime":null},"#
        + #"{"name":"명동","address":"대한민국 서울특별시 중구 명동","country":"KR","location":{"lat":37.56,"long":126.98},"currentPosition":false,"disable":false,"loadTime":"2026-11-07T16:09:45.810Z","photo":null,"source":"KMA","currentWeather":{"t1h":3},"index":1},"#
        + #"{"name":"London","address":"United Kingdom London","country":"GB","location":{"lat":51.51,"long":-0.13},"currentPosition":false,"disable":false,"photo":null}]"#
    static let push = #"{"registrationId":null,"type":"ios","category":"","fcmToken":"token-a","pushList":["#
        + #"{"cityIndex":1,"id":1,"startTime":"2026-11-07T22:00:00.000Z","endTime":"2026-11-08T13:00:00.000Z","enable":true,"category":"alert","name":"명동"},"#
        + #"{"cityIndex":1,"id":2,"time":"2026-11-07T22:40:00.000Z","dayOfWeek":[false,true,true,true,true,true,false],"enable":true,"category":"alarm"},"#
        + #"{"cityIndex":2,"id":2,"time":"2026-11-07T21:00:00.000Z","dayOfWeek":[true,true,true,true,true,true,true],"enable":false,"category":"alarm"}]}"#
    static let cordova: [String: String] = [
        "cities": cities, "cityIndex": "2",
        "units": #"{"temperatureUnit":"F","windSpeedUnit":"km/h","pressureUnit":"hPa","distanceUnit":"km","precipitationUnit":"mm","airUnit":"airnow"}"#,
        "settingsInfo": #"{"startupPage":"1","refreshInterval":"30","theme":"dark"}"#,
        "pushData2": push, "expandShortChart": "true", "startVersion": "1", "appVersion": #""1.1.1""#,
    ]

    static func migrate(_ local: [String: String]) -> AppState {
        Fixtures.migrate(CordovaSources(local: local))
    }

    static func dictionary(_ texts: [(key: String, text: String?)]) -> [String: String?] {
        Dictionary(uniqueKeysWithValues: texts.map { ($0.key, $0.text) })
    }

    /// The text parsed; `null` for no text or one that does not parse.
    static func json(_ text: String??) -> JSONValue { ((text ?? nil).flatMap { try? JSONValue.parse($0) }) ?? .null }

    @Test func aStateIsHandedBackInTheTextsTheCordovaAppWrites() throws {
        let list = CordovaHandBack.texts(Self.migrate(Self.cordova), consent: "false")
        #expect(list.map(\.key) == CordovaHandBack.keys)
        let texts = Self.dictionary(list)
        let handed = try #require(Self.json(texts["cities"]).arrayValue).compactMap(\.objectValue)
        try #require(handed.count == 3)
        // The record the Cordova app kept, without its caches; the caches empty as `createCity` leaves them.
        #expect(handed[1]["index"] == .number(1), "a field the native app does not know survives")
        for key in ["currentWeather", "timeTable", "timeChart", "dayTable", "dayChart"] {
            #expect(handed[1][key] == .null, "\(key)")
        }
        #expect(handed[1]["name"] == "명동")
        #expect(handed[2]["location"] == Fixtures.json(#"{"lat":51.51,"long":-0.13}"#))
        #expect(handed[0]["disable"] == .bool(true))
        #expect(texts["cityIndex"] == "2")
        // `_saveCitiesPreference`: the enabled places only, with their index.
        let summary = try #require(Self.json(texts["cityList"])["cityList"]?.arrayValue).compactMap(\.objectValue)
        #expect(summary.compactMap { $0["index"]?.numberValue?.text } == ["1", "2"])
        #expect(summary[0].keys == ["name", "currentPosition", "address", "location", "country", "index"])
        // The texts the Cordova app writes, member order included.
        #expect(texts["units"] == Self.cordova["units"])
        #expect(texts["settingsInfo"] == Self.cordova["settingsInfo"])
        #expect(texts["pushData2"] == Self.push)
        #expect(texts["pushData"] == .some(nil), "legacy alarms are removed: they live in pushData2")
        #expect(texts["expandShortChart"] == "true")
        #expect(texts["startVersion"] == "1")
        #expect(texts["appVersion"] == #""1.1.1""#)
        #expect(texts["disableUpdateInfo"] == .some(nil), "a key the state lacks is removed")
        #expect(texts["twAnalyticsConsentV1"] == "false")
        let none = Self.dictionary(CordovaHandBack.texts(Self.migrate(Self.cordova), consent: nil))
        #expect(none["twAnalyticsConsentV1"] == .some(nil))
        let other = Self.dictionary(CordovaHandBack.texts(Self.migrate(Self.cordova), consent: "1"))
        #expect(other["twAnalyticsConsentV1"] == .some(nil), "only a choice Monetization writes")
    }

    @Test func theTextsMigrateBackToTheSameState() {
        let state = Self.migrate(Self.cordova)
        let texts = CordovaHandBack.texts(state, consent: "true")
        var local: [String: String] = [:]
        for (key, text) in texts { if let text { local[key] = text } }
        let again = Self.migrate(local)
        func bare(_ places: [Place]) -> [Place] { places.map { var p = $0; p.cordova = nil; return p } }
        #expect(bare(again.places) == bare(state.places))
        #expect(again.placeIndex == state.placeIndex)
        #expect(again.units == state.units)
        #expect(again.settings == state.settings)
        #expect(again.push == state.push)
        #expect(again.expandShortChart == state.expandShortChart)
        #expect(again.cordovaExtras == state.cordovaExtras)
        let second = CordovaHandBack.texts(again, consent: "true")
        #expect(second.map(\.key) == texts.map(\.key))
        #expect(second.map(\.text) == texts.map(\.text), "a second hand-back writes the same texts")
    }

    @Test func placesAndAlarmsDeletedInTheNativeAppAreNotHandedBack() throws {
        var state = Self.migrate(Self.cordova)
        // London removed in S02 with its alarms (IN-11); an alarm of 명동 deleted on S09 stays disabled (IN-14).
        state.places.remove(at: 2)
        state.placeIndex = 1
        state.push.records = state.push.records.filter { PushRecords.cityIndex($0) != 2 }.map {
            PushRecords.id($0) == 2 ? $0.setting("enable", .bool(false)) : $0
        }
        let texts = Self.dictionary(CordovaHandBack.texts(state, consent: nil))
        let names = try #require(Self.json(texts["cities"]).arrayValue).map { $0["name"]?.stringValue }
        #expect(names == [nil, "명동"])
        let list = try #require(Self.json(texts["pushData2"])["pushList"]?.arrayValue).compactMap(\.objectValue)
        #expect(list.compactMap(PushRecords.cityIndex) == [1, 1])
        #expect(list[1]["enable"] == .bool(false))
        let summary = try #require(Self.json(texts["cityList"])["cityList"]?.arrayValue)
        #expect(summary.compactMap { $0["index"]?.numberValue?.text } == ["1"])
    }

    @Test func aNameTheNativeAppGaveIsHandedBackAndAnAbsentOneAddsNoKey() throws {
        let state = Self.migrate(Self.cordova)
        var named = state
        named.places[0].name = "회현동"
        named.places[0].disable = false
        let first = try #require(Self.json(Self.dictionary(CordovaHandBack.texts(named, consent: nil))["cities"])[0]?.objectValue)
        #expect(first["name"] == "회현동")
        #expect(first["disable"] == .bool(false))
        let plain = try #require(Self.json(Self.dictionary(CordovaHandBack.texts(state, consent: nil))["cities"])[0]?.objectValue)
        #expect(!plain.contains("name"), "createCity's placeholder has no name")
        // A place added in the native app has no Cordova record: createCity's caches, then its fields.
        var added = state
        added.places.append(Place(currentPosition: false, disable: false, name: "부산", address: "대한민국 부산광역시",
                                  country: "KR", location: Location(lat: 35.18, long: 129.08), source: "KMA"))
        let busan = try #require(Self.json(Self.dictionary(CordovaHandBack.texts(added, consent: nil))["cities"])[3])
        #expect(busan.jsonText == #"{"currentWeather":null,"timeTable":null,"timeChart":null,"dayTable":null,"dayChart":null,"#
            + #""currentPosition":false,"disable":false,"name":"부산","address":"대한민국 부산광역시","country":"KR","#
            + #""location":{"lat":35.18,"long":129.08},"source":"KMA"}"#)
    }

    @Test func theMarkerOrdersTheHandOvers() {
        let text = CordovaHandBack.markerText(generation: 4, writer: CordovaHandBack.native)
        #expect(text == #"{"schema":1,"generation":4,"writer":"native","complete":true,"keys":["cities","cityIndex","cityList","units","settingsInfo","pushData2","pushData","expandShortChart","startVersion","appVersion","disableUpdateInfo","twAnalyticsConsentV1"]}"#)
        #expect(CordovaHandBack.parse(text) == CordovaHandBack.Marker(schema: 1, generation: 4, writer: "native", complete: true,
                                                                    keys: CordovaHandBack.keys))
        #expect(CordovaHandBack.parse(CordovaHandBack.markerText(generation: 5, writer: "native", complete: false))?.complete == false)
        #expect(CordovaHandBack.nextGeneration(nil) == 1)
        #expect(CordovaHandBack.nextGeneration(text) == 5)
        #expect(CordovaHandBack.nextGeneration("{broken") == 1, "an unreadable marker starts over")
        #expect(CordovaHandBack.parse("{broken") == nil)
        #expect(CordovaHandBack.parse(#"{"schema":1,"writer":"native","complete":true,"keys":[]}"#) == nil, "no generation")
        #expect(CordovaHandBack.parse(#"{"schema":"1","generation":2,"writer":"native","complete":true,"keys":[]}"#) == nil)
    }

    @Test func onlyAClaimByTheFallbackBuildMakesTheNativeAppMigrateAgain() {
        func claim(schema: Int = 1, writer: String = "cordova", complete: Bool = true) -> String {
            #"{"schema":\#(schema),"generation":6,"writer":"\#(writer)","complete":\#(complete),"keys":[]}"#
        }
        #expect(CordovaHandBack.cordovaClaim(claim())?.generation == 6)
        #expect(CordovaHandBack.cordovaClaim(claim(writer: "native")) == nil)
        #expect(CordovaHandBack.cordovaClaim(claim(complete: false)) == nil, "partial: the stored state stays")
        #expect(CordovaHandBack.cordovaClaim(claim(schema: 2)) == nil, "a schema this build does not know")
        #expect(CordovaHandBack.cordovaClaim(nil) == nil)
        #expect(CordovaHandBack.cordovaClaim("not json") == nil)
    }

    /// Mutable inputs of a runner (its closures are `@Sendable`).
    final class Inputs: @unchecked Sendable {
        var local: [String: String]
        var marker: String?
        var now: Date
        init(local: [String: String], marker: String?, now: Date) {
            self.local = local
            self.marker = marker
            self.now = now
        }
    }

    static func runner(_ store: AppStateStore, _ inputs: Inputs) -> MigrationRunner {
        MigrationRunner(store: store, sources: { CordovaSources(local: inputs.local) }, now: { inputs.now },
                        zone: { Fixtures.seoul }, region: { "KR" }, marker: { inputs.marker })
    }

    static func tempStore() -> AppStateStore {
        AppStateStore(url: FileManager.default.temporaryDirectory
            .appendingPathComponent("tw-handback-\(UUID().uuidString)/TodayWeather/app_state.json"))
    }

    @Test func theNativeStartMigratesAgainAfterTheFallbackBuildClaimedTheState() throws {
        let store = Self.tempStore()
        defer { try? FileManager.default.removeItem(at: store.url.deletingLastPathComponent().deletingLastPathComponent()) }
        let inputs = Inputs(local: Self.cordova, marker: nil, now: Fixtures.now)
        let runner = Self.runner(store, inputs)
        let first = try runner.runIfNeeded()
        #expect(first.places.count == 3)
        #expect(first.migration?.handBackGeneration == nil)
        // The native app handed back (writer native): a later start keeps the stored state.
        var fewer = Self.cordova
        fewer["cities"] = String(Self.cities[..<Self.cities.range(of: #",{"name":"London""#)!.lowerBound]) + "]"
        fewer["cityIndex"] = "1"
        inputs.local = fewer
        inputs.marker = CordovaHandBack.markerText(generation: 3, writer: CordovaHandBack.native)
        inputs.now = Fixtures.now.addingTimeInterval(60)
        #expect(try runner.runIfNeeded() == first)
        // A native hand-back being written (incomplete) is no claim either.
        inputs.marker = CordovaHandBack.markerText(generation: 4, writer: CordovaHandBack.native, complete: false)
        #expect(try runner.runIfNeeded() == first)
        // The fallback build claimed it (writer cordova): its storage migrates again, as of now.
        inputs.marker = #"{"schema":1,"generation":4,"writer":"cordova","complete":true,"keys":[]}"#
        let again = try runner.runIfNeeded()
        #expect(again.places.count == 2)
        #expect(again.placeIndex == 1)
        #expect(again.migration?.migratedAtMillis == Int64(Fixtures.now.timeIntervalSince1970 * 1000) + 60_000)
        #expect(again.migration?.handBackGeneration == 4)
        #expect(try store.load() == again, "saved, generation included")
        // The same claim again (the hand-back not yet written): the adopted state stays.
        inputs.now = Fixtures.now.addingTimeInterval(120)
        #expect(try runner.runIfNeeded() == again)
        // An incomplete claim leaves the stored state.
        inputs.local = Self.cordova
        inputs.marker = #"{"schema":1,"generation":5,"writer":"cordova","complete":false,"keys":[]}"#
        #expect(try runner.runIfNeeded() == again)
    }

    @Test func theFirstMigrationAdoptsTheClaimItFinds() throws {
        // A Cordova build with the hand-back claims the state at each start; the native app is then installed over it.
        let store = Self.tempStore()
        defer { try? FileManager.default.removeItem(at: store.url.deletingLastPathComponent().deletingLastPathComponent()) }
        let inputs = Inputs(local: Self.cordova, marker: #"{"schema":1,"generation":1,"writer":"cordova","complete":true,"keys":[]}"#,
                            now: Fixtures.now)
        let runner = Self.runner(store, inputs)
        let first = try runner.runIfNeeded()
        #expect(first.migration?.handBackGeneration == 1)
        // A start before the first hand-back was written keeps the state.
        inputs.local["cityIndex"] = "1"
        inputs.now = Fixtures.now.addingTimeInterval(60)
        #expect(try runner.runIfNeeded() == first)
    }

    @Test func aStateFileWithoutAClaimKeepsItsBytes() throws {
        // The generation is written only with a claim, so the files of earlier builds and states without one stay as
        // they were; a state with one reads back equal.
        var state = Self.migrate(Self.cordova)
        let bytes = AppStateStore.encode(state)
        #expect(!String(decoding: bytes, as: UTF8.self).contains("handBackGeneration"))
        state.migration?.handBackGeneration = 7
        #expect(try AppStateStore.decode(AppStateStore.encode(state)) == state)
        #expect(try AppStateStore.decode(bytes).migration?.handBackGeneration == nil)
    }
}
