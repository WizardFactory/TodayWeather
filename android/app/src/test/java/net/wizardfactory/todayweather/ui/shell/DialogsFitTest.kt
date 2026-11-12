package net.wizardfactory.todayweather.ui.shell

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import net.wizardfactory.todayweather.ui.nation.IonicLoading
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.domain.start.LocationMessage
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import net.wizardfactory.todayweather.core.domain.start.StartLocation
import net.wizardfactory.todayweather.ui.forecast.RetryDialog
import net.wizardfactory.todayweather.ui.forecast.SourceDialog
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.start.AccessNotice
import net.wizardfactory.todayweather.ui.start.LocationRetryPopup
import net.wizardfactory.todayweather.ui.start.StartChoicePopup
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Actual O01/O02/O03/O04/O08 components; behavior tests separately verify their app entry points. */
abstract class DialogsFitTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    @Test @Config(qualifiers = "+w320dp-h480dp-port", fontScale = 1.3f) fun narrow() = fits()
    @Test @Config(qualifiers = "+w832dp-h384dp-land", fontScale = 1.3f) fun landscape() = fits()
    @Test @Config(qualifiers = "+w1280dp-h800dp-land", fontScale = 1.3f) fun tablet() = fits()
    @Test @Config(qualifiers = "+w800dp-h1280dp-port", fontScale = 1.3f) fun tabletPortrait() = fits()
    @Test @Config(qualifiers = "+w841dp-h701dp-land", fontScale = 1.3f) fun foldOpen() = fits()
    @Test @Config(qualifiers = "+w701dp-h841dp-port", fontScale = 1.3f) fun foldRotated() = fits()
    @Test @Config(qualifiers = "+w411dp-h797dp-port", fontScale = 1.3f) fun foldClosed() = fits()
    @Test @Config(qualifiers = "+w797dp-h411dp-land", fontScale = 1.3f) fun foldClosedRotated() = fits()
    @Test @Config(qualifiers = "+w640dp-h800dp-port", fontScale = 1.3f) fun splitHalf() = fits()
    @Test @Config(qualifiers = "+w421dp-h701dp-port", fontScale = 1.3f) fun foldSplit() = fits()

    private fun fits() {
        val selected = mutableIntStateOf(0)
        val texts = forecastTexts(rule.activity)
        val confirmations = LocationMessage.entries.map { StartLocation.retry(it, PermissionStatus.DENIED_ALWAYS, false) }
        val alerts = listOf(R.string.LOC_PRIVACY_SAVE_FAILED, R.string.LOC_AD_PRIVACY_UNAVAILABLE,
            R.string.LOC_FAIL_TO_GET_WEATHER_INFO, R.string.LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED)
        val confirmationsEnd = 5 + confirmations.size
        val total = confirmationsEnd + alerts.size + 4
        fun text(id: Int) = rule.activity.getString(id)
        rule.setContent {
            Box(Modifier.fillMaxSize()) {
                when (val i = selected.intValue) {
                    0 -> AccessNotice {}
                    1 -> StartChoicePopup(false, {}, {}, {})
                    2 -> RetryDialog({}, {})
                    3 -> SourceDialog("kaq", texts) {}
                    4 -> SourceDialog("airkorea", texts) {}
                    in 5 until confirmationsEnd -> LocationRetryPopup(confirmations[i - 5], {}, {})
                    in confirmationsEnd until confirmationsEnd + alerts.size -> IonicAlert(if (i-confirmationsEnd < 2) "TodayWeather" else text(R.string.LOC_ERROR), listOf(text(alerts[i-confirmationsEnd])), text(R.string.LOC_OK), {})
                    total - 4 -> IonicPopup(text(R.string.LOC_ANALYTICS_CHOICE), listOf(text(R.string.LOC_ANALYTICS_DETAIL)),
                        listOf(PopupButton(text(R.string.LOC_ANALYTICS_DENY)) {}, PopupButton(text(R.string.LOC_ANALYTICS_ALLOW)) {}), {})
                    total - 3 -> IonicPopup(text(R.string.LOC_WEATHER_ALERT), text(R.string.LOC_ADDED_BAD_WEATHER_ALERT_FUNCTION).split('\n', limit = 2),
                        listOf(PopupButton(text(R.string.LOC_CLOSE)) {}, PopupButton(text(R.string.LOC_OK)) {}), {})
                    total - 2 -> IonicPopup(text(R.string.LOC_WEATHER), listOf("A long weather message. ".repeat(30)), listOf(PopupButton(text(R.string.LOC_OK)) {}), {})
                    else -> IonicLoading()
                }
            }
        }
        for (i in 0 until total) {
            rule.runOnIdle { selected.intValue = i }
            rule.waitForIdle()
            // Material dialogs own a separate root. Parent clipping is checked within each root.
            assertEquals("dialog $i", emptyList<String>(), ShellFit.texts(rule, "dialog $i", null))
            val controls = rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.OnClick))
            val count = controls.fetchSemanticsNodes().size
            if (i == total - 1) assertEquals("loading has no action", 0, count)
            else assertTrue("dialog $i has actions", count > 0)
            for (n in 0 until count) {
                val shown = controls[n].getBoundsInRoot()
                val full = controls[n].getUnclippedBoundsInRoot()
                assertTrue("dialog $i action $n visible", (shown.bottom - shown.top).value > 0f)
                assertEquals("dialog $i action $n height", (full.bottom-full.top).value, (shown.bottom-shown.top).value, 0.5f)
                assertEquals("dialog $i action $n width", (full.right-full.left).value, (shown.right-shown.left).value, 0.5f)
            }
        }
    }
}
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-xhdpi")
class DialogsFitKoTest : DialogsFitTest()
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "en-rUS-xhdpi")
class DialogsFitEnTest : DialogsFitTest()
