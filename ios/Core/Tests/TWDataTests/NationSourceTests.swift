import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage

/// The requests of the nationwide pages and the warnings (IN-13, #2962 AC1) on a virtual clock: the paths with the
/// units and the WebView's `Accept-Language`; S10/S11's `_getHttp(url, 20000)` (three attempts 2 s apart, 20 s each,
/// the first to settle decides); S12's one `$http` with a 3 s timeout; and the answers the pages read: a production
/// answer, empty and malformed answers, error statuses and timeouts. Port of the Android `NationSourceTest`.
extension ClockedDataTests {
@MainActor
struct NationSourceTests {
    static let server = "https://server.test.invalid"
    static let korean = "ko-KR,ko;q=0.9"

    /// Runs `body` on the virtual clock, advancing one deadline at a time until it returns.
    private func run<T: Sendable>(_ clock: VirtualClock, _ body: @escaping @Sendable () async -> T) async -> (T, Int64) {
        let done = Done()
        let task = Task { () -> (T, Int64) in
            let r = await body()
            let at = clock.elapsed
            done.set()
            return (r, at)
        }
        await clock.quiesce()
        while !done.value, let next = clock.nextDeadline {
            await clock.advance(to: next)
            for _ in 0..<40 where !done.value { try? await Task.sleep(for: .milliseconds(5)) }
        }
        return await task.value
    }

    private func nation(_ behaviors: [ScriptedWeatherHTTP.Behavior], units: UnitSettings = koreanUnits)
        async -> (PageLoad<NationResponse>, Int64, ScriptedWeatherHTTP, VirtualClock) {
        let clock = VirtualClock()
        let http = ScriptedWeatherHTTP(clock: clock, behaviors)
        let source = NationSource(baseURL: Self.server, http: http, clock: clock)
        let (result, at) = await run(clock) { await source.nation(region: "KR", units: units, acceptLanguage: Self.korean) }
        return (result, at, http, clock)
    }

    private func special(_ behaviors: [ScriptedWeatherHTTP.Behavior]) async -> (PageLoad<JSONValue>, Int64, ScriptedWeatherHTTP) {
        let clock = VirtualClock()
        let http = ScriptedWeatherHTTP(clock: clock, behaviors)
        let source = NationSource(baseURL: Self.server, http: http, clock: clock)
        let (result, at) = await run(clock) { await source.special(acceptLanguage: Self.korean) }
        return (result, at, http)
    }

    private func loaded<T>(_ load: PageLoad<T>) -> T? {
        if case .loaded(let value) = load { return value }
        return nil
    }

    @Test func thePathsAreTheCordovaOnes() {
        #expect(NationSource.nationURL(base: Self.server, region: "KR", units: koreanUnits) ==
                "\(Self.server)/v000903/nation/KR?temperatureUnit=C&windSpeedUnit=m/s&pressureUnit=hPa&distanceUnit=km" +
                "&precipitationUnit=mm&airUnit=airkorea&airForecastSource=kaq")
        var units = koreanUnits
        units.windSpeedUnit = "km/h"
        units.airUnit = "airnow"
        #expect(NationSource.nationURL(base: Self.server, region: "KR", units: units).contains("windSpeedUnit=km/h&"))
        #expect(NationSource.nationURL(base: Self.server, region: "KR", units: units).contains("airUnit=airnow&"))
        #expect(NationSource.specialURL(base: Self.server) == "\(Self.server)/v000903/kma/special")
        #expect(NationSource.nationTimeout == .seconds(20))
        #expect(NationSource.specialTimeout == .seconds(3))
    }

    @Test func theNationAnswerLoadsWithTheUnitsAndTheWebViewsLanguage() async throws {
        let body = try WeatherFixtures.body("nation")
        let (result, at, http, _) = await nation([.answer(300, body)])
        let response = try #require(loaded(result))
        #expect(response.weather.count == 15)
        #expect(response.air.count == 17)
        #expect(at == 300)
        #expect(http.attempts.count == 1)
        let attempt = try #require(http.attempts.first)
        #expect(attempt.url.absoluteString == NationSource.nationURL(base: Self.server, region: "KR", units: koreanUnits))
        #expect(attempt.headers == ["Accept-Language": Self.korean])
    }

    /// A late answer: `_retryGetHttp` sends again 2 s and 4 s after the first attempt; the first answer decides and the
    /// other attempts are cancelled.
    @Test func aLateAnswerSendsThreeAttemptsTwoSecondsApart() async throws {
        let body = try WeatherFixtures.body("nation")
        let (result, at, http, clock) = await nation([.answer(5000, body), .hang, .hang])
        #expect(loaded(result) != nil)
        #expect(http.attempts.map(\.at) == [0, 2000, 4000])
        #expect(at == 5000)
        await clock.quiesce()
        #expect(clock.pendingSleeps == 0, "the other attempts were cancelled")
        #expect(http.cancelled.count == 2)
    }

