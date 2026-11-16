import Foundation
import Observation
import TWDomain
import TWModel
import TWStorage

/// The loading of the weather pages (TabCtrl in controller.tabctrl.js, #2957): `loadWeatherData` with the ten-minute
/// gate and the refresh timer, the `reloadEvent` senders, the swipes between places and the retry confirmation (O03).
/// A response applies to the place that requested it (the A01 fix, `WeatherRepository`); what it changes in the place
/// (`updateCity`) and a photo for it are saved through the `AppStateHolder`. Each load of the current position also
/// looks it up (`location`, IN-10): a new position updates it and loads again; failures open O03's position variants
/// (`positionRetry`). With no enabled place the weather pages ask how to start (O02, `startPopup`). Port of the Android
/// `WeatherSession` with the Cordova iOS branches of `updateCurrentPosition`.
@MainActor
@Observable
public final class WeatherSession {
    /// Who asks for a reload (`reloadEvent` senders).
    public enum Sender: Sendable, Equatable {
        /// The app opened (TabCtrl `init`).
        case initial
        /// The selected Hourly, Daily or Air tab was tapped again.
        case tab
        /// The app came back to the foreground; gated.
        case resume
        /// Back from the place search (IN-10, IN-11); gated.
        case search
        /// The refresh interval passed.
        case timer
        /// The retry confirmation's OK.
        case retry
        /// The refresh interval setting changed (IN-12): only the timer restarts.
        case refreshInterval
        /// An entry link selected a place (IN-16).
        case deeplink
        /// A notification tap selected a place (`reloadEvent 'push'`, IN-14); loads at once.
        case push
        /// Location services turned on (`locationOn`, IN-10): only a selected current position loads.
        case locationOn
        /// O02 chose the current position (`startPopup`, IN-10); loads at once.
        case startPopup
    }

    @ObservationIgnored public let repository: WeatherRepository
    @ObservationIgnored private let holder: AppStateHolder
    @ObservationIgnored private let acceptLanguage: () -> String
    @ObservationIgnored private let photos: () -> WeatherPhotos?
    @ObservationIgnored private let loadPhotos: () -> Void
    @ObservationIgnored private let clock: any AppClock
    @ObservationIgnored private let random: () -> Double
    @ObservationIgnored private let telemetry: WeatherTelemetry?
    @ObservationIgnored private let location: (any LocationAccess)?
    @ObservationIgnored private var timer: Task<Void, Never>?

    /// TabCtrl's `gLocationAuthorizationStatus`: TabCtrl's iOS branch records none itself; S02's find-by-location
    /// records the status it read (IN-11), and O03's position variants follow it.
    @ObservationIgnored public var recorded: LocationPermission?

    /// O03 of type `forecast`: a failed lookup of the current position, with its variant's buttons.
    public private(set) var positionRetry: RetryConfirm?

    /// O02 is open (`startPopup`).
    public private(set) var startPopup = false

    /// O02's radio value (`data.autoSearch`): whether location services were on when the weather pages opened (TabCtrl
    /// `init`), kept for its next opening in this app open.
    public private(set) var autoSearch: Bool

    /// The current position's lookup runs (TabCtrl's loading indicator for the current position).
    public private(set) var locating = false
    /// Lookups started so far; a lookup ends the turn only while it is the latest (CODEX-IN10-2).
    @ObservationIgnored private var lookups = 0
    /// The lookup started last (running or finished); awaiting it waits for that lookup's end.
    @ObservationIgnored public private(set) var lookup: Task<Void, Never>?

    /// The retry confirmation is open (`LOC_ERROR`, `LOC_FAIL_TO_GET_WEATHER_INFO`, `LOC_CLOSE` and `LOC_OK`).
    public private(set) var retry = false

    /// TabCtrl's `applyEvent`s so far: one at each `loadWeatherData` (also when the gate stops the load) and one after
    /// each applied response. The weather pages apply the selected place on each.
    public private(set) var applies = 0

