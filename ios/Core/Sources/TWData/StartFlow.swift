import Foundation
import TWDomain
import TWModel
import TWStorage

/// The device's location as the start page and the current position use it on iOS (the diagnostic, geolocation and
/// location-accuracy plugins of the Cordova build, #2959): `Util.locationStatus`, the permission, positions and the
/// request to turn location services on. The app implements it with CoreLocation (when-in-use authorization only); tests
/// pass doubles.
@MainActor
public protocol LocationAccess: AnyObject {
    /// `Util.locationStatus` (`LocationRecord`): nil while nothing was recorded (location services off at the start).
    var recorded: LocationPermission? { get }
    /// `cordova.plugins.diagnostic.isLocationEnabled`: location services are on.
    var servicesEnabled: Bool { get }
    /// `getLocationAuthorizationStatus` now.
    func status() -> LocationPermission
    /// `requestLocationAuthorization(WHEN_IN_USE)`: the system prompt, then the status it left; the record has taken a
    /// changed status by then (the plugin's state change handler).
    func request() async -> LocationPermission
    /// `WeatherUtil.getCurrentPosition`: the first fix of at most 60 s age within 60 s; nil on a location error or none
    /// within 60 s. Precise or approximate.
    func position() async -> Location?
    /// `locationAccuracy.request` on iOS: with location services off, the system's alert to turn them on; it settles at
    /// once.
    func requestServices()
}

/// S01's adds (StartCtrl, #2959): a city shortcut (`OnGetWeather`), a search result (`OnSelectResult`: a Places
/// prediction or, without a Places key, a bundled town) and the current position (`_onUseLocationService`). Each loads
/// the place's weather before it is saved; a saved place closes S01 (`close()`: `startVersion` stored, the last place
/// selected). One flow lives as long as its start page, as the controller did, with its own recorded status
/// (`gLocationAuthorizationStatus`). Port of the Android `StartFlow` (AN-10) with the Cordova iOS branches.
@MainActor
public final class StartFlow {
    /// What the position lookup ended in: the geocoded position, or the message of its failure.
    public enum Located: Sendable, Equatable {
        case found(JSONObject)
        case failed(LocationMessage)
    }

    public enum Outcome: Sendable, Equatable {
        /// A place was saved and S01 closed.
        case added
        /// O09: an alert titled `LOC_ERROR` with the message's catalog key.
        case alert(String)
        /// O04: the retry confirmation.
        case confirm(RetryConfirm)
        /// Nothing shows (the address geocode failed, as in Cordova).
        case none
    }

    public static let alreadyAdded = "LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED"
    public static let failedWeather = "LOC_FAIL_TO_GET_WEATHER_INFO"

    private let holder: any PlaceState
    private let repository: WeatherRepository
    private let geocode: GeocodeClient
    private let location: any LocationAccess
    private let acceptLanguage: () -> String
    private let telemetry: WeatherTelemetry?
    /// True for S01 (an add closes it: `startVersion` stored); false for S02's adds (IN-11), which only select the new
    /// place (`setCityIndex(getCityCount() - 1)`).
    private let closesStart: Bool

    /// `gLocationAuthorizationStatus`: the status the page recorded last.
    public private(set) var recorded: LocationPermission?

    public init(holder: any PlaceState, repository: WeatherRepository, geocode: GeocodeClient, location: any LocationAccess,
                acceptLanguage: @escaping () -> String, telemetry: WeatherTelemetry? = nil, closesStart: Bool = true) {
        self.holder = holder
        self.repository = repository
        self.geocode = geocode
        self.location = location
        self.acceptLanguage = acceptLanguage
        self.telemetry = telemetry
        self.closesStart = closesStart
    }

    /// `OnGetWeather(index)`: the shortcut's own name, address, country and coordinates.
    public func addShortcut(_ shortcut: CityShortcut) async -> Outcome {
        await add(Place(currentPosition: false, disable: false, name: shortcut.name, address: shortcut.address,
                        country: shortcut.country, location: Location(lat: shortcut.lat, long: shortcut.long)))
    }

