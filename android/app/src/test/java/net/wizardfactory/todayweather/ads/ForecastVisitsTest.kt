package net.wizardfactory.todayweather.ads

import android.content.SharedPreferences
import net.wizardfactory.todayweather.analytics.RemoteBannerConfig
import net.wizardfactory.todayweather.core.domain.shell.Tab
import org.junit.Assert.*
import org.junit.Test

class ForecastVisitsTest {
    private var day = 18L
    private var stored = ForecastAdDay(Long.MIN_VALUE)
    private var probability = 0.0
    private var draws = 0
    private var canSave = true
    private var chance = RemoteBannerConfig.DEFAULT_INTERSTITIAL_CHANCE
    private fun fresh() = ForecastVisits({ stored }, { value -> if (canSave) stored = value; canSave },
        { day }, { draws++; probability }, { chance })

    @Test fun protectsEachFirstVisitAndSharesTheCapAcrossTabsAndRestarts() {
        for ((first, second) in listOf(Tab.DAILY to Tab.HOURLY, Tab.HOURLY to Tab.DAILY)) {
            stored = ForecastAdDay(Long.MIN_VALUE)
            draws = 0
            val visits = fresh()
            assertNull(visits.reserve(first))
            visits.visible(first)
            assertNull(visits.reserve(second))
            visits.visible(second)
            assertEquals(0, draws)
            probability = 0.30
            assertNull(visits.reserve(first))
            probability = 0.2999
            assertEquals(day, visits.reserve(first))
            assertFalse(fresh().available())
            assertNull(fresh().reserve(second))
            assertEquals(2, draws)
        }
    }

    /** #3213: the Remote Config percentage replaces the fixed 10%; 0 never shows, 100 shows on every eligible return. */
    @Test fun theConfiguredChanceDecidesEachEligibleReturn() {
        for ((percent, roll, shows) in listOf(
            Triple(30, 0.2999, true), Triple(30, 0.30, false), Triple(0, 0.0, false),
            Triple(100, 0.9999, true), Triple(55, 0.5499, true), Triple(55, 0.55, false),
        )) {
            stored = ForecastAdDay(Long.MIN_VALUE)
            chance = percent
            probability = roll
            val visits = fresh()
            visits.visible(Tab.DAILY)
            assertEquals("$percent% with $roll", if (shows) day else null, visits.reserve(Tab.DAILY))
            assertEquals(!shows, fresh().available())
        }
    }

    @Test fun aChangedChanceAppliesToTheNextDrawWithoutANewInstance() {
        val visits = fresh()
        visits.visible(Tab.HOURLY)
        probability = 0.5
        assertNull(visits.reserve(Tab.HOURLY))
        chance = 100
        assertEquals(day, visits.reserve(Tab.HOURLY))
    }

    @Test fun aNewCalendarDateProtectsBothTabsAndRollbackNeverReopensAnEarlierDay() {
        val visits = fresh()
        visits.visible(Tab.DAILY)
        assertEquals(day, visits.reserve(Tab.DAILY))
        day++
        assertTrue(visits.available())
        assertNull(visits.reserve(Tab.DAILY))
        visits.visible(Tab.HOURLY)
        assertNull(visits.reserve(Tab.DAILY))
        day--
        assertFalse(visits.available())
        visits.visible(Tab.DAILY)
        assertNull(visits.reserve(Tab.DAILY))
    }

    @Test fun noConfirmedReservationNoDisplayAndOnlyConfirmedFailureReleasesTheSameDay() {
        val visits = fresh()
        visits.visible(Tab.DAILY)
        canSave = false
        assertNull(visits.reserve(Tab.DAILY))
        canSave = true
        assertEquals(day, visits.reserve(Tab.DAILY))
        visits.failedBeforeDisplay(day - 1)
        assertNull(visits.reserve(Tab.DAILY))
        visits.failedBeforeDisplay(day)
        assertEquals(day, visits.reserve(Tab.DAILY))
        assertNull(visits.reserve(Tab.HOURLY))
    }

    @Test fun terminalSdkCallbacksNavigateOnlyOnceAndReleaseOnlyOnConfirmedPreDisplayFailure() {
        val visits = fresh()
        visits.visible(Tab.HOURLY)
        var navigations = 0
        val first = ForecastTransition(visits.reserve(Tab.HOURLY)!!, visits) { navigations++ }
        first.finish(true)
        first.finish(false)
        assertEquals(1, navigations)
        val second = ForecastTransition(visits.reserve(Tab.HOURLY)!!, visits) { navigations++ }
        second.displayed()
        second.finish(true)
        second.finish(false)
        assertFalse(visits.available())
        assertEquals(2, navigations)
    }

