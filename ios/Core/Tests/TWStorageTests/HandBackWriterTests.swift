import Foundation
import Testing
import TWModel
@testable import TWStorage

/// The suite as the hand-back writes it, with the order of the operations; operations after `limit` are lost, as when
/// the process ends during a write.
final class SuiteDouble: HandBackSuite, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: Any]
    private(set) var log: [HandBackWriter.Write] = []
    var limit: Int?

    init(_ values: [String: Any] = [:]) { storage = values }

    var values: [String: Any] { lock.withLock { storage } }

    func object(forKey key: String) -> Any? { lock.withLock { storage[key] } }

    func set(_ value: Any?, forKey key: String) {
        lock.withLock {
            log.append(.init(key, value as? String))
            if limit.map({ log.count <= $0 }) ?? true { storage[key] = value }
        }
    }

    func removeObject(forKey key: String) {
        lock.withLock {
            log.append(.init(key, nil))
            if limit.map({ log.count <= $0 }) ?? true { storage[key] = nil }
        }
    }

    private(set) var synchronized: [Int] = []

    /// Records how many operations the suite had when the writer waited for them.
    func synchronize() -> Bool {
        lock.withLock { synchronized.append(log.count) }
        return true
    }

    /// The suite's strings (other types as their description), for comparisons.
    var strings: [String: String] { values.mapValues { ($0 as? String) ?? "\(type(of: $0)):\($0)" } }

    func string(_ key: String) -> String? { object(forKey: key) as? String }
}

/// The golden starts of the fallback Cordova iOS build over the hand-back's writes
/// (Fixtures/handback/handback.json, written by ios/tools/handback/generate.py).
struct HandBackGolden: Decodable {
    struct Case: Decodable {
        let name: String
        let emptyWebView: Bool
        let suite: [String: Value]
        let texts: [String: String?]
        let writes: [[String?]]
        let outcomes: [Outcome]
        let resumed: [Resumed]
    }

    struct Resumed: Decodable {
        let after: Int
        let writes: [[String?]]
        let outcomes: [Outcome]
    }

    /// `[letter, trusted, claim, consent]`.
    struct Outcome: Decodable {
        let letter: String
        let trusted: Bool?
        let claim: Int?

        init(from decoder: Decoder) throws {
            var c = try decoder.unkeyedContainer()
            letter = try c.decode(String.self)
            trusted = try c.decodeIfPresent(Bool.self)
            claim = try c.decodeIfPresent(Int.self)
        }
    }

    /// A suite value as AppPreferences.m keeps it.
    struct Value: Decodable {
        let string: String?
        let number: String?
        let bool: Bool?
        let data: String?

        var object: Any {
            if let string { return string }
            if let number { return NSNumber(value: Int(number)!) }
            if let bool { return bool }
            return Data(data!.utf8)
        }
    }

    let keys: [String]
    let cases: [Case]

    static let loaded: HandBackGolden = {
        let url = Fixtures.root.appendingPathComponent("handback/handback.json")
        return try! JSONDecoder().decode(HandBackGolden.self, from: Data(contentsOf: url))
    }()
}

extension HandBackGolden.Case {
    var orderedTexts: [(key: String, text: String?)] { CordovaHandBack.keys.map { ($0, texts[$0] ?? nil) } }
    var suiteObjects: [String: Any] { suite.mapValues(\.object) }
}

func goldenWrites(_ writes: [[String?]]) -> [HandBackWriter.Write] { writes.map { .init($0[0]!, $0[1]) } }

/// The rollback hand-back's writer (IN-17, #2966): the write order that the fallback Cordova iOS build never takes half of,
/// a write interrupted by the end of the process, the generations and the consent rule.
struct HandBackWriterTests {
    static let golden = HandBackGolden.loaded

    @Test func theGoldenCoversTheContract() {
        #expect(Self.golden.keys == CordovaHandBack.keys)
        #expect(Self.golden.cases.count == 8)
        for c in Self.golden.cases {
            let runs = [c.outcomes] + c.resumed.map(\.outcomes)
            for outcomes in runs {
                let letters = outcomes.map(\.letter).joined()
                if !c.emptyWebView {
                    #expect(!letters.contains("M"), "\(c.name): the fallback build never shows half a hand-back (\(letters))")
                }
                #expect(!letters.contains("H"), "\(c.name): no start waits (\(letters))")
                #expect(letters.last == "W", "\(c.name): the hand-back shows once written (\(letters))")
            }
        }
    }

