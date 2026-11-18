package net.wizardfactory.todayweather.ads

import net.wizardfactory.todayweather.core.domain.shell.Tab
import org.junit.Assert.*
import org.junit.Test

class ForecastVisitsTest {
    private var day = 18L
    private var stored = ForecastAdDay(Long.MIN_VALUE)
    private var probability = 0.0
    private var draws = 0
    private var canSave = true
    private fun fresh() = ForecastVisits({ stored }, { value -> if (canSave) stored = value; canSave },
        { day }, { draws++; probability })

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
            probability = 0.10
            assertNull(visits.reserve(first))
            probability = 0.099
            assertEquals(day, visits.reserve(first))
            assertFalse(fresh().available())
            assertNull(fresh().reserve(second))
            assertEquals(2, draws)
        }
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
}
