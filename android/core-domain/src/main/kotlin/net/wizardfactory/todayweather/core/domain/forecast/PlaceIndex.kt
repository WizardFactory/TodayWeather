package net.wizardfactory.todayweather.core.domain.forecast

/**
 * WeatherInfo's choice of the place to show (service.weatherinfo.js `setFirstCityIndex`, `setNextCityIndex`,
 * `setPrevCityIndex`, `getEnabledCityCount`): [disabled] per place, index 0 being the current position, which alone
 * is skipped when disabled. An index out of the list is refused (`setCityIndex`), so [current] stays.
 */
object PlaceIndex {
    fun enabledCount(disabled: List<Boolean>): Int = disabled.count { !it }

    fun first(disabled: List<Boolean>, current: Int): Int = when {
        disabled.isEmpty() -> current
        disabled[0] -> set(if (disabled.size == 1) -1 else 1, disabled.size, current)
        else -> set(0, disabled.size, current)
    }

    fun next(disabled: List<Boolean>, current: Int): Int =
        if (current == disabled.size - 1) first(disabled, current) else set(current + 1, disabled.size, current)

    fun previous(disabled: List<Boolean>, current: Int): Int =
        if (current == 0 || (current == 1 && disabled.firstOrNull() == true)) set(disabled.size - 1, disabled.size, current)
        else set(current - 1, disabled.size, current)

    private fun set(index: Int, size: Int, current: Int) = if (index in 0 until size) index else current
}