    /// The writer's operations are the golden ones, for each case and for each write the next process does again after
    /// the previous one ended at each step.
    @Test(arguments: HandBackGolden.loaded.cases.map(\.name))
    func theWriterKeepsTheContractsOrder(name: String) throws {
        let c = try #require(Self.golden.cases.first { $0.name == name })
        let suite = SuiteDouble(c.suiteObjects)
        HandBackWriter(suite: suite, consent: { nil }).write(texts: c.orderedTexts)
        #expect(suite.log == goldenWrites(c.writes))
        #expect(suite.synchronized == (c.writes.isEmpty ? [] : [c.writes.count]), "the writes reach the daemon before it returns")
        if !c.writes.isEmpty {
            let marker = try #require(CordovaHandBack.parse(suite.string(CordovaHandBack.marker)))
            #expect(marker.complete && marker.writer == "native" && marker.keys == CordovaHandBack.keys)
            for (key, text) in c.orderedTexts { #expect(suite.string(key) == text, "\(key)") }
        }
        for resumed in c.resumed {
            // The process ends after `after` operations; the next one writes the same state.
            let interrupted = SuiteDouble(c.suiteObjects)
            interrupted.limit = resumed.after
            HandBackWriter(suite: interrupted, consent: { nil }).write(texts: c.orderedTexts)
            let next = SuiteDouble(interrupted.values)
            HandBackWriter(suite: next, consent: { nil }).write(texts: c.orderedTexts)
            #expect(next.log == goldenWrites(resumed.writes), "\(name), resumed after \(resumed.after)")
            for (key, text) in c.orderedTexts { #expect(next.string(key) == text, "\(key)") }
            #expect(CordovaHandBack.parse(next.string(CordovaHandBack.marker))?.complete == true)
        }
    }

    /// Every prefix of a write: the incomplete marker is in place before the first key changes and the complete one only
    /// after the last, and while it is incomplete the fallback build neither applies nor trusts anything (golden).
    @Test func everyKeyChangesUnderAnIncompleteMarker() throws {
        for c in Self.golden.cases where c.writes.count > 1 {
            let writes = goldenWrites(c.writes)
            let first = try #require(writes.first)
            let last = try #require(writes.last)
            #expect(first.key == CordovaHandBack.marker && CordovaHandBack.parse(first.text)?.complete == false, "\(c.name)")
            #expect(last.key == CordovaHandBack.marker && CordovaHandBack.parse(last.text)?.complete == true, "\(c.name)")
            #expect(CordovaHandBack.parse(first.text)?.generation == CordovaHandBack.parse(last.text)?.generation)
            #expect(!writes.dropFirst().dropLast().contains { $0.key == CordovaHandBack.marker }, "\(c.name)")
            for outcome in c.outcomes.dropFirst().dropLast() {
                #expect(outcome.trusted == false && outcome.claim == nil, "\(c.name): an incomplete marker is not used")
            }
        }
    }

    static let seoul = Place(currentPosition: false, disable: false, name: "서울", address: "대한민국 서울특별시", country: "KR",
                             location: Location(lat: 37.567, long: 126.978), source: "KMA")
    static let london = Place(currentPosition: false, disable: false, name: "London", address: "United Kingdom London",
                              country: "GB", location: Location(lat: 51.51, long: -0.13))
    static let alarm = Fixtures.json(#"{"cityIndex":2,"id":2,"category":"alarm","enable":true,"time":"2026-11-07T21:00:00.000Z"}"#)

    static func marker(_ suite: SuiteDouble) -> CordovaHandBack.Marker? { CordovaHandBack.parse(suite.string(CordovaHandBack.marker)) }
    static func names(_ suite: SuiteDouble) -> [String?] {
        (try? JSONValue.parse(suite.string("cities") ?? ""))?.arrayValue?.map { $0["name"]?.stringValue } ?? []
    }

    @MainActor
    @Test func everySavedStateIsHandedBackWithTheNextGeneration() async throws {
        // Legacy alarms and a value the plugin stored with another type: the first goes, the second becomes a string.
        let suite = SuiteDouble(["pushData": "{}", "cityIndex": NSNumber(value: 1)])
        let writer = HandBackWriter(suite: suite, consent: { "true" })
        let holder = AppStateHolder(store: AppStateHolderTests.RecordingStore(), onSaved: writer.write)
        let start = AppState(places: [.currentPositionPlaceholder, Self.seoul, Self.london], placeIndex: 2,
                             push: PushState(fcmToken: "t", records: [Self.alarm.objectValue!]))
        holder.load(start)
        await holder.saved()
        #expect(Self.marker(suite) == CordovaHandBack.Marker(schema: 1, generation: 1, writer: "native", complete: true,
                                                            keys: CordovaHandBack.keys))
        #expect(Self.names(suite) == [nil, "서울", "London"])
        #expect(suite.object(forKey: "pushData") == nil)
        #expect(suite.string("cityIndex") == "2")
        #expect(suite.string(CordovaHandBack.consentKey) == "true")
        holder.change {
            $0.places.remove(at: 2)
            $0.placeIndex = 1
            $0.push.records = []
        }
        await holder.saved()
        #expect(Self.marker(suite)?.generation == 2)
        #expect(Self.names(suite) == [nil, "서울"])
        #expect(CordovaHandBackTests.json(suite.string("pushData2"))["pushList"]?.arrayValue?.isEmpty == true)
        // Another writer of the process (push token sync) through the holder.
        try await holder.update { $0.expandShortChart = true }
        #expect(Self.marker(suite)?.generation == 3, "handed back before update returns")
        #expect(suite.string("expandShortChart") == "true")
    }

    @MainActor
    @Test func aStateTheHolderCouldNotSaveIsNotHandedBack() async {
        let suite = SuiteDouble()
        let writer = HandBackWriter(suite: suite, consent: { nil })
        let holder = AppStateHolder(store: AppStateHolderTests.RecordingStore(failures: 1), onSaved: writer.write)
        holder.load(AppState(places: [.currentPositionPlaceholder, Self.seoul], placeIndex: 1))
        await holder.saved()
        holder.change { $0.settings.theme = "dark" }
        await holder.saved()
        #expect(Self.marker(suite)?.generation == 1, "only the loaded state")
        #expect(suite.string("settingsInfo")?.contains("light") == true)
        holder.change { $0.settings.startupPage = "1" }
        await holder.saved()
        #expect(Self.marker(suite)?.generation == 2)
        #expect(suite.string("settingsInfo") == #"{"startupPage":"1","refreshInterval":"0","theme":"dark"}"#)
    }

    @Test func aStateHandedBackAlreadyIsNotWrittenAgain() {
        let state = AppState(places: [.currentPositionPlaceholder, Self.seoul], placeIndex: 1)
        let suite = SuiteDouble()
        let writer = HandBackWriter(suite: suite, consent: { nil })
        writer.write(state)
        let written = suite.log.count
        writer.write(state)
        HandBackWriter(suite: suite, consent: { nil }).write(state)
        #expect(suite.log.count == written, "nothing written again, also by the next process")
        #expect(Self.marker(suite)?.generation == 1)
        #expect(suite.object(forKey: CordovaHandBack.consentKey) == nil)
    }

    @Test func aConsentChangeIsHandedBackWithTheLastSavedState() {
        let state = AppState(places: [.currentPositionPlaceholder, Self.seoul], placeIndex: 1)
        let consent = Box<String?>("false")
        let suite = SuiteDouble()
        let writer = HandBackWriter(suite: suite, consent: { consent.value })
        writer.rewrite()
        #expect(suite.log.isEmpty, "nothing saved yet: nothing to hand back")
        writer.write(state)
        consent.value = "true"
        writer.rewrite()
        #expect(Self.marker(suite)?.generation == 2)
        #expect(suite.string(CordovaHandBack.consentKey) == "true")
        #expect(Self.names(suite) == [nil, "서울"])
        // One key changed: the incomplete marker, the key, the complete marker.
        #expect(suite.log.suffix(3).map(\.key) == [CordovaHandBack.marker, CordovaHandBack.consentKey, CordovaHandBack.marker])
    }

    /// The next process completes a hand-back the previous one could not finish, whatever step it ended at.
    @Test func aWriteInterruptedByTheEndOfTheProcessIsCompletedByTheNextStart() {
        let before = AppState(places: [.currentPositionPlaceholder, Self.seoul, Self.london], placeIndex: 2)
        var after = before
        after.places.remove(at: 2)
        after.placeIndex = 1
        after.settings.theme = "dark"
        let base = SuiteDouble()
        HandBackWriter(suite: base, consent: { nil }).write(before)
        let full = SuiteDouble(base.values)
        HandBackWriter(suite: full, consent: { nil }).write(after)
        let steps = full.log.count
        #expect(steps == 6, "marker, cities, cityIndex, cityList, settingsInfo, marker: \(full.log.map(\.key))")
        for k in 0..<steps {
            let suite = SuiteDouble(base.values)
            suite.limit = k
            HandBackWriter(suite: suite, consent: { nil }).write(after)
            let marker = Self.marker(suite)
            if k == 0 {
                #expect(marker?.generation == 1 && marker?.complete == true, "nothing written: the previous hand-back")
            } else {
                #expect(marker?.generation == 2 && marker?.complete == false, "after \(k): incomplete, so not used")
            }
            let next = SuiteDouble(suite.values)
            HandBackWriter(suite: next, consent: { nil }).write(after)
            #expect(next.strings == full.strings.merging([CordovaHandBack.marker: Self.markerText(next)]) { $1 })
            #expect(Self.marker(next)?.complete == true)
            #expect(Self.marker(next)?.generation == (k == 0 ? 2 : 3))
            #expect(Self.names(next) == [nil, "서울"])
        }
    }

    static func markerText(_ suite: SuiteDouble) -> String { suite.string(CordovaHandBack.marker) ?? "" }

    @Test func repeatedSwitchesKeepCountingTheGenerations() {
        // Native 1, fallback claim 2 (adopted), native 3, fallback claim 4, native 5.
        let suite = SuiteDouble()
        let state = AppState(places: [.currentPositionPlaceholder, Self.seoul], placeIndex: 1)
        HandBackWriter(suite: suite, consent: { nil }).write(state)
        #expect(Self.marker(suite)?.generation == 1)
        for (claim, native) in [(2, 3), (4, 5)] {
            suite.set(#"{"schema":1,"generation":\#(claim),"writer":"cordova","complete":true,"keys":[]}"#, forKey: CordovaHandBack.marker)
            HandBackWriter(suite: suite, consent: { nil }).write(state)
            #expect(Self.marker(suite) == CordovaHandBack.Marker(schema: 1, generation: native, writer: "native", complete: true,
                                                                keys: CordovaHandBack.keys))
        }
    }

