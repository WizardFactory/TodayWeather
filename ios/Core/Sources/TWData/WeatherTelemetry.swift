import Foundation
import TWDomain

/// Where the weather path reports its analytics events (`Monetization.track`, IN-15): `weather_fetch` for each request
/// and `weather_load` for each load of the selected place, as the Cordova `getWeatherByGeoInfo` and TabCtrl's
/// `updateWeatherData` do and the Android `Telemetry` of AN-15 does. The app passes `Monetization`'s; nil reports nothing.
public typealias WeatherTelemetry = @MainActor (_ name: String, _ params: [String: AnalyticsValue]) -> Void
