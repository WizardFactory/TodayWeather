package net.wizardfactory.todayweather.ads

import androidx.activity.ComponentActivity
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The anchor reports reach once the insertion point is at or above the scroll viewport's bottom edge (#3212). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NativeSlotAnchorTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private var reached = false
    private lateinit var scroll: ScrollState
    private var px = 0f

    /** A 300 dp viewport over 500 dp of forecast, the insertion point, then 500 dp more; a 100 dp bar below. */
    private fun page(initial: Int = 0, before: Int = 500, after: Int = 500) {
        compose.setContent {
            px = LocalDensity.current.density
            scroll = rememberScrollState(initial)
            Column {
                Box(Modifier.fillMaxWidth().height(300.dp)) {
                    Column(Modifier.fillMaxWidth().verticalScroll(scroll)) {
                        Spacer(Modifier.fillMaxWidth().height(before.dp))
                        SlotAnchor { reached = true }
                        Spacer(Modifier.fillMaxWidth().height(after.dp))
                    }
                }
                Spacer(Modifier.fillMaxWidth().height(100.dp))
            }
        }
        compose.waitForIdle()
    }

    private fun scrollTo(dp: Int) {
        runBlocking { scroll.scrollTo(if (dp == Int.MAX_VALUE) scroll.maxValue else (dp * px).toInt()) }
        compose.waitForIdle()
    }

    @Test fun belowTheViewportIsNotReachedEvenWhereTheWindowContinues() {
        page()
        assertFalse(reached)
        scrollTo(190)
        assertFalse("10 dp below the viewport, over the bar", reached)
        scrollTo(210)
        assertTrue(reached)
    }

    @Test fun anInsertionPointInViewIsReachedAtOnce() {
        page(before = 100)
        assertTrue(reached)
    }

    @Test fun anInsertionPointAlreadyScrolledPastIsReachedAtOnce() {
        page(initial = Int.MAX_VALUE)
        assertTrue("scroll restored below the slot", reached)
    }

    @Test fun theAnchorTakesNoSpace() {
        page()
        assertEquals(0f, compose.onNodeWithTag(NATIVE_SLOT_ANCHOR).getUnclippedBoundsInRoot().let { (it.bottom - it.top).value }, 0f)
        assertEquals((1000 * px).toInt(), scroll.maxValue + (300 * px).toInt())
    }

    @Test fun aSlotAtTheEndOfTheContentIsReachedAtTheBottomOfTheScroll() {
        page(after = 0)
        assertFalse(reached)
        scrollTo(Int.MAX_VALUE)
        assertTrue("Saved Places: nothing follows the slot, so the viewport's bottom edge is the insertion point", reached)
    }
}
