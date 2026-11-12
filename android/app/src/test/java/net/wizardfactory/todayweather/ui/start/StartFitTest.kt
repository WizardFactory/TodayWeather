package net.wizardfactory.todayweather.ui.start

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import net.wizardfactory.todayweather.search.PlaceSearch
import net.wizardfactory.todayweather.search.Prediction
import androidx.compose.ui.test.isDisplayed
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import net.wizardfactory.todayweather.core.domain.start.TownSearch
import net.wizardfactory.todayweather.ui.shell.ShellFit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** S01's last action must remain reachable with the system's large text, even in a short window. */
abstract class StartFitTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    // AN-18c: all existing states at each parity display size, in both language subclasses.
    @Test @Config(qualifiers = "+w384dp-h832dp-port", fontScale = 1f)
    fun parity384() = fits()
    @Test @Config(qualifiers = "+w360dp-h780dp-port", fontScale = 1f)
    fun parity360() = fits()
    @Test @Config(qualifiers = "+w412dp-h892dp-port", fontScale = 1f)
    fun parity412() = fits()
    @Test @Config(qualifiers = "+w320dp-h694dp-port", fontScale = 1f)
    fun parity320() = fits()

    @Test @Config(qualifiers = "+w360dp-h640dp-port", fontScale = 1.3f)
    fun phoneLargeText() = fits()

    @Test @Config(qualifiers = "+w832dp-h384dp-land", fontScale = 1.3f)
    fun landscapeLargeText() = fits()
    @Test @Config(qualifiers = "+w320dp-h480dp-port", fontScale = 1.3f)
    fun narrowLargeText() = fits()
    @Test @Config(qualifiers = "+w800dp-h1280dp-port", fontScale = 1.3f)
    fun tabletPortraitLargeText() = fits()
    @Test @Config(qualifiers = "+w1280dp-h800dp-land", fontScale = 1.3f)
    fun tabletLandscapeLargeText() = fits()
    @Test @Config(qualifiers = "+w841dp-h701dp-land", fontScale = 1.3f)
    fun foldableOpenLargeText() = fits()
    @Test @Config(qualifiers = "+w797dp-h411dp-land", fontScale = 1.3f)
    fun foldableClosedRotatedLargeText() = fits()

    @Test @Config(qualifiers = "+w701dp-h841dp-port", fontScale = 1.3f)
    fun foldableOpenRotatedLargeText() = fits()
    @Test @Config(qualifiers = "+w411dp-h797dp-port", fontScale = 1.3f)
    fun foldableClosedLargeText() = fits()
    @Test @Config(qualifiers = "+w640dp-h800dp-port", fontScale = 1.3f)
    fun splitHalfLargeText() = fits()
    @Test @Config(qualifiers = "+w421dp-h701dp-port", fontScale = 1.3f)
    fun foldableSplitLargeText() = fits()

    @Test @Config(qualifiers = "+w832dp-h384dp-land", fontScale = 1.3f)
    fun landscapePredictionsAreReachable() = predictionsFit()

    @Test @Config(qualifiers = "+w797dp-h411dp-land", fontScale = 1.3f)
    fun foldedRotatedPredictionsAreReachable() = predictionsFit()

    private fun predictionsFit() {
        val predictions = (1..5).map { Prediction("Search result $it", 0) }
        var selected: Prediction? = null
        rule.setContent {
            // Reserve the status/navigation bars as the real StartScreen does.
            Box(Modifier.fillMaxSize().padding(top = 24.dp, bottom = 24.dp)) {
                StartContent(PlaceSearch { predictions }, { TownSearch(emptyList()) }, {}, { value, _ -> selected = value }, {}, {})
            }
        }
        rule.onNodeWithTag(StartTags.INPUT).performTextInput("Search")
        rule.mainClock.advanceTimeBy(400)
        rule.waitForIdle()
        val attribution = rule.onNodeWithTag(StartTags.ATTRIBUTION)
        attribution.performScrollTo().assertIsDisplayed()
        val shown = attribution.getBoundsInRoot()
        val whole = attribution.getUnclippedBoundsInRoot()
        assertEquals("whole attribution reachable", (whole.bottom - whole.top).value, (shown.bottom - shown.top).value, 0.5f)
        val safe = rule.onNodeWithTag(StartTags.PAGE).fetchSemanticsNode().boundsInRoot
        val badge = attribution.fetchSemanticsNode().boundsInRoot
        assertTrue("attribution above navigation bar", badge.bottom <= safe.bottom + 0.5f)
        assertEquals(emptyList<String>(), ShellFit.texts(rule, "predictions", safe))
        val last = rule.onNodeWithTag(StartTags.result(4))
        last.performScrollTo().assertIsDisplayed()
        assertEquals(last.getUnclippedBoundsInRoot().let { (it.bottom - it.top).value }, last.getBoundsInRoot().let { (it.bottom - it.top).value }, 0.5f)
        last.performClick()
        assertEquals("fifth prediction can be selected", predictions.last(), selected)
    }

    private fun fits() {
        var selected = 0
        rule.setContent {
            StartContent(null, { TownSearch(emptyList()) }, {}, { _, _ -> }, {}, { selected++ })
        }
        rule.waitForIdle()
        val location = rule.onNodeWithTag(StartTags.LOCATION)
        val initial = location.getBoundsInRoot()
        val full = location.getUnclippedBoundsInRoot()
        if (!location.isDisplayed() || kotlin.math.abs((initial.bottom - initial.top).value - (full.bottom - full.top).value) > 0.5f) {
            location.performScrollTo()
        }
        location.assertIsDisplayed()
        val shown = location.getBoundsInRoot()
        val whole = location.getUnclippedBoundsInRoot()
        assertEquals("the whole location action is reachable", (whole.bottom - whole.top).value, (shown.bottom - shown.top).value, 0.5f)
        assertTrue("location action has height", (shown.bottom - shown.top).value > 0f)
        val safe = ShellFit.safeArea(rule.activity, rule.onRoot().fetchSemanticsNode().boundsInRoot)
        assertEquals(emptyList<String>(), ShellFit.texts(rule, "start", safe))
        location.performClick()
        assertEquals("reachable action works", 1, selected)
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-xhdpi")
class StartFitKoTest : StartFitTest()

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "en-rUS-xhdpi")
class StartFitEnTest : StartFitTest()
