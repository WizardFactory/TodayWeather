package net.wizardfactory.todayweather.ui.alarms

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import java.io.File
import kotlin.math.abs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.core.data.AlarmPage
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.NotificationAccess
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PushState
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.core.storage.closeStart
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.WeatherTabTags
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.shell.ShellFit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * S09 at font scale 1.3 (AN-06: text follows the system font scale; review F6), on a phone, a small window and a tablet,
 * and at 1.0 on the reference phone and a small window: the page from its top to Cancel and Save, and the picker O14. No
 * text is ellipsized or cut and none reaches past the window's sides ([ShellFit]), each description's lines fit its block,
 * so none runs into the hour bar or the weekday buttons, and below 360 dp the weekday row follows the Cordova
 * `max-width: 359px` rule. Images go to build/alarms-fit/.
 */
abstract class AlarmsFitTest(private val lang: String) {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val out = File(project, "build/alarms-fit").apply { mkdirs() }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    @After fun stop() = scope.cancel()

    // AN-18 AC4: window-size coverage; real multi-window is checked separately on device.
    @Test @Config(qualifiers = "+w800dp-h1280dp-port", fontScale = 1.3f) fun tabletPortraitLargeText() = fits("tabletPortraitLargeText")
    @Test @Config(qualifiers = "+w841dp-h701dp-land", fontScale = 1.3f) fun foldableOpenLargeText() = fits("foldableOpenLargeText")
    @Test @Config(qualifiers = "+w701dp-h841dp-port", fontScale = 1.3f) fun foldableOpenRotatedLargeText() = fits("foldableOpenRotatedLargeText")
    @Test @Config(qualifiers = "+w411dp-h797dp-port", fontScale = 1.3f) fun foldableClosedLargeText() = fits("foldableClosedLargeText")
    @Test @Config(qualifiers = "+w797dp-h411dp-land", fontScale = 1.3f) fun foldableClosedRotatedLargeText() = fits("foldableClosedRotatedLargeText")
    @Test @Config(qualifiers = "+w832dp-h384dp-land", fontScale = 1.3f) fun phoneLandscapeLargeText() = fits("phoneLandscapeLargeText")
    @Test @Config(qualifiers = "+w640dp-h800dp-port", fontScale = 1.3f) fun splitHalfLargeText() = fits("splitHalfLargeText")
    @Test @Config(qualifiers = "+w421dp-h701dp-port", fontScale = 1.3f) fun foldableSplitLargeText() = fits("foldableSplitLargeText")

    @Test @Config(qualifiers = "+w360dp-h640dp-port", fontScale = 1.3f) fun phoneLargeText() = fits("phone-text-1.3")
    @Test @Config(qualifiers = "+w320dp-h480dp-port", fontScale = 1.3f) fun smallWindowLargeText() = fits("small-window-text-1.3")
    @Test @Config(qualifiers = "+w1280dp-h800dp-land", fontScale = 1.3f) fun tabletLargeText() = fits("tablet-text-1.3")
    @Test @Config(qualifiers = "+w384dp-h832dp-port") fun phone() = fits("phone")
    @Test @Config(qualifiers = "+w320dp-h480dp-port") fun smallWindow() = fits("small-window")

