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
struct TodayWeatherWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: WidgetStore.kind, intent: WeatherConfiguration.self,
                               provider: WeatherProvider()) { entry in
            WeatherWidgetView(entry: entry)
                .widgetURL(entry.url)
                .containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("TodayWeather")
        .description("Current conditions and forecasts for your place.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct WeatherWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WeatherWidgetEntry

    var body: some View {
        switch entry.content {
        case .openApp:
            message("Open TodayWeather and check the weather to resume widget updates.")
        case .unavailable:
            message("Open TodayWeather to check the weather for this place.")
        case let .weather(name, weather, mode):
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(name).font(.headline).lineLimit(1)
                    Spacer(minLength: 3)
                    Text(weather.date, style: Calendar.current.isDate(weather.date, inSameDayAs: entry.date) ? .time : .date)
                        .font(.caption2).foregroundStyle(.secondary)
                }
                HStack(spacing: 6) {
                    Image(systemName: weather.symbol).accessibilityHidden(true)
                    Text(weather.temperature).font(.title.bold())
                    if family == .systemMedium {
                        Spacer()
                        temperatureRange(weather)
                    }
                }
                if family == .systemSmall { temperatureRange(weather) }
                if !weather.air.isEmpty { Text(weather.air).font(.caption).lineLimit(1) }
                if family == .systemMedium {
                    forecastRow(mode == .daily ? weather.daily : weather.hourly)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func message(_ text: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("TodayWeather", systemImage: "cloud.sun").font(.headline)
            Text(text).font(.subheadline)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func temperatureRange(_ weather: WidgetWeather) -> some View {
        HStack(spacing: 6) {
            if !weather.high.isEmpty { Text("↑ \(weather.high)") }
            if !weather.low.isEmpty { Text("↓ \(weather.low)") }
        }.font(.caption).foregroundStyle(.secondary)
    }

    private func forecastRow(_ items: [WidgetForecast]) -> some View {
        HStack(spacing: 2) {
            ForEach(Array(items.prefix(6).enumerated()), id: \.offset) { _, item in
                VStack(spacing: 2) {
                    Text(item.label)
                    Image(systemName: item.symbol).accessibilityHidden(true)
                    Text(item.temperature)
                }.frame(maxWidth: .infinity)
            }
        }.font(.caption2).lineLimit(1).minimumScaleFactor(0.75)
    }
}
