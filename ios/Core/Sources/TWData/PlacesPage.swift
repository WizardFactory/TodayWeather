import Foundation
import Observation
import TWDomain
import TWModel
import TWStorage

/// One visit of the saved places S02 (SearchCtrl, controller.searchctrl.js, #2960), new each time the Locations tab
/// opens (`cache: false`). Port of the Android `PlacesPage` (AN-11) with SearchCtrl's iOS branches:
/// - `open()`: the bells of the visit (`Push.hasPushInfo`, read once), then each enabled place loads in turn through the
///   ten-minute gate, failures silent (`updateCityEvent`); an enabled current position also looks itself up (the
///   recorded status decides, as `updateCurrentPosition` on iOS) and, when found, loads again with its stored location;
/// - `delete` and `setCurrentPosition`: with the row's bell on, the place's alarms go first (`removeAlarms`, which is
///   `Push.removePushListByCityIndex`: `DELETE /push`, no other record renumbered, A24); turning the current position
///   on while it has no temperature finds it, names it from the geocode and loads it (`updateCurrentPositionWeather`);
/// - `findByLocation` and the adds of a search result, one at a time behind the loading overlay; an add selects the
///   new place (`onAdded`, then the app's `goPage`); failures end in O09 or O03 of type `search` (`onPopup`), whose OK
///   finds by location again (A26).
/// SearchCtrl records the location status into TabCtrl's `gLocationAuthorizationStatus` (`WeatherSession.recorded`).
@MainActor
@Observable
public final class PlacesPage {
    @ObservationIgnored private let holder: AppStateHolder
    @ObservationIgnored private let repository: WeatherRepository
    @ObservationIgnored private let session: WeatherSession
    @ObservationIgnored private let flow: StartFlow
    @ObservationIgnored private let location: any LocationAccess
    @ObservationIgnored private let removeAlarms: (Int) -> Void
    @ObservationIgnored private let telemetry: WeatherTelemetry?
    /// The action behind the overlay (find-by-location, an add, the first enable), while it runs.
    @ObservationIgnored public private(set) var action: Task<Void, Never>?

    /// O09 (`.alert`) or O03 `search` (`.confirm`) to show.
    @ObservationIgnored public var onPopup: (StartFlow.Outcome) -> Void = { _ in }
    /// A search result was added and selected; `goPage()` follows.
    @ObservationIgnored public var onAdded: () -> Void = {}

    /// Each row's bell as the visit opened (`Push.hasPushInfo`, not read again; a deleted row's goes with it).
    public private(set) var hasPush: [Bool] = []
    /// The loading overlay (`$ionicLoading`).
    public private(set) var loading = false
    /// The geocoded position find-by-location gave: its result row.
    public private(set) var found: JSONObject?
    /// Counts the found positions of `findByLocation`: each one replaces the results, also when its name is the word
    /// already typed (CODEX-IN11-1).
    public private(set) var finds = 0
    /// The visit's loads and its lookup of the current position (for tests that wait for them).
    @ObservationIgnored public private(set) var visit: Task<Void, Never>?
    @ObservationIgnored public private(set) var lookup: Task<Void, Never>?

    public init(holder: AppStateHolder, repository: WeatherRepository, session: WeatherSession, geocode: GeocodeClient,
                location: any LocationAccess, acceptLanguage: @escaping () -> String, telemetry: WeatherTelemetry? = nil,
                removeAlarms: @escaping (Int) -> Void) {
        self.holder = holder
        self.repository = repository
        self.session = session
        self.location = location
        self.removeAlarms = removeAlarms
        self.telemetry = telemetry
        flow = StartFlow(holder: holder, repository: repository, geocode: geocode, location: location,
                         acceptLanguage: acceptLanguage, telemetry: telemetry, closesStart: false)
    }

    /// SearchCtrl's `init`.
    public func open() {
        guard let s = holder.state else { return }
        hasPush = s.places.indices.map { PushRegistration.hasPush(s.push.records, index: $0) }
        // The stored weather of every row (`city.currentWeather`), read before the rows are drawn.
        for place in s.places { _ = repository.cached(place) }
        let holder = self.holder, session = self.session
        visit = Task { @MainActor in
            var i = 0
            while let places = holder.state?.places, places.indices.contains(i) {
                await session.refresh(places[i])
                i += 1
            }
        }
        if let current = s.places.first, current.currentPosition, !current.disable {
            lookup = Task { @MainActor [weak self] in
                guard let self, case .found = await locate() else { return }
                // `WeatherInfo.reloadCity(0)` and `loadWeatherData(0)`: the stored location again (the found one is not
                // applied, as SearchCtrl's `updateCity` is commented out).
                guard let place = holder.state?.places.first, place.currentPosition else { return }
                await session.refresh(place, force: true)
            }
        }
    }