    @Test func aGrantStandsAtTheStartOnlyWhileTheSuiteSaysTrue() {
        let claim = #"{"schema":1,"generation":4,"writer":"cordova","complete":true,"keys":[]}"#
        let own = CordovaHandBack.markerText(generation: 5, writer: CordovaHandBack.native)
        let incomplete = CordovaHandBack.markerText(generation: 6, writer: CordovaHandBack.native, complete: false)
        func stands(_ marker: String?, _ choice: Any?) -> Bool {
            var values: [String: Any] = [:]
            values[CordovaHandBack.marker] = marker
            values[CordovaHandBack.consentKey] = choice
            return HandBackConsent.grantStands(in: SuiteDouble(values))
        }
        #expect(stands(nil, nil), "nothing handed over yet: an earlier grant stands")
        #expect(stands(own, "true"), "its own hand-back")
        #expect(stands(claim, "true"), "a fallback build that kept the grant")
        #expect(!stands(claim, "false"), "withdrawn in the fallback build")
        #expect(!stands(own, "false"), "withdrawn there while that build could not read the hand-back")
        #expect(!stands(incomplete, "false"), "withdrawn there while a hand-back was being written")
        #expect(!stands(claim, nil), "no choice there: off")
        #expect(!stands(claim, true), "a boolean is not the choice Monetization writes")
    }