    public init(repository: WeatherRepository, holder: AppStateHolder, acceptLanguage: @escaping () -> String,
                photos: @escaping () -> WeatherPhotos? = { nil }, loadPhotos: @escaping () -> Void = {},
                clock: any AppClock = SystemClock(), random: @escaping () -> Double = { Double.random(in: 0..<1) },
                telemetry: WeatherTelemetry? = nil, location: (any LocationAccess)? = nil) {
        self.repository = repository
        self.holder = holder
        self.acceptLanguage = acceptLanguage
        self.photos = photos
        self.loadPhotos = loadPhotos
        self.clock = clock
        self.random = random
        self.telemetry = telemetry
        self.location = location
        autoSearch = location?.servicesEnabled ?? false
    }

    /// The selected place, as `WeatherInfo.getCityOfIndex(getCityIndex())`.
    public var selected: Place? {
        guard let s = holder.state, s.places.indices.contains(s.placeIndex) else { return nil }
        return s.places[s.placeIndex]
    }

    /// The record the pages apply for `place`: its weather (this process or the cache) with its own fields.
    public func record(_ place: Place) -> JSONObject { cityRecord(place, repository.cached(place)) }

    /// TabCtrl's loading indicator (`showLoadingIndicator`): while the selected place's request is in flight; for the
    /// current position with a location lookup, while the lookup runs (it hides the indicator when it settles).
    public var loadingSelected: Bool {
        guard let place = selected else { return false }
        if place.currentPosition && location != nil { return locating }
        return repository.loading.contains(WeatherRepository.key(place))
    }

    /// `reloadEvent`: ignored while a retry confirmation is open; a resume or a return from search waits for the gate;
    /// `locationOn` reloads only the current position; the refresh-interval setting restarts the timer only. Otherwise
    /// `reloadCity` and `loadWeatherData`.
    public func reload(_ sender: Sender) {
        if retry || positionRetry != nil { return }
        guard let s = holder.state, let place = selected else { return }
        switch sender {
        case .resume, .search:
            if !repository.canLoad(place) { return }
        case .locationOn:
            if !place.currentPosition { return }
        case .refreshInterval:
            restartTimer(s)
            return
        default:
            break
        }
        repository.invalidate(place)
        loadWeatherData()
    }

    /// A notification tap (`reloadEvent 'push'`) or an entry link selecting `index` (`setCityIndex`, which refuses an
    /// index outside the places), then a reload that loads at once unless the confirmation is open.
    public func openPlace(_ index: Int, sender: Sender = .deeplink) {
        guard let s = holder.state else { return }
        if index >= 0 && index < s.places.count { holder.change { $0.placeIndex = index } }
        reload(sender)
    }

    /// A unit or setting change (`_resetUpdateTimeCities`, IN-12): every place may load again, then the selected one
    /// loads unless the retry confirmation is open (`reloadEvent 'resume'`).
    public func settingChanged() {
        repository.invalidateAll()
        reload(.resume)
    }

    /// `onSwipeLeft` (the header swiped left, or its right arrow): the next place, then a gated load.
    public func next() { move(PlaceIndex.next) }

    /// `onSwipeRight` (the header swiped right, or its left arrow): the previous place, then a gated load.
    public func previous() { move(PlaceIndex.previous) }

    /// The retry confirmation's Close.
    public func closeRetry() { retry = false }

    /// O03 `forecast`'s Close, or its Settings: the confirmation closes.
    public func closePositionRetry() { positionRetry = nil }

    /// O03 `forecast`'s OK: `reloadEvent 'retryPopup'` once it has closed.
    public func confirmPositionRetry() {
        positionRetry = nil
        Task { @MainActor [weak self] in self?.reload(.retry) }
    }

    /// O03 `forecast`'s Search: `disableCity(true)`; the app opens the Locations tab.
    public func searchInsteadOfPosition() {
        positionRetry = nil
        holder.change { $0 = PlaceList.disableCurrent($0, true) }
    }

