import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
@testable import TodayWeather

/// The device's location for the app-hosted start tests (IN-10): the system's authorization and the location services
/// switch, the prompt's answer and the fixes, kept in a `LocationRecord` as `CoreLocationAccess` keeps it.
@MainActor
final class TestLocation: AppLocation {
    var system: SystemAuthorization
    var servicesEnabled: Bool
    var answer: SystemAuthorization
    var fixes: [Location?]
    var onLocationOn: () -> Void = {}
    private(set) var record = LocationRecord()
    private(set) var prompts = 0
    private(set) var positions = 0

    init(services: Bool = true, system: SystemAuthorization, answer: SystemAuthorization = .denied, fixes: [Location?] = []) {
        self.system = system
        servicesEnabled = services
        self.answer = answer
        self.fixes = fixes
        record.authorizationReported(LocationPermission(system))
        check()
    }

    var recorded: LocationPermission? { record.status }
    func status() -> LocationPermission { LocationPermission(system) }
    func check() { record.check(servicesEnabled: servicesEnabled, status: LocationPermission(system)) }

    func request() async -> LocationPermission {
        prompts += 1
        if system == .notDetermined && servicesEnabled {
            system = answer
            if record.authorizationReported(LocationPermission(answer)) { onLocationOn() }
        }
        return LocationPermission(system)
    }

    func position() async -> Location? {
        positions += 1
        return fixes.isEmpty ? nil : fixes.removeFirst()
    }

    func requestServices() {}
}

/// Google's predictions for a word, as the Places SDK would give them.
@MainActor
final class TestPlaceSearch: PlaceSearch {
    var answers: [String: [Prediction]]
    private(set) var words: [String] = []

    init(_ answers: [String: [Prediction]]) { self.answers = answers }

    func predictions(_ word: String) async -> [Prediction]? {
        words.append(word)
        return answers[word] ?? []
    }
}

/// The legacy server for the start page: the geocode answers and the corpus weather.
enum StartServer {
    static let geocodeSeoul = #"{"name":"회현동","country":"KR","address":"서울특별시 중구 회현동","location":{"lat":37.56,"long":126.98}}"#
    static let geocodeLondon = #"{"name":"London","country":"GB","address":"London, UK","location":{"lat":51.507,"long":-0.128}}"#

    static func server(weather: Bool = true) throws -> WeatherTabTests.Server {
        let seoul = try References.data("forecast-kma-seoul.input.json")
        return WeatherTabTests.Server { url in
            let path = url.path
            if path.hasPrefix("/geocode/v000903/coord/") { return .answer(0, Data(geocodeSeoul.utf8)) }
            if path.hasPrefix("/geocode/v000903/addr/") { return .answer(0, Data(geocodeLondon.utf8)) }
            return weather ? .answer(0, seoul) : .fail(0, 503)
        }
    }
}

extension References {
    static func data(_ name: String) throws -> Data { try Data(contentsOf: url(name)) }
}

/// A start page over doubles: a fresh state (S01), the server double, the location double and the Places double.
@MainActor
struct StartFixture {
    let holder: AppStateHolder
    let shell: ShellModel
    let page: StartPage
    let server: WeatherTabTests.Server
    let location: TestLocation
    var closed: () -> Int

    init(location: TestLocation, search: (any PlaceSearch)? = nil, weather: Bool = true, languages: [String] = ["ko-KR"]) throws {
        holder = AppStateHolder(store: MemoryStore())
        holder.load(AppState(units: .defaults(region: "KR")))
        shell = ShellModel(holder: holder, locale: ShellLocale(preferredLanguages: languages), version: "test")
        server = try StartServer.server(weather: weather)
        self.location = location
        let repository = WeatherRepository(baseURL: "https://server.test.invalid", cacheDirectory: nil, http: server)
        let flow = StartFlow(holder: holder, repository: repository,
                             geocode: GeocodeClient(baseURL: "https://server.test.invalid", http: server),
                             location: location, acceptLanguage: { "ko-KR,ko;q=0.9" })
        let counter = Counter()
        page = StartPage(shell: shell, flow: flow, search: search, towns: { StartPage.bundledTowns() },
                         openURL: { _ in }, closed: { counter.value += 1 })
        page.predictionDelay = .milliseconds(10)
        closed = { counter.value }
    }

    final class Counter { var value = 0 }

    var paths: [String] { server.requests.map { $0.0.path(percentEncoded: true) } }
}
