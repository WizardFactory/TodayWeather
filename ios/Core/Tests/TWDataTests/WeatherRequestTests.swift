import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage

/// The weather requests (IN-08, #2957) on a virtual clock: the attempts, gaps and timeouts of `_retryGetHttp` against the
/// Cordova code run in JavaScriptCore (Golden/weather-timed.json, ios/tools/weather/generate.py), the request path, unit
/// parameters and `Accept-Language`, the address fallbacks with the gateway's 501, and the ten-minute gate.
@MainActor
struct WeatherRequestTests {
    static let server = "https://server.test.invalid"

    private func behaviors(_ c: JSONValue, body: Data) -> [ScriptedWeatherHTTP.Behavior] {
        (c["behaviors"]?.arrayValue ?? []).map { b in
            if let ms = b["answer"]?.numberValue { return .answer(Int64(ms.double), body) }
            if let ms = b["fail"]?.numberValue { return .fail(Int64(ms.double), Int(b["status"]?.numberValue?.double ?? 0)) }
            return .hang
        }
    }

    /// Every V08 case of the golden: the attempts start at the Cordova times and the first to settle decides, with its
    /// time and outcome (a body, an error status, or the 10 s timeout: status -1 in Cordova). Legacy attempts that start
    /// after the promise settled (A06) are not sent: the native client cancels the others once one settled.
    @Test func attemptsAndTimeoutsMatchTheCordovaWrapper() async throws {
        let golden = try WeatherFixtures.golden()
        let cases = try #require(golden["retry"]?.arrayValue)
        #expect(cases.count == 10)
        for c in cases {
            let name = s(c["name"])
            let clock = VirtualClock()
            let http = ScriptedWeatherHTTP(clock: clock, behaviors(c, body: Data("{}".utf8)))
            let url = URL(string: "\(Self.server)/weather/v000903/coord/37.5665,126.978")!
            let done = Done()
            let task = Task { () -> (Result<Data, any Error>, Int64) in
                let r = await firstSettled(attempts: WeatherRequests.attempts, gap: WeatherRequests.attemptGap,
                                           timeout: WeatherRequests.timeout, clock: clock) {
                    try await http.get(url, headers: [:])
                }
                let at = clock.elapsed
                done.set()
                return (r, at)
            }
            // One deadline at a time, and no further while the request may be settling: the settle time is exact even
            // when the machine is busy.
            await clock.quiesce()
            while !done.value, let next = clock.nextDeadline {
                await clock.advance(to: next)
                for _ in 0..<40 where !done.value { try? await Task.sleep(for: .milliseconds(5)) }
            }
            let (result, at) = await task.value
            let settled = try #require(c["settled"])
            let settledAt = Int64(try #require(settled["at"]?.numberValue).double)
            #expect(at == settledAt, "\(name): settled at \(at), Cordova \(settledAt)")
            let legacy = (c["attempts"]?.arrayValue ?? []).map { Int64($0["at"]!.numberValue!.double) }
            let sent = legacy.filter { $0 < settledAt }
            #expect(http.attempts.map(\.at) == sent, "\(name): attempts \(http.attempts.map(\.at)), Cordova \(legacy)")
            #expect((c["attempts"]?.arrayValue ?? []).allSatisfy { $0["timeout"]?.numberValue?.double == 10_000 }, "\(name): timeout")
            switch (s(settled["outcome"]), result) {
            case ("resolved", .success): break
            case ("rejected", .failure(let error)):
                let code = Int(settled["code"]?.numberValue?.double ?? 0)
                if code == -1 {
                    #expect(error is AttemptTimeout, "\(name): the timeout")
                } else {
                    #expect((error as? URLSessionGet.StatusError)?.status == code, "\(name): status \(code)")
                }
            default:
                Issue.record("\(name): \(result), Cordova \(settled.jsonText)")
            }
            // Once one attempt settled, every other one still running was cancelled.
            await clock.quiesce()
            #expect(clock.pendingSleeps == 0, "\(name): nothing left waiting")
        }
    }

    /// The repository's request: the coordinate path with the unit parameters in `Units.getAllUnits()` order and
    /// `airForecastSource=kaq`, and the WebView's `Accept-Language`; the attempts of `_retryGetHttp`.
    @Test func theWeatherRequestCarriesUnitsAndLanguage() async throws {
        let clock = VirtualClock()
        let http = ScriptedWeatherHTTP(clock: clock, [.hang, .answer(100, try WeatherFixtures.body("kma-seoul"))])
        let repository = WeatherRepository(baseURL: Self.server, cacheDirectory: nil, http: http, clock: clock)
        var units = koreanUnits
        units.temperatureUnit = "F"
        units.windSpeedUnit = "km/h"
        let task = Task { await repository.load(seoul, units: units, acceptLanguage: "ko-KR,ko;q=0.9", force: false) }
        await clock.advance(to: 30_000)
        let result = await task.value
        guard case .loaded(let key, let entry, _) = result else { Issue.record("not loaded: \(result)"); return }
        #expect(key == "coord:37.56,126.98")
        #expect(entry.weather["currentWeather"] != nil)
        #expect(http.attempts.map(\.at) == [0, 2000])
        for attempt in http.attempts {
            #expect(attempt.url.absoluteString == "\(Self.server)/weather/v000903/coord/37.56,126.98?temperatureUnit=F"
                    + "&windSpeedUnit=km/h&pressureUnit=hPa&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea&airForecastSource=kaq")
            #expect(attempt.headers == ["Accept-Language": "ko-KR,ko;q=0.9"])
        }
        #expect(http.cancelled == [1], "the first attempt is cancelled once the second answered")
    }

