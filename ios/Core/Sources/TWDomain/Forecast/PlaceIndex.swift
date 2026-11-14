import Foundation

/// WeatherInfo's choice of the place to show (service.weatherinfo.js `setFirstCityIndex`, `setNextCityIndex`,
/// `setPrevCityIndex`, `getEnabledCityCount`): `disabled` per place, index 0 being the current position, which alone is
/// skipped when disabled. An index outside the list is refused (`setCityIndex`), so `current` stays. Port of the
/// Android `PlaceIndex`.
public enum PlaceIndex {
    public static func enabledCount(_ disabled: [Bool]) -> Int { disabled.filter { !$0 }.count }

    public static func first(_ disabled: [Bool], current: Int) -> Int {
        if disabled.isEmpty { return current }
        if disabled[0] { return set(disabled.count == 1 ? -1 : 1, disabled.count, current) }
        return set(0, disabled.count, current)
    }

    public static func next(_ disabled: [Bool], current: Int) -> Int {
        current == disabled.count - 1 ? first(disabled, current: current) : set(current + 1, disabled.count, current)
    }

    public static func previous(_ disabled: [Bool], current: Int) -> Int {
        if current == 0 || (current == 1 && disabled.first == true) { return set(disabled.count - 1, disabled.count, current) }
        return set(current - 1, disabled.count, current)
    }

    private static func set(_ index: Int, _ size: Int, _ current: Int) -> Int { index >= 0 && index < size ? index : current }
}