    /// A chosen Places prediction: named by `PredictionName`, geocoded by `query` (S01: its full text,
    /// `getGeoInfoByAddr(description)`); a failed geocode shows nothing.
    public func addPrediction(fullText: String, firstMatch: Int?, word: String, query: String? = nil) async -> Outcome {
        guard let place = await predictionPlace(fullText: fullText, firstMatch: firstMatch, word: word, query: query) else {
            return .none
        }
        return await add(place)
    }

    /// The place of a chosen Places prediction, named and geocoded as `addPrediction` does; nil when the geocode failed.
    public func predictionPlace(fullText: String, firstMatch: Int?, word: String, query: String? = nil) async -> Place? {
        let name = PredictionName.of(fullText: fullText, firstMatch: firstMatch, word: word)
        guard !Task.isCancelled,
              let geoInfo = await geocode.byAddress(query ?? fullText, acceptLanguage: acceptLanguage()) else { return nil }
        var place = GeocodeClient.place(geoInfo, currentPosition: false)
        place.name = name
        return place
    }

    /// A geocoded place as an ordinary place with its own name (S02's find-by-location row, IN-11).
    public static func geoInfoPlace(_ geoInfo: JSONObject) -> Place {
        GeocodeClient.place(geoInfo, currentPosition: false)
    }

    /// A chosen bundled town, with the address and name StartCtrl builds; no geocode request.
    public func addTown(_ town: BundledTown) async -> Outcome {
        await add(Self.townPlace(town))
    }

    /// The place of a bundled town: the address and name StartCtrl builds, and its coordinates.
    public static func townPlace(_ town: BundledTown) -> Place {
        let info = town.placeInfo
        return Place(currentPosition: false, disable: false, name: info.name, address: info.address,
                     country: info.country, location: Location(lat: info.lat, long: info.long))
    }

    /// `saveCity` then `addCity`: an existing place, or a body that does not convert, is "already added".
    private func add(_ city: Place) async -> Outcome {
        guard !Task.isCancelled, let s = holder.state else { return .none }
        let loaded = await repository.load(city, units: s.units, acceptLanguage: acceptLanguage(), force: true)
        // Cancelled while it loaded (the star of a linked place closed S01, #3097): nothing is saved.
        if Task.isCancelled { return .none }
        switch loaded {
        case .loaded(_, let entry, _):
            var saved = city
            if let source = Self.source(entry.weather) { saved.source = source }
            guard let current = holder.state, PlaceList.add(current, saved) != nil else { return .alert(Self.alreadyAdded) }
            let select = closesStart ? PlaceList.closeStart : PlaceList.selectLast
            holder.change { st in st = PlaceList.add(st, saved).map(select) ?? st }
            telemetry?("favorite_change", ["action": .text("add")])
            return .added
        case .failed(_, let unconvertible):
            return .alert(unconvertible ? Self.alreadyAdded : Self.failedWeather)
        case .skipped, .superseded:
            return .none
        }
    }

    /// `_onUseLocationService`: the recorded status decides (`StartLocation`); a fix, rounded to three decimals, is
    /// geocoded (`/coord`) and its weather loaded; then the current position is enabled and named from the geocode. A
    /// grant from the prompt runs it again at once; every failure ends in O04 (#2871). `loading` shows and hides the
    /// loading overlay as StartCtrl did.
    public func useCurrentLocation(loading: (Bool) -> Void = { _ in }) async -> Outcome {
        // Abandoned (the star of a linked place closed S01, #3097): nothing more is asked or requested (CODEX-3195-13).
        if Task.isCancelled { return .none }
        let located = await locate(loading: loading)
        if Task.isCancelled { return .none }
        switch located {
        case .found(let geoInfo): return await saveCurrent(geoInfo, loading: loading)
        case .failed(let message):
            loading(false)
            return .confirm(StartLocation.retry(message, recorded: recorded, enabled: location.recorded?.granted ?? false))
        }
    }

    /// `updateCurrentPosition` of StartCtrl: the recorded status decides; a fix, rounded to three decimals, is geocoded
    /// (`/coord`). A grant from the prompt runs it again at once. `loading` shows the overlay at each attempt and hides it
    /// before the prompt when StartCtrl did; the caller hides it at the end.
    public func locate(loading: (Bool) -> Void = { _ in }) async -> Located {
        await locate(loading: loading, decide: StartLocation.decide) { [weak self] in self?.recorded = $0 }
    }

