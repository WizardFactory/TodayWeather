import Foundation
import Observation
import TWDomain
import TWModel
import TWStorage

/// The loading of the weather pages (TabCtrl in controller.tabctrl.js, #2957): `loadWeatherData` with the ten-minute
/// gate and the refresh timer, the `reloadEvent` senders, the swipes between places and the retry confirmation (O03).
/// A response applies to the place that requested it (the A01 fix, `WeatherRepository`); what it changes in the place
/// (`updateCity`) and a photo for it are saved through the `AppStateHolder`. Port of the Android `WeatherSession`
/// without the current position's own lookup and the start choice (O02), which IN-10 adds.
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
    }

    @ObservationIgnored public let repository: WeatherRepository
    @ObservationIgnored private let holder: AppStateHolder
    @ObservationIgnored private let acceptLanguage: () -> String
    @ObservationIgnored private let photos: () -> WeatherPhotos?
    @ObservationIgnored private let loadPhotos: () -> Void
    @ObservationIgnored private let clock: any AppClock
    @ObservationIgnored private let random: () -> Double
    @ObservationIgnored private var timer: Task<Void, Never>?

    /// The retry confirmation is open (`LOC_ERROR`, `LOC_FAIL_TO_GET_WEATHER_INFO`, `LOC_CLOSE` and `LOC_OK`).
    public private(set) var retry = false

    /// TabCtrl's `applyEvent`s so far: one at each `loadWeatherData` (also when the gate stops the load) and one after
    /// each applied response. The weather pages apply the selected place on each.
    public private(set) var applies = 0

    public init(repository: WeatherRepository, holder: AppStateHolder, acceptLanguage: @escaping () -> String,
                photos: @escaping () -> WeatherPhotos? = { nil }, loadPhotos: @escaping () -> Void = {},
                clock: any AppClock = SystemClock(), random: @escaping () -> Double = { Double.random(in: 0..<1) }) {
        self.repository = repository
        self.holder = holder
        self.acceptLanguage = acceptLanguage
        self.photos = photos
        self.loadPhotos = loadPhotos
        self.clock = clock
        self.random = random
    }

    /// The selected place, as `WeatherInfo.getCityOfIndex(getCityIndex())`.
    public var selected: Place? {
        guard let s = holder.state, s.places.indices.contains(s.placeIndex) else { return nil }
        return s.places[s.placeIndex]
    }

    /// The record the pages apply for `place`: its weather (this process or the cache) with its own fields.
    public func record(_ place: Place) -> JSONObject { cityRecord(place, repository.cached(place)) }

    /// Whether the selected place's request is in flight (`showLoadingIndicator`).
    public var loadingSelected: Bool { selected.map { repository.loading.contains(WeatherRepository.key($0)) } ?? false }

    /// `reloadEvent`: ignored while the retry confirmation is open; a resume or a return from search waits for the gate;
    /// `locationOn` reloads only the current position; the refresh-interval setting restarts the timer only. Otherwise
    /// `reloadCity` and `loadWeatherData`.
    public func reload(_ sender: Sender) {
        if retry { return }
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
            let result = await repository.load(place, units: units, acceptLanguage: language, force: false)
            switch result {
            case .loaded(let key, let entry, let updated): save(key: key, entry: entry, updated: updated)
            // `showRetryConfirm(strError, strFailToGetWeatherInfo, 'weather')`; one at a time.
            case .failed: retry = true
            case .skipped, .superseded: break
            }
        }
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
