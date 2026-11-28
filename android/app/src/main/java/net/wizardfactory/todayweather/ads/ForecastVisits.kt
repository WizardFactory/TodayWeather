package net.wizardfactory.todayweather.ads

import net.wizardfactory.todayweather.core.domain.shell.Tab

internal data class ForecastAdDay(
    val date: Long,
    val hourly: Boolean = false,
    val daily: Boolean = false,
    val spent: Boolean = false,
)

/** All calls run on the main thread. Read the shared store on every transition so activity recreation retains the cap. */
internal class ForecastVisits(
    private val load: () -> ForecastAdDay,
    private val save: (ForecastAdDay) -> Boolean,
    private val today: () -> Long,
    private val draw: () -> Double,
    /** The current `tw_interstitial_chance` percentage, read on every draw. */
    private val chance: () -> Int,
    /** Best-effort async save for [visible] only; durable transitions always use [save]. */
    private val saveAsync: (ForecastAdDay) -> Unit = { save(it) },
) {
    fun visible(tab: Tab) {
        val day = current() ?: return
        val visited = when (tab) {
            Tab.HOURLY -> day.copy(hourly = true)
            Tab.DAILY -> day.copy(daily = true)
            else -> return
        }
        if (day != visited) saveAsync(visited)
    }

    /** Caller has a ready ad for one deliberate navigation. A durable reservation precedes every show. */
    fun reserve(tab: Tab): Long? {
        val day = current() ?: return null
        val seen = when (tab) {
            Tab.HOURLY -> day.hourly
            Tab.DAILY -> day.daily
            else -> false
        }
        if (!seen || day.spent || draw() >= chance() / 100.0) return null
        return if (save(day.copy(spent = true))) day.date else null
    }

    /** If the device crossed midnight between reservation and display, consume the display day as well. */
    fun displayed(reservedDate: Long) {
        val day = current() ?: return
        if (day.date > reservedDate && !day.spent) save(day.copy(spent = true))
    }

    fun failedBeforeDisplay(date: Long) {
        val day = load()
        if (day.date == date && day.spent) save(day.copy(spent = false))
    }

    fun available(): Boolean = current()?.spent == false

    private fun current(): ForecastAdDay? {
        val stored = load()
        val now = today()
        return when {
            now < stored.date -> null
            now == stored.date -> stored
            else -> ForecastAdDay(now)
        }
    }
}

/** Owns exactly one reserved display and destination until the SDK reports a terminal outcome. */
internal class ForecastTransition(
    private val date: Long,
    private val visits: ForecastVisits,
    private val navigate: () -> Unit,
) {
    private var shown = false
    private var done = false

    fun displayed() {
        if (done || shown) return
        shown = true
        visits.displayed(date)
    }

    fun finish(failedBeforeShow: Boolean) {
        if (done) return
        done = true
        if (failedBeforeShow && !shown) visits.failedBeforeDisplay(date)
        navigate()
    }
}