    /// A saved place without coordinates: a Korean address uses the KMA town route; a free-form address the
    /// `/weather/v000903/addr/` route, which the gateway answers with HTTP 501: one attempt (the failure clears the next
    /// attempt's timer), then the failure the Cordova app reports with the retry confirmation. No location and no
    /// address: nothing is requested and the load fails (`invalid_input`).
    @Test func addressFallbacksAndThe501() async throws {
        let clock = VirtualClock()
        let body = try WeatherFixtures.body("kma-seoul")
        let http = ScriptedWeatherHTTP(clock: clock) { url in
            url.path.hasPrefix("/weather/v000903/addr/") ? .fail(150, 501) : .answer(80, body)
        }
        let repository = WeatherRepository(baseURL: Self.server, cacheDirectory: nil, http: http, clock: clock)
        let korean = Place(currentPosition: false, disable: false, name: "명동", address: "대한민국 서울특별시 중구 명동")
        let task = Task { await repository.load(korean, units: koreanUnits, acceptLanguage: "ko-KR,ko;q=0.9", force: false) }
        await clock.advance(by: 30_000)
        let loaded = await task.value
        guard case .loaded(_, _, let place) = loaded else { Issue.record("not loaded: \(loaded)"); return }
        #expect(http.attempts.first?.url.absoluteString == "\(Self.server)/v000903/kma/addr/"
                + "%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C/%EC%A4%91%EA%B5%AC/%EB%AA%85%EB%8F%99?temperatureUnit=C"
                + "&windSpeedUnit=m/s&pressureUnit=hPa&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea&airForecastSource=kaq")
        #expect(place.location != nil, "a saved place without a location takes the response's (#1971)")

        let freeForm = Place(currentPosition: false, disable: false, name: "Abbey Road", address: "United Kingdom London Abbey Road")
        let before = http.attempts.count
        let failing = Task { await repository.load(freeForm, units: koreanUnits, acceptLanguage: "en-US,en;q=0.9", force: false) }
        await clock.advance(by: 30_000)
        let failed = await failing.value
        let sent = http.attempts.dropFirst(before)
        #expect(sent.count == 1, "the 501 settles the request before a second attempt")
        #expect(sent.first?.url.absoluteString.hasPrefix("\(Self.server)/weather/v000903/addr/United%20Kingdom%20London%20Abbey%20Road?temperatureUnit=C") == true)
        guard case .failed(let network, _) = failed else { Issue.record("not failed: \(failed)"); return }
        #expect(network)

