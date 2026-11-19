import SwiftUI
import WidgetKit

struct WeatherWidgetEntry: TimelineEntry {
    enum Content {
        case openApp
        case unavailable
        case weather(String, WidgetWeather, WidgetForecastMode)
    }

    let date: Date
    let placeID: String?
    let content: Content

    var url: URL? {
        var parts = URLComponents()
        parts.scheme = "todayweather"
        parts.host = "widget"
        if let placeID {
            parts.queryItems = [URLQueryItem(name: "place", value: placeID)]
        }
        return parts.url
    }
}

struct WeatherProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> WeatherWidgetEntry {
        WeatherWidgetEntry(date: .now, placeID: nil, content: .openApp)
    }

    func snapshot(for configuration: WeatherConfiguration, in context: Context) async -> WeatherWidgetEntry {
        let now = Date.now
        let place = selectedPlace(configuration)
        guard WidgetStore.expiry(at: now) != nil else {
            return .init(date: now, placeID: place?.id, content: .openApp)
        }
        return entry(for: place, weather: place.flatMap { WidgetStore.weather(for: $0.id) },
                     mode: configuration.forecast, date: now)
    }

    func timeline(for configuration: WeatherConfiguration, in context: Context) async -> Timeline<WeatherWidgetEntry> {
        let place = selectedPlace(configuration)
        let start = Date.now
        guard WidgetStore.expiry(at: start) != nil else { return expired(at: start, place: place) }

        var weather: WidgetWeather?
        if let place {
            weather = await WidgetRefresh.weather(for: place, at: start) ?? WidgetStore.weather(for: place.id)
        }
        let now = Date.now
        guard let deadline = WidgetStore.expiry(at: now) else { return expired(at: now, place: place) }

        // Schedule the app reminder even when WidgetKit defers the next provider reload.
        let current = entry(for: place, weather: weather, mode: configuration.forecast, date: now)
        let reminder = WeatherWidgetEntry(date: deadline, placeID: place?.id, content: .openApp)
        return Timeline(entries: [current, reminder], policy: .after(min(deadline, now.addingTimeInterval(3600))))
    }

    private func selectedPlace(_ configuration: WeatherConfiguration) -> WidgetPlace? {
        let places = WidgetStore.places()
        if let id = configuration.cityID {
            return places.first { $0.id == id }
        }
        let selectedID = WidgetStore.selectedID()
        return places.first { $0.id == selectedID } ?? places.first
    }

    private func expired(at date: Date, place: WidgetPlace?) -> Timeline<WeatherWidgetEntry> {
        Timeline(entries: [.init(date: date, placeID: place?.id, content: .openApp)], policy: .never)
    }

    private func entry(for place: WidgetPlace?, weather: WidgetWeather?, mode: WidgetForecastMode,
                       date: Date) -> WeatherWidgetEntry {
        guard let place, let weather else {
            return .init(date: date, placeID: place?.id, content: .unavailable)
        }
        return .init(date: date, placeID: place.id, content: .weather(place.name, weather, mode))
    }
}

@main
struct TodayWeatherWidgets: WidgetBundle {
    var body: some Widget {
        ClassicWeatherWidget()
        SkyWeatherWidget()
        CurveWeatherWidget()
    }
}

enum WeatherDesign {
    case classic, sky, curve

    var kind: String {
        switch self {
        case .classic: WidgetStore.kind
        case .sky: "TodayWeatherSky"
        case .curve: "TodayWeatherCurve"
        }
    }

    var title: LocalizedStringKey {
        switch self {
        case .classic: "Classic Color"
        case .sky: "Morning Sky"
        case .curve: "Temperature Curve"
        }
    }
}

private struct ClassicWeatherWidget: Widget {
    var body: some WidgetConfiguration { weatherConfiguration(.classic) }
}

private struct SkyWeatherWidget: Widget {
    var body: some WidgetConfiguration { weatherConfiguration(.sky) }
}

private struct CurveWeatherWidget: Widget {
    var body: some WidgetConfiguration { weatherConfiguration(.curve) }
}

@MainActor private func weatherConfiguration(_ design: WeatherDesign) -> some WidgetConfiguration {
    AppIntentConfiguration(kind: design.kind, intent: WeatherConfiguration.self, provider: WeatherProvider()) { entry in
        WeatherWidgetView(entry: entry, design: design).widgetURL(entry.url)
    }
    .configurationDisplayName(design.title)
    .description("Current conditions and forecasts for your place.")
    .supportedFamilies([.systemSmall, .systemMedium])
    .contentMarginsDisabled()
}
