package net.wizardfactory.todayweather.ads

import net.wizardfactory.todayweather.core.domain.shell.Tab
import org.junit.Assert.*
import org.junit.Test

class NativeInventoryTest {
    private var now = 0L
    private val pending = ArrayDeque<() -> Unit>()
    private val loads = mutableListOf<(String?) -> Unit>()
    private val released = mutableListOf<String>()
    private val inventory = NativeInventory<String>(loads::add, released::add, { now }, pending::addLast)
    private var displayed: String? = null

    private fun start() {
        inventory.setForeground(true)
        inventory.setEnabled(true)
    }

    /** A visit whose slot is already in view when it opens: the #3041 cases. */
    private fun visit(tab: Tab, key: Any = Any()) = open(tab, key).also { it.reach() }

    private fun open(tab: Tab, key: Any = Any()) = inventory.open(tab, key) { displayed = it }

    private fun dispatch() {
        while (pending.isNotEmpty()) pending.removeFirst()()
    }

    @Test fun returningToHourlyReusesItsCardWithoutWaitingForANewLoad() {
        start()
        dispatch()
        loads.single()("hourly-ad")
        visit(Tab.HOURLY)
        assertEquals("hourly-ad", displayed)
        dispatch()
        loads[1]("daily-ad")
        visit(Tab.DAILY)
        assertEquals("daily-ad", displayed)
        visit(Tab.HOURLY)
        assertEquals("hourly-ad", displayed)
        visit(Tab.DAILY)
        assertEquals("daily-ad", displayed)
        assertTrue(released.isEmpty())
        assertEquals(1, pending.size)
        dispatch()
        assertEquals(3, loads.size)
    }

    @Test fun missingSlotNeverInsertsLateAndSavesTheFillForAnotherVisit() {
        start()
        val key = Any()
        val empty = visit(Tab.HOURLY, key)
        assertNull(displayed)
        dispatch()
        loads.single()("next-page")
        assertNull(displayed)
        empty.detach()
        visit(Tab.HOURLY, key)
        assertNull("return from an overlay is still the same visit", displayed)
        inventory.end(key)
        visit(Tab.AIR)
        assertEquals("next-page", displayed)
        assertEquals(1, pending.size)
    }

    @Test fun expiredAssignedAndSpareCreativesAreReleasedFromLoadTime() {
        start()
        dispatch()
        loads.single()("hourly")
        now = 30 * 60_000
        visit(Tab.HOURLY)
        dispatch()
        loads[1]("spare")
        now = 55 * 60_000 - 1L
        visit(Tab.HOURLY)
        assertEquals("hourly", displayed)
        now++
        visit(Tab.HOURLY)
        assertEquals("spare", displayed)
        assertEquals(listOf("hourly"), released)
        dispatch()
        loads[2]("unused")
        now += 55 * 60_000L
        visit(Tab.DAILY)
        assertNull(displayed)
        assertEquals(listOf("hourly", "spare", "unused"), released)
    }

    @Test fun fourAssignedTabsNeedNoFifthCreativeAndRevocationReleasesEachOnce() {
        start()
        for ((i, tab) in Tab.entries.withIndex()) {
            dispatch()
            loads[i](tab.name)
            visit(tab)
            assertEquals(tab.name, displayed)
        }
        for (tab in Tab.entries.reversed()) {
            visit(tab)
            assertEquals(tab.name, displayed)
        }
        assertTrue(pending.isEmpty())
        assertEquals(4, loads.size)
        inventory.setEnabled(false)
        assertNull(displayed)
        inventory.setEnabled(false)
        assertEquals(Tab.entries.map { it.name }.sorted(), released.sorted())
    }

    @Test fun requestsCoalesceAndNoFillRetriesOnlyOnLaterDemand() {
        start()
        for (tab in Tab.entries) visit(tab)
        assertEquals(1, pending.size)
        assertTrue(loads.isEmpty())
        dispatch()
        for (tab in Tab.entries) visit(tab)
        assertTrue(pending.isEmpty())
        loads.single()(null)
        now = 59_999L
        visit(Tab.HOURLY)
        inventory.setForeground(false)
        inventory.setForeground(true)
        assertTrue(pending.isEmpty())
        now++
        visit(Tab.AIR)
        visit(Tab.DAILY)
        assertNull(displayed)
        assertEquals(1, pending.size)
        dispatch()
        assertEquals(2, loads.size)
    }

    @Test fun backgroundSkipsQueuedWorkAndRevocationRejectsOldCallbacks() {
        start()
        inventory.setForeground(false)
        dispatch()
        assertTrue(loads.isEmpty())
        inventory.setForeground(true)
        dispatch()
        assertEquals(1, loads.size)
        inventory.setEnabled(false)
        inventory.setEnabled(true)
        dispatch()
        loads[0]("stale")
        loads[1]("spare")
        inventory.setEnabled(false)
        assertEquals(listOf("stale", "spare"), released)
        visit(Tab.AIR)
        assertNull(displayed)
        inventory.setEnabled(true)
        inventory.setEnabled(false)
        dispatch()
        assertEquals(2, loads.size)
    }

    @Test fun fillBeforeTheSlotIsReachedIsShownInThatVisit() {
        start()
        val first = open(Tab.HOURLY)
        assertNull(displayed)
        dispatch()
        loads.single()("cold-start")
        assertEquals("cold-start", displayed)
        first.reach()
        assertEquals("cold-start", displayed)
        assertEquals("the visit took the fill, so the next spare is requested", 1, pending.size)
        visit(Tab.DAILY)
        assertNull(displayed)
        visit(Tab.HOURLY)
        assertEquals("the tab keeps its assigned ad", "cold-start", displayed)
        assertTrue(released.isEmpty())
    }

    @Test fun fillAfterTheSlotIsReachedWaitsForTheNextVisit() {
        start()
        val key = Any()
        open(Tab.HOURLY, key).reach()
        dispatch()
        loads.single()("late")
        assertNull("the reader passed the slot, so nothing is inserted", displayed)
        open(Tab.HOURLY, key).reach()
        assertNull("one decision per visit", displayed)
        inventory.end(key)
        open(Tab.HOURLY)
        assertEquals("late", displayed)
    }

    @Test fun anOverlayKeepsThePendingVisitAndItsLaterFill() {
        start()
        val key = Any()
        val visit = open(Tab.AIR, key)
        visit.detach()
        displayed = null
        dispatch()
        loads.single()("under-the-menu")
        assertNull("no renderer while the overlay covers the page", displayed)
        open(Tab.AIR, key).reach()
        assertEquals("under-the-menu", displayed)
    }

    @Test fun reachingAnotherVisitsSlotOrReachingTwiceDecidesNothing() {
        start()
        val old = open(Tab.HOURLY)
        val current = open(Tab.DAILY)
        old.reach()
        dispatch()
        loads.single()("daily")
        assertEquals("daily", displayed)
        current.reach()
        current.reach()
        assertEquals("daily", displayed)
        assertTrue(released.isEmpty())
    }
}