    @Test fun displayJustAfterMidnightConsumesTheNewDaysAllowance() {
        val visits = fresh()
        visits.visible(Tab.HOURLY)
        val transition = ForecastTransition(visits.reserve(Tab.HOURLY)!!, visits) {}
        day++
        transition.displayed()
        visits.visible(Tab.DAILY)
        assertNull(visits.reserve(Tab.DAILY))
    }

    @Test fun visitsToOtherTabsNeverDraw() {
        val visits = fresh()
        visits.visible(Tab.LOCATIONS)
        visits.visible(Tab.AIR)
        assertNull(visits.reserve(Tab.AIR))
        assertNull(visits.reserve(Tab.LOCATIONS))
        assertEquals(0, draws)
    }

    /** #3238 AC5: visible() uses apply(), while reserve(), displayed(), and failedBeforeDisplay() still commit(). */
    @Test fun visibleUsesApplyWhileReservationDisplayAndReleaseUseCommit() {
        val prefs = RecordingPrefs()
        val visits = forecastVisits(prefs, { day }, { probability }, { chance })

        visits.visible(Tab.HOURLY)
        assertEquals(0, prefs.commits)
        assertEquals(1, prefs.applies)
        assertTrue(prefs.getBoolean("hourly", false))

        // Repeat visible on same tab performs no extra write.
        visits.visible(Tab.HOURLY)
        assertEquals(0, prefs.commits)
        assertEquals(1, prefs.applies)

        // reserve() must commit synchronously.
        val reserved = visits.reserve(Tab.HOURLY)
        assertEquals(day, reserved)
        assertEquals(1, prefs.commits)
        assertEquals(1, prefs.applies)
        assertTrue(prefs.getBoolean("spent", false))

        // failedBeforeDisplay() must commit synchronously.
        visits.failedBeforeDisplay(day)
        assertEquals(2, prefs.commits)
        assertEquals(1, prefs.applies)
        assertFalse(prefs.getBoolean("spent", true))

        // Re-reserve and cross midnight before display: displayed() must commit synchronously.
        assertEquals(day, visits.reserve(Tab.HOURLY))
        assertEquals(3, prefs.commits)
        day++
        visits.displayed(day - 1)
        assertEquals(4, prefs.commits)
        assertEquals(1, prefs.applies)
        assertTrue(prefs.getBoolean("spent", false))
    }

    private class RecordingPrefs : SharedPreferences {
        private val data = LinkedHashMap<String, Any?>()
        var commits = 0
        var applies = 0

        override fun getAll(): MutableMap<String, *> = HashMap(data)
        override fun getString(key: String?, defValue: String?): String? = data[key] as? String ?: defValue
        @Suppress("UNCHECKED_CAST")
        override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? = data[key] as? MutableSet<String> ?: defValues
        override fun getInt(key: String?, defValue: Int): Int = data[key] as? Int ?: defValue
        override fun getLong(key: String?, defValue: Long): Long = data[key] as? Long ?: defValue
        override fun getFloat(key: String?, defValue: Float): Float = data[key] as? Float ?: defValue
        override fun getBoolean(key: String?, defValue: Boolean): Boolean = data[key] as? Boolean ?: defValue
        override fun contains(key: String?): Boolean = key in data
        override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}
        override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}

        override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
            private val staged = LinkedHashMap<String, Any?>()
            override fun putString(key: String?, value: String?) = apply { if (key != null) staged[key] = value }
            override fun putStringSet(key: String?, values: MutableSet<String>?) = apply { if (key != null) staged[key] = values }
            override fun putInt(key: String?, value: Int) = apply { if (key != null) staged[key] = value }
            override fun putLong(key: String?, value: Long) = apply { if (key != null) staged[key] = value }
            override fun putFloat(key: String?, value: Float) = apply { if (key != null) staged[key] = value }
            override fun putBoolean(key: String?, value: Boolean) = apply { if (key != null) staged[key] = value }
            override fun remove(key: String?) = apply { if (key != null) staged[key] = null }
            override fun clear() = apply { staged.clear() }
            override fun commit(): Boolean {
                data.putAll(staged)
                commits++
                return true
            }
            override fun apply() {
                data.putAll(staged)
                applies++
            }
        }
    }
}
