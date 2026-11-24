import Foundation
import Observation
import TWDomain
import TWStorage

/// The state the weather pages read and change: the `AppStateHolder` itself, or `UnsavedPlaces` over it.
@MainActor
public protocol PlaceState: AnyObject {
    var state: AppState? { get }
    func change(_ update: (inout AppState) -> Void)
}

extension AppStateHolder: PlaceState {}

/// A place opened without saving it, by a search result or a `link.todayweather.ai` link (#3180, #3097,
/// specs/deeplink.md §6.2). The weather pages read and change the saved state through this one: the unsaved place is the
/// last place of the list, so swipes and arrows reach it as any other. Its own changes (a response's location, source and
/// photo) stay in memory; every other change is saved, and while it is selected the saved selection stays the one before
/// it.
///
/// One unsaved place is kept. Moving to a saved place keeps it (a swipe back shows it again); another `show` replaces it; a
/// new start of the app has none, because nothing was saved. `add`, the header's star, saves it where it stands, and on
/// the start page that closes S01 as a first place does. Only the weather pages see it: widgets, push, S02's list and the
/// store read the holder. Port of the Android `LinkPreview` (#3096, #3190); everything here runs on the main actor, so a
/// show and a change never interleave and nothing waits on a lock (CODEX-3190-1, -8).
///
/// The unsaved place is the selected one when it was selected last, or when the saved selection names no enabled saved
/// place. While it is selected, the saved selection stays on the saved row selected before it, and S02's changes
/// (`savedAccess`) follow that row to where the change put it (a delete keeps the other rows in order), else select the
/// first enabled row, else none, so the next start opens that place (#3180) and never a deleted or disabled row
/// (CODEX-3190-2). No place is matched by its fields (CODEX-3190-10, -13, -14).
@MainActor
@Observable
public final class UnsavedPlaces: PlaceState {
    /// The unsaved place; `selected` when it was selected last.
    public struct Unsaved: Equatable, Sendable {
        public var place: Place
        public var selected: Bool

        public init(place: Place, selected: Bool) {
            self.place = place
            self.selected = selected
        }
    }

    /// The saved state for S02, which lists and changes the saved places only.
    @MainActor
    public final class SavedAccess: PlaceState {
        unowned let owner: UnsavedPlaces

        init(owner: UnsavedPlaces) {
            self.owner = owner
        }

        public var state: AppState? { owner.holder.state }

        /// While the unsaved place is selected, a delete or a disable keeps the saved selection on the row it named before
        /// the change when that row stays and is enabled, else on the first enabled row, else on none (-1). Otherwise
        /// Cordova's rules apply as they are.
        public func change(_ update: (inout AppState) -> Void) {
            let now = owner.unsaved
            owner.holder.change { s in
                let before = s
                update(&s)
                // Judged after the change: turning off the only enabled place makes the unsaved place the selected one.
                if let now, UnsavedPlaces.selected(s, now) {
                    s.placeIndex = UnsavedPlaces.savedSelection(before, s)
                }
            }
        }
    }

    /// S02's view of the saved state (`SavedAccess`).
    @ObservationIgnored public private(set) lazy var savedAccess = SavedAccess(owner: self)

    @ObservationIgnored public let holder: AppStateHolder

    /// The unsaved place with its selection; nil when none is shown.
    public private(set) var unsaved: Unsaved?

    public init(holder: AppStateHolder) {
        self.holder = holder
    }

    /// The saved state with the unsaved place appended, and selected while it is the selected one, as the pages see it.
    public var state: AppState? { holder.state.map { Self.overlay($0, unsaved) } }

    /// Shows `place` (enabled) as the selected place, in place of an earlier unsaved one.
    public func show(_ place: Place) {
        var enabled = place
        enabled.disable = false
        unsaved = Unsaved(place: enabled, selected: true)
    }

    public func clear() {
        unsaved = nil
    }

    /// The star: saves the selected unsaved place where it stands, at the end of the list, and keeps it selected; when a
    /// saved place lies within 0.01° (`LinkRoutes.nearbySaved`) that one is selected instead. On the start page the add
    /// closes S01 (`closeStart`). The selected index, or nil when the unsaved place is not the selected one. The app has no
    /// place limit (S02 neither).
    @discardableResult
    public func add() -> Int? {
        guard let now = unsaved, let base = holder.state, Self.selected(base, now) else { return nil }
        holder.change { s in
            let existing = LinkRoutes.nearbySaved(s, now.place)
            if existing >= 0 {
                s.placeIndex = existing
            } else {
                s.places.append(now.place)
                s.placeIndex = s.places.count - 1
            }
            if StartGate.shows(s.cordovaExtras["startVersion"]) {
                let index = s.placeIndex
                s = PlaceList.closeStart(s)
                s.placeIndex = index
            }
        }
        // After the save, so the start page never shows in between.
        unsaved = nil
        return holder.state?.placeIndex
    }

