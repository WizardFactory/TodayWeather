import Foundation
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage

/// Records the analytics events the weather path reports (test code only).
@MainActor
final class EventRecorder {
    private(set) var events: [(name: String, params: [String: AnalyticsValue])] = []
    var telemetry: WeatherTelemetry { { [weak self] name, params in self?.events.append((name, params)) } }

    func outcomes(_ name: String) -> [String] {
        events.filter { $0.name == name }.compactMap { if case .text(let s)? = $0.params["outcome"] { s } else { nil } }
    }

    func durations(_ name: String) -> [Double] {
        events.filter { $0.name == name }.compactMap { if case .number(let n)? = $0.params["duration_ms"] { n } else { nil } }
    }
}

/// `weather_fetch` and `weather_load` (CODEX-IN15-1): the events `Monetization.track` gets from the weather path, as
/// `getWeatherByGeoInfo` (service.weatherutil.js) and TabCtrl's `updateWeatherData` report them, and as the Android
/// `WeatherRepository` and `WeatherSession` (AN-15) do. Durations are on the injected clock.
extension ClockedDataTests {
@MainActor
struct WeatherTelemetryTests {
    static let server = "https://server.test.invalid"

    /// Every request reports `weather_fetch`: success once a body parsed as JSON (also when it does not convert),
    /// `network_error` when the attempts fail or the body is not JSON, `invalid_input` when no URL can be built. The
    /// duration lies between the answer's time and the time the clock was moved to (the main actor reports it when it
    /// resumes).
    @Test func everyRequestReportsWeatherFetch() async throws {
        let body = try WeatherFixtures.body("kma-seoul")
        let clock = VirtualClock()
        let http = ScriptedWeatherHTTP(clock: clock, [.answer(1500, body), .answer(100, Data("{}".utf8)),
                                                       .answer(100, Data("not json".utf8))])
        let recorder = EventRecorder()
        let repository = WeatherRepository(baseURL: Self.server, cacheDirectory: nil, http: http, clock: clock,
                                           telemetry: recorder.telemetry)
        for _ in 0..<3 {
            let load = Task { await repository.load(seoul, units: koreanUnits, acceptLanguage: "ko", force: true) }
            await clock.advance(by: 2000)
            _ = await load.value
        }
        let nowhere = Place(currentPosition: false, disable: false, name: "없음")
        _ = await repository.load(nowhere, units: koreanUnits, acceptLanguage: "ko", force: true)
        #expect(recorder.outcomes("weather_fetch") == ["success", "success", "network_error", "invalid_input"])
        let durations = recorder.durations("weather_fetch")
        #expect(durations.count == 4 && (1500...2000).contains(durations[0]) && (100...2000).contains(durations[1]))
        #expect(durations.last == 0)
        #expect(recorder.outcomes("weather_load").isEmpty, "the repository reports requests, not loads")
    }

    /// A session over one scripted server whose first load is the selected place's.
    static func firstLoad(_ answers: [ScriptedWeatherHTTP.Behavior]) async throws -> EventRecorder {
        let clock = VirtualClock()
        let http = ScriptedWeatherHTTP(clock: clock, answers)
        let recorder = EventRecorder()
        let holder = AppStateHolder(store: MemoryStore())
        holder.load(AppState(places: [.currentPositionPlaceholder, seoul], placeIndex: 1, units: koreanUnits,
                             settings: Settings(startupPage: "0", refreshInterval: "0", theme: "light")))
        let repository = WeatherRepository(baseURL: server, cacheDirectory: nil, http: http, clock: clock,
                                           telemetry: recorder.telemetry)
        let session = WeatherSession(repository: repository, holder: holder, acceptLanguage: { "ko-KR" }, clock: clock,
                                     random: { 0 }, telemetry: recorder.telemetry)
        session.reload(.initial)
        await clock.advance(by: 60_000)
        _ = await eventually { !recorder.outcomes("weather_load").isEmpty }
        // A resume within ten minutes: the gate stops it, and a stopped load reports nothing.
        session.reload(.resume)
        await clock.advance(by: 1000)
        return recorder
    }

    /// Each load of the selected place reports `weather_load`: success, `network_error` for a failed request,
    /// `invalid_response` for a body that does not convert; a load the gate stops reports nothing.
    @Test func everyLoadReportsWeatherLoad() async throws {
        let body = try WeatherFixtures.body("kma-seoul")
        let loaded = try await Self.firstLoad([.answer(700, body)])
        #expect(loaded.outcomes("weather_load") == ["success"])
        #expect(loaded.durations("weather_load").allSatisfy { (700...60_000).contains($0) })
        #expect(loaded.outcomes("weather_fetch") == ["success"])

        let unconvertible = try await Self.firstLoad([.answer(100, Data("{}".utf8))])
        #expect(unconvertible.outcomes("weather_load") == ["invalid_response"])
        #expect(unconvertible.outcomes("weather_fetch") == ["success"])

        let failed = try await Self.firstLoad(Array(repeating: .fail(100, 500), count: WeatherRequests.attempts))
        #expect(failed.outcomes("weather_load") == ["network_error"])
        #expect(failed.outcomes("weather_fetch") == ["network_error"])
    }
}
}
