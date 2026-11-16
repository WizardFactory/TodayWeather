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