    private fun fits(name: String) {
        val seoul = Place(false, false, "서울", "대한민국 서울특별시", "KR", Location(37.567, 126.978))
        val memory = object : StateAccess {
            val flow = MutableStateFlow(AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1,
                units = UnitSettings.defaults("KR"), push = PushState(fcmToken = "t")).closeStart().copy(placeIndex = 1))
            override fun current() = flow.value
            override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
        }
        val repository = WeatherRepository("https://server.test.invalid", null,
            HttpGet { _, _ -> File(inputs, "kma-seoul.json").readText() }, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf(lang) }, { null })
        var granted = true
        val permission = object : NotificationAccess {
            override val available = true
            override fun enabled() = granted
            override suspend fun request() = granted
        }
        lateinit var page: AlarmPage
        val alarms = AlarmsHost { s, openSettings -> AlarmPage(memory, permission, post = {}, openSettings = openSettings, scope = s).also { page = it } }
        rule.setContent {
            val state by memory.flow.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            AppContent(state, entries, loading, false, session, host, "test", onExit = {}, alarms = alarms)
        }
        session.reload(WeatherSession.Sender.INIT)
        rule.waitForIdle()
        rule.onNodeWithTag(WeatherTabTags.BELL).performClick()
        rule.waitForIdle()
        val safe = ShellFit.safeArea(rule.activity, rule.onRoot().fetchSemanticsNode().boundsInRoot)
        val problems = mutableListOf<String>()
        // `@media (max-width: 359px)`: the weekday row's 8 dp of padding and the buttons' 2 dp of margin, else 16 dp and 4 dp.
        val first = rule.onNodeWithTag(AlarmsTags.day(0)).getUnclippedBoundsInRoot().left
        val expected = if (rule.activity.resources.configuration.screenWidthDp < 360) 10.dp else 20.dp
        if (abs(first.value - expected.value) > 0.6f) problems += "the first weekday button at $first, not $expected"
        problems += ShellFit.texts(rule, "top", safe)
        problems += descriptions()
        capture("$name-top")
        rule.onNodeWithTag(AlarmsTags.SAVE).performScrollTo()
        rule.waitForIdle()
        problems += ShellFit.texts(rule, "end", safe)
        capture("$name-end")
        rule.onNodeWithTag(AlarmsTags.row(0)).performScrollTo().performClick()
        rule.waitForIdle()
        problems += ShellFit.texts(rule, "picker", safe)
        capture("$name-picker")
        rule.runOnIdle { page.back(); page.setAlert(true); page.setHours(6.0, 6.0); page.save() }
        rule.waitForIdle()
        assertEquals(net.wizardfactory.todayweather.core.data.AlarmPopup.EqualHours, page.popup.value)
        problems += ShellFit.texts(rule, "equal-hours", safe)
        capture("$name-equal-hours")
        rule.runOnIdle { page.closeEqualHours(); page.setHours(6.0, 22.0); page.cancel() }
        rule.waitForIdle()
        assertEquals(net.wizardfactory.todayweather.core.data.AlarmPopup.SaveChanges, page.popup.value)
        problems += ShellFit.texts(rule, "save-changes", safe)
        capture("$name-save-changes")
        rule.runOnIdle { granted = false; page.answerSaveChanges(true) }
        rule.waitForIdle()
        assertEquals(net.wizardfactory.todayweather.core.data.AlarmPopup.Permission, page.popup.value)
        problems += ShellFit.texts(rule, "notification-permission", safe)
        capture("$name-permission")
        assertEquals("$lang $name", emptyList<String>(), problems.distinct())
    }

    /** Each description's lines within its block, with 8 dp of padding above and under them. */
    private fun descriptions(): List<String> = (0..1).mapNotNull { i ->
        val node = rule.onNode(hasAnyAncestor(hasTestTag(AlarmsTags.description(i))) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Text),
            useUnmergedTree = true).fetchSemanticsNode()
        val layouts = mutableListOf<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        val lines = layouts.single().multiParagraph.height
        val room = rule.onNodeWithTag(AlarmsTags.description(i)).fetchSemanticsNode().size.height - 16 * rule.density.density
        // Compose's text box can round a pixel above the CSS block (the screenshot comparisons keep the block).
        if (lines > room + 1.5f) "description $i: its lines are $lines px high in $room px" else null
    }

    private fun capture(name: String) {
        val image = rule.onRoot().captureToImage().asAndroidBitmap()
        File(out, "$lang-$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-xhdpi")
class AlarmsFitKoTest : AlarmsFitTest("ko-KR")

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "en-rUS-xhdpi")
class AlarmsFitEnTest : AlarmsFitTest("en-US")
