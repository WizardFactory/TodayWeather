import Foundation
import Testing
@testable import TWStorage

/// The per-key rules of `CordovaMigration` (android/README.md "Data migration from the Cordova app"), on valid,
/// partial, malformed, suite-only and legacy-`pushData` inputs.
struct CordovaMigrationTests {
    // MARK: Valid

    /// The captured 1.1.1 state: localStorage of the simulator layout, the App Group suite as the app left it.
    @Test func validStateMigratesFromLocalStorage() throws {
        let sources = try CordovaSources.read(dataContainer: Fixtures.container("simulator"),
                                              suite: Fixtures.suiteKeys("current"))
        let state = Fixtures.migrate(sources)

        try #require(state.places.count == 3)
        #expect(state.places[0] == Place(currentPosition: true, disable: true, cordova: state.places[0].cordova))
        #expect(state.places[1].name == "명동")
        #expect(state.places[1].address == "대한민국 서울특별시 중구 명동")
        #expect(state.places[1].location == Location(lat: 37.56, long: 126.98))
        #expect(state.places[1].source == "KMA")
        #expect(state.places[1].disable == false)
        #expect(state.places[2].name == "London")
        #expect(state.places[2].location == Location(lat: 51.51, long: -0.13))
        // Weather caches and loadTime are dropped from the kept Cordova record.
        #expect(state.places[1].cordova?["loadTime"] == nil)
        #expect(state.places[0].cordova?["currentWeather"] == nil)
        #expect(state.places[1].cordova?["country"] == .string("KR"))
        #expect(state.placeIndex == 2)
        #expect(state.units == UnitSettings(temperatureUnit: "F", windSpeedUnit: "km/h", pressureUnit: "hPa",
                                            distanceUnit: "km", precipitationUnit: "mm", airUnit: "airnow"))
        #expect(state.settings == Settings(startupPage: "1", refreshInterval: "30", theme: "dark"))
        #expect(state.expandShortChart)
        #expect(state.cordovaExtras == Fixtures.obj(["startVersion": .number(1)]))
        #expect(state.push.type == "ios")
        #expect(state.push.fcmToken == "token-a")
        #expect(state.push.needsAlertIntro == false)
        try #require(state.push.records.count == 4)
        #expect(state.push.records.map { $0["category"] } == [.string("alert"), .string("alarm"), .string("alarm"),
                                                               .string("alarm")])
        #expect(state.push.records[1]["time"] == .string("2026-11-12T22:40:00.000Z"))
        #expect(state.push.records[1]["dayOfWeek"] == Fixtures.json("[false,true,true,true,true,true,false]"))
        #expect(state.push.records[0]["town"]?["third"] == .string("명동"))

        let info = try #require(state.migration)
        #expect(info.source == "cities=localStorage,cityIndex=localStorage,units=localStorage,"
                + "settingsInfo=localStorage,pushData2=localStorage,expandShortChart=localStorage,"
                + "startVersion=localStorage")
        #expect(info.keys["cities"] == "migrated")
        #expect(info.keys["cityIndex"] == "migrated")
        #expect(info.keys["units"] == "migrated")
        #expect(info.keys["settingsInfo"] == "migrated")
        #expect(info.keys["pushData2"] == "migrated")
        #expect(info.keys["pushData2.records"] == "0 dropped, 0 orphan")
        #expect(info.keys["pushData"] == "absent")
        #expect(info.keys["twAnalyticsConsentV1"] == "ignored")
        #expect(info.migratedAtMillis == 1_794_549_600_000)
        #expect(info.localStorageFile?.hasSuffix("/LocalStorage/localstorage.sqlite3") == true)
        #expect(info.localStorageFile?.hasPrefix("Library/WebKit/net.wizardfactory.todayweather/WebsiteData/Default/") == true)
    }

    @Test func suiteValuesMatchLocalStorageForTheCapturedState() throws {
        let local = try CordovaSources.read(dataContainer: Fixtures.container("simulator"), suite: [:])
        let suiteOnly = CordovaSources(suite: Fixtures.suiteKeys("current").mapValues(SuiteValue.from))
        var a = Fixtures.migrate(local)
        var b = Fixtures.migrate(suiteOnly)
        #expect(b.migration?.source.contains("=localStorage") == false)
        a.migration = nil
        b.migration = nil
        #expect(a == b)
    }

    // MARK: Partial

    @Test func partialValuesKeepWhatIsValid() throws {
        let local = [
            // a non-object entry keeps its slot; an out-of-range location makes the place address-only
            "cities": #"[{"currentPosition":true,"disable":false},"broken",{"name":"Far","address":"x","location":{"lat":91,"long":0}}]"#,
            "cityIndex": "7",
            "units": #"{"temperatureUnit":"F","airUnit":"aircn","windSpeedUnit":"furlongs"}"#,
            "settingsInfo": #"{"startupPage":"9","refreshInterval":"15"}"#,
            "pushData2": """
            {"type":"ios","pushList":[
             {"cityIndex":0,"id":1,"category":"alert","enable":true,"startTime":"2026-11-12T22:00:00.000Z","endTime":"2026-11-13T13:00:00.000Z"},
             {"cityIndex":5,"id":2,"category":"alarm","enable":true,"time":"2026-11-12T22:40:00.000Z","dayOfWeek":[true,true,true,true,true,true,true]},
             {"cityIndex":0,"id":3,"category":"alarm","enable":"yes","time":"2026-11-12T22:40:00.000Z","dayOfWeek":[true,true,true,true,true,true,true]},
             {"cityIndex":0,"id":4,"category":"alarm","enable":true,"time":"2026-02-30T22:40:00.000Z","dayOfWeek":[true,true,true,true,true,true,true]},
             {"cityIndex":0,"id":5,"category":"alarm","enable":true,"time":"2026-11-12T22:40:00.000Z","dayOfWeek":[true,true]},
             {"cityIndex":"0","id":6,"category":"alert","enable":true,"startTime":"2026-11-12T22:00:00.000Z","endTime":"2026-11-13T13:00:00.000Z"},
             {"cityIndex":0,"id":7,"category":"other","enable":true}
            ]}
            """,
        ]
        let state = Fixtures.migrate(CordovaSources(local: local), region: "US")
        try #require(state.places.count == 3)
        #expect(state.places[1] == Place(currentPosition: false, disable: true))
        #expect(state.places[2].location == nil)
        #expect(state.places[2].address == "x")
        #expect(state.placeIndex == 0) // out of range: first enabled place
        #expect(state.units == UnitSettings(temperatureUnit: "F", windSpeedUnit: "mph", pressureUnit: "inHg",
                                            distanceUnit: "mi", precipitationUnit: "in", airUnit: "airnow"))
        #expect(state.settings == Settings(startupPage: "0", refreshInterval: "15", theme: "light"))
        #expect(state.push.records.map { $0["id"] } == [.number(1), .number(2)])
        let keys = try #require(state.migration?.keys)
        #expect(keys["cities"] == "partial")
        #expect(keys["cityIndex"] == "malformed")
        #expect(keys["units"] == "partial")
        #expect(keys["settingsInfo"] == "partial")
        #expect(keys["pushData2"] == "partial")
        #expect(keys["pushData2.records"] == "5 dropped, 1 orphan")
        #expect(keys["expandShortChart"] == "absent")
    }

    @Test func indexFallsBackToTheFirstEnabledPlace() {
        let disabledFirst = #"[{"currentPosition":true,"disable":true},{"name":"A","address":"a"}]"#
        #expect(Fixtures.migrate(CordovaSources(local: ["cities": disabledFirst])).placeIndex == 1)
        #expect(Fixtures.migrate(CordovaSources(local: ["cities": disabledFirst, "cityIndex": "true"])).placeIndex == 1)
        #expect(Fixtures.migrate(CordovaSources()).placeIndex == -1)
        #expect(Fixtures.migrate(CordovaSources(local: ["cities": "[]"])).places == [.currentPositionPlaceholder])
    }

    @Test func unitDefaultsFollowTheRegion() {
        #expect(Fixtures.migrate(CordovaSources(), region: "KR").units.airUnit == "airkorea")
        #expect(Fixtures.migrate(CordovaSources(), region: "JP").units.pressureUnit == "mmHg")
        #expect(Fixtures.migrate(CordovaSources(), region: "GB").units == UnitSettings.defaults(region: nil))
        #expect(CordovaRegion.from(preferredLanguages: ["ko-KR", "en-US"]) == "KR")
        #expect(CordovaRegion.from(preferredLanguages: ["en", "zh-Hans-CN"]) == "CN")
        #expect(CordovaRegion.from(preferredLanguages: ["en"]) == "KR")
    }

    // MARK: Malformed

    @Test func malformedLocalStorageFallsBackToTheSuite() throws {
        let sources = CordovaSources(
            local: ["cities": "[{", "cityIndex": "", "units": "{\"temperatureUnit\":", "settingsInfo": "nope"],
            suite: ["cities": .string(#"[{"currentPosition":true,"disable":true},{"name":"A","address":"a"}]"#),
                    "cityIndex": .number("1"), "settingsInfo": .data(Data("{\"theme\":\"x\"".utf8))])
        let state = Fixtures.migrate(sources)
        #expect(state.places.count == 2)
        #expect(state.placeIndex == 1)
        #expect(state.settings == Settings())
        let info = try #require(state.migration)
        #expect(info.source == "cities=suite,cityIndex=suite")
        #expect(info.keys["units"] == "malformed")
        #expect(info.keys["settingsInfo"] == "malformed")
        #expect(state.units == UnitSettings.defaults(region: "KR"))
    }

    @Test func wrongTypesTakeTheDefaults() throws {
        let local = ["cities": #"{"name":"A"}"#, "units": "[]", "settingsInfo": "\"dark\"", "pushData2": "[]",
                     "expandShortChart": "\"yes\""]
        let state = Fixtures.migrate(CordovaSources(local: local))
        #expect(state.places == [.currentPositionPlaceholder])
        #expect(state.units == UnitSettings.defaults(region: "KR"))
        #expect(state.settings == Settings())
        #expect(state.push == PushState())
        #expect(state.expandShortChart == false)
        let keys = try #require(state.migration?.keys)
        #expect(keys["cities"] == "malformed")
        #expect(keys["units"] == "malformed")
        #expect(keys["settingsInfo"] == "malformed")
        #expect(keys["pushData2"] == "malformed")
        #expect(keys["expandShortChart"] == "default") // parsed, but not a boolean
    }

    @Test func suiteValueTypesAreReadAsThePluginStoresThem() throws {
        let suite = Fixtures.suiteKeys("types")
        #expect(suite["_twHandBack"] == nil)
        let values = suite.mapValues(SuiteValue.from)
        #expect(values["cityIndex"] == .number("1"))
        #expect(values["expandShortChart"] == .bool(true))
        #expect(values["startVersion"] == .number("1.5"))
        #expect(values["appVersion"].map { if case .unsupported = $0 { true } else { false } } == true)
        let state = Fixtures.migrate(CordovaSources(suite: values))
        try #require(state.places.count == 2)
        #expect(state.placeIndex == 1)
        #expect(state.places[1].name == "London")
        #expect(state.expandShortChart)
        #expect(state.units == UnitSettings(temperatureUnit: "F", windSpeedUnit: "kt", pressureUnit: "inHg",
                                            distanceUnit: "mi", precipitationUnit: "in", airUnit: "aqicn"))
        #expect(state.settings == Settings(startupPage: "3", refreshInterval: "0", theme: "photo"))
        #expect(state.cordovaExtras == Fixtures.obj(["startVersion": .number(1.5)]))
        let keys = try #require(state.migration?.keys)
        #expect(keys["pushData2"] == "malformed") // data that is not UTF-8
        #expect(keys["appVersion"] == "malformed") // an array the plugin never writes
    }

    // MARK: Suite only (update straight from 1.0.10)

    @Test func suiteOnlyStateFromVersion1010() throws {
        let sources = try CordovaSources.read(dataContainer: Fixtures.container("none"),
                                              suite: Fixtures.suiteKeys("v1.0.10"))
        #expect(sources.local.isEmpty)
        #expect(sources.localStorageFile == nil)
        let state = Fixtures.migrate(sources)
        try #require(state.places.count == 2)
        #expect(state.places[0].currentPosition)
        #expect(state.places[0].disable == false)
        #expect(state.places[1].name == "부산")
        #expect(state.placeIndex == 1)
        // The standalone startupPage/refreshInterval and guideVersion lived only in localStorage.
        #expect(state.settings == Settings(startupPage: "0", refreshInterval: "0", theme: "light"))
        #expect(state.cordovaExtras == Fixtures.obj(["startVersion": .number(1)]))
        #expect(state.units == UnitSettings.defaults(region: "KR"))
        #expect(state.push.needsAlertIntro)
        #expect(state.push.registrationId == "legacy-registration")
        #expect(state.push.records.count == 2)
        let keys = try #require(state.migration?.keys)
        #expect(keys["settingsInfo"] == "absent")
        #expect(keys["pushData"] == "legacy")
        #expect(state.migration?.source == "cities=suite,cityIndex=suite,pushData=suite,startVersion=suite")
    }

    @Test func emptySourcesGiveANewInstall() throws {
        let state = Fixtures.migrate(CordovaSources())
        var expected = AppState(units: .defaults(region: "KR"))
        expected.migration = state.migration
        #expect(state == expected)
        #expect(state.migration?.keys["cities"] == "absent")
    }

    // MARK: Legacy keys

    @Test func legacyLocalStorageKeysOfOldVersions() throws {
        let sources = try CordovaSources.read(dataContainer: Fixtures.container("legacy"), suite: [:])
        #expect(sources.localStorageFile == "Library/WebKit/WebsiteData/LocalStorage/app_localhost_0.localstorage")
        let state = Fixtures.migrate(sources)
        #expect(state.settings == Settings(startupPage: "2", refreshInterval: "60", theme: "light"))
        try #require(state.places.count == 2)
        #expect(state.migration?.keys["settingsInfo"] == "legacy")
        #expect(state.cordovaExtras == Fixtures.obj(["startVersion": .number(1)])) // from guideVersion
        #expect(state.places[0].location == Location(lat: 37.5636, long: 126.9826))
        #expect(state.places[0].cordova?["currentWeather"] == nil)
        #expect(state.push.needsAlertIntro)
    }

    /// `loadOldPushInfo`: an alert 07–22 (disabled) and an alarm per legacy entry, with the city info.
    @Test func legacyPushDataConvertsLikeLoadOldPushInfo() throws {
        let cities = #"[{"currentPosition":true,"disable":true},{"name":"명동","address":"서울특별시 중구 명동","source":"KMA","location":{"lat":37.56,"long":126.98}},{"address":"x"}]"#
        let legacy = #"{"registrationId":"r","type":"ios","alarmList":[{"cityIndex":1,"time":1488407400000,"name":"명동"},{"cityIndex":"2","time":"2017-03-01T22:30:00.000Z"},{"cityIndex":9,"time":"bad"}]}"#
        let state = Fixtures.migrate(CordovaSources(local: ["cities": cities, "pushData": legacy]))
        let r = state.push.records
        try #require(r.count == 6)
        #expect(r[0] == Fixtures.obj([
            "cityIndex": .number(1), "id": .number(1), "category": .string("alert"), "enable": .bool(false),
            "startTime": .string("2026-11-12T22:00:00.000Z"), "endTime": .string("2026-11-13T13:00:00.000Z"),
            "name": .string("명동"), "source": .string("KMA"),
            "location": .object(Fixtures.obj(["lat": .number(37.56), "long": .number(126.98)])),
            "town": .object(Fixtures.obj(["first": .string("서울특별시"), "second": .string("중구"), "third": .string("명동")])),
        ]))
        #expect(r[1]["name"] == nil) // a place without location or town keeps the base fields
        #expect(r[1]["cityIndex"] == .number(2))
        #expect(r[2]["cityIndex"] == .number(9))
        #expect(r[3] == Fixtures.obj([
            "cityIndex": .number(1), "id": .number(2), "category": .string("alarm"), "enable": .bool(true),
            "time": .string("2017-03-01T22:30:00.000Z"), "name": .string("명동"),
            "dayOfWeek": .array(Array(repeating: .bool(true), count: 7)),
        ]))
        #expect(r[4]["id"] == .number(3))
        #expect(r[4]["time"] == .string("2017-03-01T22:30:00.000Z"))
        #expect(r[5]["time"] == .null)
        #expect(state.push.needsAlertIntro)
        #expect(state.push.registrationId == "r")
        #expect(state.migration?.keys["pushData"] == "legacy")
    }

    @Test func pushData2TakesPrecedenceOverLegacyPushData() {
        let state = Fixtures.migrate(CordovaSources(local: [
            "pushData2": #"{"type":"ios","pushList":[]}"#,
            "pushData": #"{"alarmList":[{"cityIndex":0,"time":0}]}"#,
        ]))
        #expect(state.push.records.isEmpty)
        #expect(state.push.needsAlertIntro == false)
        #expect(state.migration?.keys["pushData"] == nil)
    }

    /// `secs2date` keeps the local wall time on a daylight-saving day.
    @Test func legacyAlertHoursAreLocalWallTimesOnDaylightSavingDays() {
        let newYork = TimeZone(identifier: "America/New_York")!
        // 2026-03-08 12:00 EDT, the day the clocks went forward.
        let day = Date(timeIntervalSince1970: 1_772_985_600)
        #expect(CordovaMigration.secs2date(7 * 3600, now: day, zone: newYork) == "2026-03-08T11:00:00.000Z")
        #expect(CordovaMigration.secs2date(22 * 3600, now: day, zone: newYork) == "2026-03-09T02:00:00.000Z")
        #expect(CordovaMigration.secs2date(1 * 3600, now: day, zone: newYork) == "2026-03-08T06:00:00.000Z")
    }

    @Test func recordTimesMustNameRealInstants() {
        #expect(CordovaMigration.validInstant("2024-02-29T23:59:59.999Z"))
        #expect(CordovaMigration.validInstant("2026-11-12T22:40:00Z"))
        #expect(!CordovaMigration.validInstant("2026-02-29T22:40:00.000Z"))
        #expect(!CordovaMigration.validInstant("2026-11-12T24:00:00.000Z"))
        #expect(!CordovaMigration.validInstant("2026-11-12T22:40:00.000+09:00"))
        #expect(!CordovaMigration.validInstant("2026-13-01T00:00:00.000Z"))
    }

    // MARK: Determinism

    @Test func aSecondRunChangesNothing() throws {
        let sources = try CordovaSources.read(dataContainer: Fixtures.container("simulator"),
                                              suite: Fixtures.suiteKeys("current"))
        let first = Fixtures.migrate(sources)
        let second = Fixtures.migrate(sources)
        #expect(first == second)
        #expect(AppStateStore.encode(first) == AppStateStore.encode(second))
        // The stored state reads back equal.
        let decoded = try AppStateStore.decode(AppStateStore.encode(first))
        #expect(decoded == first)
    }
}
