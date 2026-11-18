import AppIntents

struct CityOptions: DynamicOptionsProvider {
    func results() async throws -> IntentItemCollection<String> {
        let items = WidgetStore.places().map { place in
            IntentItem(place.id, title: "\(place.name)")
        }
        return IntentItemCollection(sections: [IntentItemSection(items: items)])
    }
}

enum WidgetForecastMode {
    case daily, hourly
}

struct WeatherConfiguration: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "TodayWeather"
    static let description = IntentDescription("Choose the place and forecast shown in this widget.")

    @Parameter(title: "City", optionsProvider: CityOptions())
    var cityID: String?

    @Parameter(title: "Hourly forecast", default: false)
    var showHourly: Bool

    var forecast: WidgetForecastMode { showHourly ? .hourly : .daily }
}
