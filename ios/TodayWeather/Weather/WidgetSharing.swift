import CryptoKit
import Foundation
import TWData
import TWDomain
import TWStorage
import WidgetKit

enum WidgetSharing {
    static func id(_ place: Place) -> String {
        if place.currentPosition { return "current" }
        // Saved cities are identified by address and name in PlaceList. Hash them so the
        // deep link exposes neither and remains valid when places are reordered or acquire coordinates.
        let address = place.address ?? ""
        let key = address.isEmpty ? WeatherRepository.key(place) : address
        let identity = "\(key.utf8.count):" + key + (place.name ?? "")
        return SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func place(_ place: Place, base: String?, units: UnitSettings) -> WidgetPlace {
        let request = base.flatMap { server in
            WeatherRequests.url(base: server, lat: place.location?.lat, long: place.location?.long,
                                address: place.address, units: UnitSettings.keys.map { ($0, units.value($0)) })
        }.flatMap(WeatherRequests.requestURL)
        let name = [place.name, place.address].compactMap { $0 }.first { !$0.isEmpty }
        return WidgetPlace(id: id(place), name: name ?? "📍", request: request)
    }

    static func publish(_ state: AppState, base: String?) {
        let places = state.places.filter { !$0.disable }.map { place($0, base: base, units: state.units) }
        let selectedID = state.places.indices.contains(state.placeIndex) && !state.places[state.placeIndex].disable
            ? id(state.places[state.placeIndex]) : places.first?.id
        if WidgetStore.publish(places: places, selectedID: selectedID) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    static func received(_ entry: WeatherEntry, for place: Place, request: URL) {
        let id = id(place)
        guard WidgetStore.expiry(at: Date()) != nil,
              let target = WidgetStore.places().first(where: { $0.id == id && $0.request == request }),
              let weather = WidgetWeatherProjection.make(entry.weather, updatedAt: entry.loadedAt),
              WidgetStore.save(weather, for: target) else { return }
        WidgetCenter.shared.reloadAllTimelines()
    }

    struct Link {
        let placeID: String?

        init?(_ url: URL) {
            guard let link = URLComponents(url: url, resolvingAgainstBaseURL: false), link.scheme == "todayweather",
                  link.host == "widget", link.path.isEmpty else { return nil }
            placeID = link.queryItems?.first(where: { $0.name == "place" })?.value
        }
    }
}
