import Foundation
import Testing
import TWModel
@testable import TWStorage

/// The requests after a start and after a token refresh against those of the Cordova `Push` service on iOS
/// (`Fixtures/push/push.json`, written by ios/tools/push/generate.py in JavaScriptCore): path, headers and body with
/// member order and number texts.
struct PushRegistrationTests {
    static let corpus: JSONObject = {
        let url = Fixtures.root.appendingPathComponent("push/push.json")
        return try! JSONValue.parse(Data(contentsOf: url)).objectValue!
    }()

    static let places: [Place] = corpus["cities"]!.arrayValue!.map { c in
        let loc = c["location"]!
        return Place(currentPosition: c["currentPosition"]!.boolValue!, disable: c["disable"]!.boolValue!,
                     name: c["name"]?.stringValue, address: c["address"]?.stringValue,
                     country: c["country"]?.stringValue,
                     location: Location(lat: loc["lat"]!.numberValue!.double, long: loc["long"]!.numberValue!.double),
                     source: c["source"]?.stringValue)
    }

    static func string(_ value: JSONValue?) -> String? { value?.stringValue }

    static func context(_ c: JSONValue) -> PushRegistration.Context {
        let units = UnitSettings(temperatureUnit: "C", windSpeedUnit: "m/s", pressureUnit: "hPa", distanceUnit: "km",
                                 precipitationUnit: "mm", airUnit: c["airUnit"]!.stringValue!)
        return PushRegistration.Context(
            deviceId: corpus["deviceId"]!.stringValue!, language: corpus["language"]!.stringValue!,
            appVersion: corpus["appVersion"]!.stringValue!, units: units,
            now: Date(timeIntervalSince1970: corpus["now"]!.numberValue!.double / 1000),
            zone: TimeZone(identifier: c["zone"]!.stringValue!)!)
    }

    /// The Cordova URL `https://server/v000902/…` as the native path: the app calls every API with v000903 (#2948).
    static func path(_ url: String) -> String {
        JSString.replaceFirst(JSString.replaceFirst(url, "https://server", ""), "/v000902/", "/v000903/")
    }

    static func compare(_ expected: [JSONValue], _ actual: [PushRequest], _ name: String) {
        #expect(actual.count == expected.count, "\(name): request count \(actual.map(\.method))")
        for (e, a) in zip(expected, actual) {
            #expect(a.method == e["method"]!.stringValue!, "\(name)")
            #expect(a.path == path(e["url"]!.stringValue!), "\(name)")
            let headers = Dictionary(uniqueKeysWithValues: e["headers"]!.objectValue!.map { ($0.key, $0.value.stringValue!) })
            #expect(a.headers == headers, "\(name) \(a.method) headers")
            #expect(a.body.sameText(e["data"]!), "\(name) \(a.method) body:\n\(a.body.jsonText)\nexpected:\n\(e["data"]!.jsonText)")
        }
    }

    @Test func casesCoverEveryTokenSituation() {
        let names = Self.corpus["cases"]!.arrayValue!.map { $0["name"]!.stringValue! }
        for name in ["first-token", "unchanged-token", "changed-token", "dst-new-york", "refresh-changed",
                     "refresh-first"] {
            #expect(names.contains(name), "\(name)")
        }
        let types = Self.corpus["cases"]!.arrayValue!.flatMap { $0["requests"]!.arrayValue! }
            .compactMap { $0["data"]!.arrayValue }.flatMap { $0 }.map { $0["type"]?.stringValue }
        #expect(!types.isEmpty && types.allSatisfy { $0 == "ios" }, "the corpus comes from the iOS platform")
    }

    /// `Push.init` on open: repair, replacement of a changed token (a first token also posts the list), then the
    /// list again when a token exists. The refresh cases deliver a token while the app runs, after the start.
    @Test func requestsMatchCordovaForEveryTokenCase() {
        for c in Self.corpus["cases"]!.arrayValue! {
            let name = c["name"]!.stringValue!
            let ctx = Self.context(c)
            let records = (c["pushList"] ?? Self.corpus["pushList"])!.arrayValue!.map { $0.objectValue! }
            let stored = Self.string(c["storedToken"])
            let state = PushState(type: "ios", fcmToken: stored, records: records)
            let start = PushRegistration.onStart(state, places: Self.places, token: Self.string(c["startToken"]),
                                                 context: ctx)
            let expected = c["requests"]!.arrayValue!
            if let refresh = Self.string(c["refreshToken"]) {
                let result = PushRegistration.onTokenRefresh(start.state, places: Self.places, token: refresh, context: ctx)
                Self.compare(expected, result.requests, name)
                #expect(result.state.fcmToken == refresh, "\(name): stored token")
            } else {
                Self.compare(expected, start.requests, name)
                #expect(start.state.fcmToken == (Self.string(c["startToken"]) ?? stored), "\(name): stored token")
            }
        }
    }

    /// Cordova ignores a token that is not a string or is blank after JavaScript's `trim` (token deletion can emit
    /// one), and sends nothing without a token.
    @Test func blankTokensAreIgnored() {
        let c = Self.corpus["cases"]!.arrayValue!.first { $0["name"]!.stringValue! == "unchanged-token" }!
        let records = Self.corpus["pushList"]!.arrayValue!.map { $0.objectValue! }
        let state = PushState(type: "ios", fcmToken: "token-a", records: records)
        for blank in ["", " ", "\u{FEFF}\t\u{2028}"] {
            let result = PushRegistration.onTokenRefresh(state, places: Self.places, token: blank, context: Self.context(c))
            #expect(result.requests.isEmpty, "\(blank.unicodeScalars.map(\.value))")
            #expect(result.state.fcmToken == "token-a")
        }
        let none = PushRegistration.onStart(PushState(records: records), places: Self.places, token: nil,
                                            context: Self.context(c))
        #expect(none.requests.isEmpty)
    }

    /// The post objects carry `type: "ios"` whatever type the Cordova state stored (`Push.init` sets it on iOS).
    @Test func typeIsIOSWhateverWasStored() throws {
        let c = Self.corpus["cases"]!.arrayValue!.first { $0["name"]!.stringValue! == "unchanged-token" }!
        let records = Self.corpus["pushList"]!.arrayValue!.map { $0.objectValue! }
        let state = PushState(type: "", fcmToken: "token-a", records: records)
        let result = PushRegistration.onStart(state, places: Self.places, token: "token-a", context: Self.context(c))
        let posted = try #require(result.requests.last?.body.arrayValue)
        #expect(posted.count == records.count && posted.allSatisfy { $0["type"] == "ios" })
    }
}
