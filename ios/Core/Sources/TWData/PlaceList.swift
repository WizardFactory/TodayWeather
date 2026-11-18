import Foundation
import TWDomain
import TWModel
import TWStorage

/// WeatherInfo's list operations that the start page and the saved places use (service.weatherinfo.js). Port of the
/// Android `PlaceList` (AN-10).
public enum PlaceList {
    /// `getIndexOfCity`: the current position matches the current position; another place matches a saved place with the
    /// same address and the same name, or with the same address when neither has a name (texts compared by UTF-16 code
    /// units). -1 when none matches.
    public static func indexOf(_ places: [Place], _ city: Place) -> Int {
        places.firstIndex { place in
            if place.currentPosition { return city.currentPosition }
            guard JSString.same(place.address, city.address) else { return false }
            let named = !(city.name ?? "").isEmpty || !(place.name ?? "").isEmpty
            return named ? JSString.same(city.name, place.name) : true
        } ?? -1
    }

    /// `addCity`: `city` appended and enabled unless a place matches it (`indexOf`); nil when one does.
    public static func add(_ state: AppState, _ city: Place) -> AppState? {
        if indexOf(state.places, city) != -1 { return nil }
        var s = state
        var added = city
        added.disable = false
        s.places.append(added)
        return s
    }

    /// `removeCity(index)` (S02, IN-11): the place at `index` removed (S02 offers no delete for the current position);
    /// the selection moves to the first enabled place only when it now equals the number of places
    /// (`setFirstCityIndex`), so deleting an earlier place keeps the selected number, which now names the next place
    /// (kept, as AN-11).
    public static func remove(_ state: AppState, _ index: Int) -> AppState {
        guard state.places.indices.contains(index) else { return state }
        var s = state
        s.places.remove(at: index)
        if s.placeIndex == s.places.count { s.placeIndex = PlaceIndex.first(s.places.map(\.disable), current: s.placeIndex) }
        return s
    }

    /// An add from S02 (`setCityIndex(getCityCount() - 1)`): the last place selected; S01's gate is not touched.
    public static func selectLast(_ state: AppState) -> AppState {
        var s = state
        s.placeIndex = s.places.count - 1
        return s
    }

    /// `disableCity(disable)`: the current position's flag, then `setFirstCityIndex` while the index is at most 0.
    public static func disableCurrent(_ state: AppState, _ disable: Bool) -> AppState {
        if state.places.isEmpty { return state }
        var s = state
        s.places[0].disable = disable
        if s.placeIndex <= 0 { s.placeIndex = PlaceIndex.first(s.places.map(\.disable), current: s.placeIndex) }
        return s
    }

    /// StartCtrl's `close()`: `startVersion` stored (the rollback hand-back of IN-17 gives it back to the Cordova app) and
    /// the last place selected (`setCityIndex(getCityCount() - 1)`).
    public static func closeStart(_ state: AppState) -> AppState {
        var s = state
        s.cordovaExtras["startVersion"] = StartGate.closed
        s.placeIndex = s.places.count - 1
        return s
    }
}