    /// `startPopup()`: O02 asks how to start, opened with no enabled place by a weather page, a tap on a weather or Air
    /// tab (`doTabForecast`) or a share without a location (`doTabShare`, IN-16).
    public func openStartPopup() { startPopup = true }

    /// O02's radio rows.
    public func chooseAutoSearch(_ value: Bool) { autoSearch = value }

    /// O02's OK: it closes, and `data.autoSearch` true (Cordova's inverted rows, A07: the row 지역 검색으로 시작) enables
    /// the current position (`disableCity(false)`) and loads it (`reloadEvent 'startPopup'`); false leaves the places as
    /// they are for the Locations tab. Returns the answer.
    @discardableResult
    public func startChoice() -> Bool {
        startPopup = false
        guard autoSearch else { return false }
        holder.change { $0 = PlaceList.disableCurrent($0, false) }
        reload(.startPopup)
        return true
    }

    /// The retry confirmation's OK: a forced reload after it closed (`setTimeout(…, 0)` in `showRetryConfirm`).
    public func confirmRetry() {
        retry = false
        Task { @MainActor [weak self] in self?.reload(.retry) }
    }

    /// The photo feed arrived (`loadWeatherPhotos`): each place without a photo gets one for its cached weather.
    public func photosLoaded() {
        guard let feed = photos(), let s = holder.state else { return }
        var chosen: [(Int, String, String)] = []
        for (i, place) in s.places.enumerated() where place.photo == nil {
            if let photo = photoFor(repository.cached(place)?.weather, feed) {
                chosen.append((i, WeatherRepository.key(place), photo))
            }
        }
        if chosen.isEmpty { return }
        holder.change { st in
            for (i, key, photo) in chosen where st.places.indices.contains(i) && WeatherRepository.key(st.places[i]) == key {
                st.places[i].photo = photo
            }
        }
    }

    private func move(_ step: ([Bool], Int) -> Int) {
        guard let s = holder.state else { return }
        let disabled = s.places.map(\.disable)
        if PlaceIndex.enabledCount(disabled) == 1 { return }
        let index = step(disabled, s.placeIndex)
        if index != s.placeIndex { holder.change { $0.placeIndex = index } }
        loadWeatherData()
    }

    /// `loadWeatherData`: restarts the timer and fires `applyEvent`, then loads the selected place unless the gate stops it.
    private func loadWeatherData() {
        guard let s = holder.state else { return }
        restartTimer(s)
        applies += 1
        guard let place = selected, repository.canLoad(place) else { return }
        let units = s.units
        let language = acceptLanguage()
        Task { @MainActor [weak self] in
            guard let self else { return }
            let started = clock.now
            let result = await repository.load(place, units: units, acceptLanguage: language, force: false)
            // `updateWeatherData` reports each load; an answer a later request replaced applies nowhere, so it is no load.
            let outcome: String? = switch result {
            case .loaded: "success"
            case .failed(let network, _): network ? "network_error" : "invalid_response"
            case .skipped, .superseded: nil
            }
            if let outcome {
                telemetry?("weather_load", ["outcome": .text(outcome),
                                            "duration_ms": .number((clock.now.timeIntervalSince(started) * 1000).rounded())])
            }
            switch result {
            case .loaded(let key, let entry, let updated): save(key: key, entry: entry, updated: updated)
            // `showRetryConfirm(strError, strFailToGetWeatherInfo, 'weather')`; one at a time: a new one closes the open
            // one.
            case .failed:
                positionRetry = nil
                retry = true
            case .skipped, .superseded: break
            }
        }
        // After the saved place's request, as TabCtrl started them.
        if place.currentPosition { lookupCurrentPosition(place) }
    }