        let nowhere = Place(currentPosition: false, disable: false, name: "x")
        let count = http.attempts.count
        guard case .failed(false, false) = await repository.load(nowhere, units: koreanUnits, acceptLanguage: "ko", force: true) else {
            Issue.record("a place without location or address must fail")
            return
        }
        #expect(http.attempts.count == count, "nothing requested")
    }

    /// Without the private server URL nothing is requested; the load fails as a request without a server does.
    @Test func noServerNoRequest() async {
        let clock = VirtualClock()
        let http = ScriptedWeatherHTTP(clock: clock)
        let repository = WeatherRepository(baseURL: nil, cacheDirectory: nil, http: http, clock: clock)
        let result = await repository.load(seoul, units: koreanUnits, acceptLanguage: "ko", force: false)
        guard case .failed(true, false) = result else { Issue.record("\(result)"); return }
        #expect(http.attempts.isEmpty)
    }

    /// `canLoadCity` against the Cordova WeatherInfo in JavaScriptCore: a place loaded in this process loads again only
    /// more than ten minutes later; `reloadCity` lets it load at once; a disabled place never loads.
    @Test func theTenMinuteGateMatchesWeatherInfo() async throws {
        let golden = try WeatherFixtures.golden()
        let cases = try #require(golden["gate"]?.arrayValue)
        let places = [Place.currentPositionPlaceholder, seoul, london]
        let body = try WeatherFixtures.body("kma-seoul")
        for c in cases {
            let clock = VirtualClock()
            let http = ScriptedWeatherHTTP(clock: clock) { _ in .answer(0, body) }
            let repository = WeatherRepository(baseURL: Self.server, cacheDirectory: nil, http: http, clock: clock)
            var answers: [Bool] = []
            for step in c["steps"]?.arrayValue ?? [] {
                await clock.advance(to: Int64(step["at"]!.numberValue!.double))
                let index = int(step["index"])
                switch s(step["op"]) {
                case "update":
                    let task = Task { await repository.load(places[index], units: koreanUnits, acceptLanguage: "ko", force: true) }
                    await clock.quiesce()
                    guard case .loaded = await task.value else { Issue.record("\(s(c["name"])): update"); return }
                case "reload":
                    repository.invalidate(places[index])
                default:
                    // An index outside the places: no place, nothing loads (`canLoadCity` answers false).
                    answers.append(places.indices.contains(index) ? repository.canLoad(places[index]) : false)
                }
            }
            let expected = (c["results"]?.arrayValue ?? []).map { $0["canLoad"]?.boolValue == true }
            #expect(answers == expected, "\(s(c["name"])): \(answers), Cordova \(expected)")
        }
    }

    /// A late response applies to the place that requested it (V09, the A01 fix): Seoul's slow answer arrives after the
    /// selection moved to London and London's answer; it updates Seoul's entry only. Of two requests for one place, only
    /// the latest counts: the older one's answer, arriving last, is superseded.
    @Test func lateResponsesApplyToTheirOwnPlace() async throws {
        let clock = VirtualClock()
        let seoulBody = try WeatherFixtures.body("kma-seoul")
        let londonBody = try WeatherFixtures.body("vc-london")
        let http = ScriptedWeatherHTTP(clock: clock) { url in
            url.path.contains("37.56,126.98") ? .answer(1500, seoulBody) : .answer(300, londonBody)
        }
        let repository = WeatherRepository(baseURL: Self.server, cacheDirectory: nil, http: http, clock: clock)
        let first = Task { await repository.load(seoul, units: koreanUnits, acceptLanguage: "ko", force: false) }
        await clock.advance(by: 100)
        let second = Task { await repository.load(london, units: koreanUnits, acceptLanguage: "ko", force: false) }
        await clock.advance(by: 400)
        guard case .loaded(let londonKey, _, _) = await second.value else { Issue.record("London"); return }
        #expect(repository.weather[londonKey] != nil && repository.weather["coord:37.56,126.98"] == nil)
        await clock.advance(by: 2000)
        guard case .loaded(let seoulKey, let entry, _) = await first.value else { Issue.record("Seoul"); return }
        #expect(seoulKey == "coord:37.56,126.98")
        #expect(entry.weather["source"]?.stringValue == "KMA")
        #expect(repository.weather[londonKey]?.weather["source"]?.stringValue == "VC", "London keeps its own weather")

        // Two requests for Seoul: the first answers last and counts for nothing.
        let slow = ScriptedWeatherHTTP(clock: clock, [.answer(1500, seoulBody), .answer(200, seoulBody)])
        let again = WeatherRepository(baseURL: Self.server, cacheDirectory: nil, http: slow, clock: clock)
        let older = Task { await again.load(seoul, units: koreanUnits, acceptLanguage: "ko", force: true) }
        await clock.advance(by: 100)
        let newer = Task { await again.load(seoul, units: koreanUnits, acceptLanguage: "ko", force: true) }
        await clock.advance(by: 3000)
        guard case .loaded = await newer.value else { Issue.record("newer"); return }
        guard case .superseded = await older.value else { Issue.record("older must be superseded"); return }
        #expect(again.loading.isEmpty)
    }

    /// A02: fields a response leaves out keep their old value; the entry is cached and read back by a new repository (a
    /// cold start shows the last weather while it loads).
    @Test func mergeAndCache() async throws {
        let previous = JSONObject([("currentWeather", .object(JSONObject([("t1h", 3)]))), ("source", "KMA"), ("name", "x")])
        let merged = WeatherRepository.merge(previous, JSONObject([("currentWeather", .null), ("source", "VC"), ("dayChart", .array([]))]))
        #expect(merged.keys == ["currentWeather", "source", "dayChart"])
        #expect(merged["currentWeather"]?["t1h"] == 3, "a falsy field keeps the old value")
        #expect(merged["source"]?.stringValue == "VC")

        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tw-weather-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let clock = VirtualClock()
        let http = ScriptedWeatherHTTP(clock: clock) { _ in .answer(0, try! WeatherFixtures.body("kma-seoul")) }
        let repository = WeatherRepository(baseURL: Self.server, cacheDirectory: dir, http: http, clock: clock)
        let task = Task { await repository.load(seoul, units: koreanUnits, acceptLanguage: "ko", force: false) }
        await clock.quiesce()
        guard case .loaded(_, let entry, _) = await task.value else { Issue.record("not loaded"); return }
        let cold = WeatherRepository(baseURL: Self.server, cacheDirectory: dir, http: http, clock: clock)
        #expect(cold.cached(seoul)?.weather.jsonValue.jsonText == entry.weather.jsonValue.jsonText)
        #expect(cold.canLoad(seoul), "the gate lives in memory: a new process loads at once")
    }
}

private extension JSONObject {
    var jsonValue: JSONValue { .object(self) }
}

func s(_ v: JSONValue?) -> String { v?.stringValue ?? "" }

/// A flag set once from any task.
final class Done: @unchecked Sendable {
    private let lock = NSLock()
    private var flag = false
    var value: Bool { lock.withLock { flag } }
    func set() { lock.withLock { flag = true } }
}
func int(_ v: JSONValue?) -> Int { Int(v?.numberValue?.double ?? 0) }