    /// True when `index` of the shown state is the unsaved place: no saved place, alarm or widget has it.
    public func isUnsaved(_ index: Int) -> Bool {
        unsaved != nil && index == holder.state?.places.count
    }

    /// True when the unsaved place is the selected place of `state`, the shown state: the header shows its star.
    public func isSelected(_ state: AppState) -> Bool {
        unsaved != nil && state.placeIndex == state.places.count - 1
    }

    /// True when `index`, from outside the pages (a widget link, a notification's `cityIndex`), names a saved place: the
    /// unsaved place has no number there (CODEX-3190-3).
    public func isSaved(_ index: Int) -> Bool {
        guard let count = holder.state?.places.count else { return false }
        return index >= 0 && index < count
    }

    /// True when the tabs show over S01 for an unsaved place.
    public var bypassesStart: Bool {
        guard let s = holder.state, unsaved != nil else { return false }
        return StartGate.shows(s.cordovaExtras["startVersion"])
    }

    /// The pages' view of `state` with `unsaved`.
    public static func overlay(_ state: AppState, _ unsaved: Unsaved?) -> AppState {
        guard let unsaved else { return state }
        var shown = state
        shown.places.append(unsaved.place)
        if selected(state, unsaved) { shown.placeIndex = state.places.count }
        return shown
    }

    /// Whether `unsaved` is the selected place over the saved `state`: when it was selected last, or when the saved
    /// selection is outside the saved places, where it would name the unsaved place or nothing (S02 deleted the last
    /// enabled place, and Cordova's `removeCity` keeps the index; CODEX-3190-2).
    static func selected(_ state: AppState, _ unsaved: Unsaved) -> Bool {
        unsaved.selected || enabledSelection(state) == nil
    }

    /// The saved place the saved selection names, when it is an enabled one.
    static func enabledSelection(_ state: AppState) -> Place? {
        guard state.places.indices.contains(state.placeIndex), !state.places[state.placeIndex].disable else { return nil }
        return state.places[state.placeIndex]
    }

    /// The saved selection after S02 changed `before` into `after` while the unsaved place is selected: the row `before`'s
    /// selection named, followed to its place in `after` (a delete removes one row and keeps the others in order; a change
    /// in place keeps the list's length), when it is enabled; else the first enabled row (not `setFirstCityIndex`, which
    /// names row 0 or 1 even when disabled); else -1.
    static func savedSelection(_ before: AppState, _ after: AppState) -> Int {
        var back = -1
        if before.places.indices.contains(before.placeIndex) {
            let i = before.placeIndex
            if after.places.count == before.places.count {
                back = i
            } else if after.places.count == before.places.count - 1 {
                // One row removed: the first index where the lists differ is the removed row.
                let removed = after.places.indices.first { before.places[$0] != after.places[$0] } ?? after.places.count
                back = i == removed ? -1 : i > removed ? i - 1 : i
            }
        }
        if back >= 0 && !after.places[back].disable { return back }
        return after.places.firstIndex { !$0.disable } ?? -1
    }

    public func change(_ update: (inout AppState) -> Void) {
        guard let now = unsaved, let base = holder.state else { return holder.change(update) }
        let before = Self.overlay(base, now)
        var after = before
        update(&after)
        guard after.places.count == before.places.count else {
            // A change that adds or removes places through the pages is the saved list's own: the unsaved place goes.
            unsaved = nil
            return holder.change(update)
        }
        let last = before.places.count - 1
        let selectedAfter = after.placeIndex == last
        unsaved = Unsaved(place: after.places[last], selected: selectedAfter)
        holder.change { s in
            var changed = after
            changed.places.removeLast()
            // While the unsaved place is selected, the saved selection stays the one before it.
            changed.placeIndex = after.placeIndex == last ? s.placeIndex : after.placeIndex
            s = changed
        }
    }
}

/// specs/deeplink.md §6.2: where a link goes over the saved state.
public enum LinkRoutes {
    /// The pages over the tabs a link opens: S10, S11 and S12.
    public enum Page: Sendable, Equatable { case nationWeather, nationAir, warnings }

    /// Where a `link.todayweather.ai` link goes.
    public enum Route: Sendable, Equatable {
        /// A weather tab (`view`, with `pollutant` for Air) for the saved place at `index`, or for `unsaved`, a place shown
        /// without being saved.
        case weather(view: WeatherView, pollutant: String?, index: Int?, unsaved: Place?)
        case page(Page)
        /// `/open`: the app as it is.
        case app
    }

