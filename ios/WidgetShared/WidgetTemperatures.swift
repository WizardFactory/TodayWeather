import Foundation

/// Values in the shared cache already use the selected temperature unit. Older
/// installations store daily pairs as "high°/low°" and hourly samples as "value°".
struct WidgetTemperatureSample: Equatable {
    let label: String
    let upper: Double
    let lower: Double?
    let previous: Double?

    init?(_ forecast: WidgetForecast, hourly: Bool) {
        let values = forecast.temperature.components(separatedBy: "/")
        guard values.count == (hourly ? 1 : 2), let upper = Self.value(values[0]) else { return nil }
        if hourly {
            lower = nil
        } else {
            guard let low = Self.value(values[1]) else { return nil }
            lower = low
        }
        previous = hourly ? forecast.previousTemperature.flatMap(Self.value) : nil
        self.upper = upper
        label = forecast.label
    }

    static func value(_ text: String) -> Double? {
        let digits = text.hasSuffix("°") ? String(text.dropLast()) : text
        guard let number = Double(digits), (-200...250).contains(number) else { return nil }
        return number
    }
}
