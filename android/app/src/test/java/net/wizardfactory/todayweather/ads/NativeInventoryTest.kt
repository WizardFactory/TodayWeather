package net.wizardfactory.todayweather.ads

import org.junit.Assert.*
import org.junit.Test

class NativeInventoryTest {
    private var now = 0L
    private val loads = mutableListOf<(String?) -> Unit>()
    private val released = mutableListOf<String>()
    private val inventory = NativeInventory<String>({ loads.add(it) }, { released.add(it) }) { now }
    private var displayed: String? = null
    private fun visit() = inventory.open(Any()) { displayed = it }

    @Test fun readyCreativeIsShownOnEntryAndReleasedOnce() {
        assertTrue(loads.isEmpty())
        inventory.setEnabled(true)
        loads.single()("creative-1")
        val first = visit()
        assertEquals("creative-1", displayed)
        loads[1]("creative-2")
        val second = visit()
        first.close()
        assertEquals("creative-2", displayed)
        second.close()
        assertEquals(listOf("creative-1", "creative-2"), released)
    }

    @Test fun lateAdWaitsForNextVisitOnceReaderReachedSlot() {
        inventory.setEnabled(true)
        val first = visit()
        first.position(belowViewport = true)
        first.position(belowViewport = false)
        first.position(belowViewport = true)
        loads.single()("late")
        assertNull(displayed)
        first.close()
        visit()
        assertEquals("late", displayed)
    }

    @Test fun returningFromAnOverlayCannotInsertAnAdAfterTheAnchorWasReached() {
        val page = Any()
        inventory.setEnabled(true)
        val first = inventory.open(page) { displayed = it }
        first.position(belowViewport = false)
        first.detach()
        loads.single()("late")
        val resumed = inventory.open(page) { displayed = it }
        resumed.position(belowViewport = true)
        assertNull("an overlay return belongs to the same reading visit", displayed)
        resumed.close()
        visit()
        assertEquals("late", displayed)
    }

    @Test fun coveredPageRechecksGeometryBeforeUsingAReadyAd() {
        val page = Any()
        inventory.setEnabled(true)
        val first = inventory.open(page) { displayed = it }
        first.position(belowViewport = true)
        first.detach()
        loads.single()("ready")
        assertNull(displayed)
        val resumed = inventory.open(page) { displayed = it }
        assertNull(displayed)
        resumed.position(belowViewport = true)
        assertEquals("ready", displayed)
        resumed.detach()
        loads[1]("spare")
        val rendered = mutableListOf<String?>()
        inventory.open(page, rendered::add)
        assertEquals(listOf("ready"), rendered)
        inventory.end(page)
        assertEquals(listOf("ready", null), rendered)
        assertEquals(listOf("ready"), released)
        visit()
        assertEquals("spare", displayed)
    }

    @Test fun adMayArriveWhileStillBelowReaderAndIsRevokedImmediately() {
        val slot = visit()
        slot.position(belowViewport = true)
        inventory.setEnabled(true)
        loads.single()("creative")
        assertEquals("creative", displayed)
        inventory.setEnabled(false)
        assertNull(displayed)
        loads[1]("stale")
        slot.close()
        assertEquals(listOf("creative", "stale"), released)
    }

    @Test fun unknownGeometryAndNoFillLeaveNoSlotAndDoNotLoopRequests() {
        inventory.setEnabled(true)
        val first = visit()
        loads.single()("ready-after-entry")
        assertNull(displayed)
        first.position(belowViewport = false)
        assertNull(displayed)
        first.close()
        now += 3_600_001
        visit()
        assertNull(displayed)
        assertEquals(listOf("ready-after-entry"), released)
        loads[1](null)
        assertEquals(2, loads.size)
    }
}