    /// Without a stored choice here the region default applies (2026-11-24), so a withdrawal made in a fallback build must
    /// be adopted as this app's choice: the suite says `"false"` once anything was handed over. A native hand-back without
    /// a choice removes the key, so `"false"` there comes from the fallback build (a choice, or a grant it withdrew).
    @Test func aWithdrawalInTheFallbackBuildIsAdoptedWithoutAChoiceHere() {
        let claim = #"{"schema":1,"generation":4,"writer":"cordova","complete":true,"keys":[]}"#
        let own = CordovaHandBack.markerText(generation: 5, writer: CordovaHandBack.native)
        let incomplete = CordovaHandBack.markerText(generation: 6, writer: CordovaHandBack.native, complete: false)
        func withdrawn(_ marker: String?, _ choice: Any?) -> Bool {
            var values: [String: Any] = [:]
            values[CordovaHandBack.marker] = marker
            values[CordovaHandBack.consentKey] = choice
            return HandBackConsent.withdrawnThere(in: SuiteDouble(values))
        }
        #expect(withdrawn(claim, "false"), "withdrawn in the fallback build")
        #expect(withdrawn(own, "false"), "withdrawn there while that build could not read the hand-back")
        #expect(withdrawn(incomplete, "false"), "withdrawn there while a hand-back was being written")
        #expect(!withdrawn(nil, "false"), "nothing handed over yet: the Cordova choice does not carry over")
        #expect(!withdrawn(claim, "true"), "a grant there is not carried over")
        #expect(!withdrawn(claim, nil), "no choice there")
        #expect(!withdrawn(claim, false), "a boolean is not the choice Monetization writes")
    }
}

final class Box<T>: @unchecked Sendable {
    var value: T
    init(_ value: T) { self.value = value }
}
