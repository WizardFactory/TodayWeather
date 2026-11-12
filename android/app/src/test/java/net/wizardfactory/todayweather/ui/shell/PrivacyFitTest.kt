package net.wizardfactory.todayweather.ui.shell

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.unit.dp
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.PrivacyActions
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The usage analytics popup in a small window at font scale 1.3 with a banner (#2894, review round 1 F2): as Ionic's
 * `.popup` it stays within 90 % of the area above the banner, its body scrolls, and its two buttons show whole (a long
 * label wraps and the buttons grow) and work; no text is cut or ellipsized ([ShellFit]).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class PrivacyFitTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val seoulBody = File(project, "../core-domain/src/test/resources/corpus/inputs/kma-seoul.json").readText()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    @After fun stop() = scope.cancel()

    // AN-18c: all existing states at each parity display size, in both language subclasses.
    @Test @Config(qualifiers = "ko-rKR-w384dp-h832dp-port-xhdpi", fontScale = 1f)
    fun parity384Korean() = fits(R.string.LOC_ANALYTICS_ALLOW, mustScroll = false)
    @Test @Config(qualifiers = "en-rUS-w384dp-h832dp-port-xhdpi", fontScale = 1f)
    fun parity384English() = fits(R.string.LOC_ANALYTICS_ALLOW, mustScroll = false)
    @Test @Config(qualifiers = "ko-rKR-w360dp-h780dp-port-xhdpi", fontScale = 1f)
    fun parity360Korean() = fits(R.string.LOC_ANALYTICS_ALLOW, mustScroll = false)
    @Test @Config(qualifiers = "en-rUS-w360dp-h780dp-port-xhdpi", fontScale = 1f)
    fun parity360English() = fits(R.string.LOC_ANALYTICS_ALLOW, mustScroll = false)
    @Test @Config(qualifiers = "ko-rKR-w412dp-h892dp-port-xhdpi", fontScale = 1f)
    fun parity412Korean() = fits(R.string.LOC_ANALYTICS_ALLOW, mustScroll = false)
    @Test @Config(qualifiers = "en-rUS-w412dp-h892dp-port-xhdpi", fontScale = 1f)
    fun parity412English() = fits(R.string.LOC_ANALYTICS_ALLOW, mustScroll = false)
    @Test @Config(qualifiers = "ko-rKR-w320dp-h694dp-port-xhdpi", fontScale = 1f)
    fun parity320Korean() = fits(R.string.LOC_ANALYTICS_ALLOW, mustScroll = false)
    @Test @Config(qualifiers = "en-rUS-w320dp-h694dp-port-xhdpi", fontScale = 1f)
    fun parity320English() = fits(R.string.LOC_ANALYTICS_ALLOW, mustScroll = false)

    @Test @Config(qualifiers = "ko-rKR-w320dp-h480dp-port", fontScale = 1.3f) fun koreanSmallWindowLargeText() = fits(R.string.LOC_ANALYTICS_ALLOW)
    @Test @Config(qualifiers = "en-rUS-w320dp-h480dp-port", fontScale = 1.3f) fun englishSmallWindowLargeText() = fits(R.string.LOC_ANALYTICS_ALLOW)

    private fun fits(allow: Int, mustScroll: Boolean = true) {
        val seoul = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))
        val memory = object : StateAccess {
            val flow = MutableStateFlow(AppState(places = listOf(seoul), placeIndex = 0, units = UnitSettings.defaults("KR")))
            override fun current() = flow.value
            override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
        }
        val repository = WeatherRepository("https://server.test.invalid", null, HttpGet { _, _ -> seoulBody }, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        val chosen = mutableListOf<Boolean>()
        val privacy = PrivacyActions(MutableStateFlow(false), { chosen += it; true }) {}
        rule.setContent {
            val state by memory.flow.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            AppContent(state, entries, loading, false, session, host, "test", onExit = {}, privacy = privacy,
                banner = { Box(Modifier.fillMaxWidth().height(60.dp).testTag(BANNER)) })
        }
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.row(MenuRow.ANALYTICS)).performScrollTo().performClick()
        rule.waitForIdle()

        val area = rule.onNodeWithTag(BANNER).getBoundsInRoot().top.value
        val popup = rule.onNodeWithTag(PopupTags.POPUP).getUnclippedBoundsInRoot()
        assertTrue(popup.bottom.value - popup.top.value <= area * 0.9f + 0.5f, "the popup stays within 90 % of the area above the banner")
        assertTrue(popup.top.value >= 0f && popup.bottom.value <= area, "and inside it")
        val buttons = rule.onAllNodesWithTag(PopupTags.BUTTON)
        for (i in 0 until 2) {
            val shown = buttons[i].getBoundsInRoot()
            val whole = buttons[i].getUnclippedBoundsInRoot()
            assertTrue(shown.bottom.value - shown.top.value >= 45f, "button $i keeps at least its 45 dp")
            assertEquals(whole.bottom.value - whole.top.value, shown.bottom.value - shown.top.value, 0.5f, "button $i shows whole")
        }
        val body = rule.onNodeWithTag(PopupTags.BODY).fetchSemanticsNode()
        val range = body.config[SemanticsProperties.VerticalScrollAxisRange]
        assertTrue(SemanticsActions.ScrollBy in body.config, "body scrolling is enabled")
        if (mustScroll) assertTrue(range.maxValue() > 0f, "the small-window body needs scrolling")
        val safe = ShellFit.safeArea(rule.activity, rule.onRoot().fetchSemanticsNode().boundsInRoot)
        assertEquals(emptyList(), ShellFit.texts(rule, "popup", safe))
        if (range.maxValue() > 0f) {
            rule.onNodeWithTag(PopupTags.BODY).performTouchInput { swipeUp() }
            rule.waitForIdle()
            assertTrue(range.value() > 0f, "the body scrolled")
        }
        rule.onNode(hasText(rule.activity.getString(allow)) and hasAnyAncestor(hasTestTag(PopupTags.POPUP)), useUnmergedTree = true).performClick()
        rule.waitForIdle()
        assertEquals(listOf(true), chosen)
    }

    private companion object {
        const val BANNER = "fit-banner"
    }
}