    /// `updateCurrentPosition` with its follow-up in `loadWeatherData` (controller.tabctrl.js L870-L926, L954-L1088), iOS
    /// branch: a lookup runs beside the load of the saved current position, one at a time (a second call was
    /// `alreadyCalled`, which settles silently). A fix, rounded to three decimals, that differs from the saved location
    /// replaces it; while the current position is still selected, its weather loads for the new location. Failures open
    /// O03 `forecast`.
    private func lookupCurrentPosition(_ place: Place) {
        guard let location, !locating else { return }
        locating = true
        lookups += 1
        let lookup = lookups
        self.lookup = Task { @MainActor [weak self] in
            guard let self else { return }
            let step = TabLocation.decide(record: location.recorded, hasSaved: place.address != nil || place.location != nil)
            // `trackEvent('position', 'status', 'authorized', isLocationAuthorized ? 1 : 0)`.
            telemetry?("location_permission", ["outcome": .text(step == .locate ? "granted" : "denied")])
            var message: LocationMessage?
            switch step {
            case .locate:
                if let fix = await location.position() {
                    let normalized = GeoLocation.normalize(lat: fix.lat, long: fix.long)
                    // The indicator hides when the position settles, before the new location's weather loads.
                    locating = false
                    await moved(Location(lat: normalized.lat, long: normalized.long))
                    // A later lookup may have started while the new location's weather loaded: its turn is its own.
                    if lookup != lookups { return }
                } else {
                    message = .notFound
                }
            case .ask:
                message = TabLocation.afterPrompt(await location.request())
            case .useSaved:
                break
            case .requestServices:
                location.requestServices()
            }
            locating = false
            if let message {
                retry = false
                positionRetry = TabLocation.retry(message, recorded: recorded, enabled: location.recorded?.granted ?? false)
            }
        }
    }

    /// A fix for the current position: the same location ends it; a new one is saved and, while the current position is
    /// selected, its weather loads (`updateWeatherData({location})`; failures are silent).
    private func moved(_ fix: Location) async {
        guard let s = holder.state, let current = s.places.first, current.currentPosition else { return }
        if let saved = current.location {
            if saved == fix { return }
            holder.change { $0.places[0].location = fix }
        }
        guard let now = holder.state, now.placeIndex == 0, let place = now.places.first else { return }
        var request = place
        request.location = fix
        let result = await repository.load(request, units: now.units, acceptLanguage: acceptLanguage(), force: true)
        if case .loaded(let key, let entry, let updated) = result { save(key: key, entry: entry, updated: updated) }
    }

    /// `setRefreshTimer`: a reload after the interval in minutes, none for "0" (manual).
    private func restartTimer(_ s: AppState) {
        timer?.cancel()
        timer = nil
        guard let minutes = Int(s.settings.refreshInterval), minutes > 0 else { return }
        let clock = self.clock
        timer = Task { @MainActor [weak self] in
            do { try await clock.sleep(for: .seconds(minutes * 60)) } catch { return }
            self?.reload(.timer)
        }
    }

    /// `updateCity`'s changes to the place that requested the weather, and its new photo, wherever it is in the list
    /// now, then `applyEvent`. Without the feed the photo is none and the feed loads (`_getPhoto`).
    private func save(key: String, entry: WeatherEntry, updated: Place) {
        let feed = photos()
        if feed == nil { loadPhotos() }
        let photo = feed.flatMap { photoFor(entry.weather, $0) }
        let source = entry.weather["source"]?.stringValue
        holder.change { s in
            for i in s.places.indices where WeatherRepository.key(s.places[i]) == key {
                let place = s.places[i]
                var p = place
                if place.currentPosition {
                    p.name = updated.name
                    p.country = updated.country
                    p.address = updated.address
                }
                p.location = updated.location
                p.source = source ?? place.source
                p.photo = photo
                s.places[i] = p
            }
        }
        applies += 1
    }

    /// `findWeatherPhoto(currentWeather)`.
    private func photoFor(_ weather: JSONObject?, _ feed: WeatherPhotos) -> String? {
        feed.find(skyIcon: weather?["currentWeather"]?["skyIcon"]?.stringValue, random: random())
    }
}