    /// `updateCurrentPosition` of StartCtrl or SearchCtrl (IN-11): `decide` gives the step and what the attempt records,
    /// which `record` stores (S02 records into TabCtrl's `gLocationAuthorizationStatus`, `WeatherSession.recorded`).
    public func locate(loading: (Bool) -> Void = { _ in },
                       decide: (LocationPermission?, LocationPermission) -> (step: StartLocation.Step, records: LocationPermission?),
                       record: (LocationPermission) -> Void) async -> Located {
        while true {
            // A cancelled attempt (an abandoned S01) asks for no position, prompt or geocode (CODEX-3195-13).
            if Task.isCancelled { return .failed(.notFound) }
            loading(true)
            let decision = decide(location.recorded, location.status())
            if let records = decision.records { record(records) }
            // `trackEvent('position', 'status', 'authorized', isLocationAuthorized ? 1 : 0)`.
            telemetry?("location_permission", ["outcome": .text(decision.step == .locate ? "granted" : "denied")])
            switch decision.step {
            case .locate:
                guard let fix = await location.position(), !Task.isCancelled else { return .failed(.notFound) }
                let normalized = GeoLocation.normalize(lat: fix.lat, long: fix.long)
                let at = Location(lat: normalized.lat, long: normalized.long)
                guard let geoInfo = await geocode.byLocation(at, acceptLanguage: acceptLanguage()) else {
                    return .failed(.noInformation)
                }
                return .found(geoInfo)
            case .ask(let hideLoading):
                if hideLoading { loading(false) }
                let answer = await location.request()
                if let message = StartLocation.afterPrompt(answer) { return .failed(message) }
            case .fail(let message):
                return .failed(message)
            }
        }
    }

    /// The geocoded position's weather; then `disableCity(false)` and `saveCity(…, true)`: the place at the selected index
    /// takes the geocode's name, address, country and location (a current position) and the weather's source. A failed
    /// request leaves the current position disabled; a body that does not convert disables it again.
    private func saveCurrent(_ geoInfo: JSONObject, loading: (Bool) -> Void) async -> Outcome {
        let place = GeocodeClient.place(geoInfo, currentPosition: true)
        guard let s = holder.state else { return .none }
        let result = await repository.load(place, units: s.units, acceptLanguage: acceptLanguage(), force: true)
        if Task.isCancelled { return .none }
        loading(false)
        switch result {
        case .loaded(_, let entry, _):
            let source = Self.source(entry.weather)
            holder.change { st in
                var enabled = PlaceList.disableCurrent(st, false)
                let i = enabled.placeIndex
                if enabled.places.indices.contains(i) { enabled.places[i] = Self.updateCity(enabled.places[i], place, source) }
                st = PlaceList.closeStart(enabled)
            }
            return .added
        case .failed(_, let unconvertible):
            if unconvertible {
                holder.change { st in st = PlaceList.disableCurrent(PlaceList.disableCurrent(st, false), true) }
                return .alert(Self.alreadyAdded)
            }
            return .alert(Self.failedWeather)
        case .skipped, .superseded:
            return .none
        }
    }

    static func source(_ weather: JSONObject) -> String? {
        guard let value = weather["source"], Js.truthy(value) else { return nil }
        return value.stringValue
    }

    /// `updateCity(index, city)` with the geocoded `city`: a current position takes its truthy name, country, address and
    /// location; another place only a location it lacks (#1971). Both take a truthy source.
    static func updateCity(_ place: Place, _ city: Place, _ source: String?) -> Place {
        var updated = place
        if let source { updated.source = source }
        if place.currentPosition {
            if let name = city.name, !name.isEmpty { updated.name = name }
            if let country = city.country, !country.isEmpty { updated.country = country }
            if let address = city.address, !address.isEmpty { updated.address = address }
            if let location = city.location { updated.location = location }
            return updated
        }
        let own = WeatherRequests.usesCoordinates(lat: place.location?.lat, address: place.address)
        if !own, let found = city.location, found.lat != 0 { updated.location = found }
        return updated
    }
}