    /// No answer at all: each attempt ends after 20 s; the first timeout decides (a failure), 20 s after the start.
    @Test func noAnswerFailsAfterTwentySeconds() async {
        let (result, at, http, _) = await nation([.hang, .hang, .hang])
        #expect(loaded(result) == nil)
        #expect(http.attempts.map(\.at) == [0, 2000, 4000])
        #expect(at == 20_000)
    }

    /// An error status at once settles the request: one attempt, a failure.
    @Test func anErrorStatusFailsAtOnce() async {
        let (result, at, http, _) = await nation([.fail(50, 500), .hang, .hang])
        #expect(loaded(result) == nil)
        #expect(http.attempts.count == 1)
        #expect(at == 50)
    }

    /// The empty answer loads (the labels show their names); an answer that is not a JSON object fails, as the
    /// callback's `data.weather` finds nothing or throws: a text body, `null`, a list, a number, a body that is not JSON
    /// (a bare word, which `JSON.parse` refuses).
    @Test func emptyAndMalformedNationAnswers() async throws {
        let empty = try #require(loaded(await nation([.answer(10, Data(#"{"nation":"KR","weather":[],"air":[]}"#.utf8))]).0))
        #expect(empty.weather.isEmpty && empty.air.isEmpty)
        let noLists = try #require(loaded(await nation([.answer(10, Data("{}".utf8))]).0))
        #expect(noLists.weather.isEmpty && noLists.air.isEmpty)
        for text in ["Internal Server Error", "null", "[]", "1", "\"x\"", "", "{\"weather\":"] {
            let (result, _, http, _) = await nation([.answer(10, Data(text.utf8))])
            #expect(loaded(result) == nil, "\(text)")
            #expect(http.attempts.count == 1, "\(text): settled by the first answer")
        }
    }

    @Test func theWarningsAnswerLoadsWithOneRequest() async throws {
        let body = try WeatherFixtures.body("special")
        let (result, at, http) = await special([.answer(200, body)])
        let list = try #require(loaded(result))
        #expect(list.arrayValue?.count == 3)
        #expect(at == 200)
        let attempt = try #require(http.attempts.first)
        #expect(http.attempts.count == 1)
        #expect(attempt.url.absoluteString == "\(Self.server)/v000903/kma/special")
        #expect(attempt.headers == ["Accept-Language": Self.korean])
    }

    /// `$http`'s 3 s timeout, no retry; an error status fails at once.
    @Test func theWarningsRequestTimesOutAfterThreeSecondsWithoutRetry() async {
        let (late, at, http) = await special([.answer(3500, Data("[]".utf8)), .hang])
        #expect(loaded(late) == nil)
        #expect(at == 3000)
        #expect(http.attempts.count == 1)
        let (failed, failedAt, failedHttp) = await special([.fail(40, 500), .hang])
        #expect(loaded(failed) == nil)
        #expect(failedAt == 40)
        #expect(failedHttp.attempts.count == 1)
    }

    /// `responseType: 'json'`: a body that is not JSON reads as null (the page shows no card); `[]` and other JSON load
    /// as they are.
    @Test func emptyAndMalformedWarningAnswers() async throws {
        #expect(loaded(await special([.answer(10, Data("[]".utf8))]).0) == .array([]))
        #expect(loaded(await special([.answer(10, Data("{}".utf8))]).0) == .object(JSONObject()))
        for text in ["Internal Server Error", "", "[1,"] {
            #expect(loaded(await special([.answer(10, Data(text.utf8))]).0) == .null, "\(text)")
        }
    }

    /// Without a server URL nothing is sent and both requests fail.
    @Test func withoutAServerNothingIsSent() async {
        let clock = VirtualClock()
        let http = ScriptedWeatherHTTP(clock: clock, [])
        for base in [nil, ""] as [String?] {
            let source = NationSource(baseURL: base, http: http, clock: clock)
            let (n, _) = await run(clock) { await source.nation(region: "KR", units: koreanUnits, acceptLanguage: Self.korean) }
            let (w, _) = await run(clock) { await source.special(acceptLanguage: Self.korean) }
            #expect(loaded(n) == nil)
            #expect(loaded(w) == nil)
        }
        #expect(http.attempts.isEmpty)
    }
}
}