    /// `OnDeleteCity(index)`: no confirmation; never the current position.
    public func delete(_ index: Int) {
        guard let s = holder.state, s.places.indices.contains(index), !s.places[index].currentPosition else { return }
        if hasPush.indices.contains(index) {
            if hasPush[index] { removeAlarms(index) }
            hasPush.remove(at: index)
        }
        holder.change { $0 = PlaceList.remove($0, index) }
        telemetry?("favorite_change", ["action": .text("remove")])
    }

    /// `OnDisableCity`: the current position's switch.
    public func setCurrentPosition(_ on: Bool) {
        guard let s = holder.state, let current = s.places.first, current.currentPosition else { return }
        holder.change { $0 = PlaceList.disableCurrent($0, !on) }
        if !on {
            if hasPush.first == true { removeAlarms(0) }
            return
        }
        // `city.t1h === '-'`: it is enabled the first time.
        guard !hasTemperature(current) else { return }
        perform { [weak self] in
            guard let self else { return }
            switch await locate(loading: { [weak self] in self?.loading = $0 }) {
            case .found(let geoInfo):
                // `WeatherInfo.updateCity(0, geoInfo)`, then `updateWeatherData(0)`.
                let geo = GeocodeClient.place(geoInfo, currentPosition: true)
                holder.change { st in
                    if let first = st.places.first, first.currentPosition { st.places[0] = StartFlow.updateCity(first, geo, nil) }
                }
                if let place = holder.state?.places.first, place.currentPosition { await session.refresh(place, force: true) }
            case .failed(let message):
                confirm(message)
            }
        }
    }

    /// `OnSearchCurrentPosition`: the geocoded position as the result row, or O03 `search`.
    public func findByLocation() {
        perform { [weak self] in
            guard let self else { return }
            switch await locate(loading: { [weak self] in self?.loading = $0 }) {
            case .found(let geoInfo):
                found = geoInfo
                finds += 1
            case .failed(let message): confirm(message)
            }
        }
    }

    /// A bundled town (`OnSelectResult`, town.js result).
    public func addTown(_ town: BundledTown) {
        perform { [weak self] in await self?.finish(self?.flow.addTown(town)) }
    }

    /// A Places prediction (`OnSelectResult`, Google's result): named by `PredictionName`, geocoded by its terms joined
    /// with commas (`_makeQueryString`).
    public func addPrediction(fullText: String, firstMatch: Int?, word: String) {
        perform { [weak self] in
            await self?.finish(self?.flow.addPrediction(fullText: fullText, firstMatch: firstMatch, word: word,
                                                        query: SearchQuery.of(fullText)))
        }
    }

    /// The find-by-location row (`OnSelectResult`, the geocode server's result): added as an ordinary place.
    public func addFound() {
        guard let geoInfo = found else { return }
        found = nil
        perform { [weak self] in await self?.finish(self?.flow.addGeoInfo(geoInfo)) }
    }

    /// The search was cleared (Cancel, Edit, a new word): the find-by-location row goes too (as AN-11).
    public func clearFound() {
        found = nil
    }

    /// An O03 `search` button after the popup closed: OK finds by location again (A26); Settings and Close only close it
    /// here (the app opens the Settings app).
    public func retryButton(_ button: RetryButton) {
        if button == .retry { findByLocation() }
    }

    /// Whether `place` has a temperature in the weather this process holds (`city.t1h !== '-'`).
    public func hasTemperature(_ place: Place) -> Bool {
        guard let t1h = repository.cached(place)?.weather["currentWeather"]?["t1h"] else { return false }
        return t1h.stringValue.map { !JSString.equal($0, "-") } ?? true
    }

    // MARK: -

    private func locate(loading: (Bool) -> Void = { _ in }) async -> StartFlow.Located {
        let session = self.session
        let located = await flow.locate(loading: loading, decide: SearchLocation.decide) { session.recorded = $0 }
        return located
    }

    private func confirm(_ message: LocationMessage) {
        onPopup(.confirm(SearchLocation.retry(message, recorded: session.recorded, enabled: location.recorded?.granted ?? false)))
    }

    private func finish(_ outcome: StartFlow.Outcome?) {
        switch outcome {
        case .added?: onAdded()
        case .alert?, .confirm?: onPopup(outcome!)
        case .none?, nil: break
        }
    }

    /// One action at a time, behind the overlay.
    private func perform(_ body: @escaping @MainActor () async -> Void) {
        guard action == nil else { return }
        loading = true
        action = Task { @MainActor [weak self] in
            await body()
            self?.loading = false
            self?.action = nil
        }
    }
}
