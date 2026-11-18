package net.wizardfactory.todayweather.ads

import org.junit.Assert.*
import org.junit.Test

class NativeInventoryTest {
    private var now = 0L
    private val loads = mutableListOf<(String?) -> Unit>()
    private val released = mutableListOf<String>()
    private val inventory = NativeInventory<String>({ loads.add(it) }, { released.add(it) }) { now }
    private var displayed: String? = null
    private fun visit() = inventory.open { displayed = it }

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