    /// A catalog city or coordinates go to the first enabled saved place within 0.01° (not the current position, which
    /// moves), else to an unsaved place; without `matchSaved` always to an unsaved place. An unknown catalog city goes
    /// nowhere (nil), as does a widget link, which `WidgetSharing.Link` handles.
    public static func route(_ target: DeepLinkTarget, _ state: AppState, matchSaved: Bool = true) -> Route? {
        switch target {
        case .open: return .app
        case .nationWeather: return .page(.nationWeather)
        case .nationAir: return .page(.nationAir)
        case .warnings: return .page(.warnings)
        case .legacyWidget: return nil
        case .place(let slug, let view, let pollutant):
            guard let city = DeepLinkCatalog.find(slug) else { return nil }
            let place = Place(currentPosition: false, disable: false, name: city.name, address: city.address,
                              country: city.country, location: Location(lat: city.lat, long: city.lon))
            return weather(state, matchSaved: matchSaved, view: view, pollutant: pollutant, place: place)
        case .coordinate(let lat, let lon, let name, let view, let pollutant):
            let place = Place(currentPosition: false, disable: false, name: name ?? DeepLink.coordinateText(lat: lat, lon: lon),
                              location: Location(lat: lat, long: lon))
            return weather(state, matchSaved: matchSaved, view: view, pollutant: pollutant, place: place)
        }
    }

    /// The first enabled saved place within 0.01° of `place`; -1 when none is. A link never matches the current position,
    /// which moves; a search result does (`withCurrentPosition`), as #3180 counts it among the saved places
    /// (CODEX-3190-4).
    public static func nearbySaved(_ state: AppState, _ place: Place, withCurrentPosition: Bool = false) -> Int {
        guard let at = place.location else { return -1 }
        return state.places.firstIndex { saved in
            guard let location = saved.location else { return false }
            return (withCurrentPosition || !saved.currentPosition) && !saved.disable
                && DeepLink.nearSaved(location.lat, location.long, at.lat, at.long)
        } ?? -1
    }

    private static func weather(_ state: AppState, matchSaved: Bool, view: WeatherView, pollutant: String?, place: Place) -> Route {
        let index = matchSaved ? nearbySaved(state, place) : -1
        return index >= 0 ? .weather(view: view, pollutant: pollutant, index: index, unsaved: nil)
            : .weather(view: view, pollutant: pollutant, index: nil, unsaved: place)
    }
}

/// Applies `link.todayweather.ai` links over the saved state (specs/deeplink.md §6.2), once the migration has finished:
/// a saved place within 0.01° is selected and loaded (`openPlace`, `reloadEvent 'deeplink'`); another place shows unsaved
/// (`UnsavedPlaces.show`) and loads (`reload`), replacing an unsaved place shown before. On the start page (S01) every
/// place link shows unsaved over it without closing it, and page links and `/open` are ignored (§6.2.3 "defer or
/// ignore"). An unknown catalog city changes nothing. The app then closes what covers the tabs and shows the route's tab
/// or page. Port of the Android `LinkOpener` (#3096); the app applies each link at once on the main actor, so no queue.
@MainActor
public final class LinkOpener {
    private let unsaved: UnsavedPlaces
    private let openPlace: (Int) -> Void
    private let reload: () -> Void

    public init(unsaved: UnsavedPlaces, openPlace: @escaping (Int) -> Void, reload: @escaping () -> Void) {
        self.unsaved = unsaved
        self.openPlace = openPlace
        self.reload = reload
    }

    /// Applies `target`: the route the app shows, or nil when the link changes nothing.
    @discardableResult
    public func open(_ target: DeepLinkTarget) -> LinkRoutes.Route? {
        guard let saved = unsaved.holder.state else { return nil }
        let start = StartGate.shows(saved.cordovaExtras["startVersion"])
        guard let route = LinkRoutes.route(target, saved, matchSaved: !start) else { return nil }
        switch route {
        case .app, .page:
            if start { return nil }
        case .weather(_, _, let index, let place):
            if let place {
                unsaved.show(place)
                reload()
            } else if let index {
                // The saved place is selected; an unsaved place opened earlier stays in the list.
                openPlace(index)
            }
        }
        return route
    }

    /// A place chosen in the search (#3180): the saved place within 0.01° is selected (the enabled current position
    /// included), else the place shows without being saved. The search loads it and chooses the tab (`goPage`).
    public func show(_ place: Place) {
        guard let saved = unsaved.holder.state else { return }
        let index = LinkRoutes.nearbySaved(saved, place, withCurrentPosition: true)
        if index < 0 {
            unsaved.show(place)
        } else {
            unsaved.change { $0.placeIndex = index }
        }
    }
}
