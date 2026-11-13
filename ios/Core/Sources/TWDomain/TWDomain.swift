import TWModel

/// Conversion, units, comparisons and chart data, ported from the Cordova client through the Android core
/// (`android/core-domain`) and checked against the shared golden corpus (IN-02, #2951). Foundation only.
///
/// - ``Js``: JavaScript truthiness, comparison and number formatting.
/// - ``WeatherConverter``: `convertWeatherData`.
/// - ``AddressFormat``, ``ForecastText``, ``UpdateTime``, ``GeoLocation``: text helpers of WeatherUtil and S03/S04.
/// - ``AirQuality``, ``Nationwide``, ``Warnings``, ``ChartPosition``: air grades, the nationwide maps, warnings and
///   the charts' opening scroll.
public enum TWDomain {}
