package net.wizardfactory.todayweather.ui.settings

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.SettingsActions
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.settings.SettingLists
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.shell.PopupTags
import net.wizardfactory.todayweather.ui.shell.ShellFit
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The settings pages and the About popup at font scale 1.3 (AN-06: text follows the system font scale), on a phone, a
 * small window and a tablet: S07 with the longest unit values (beaufort, inches, the WHO standard), every S08 list
 * scrolled to its last row, and About over the menu. No text is ellipsized or cut and none reaches past the window's
 * sides ([ShellFit]); a value moves under its name and a long choice wraps. Images go to build/settings-fit/.
 */
abstract class SettingsFitTest(private val lang: String) {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val out = File(project, "build/settings-fit").apply { mkdirs() }
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

    private fun fits(name: String) {
        val seoul = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))
        val memory = object : StateAccess {
            val flow = MutableStateFlow(AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1,
                units = UnitSettings("F", "bft", "inHg", "mi", "in", "airkorea_who")))
            override fun current() = flow.value
            override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
        }
        val repository = WeatherRepository("https://server.test.invalid", null,
            HttpGet { _, _ -> File(inputs, "kma-seoul.json").readText() }, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf(lang) }, { null })
        val settings = SettingsActions(memory, session) {}
        rule.setContent {
            val state by memory.flow.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            AppContent(state, entries, loading, false, session, host, "test", onExit = {}, settings = settings)
        }
        session.reload(WeatherSession.Sender.INIT)
        rule.waitForIdle()
        val safe = ShellFit.safeArea(rule.activity, rule.onRoot().fetchSemanticsNode().boundsInRoot)
        val problems = mutableListOf<String>()
        fun page(what: String, rows: Int) {
            problems += ShellFit.texts(rule, what, safe)
            capture("$name-$what")
            rule.onNodeWithTag(SettingsTags.row(rows - 1)).performScrollTo()
            rule.waitForIdle()
            problems += ShellFit.texts(rule, "$what end", safe)
        }
        fun menu(row: MenuRow) {
            rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
            rule.waitForIdle()
            rule.onNodeWithTag(ShellTags.row(row)).performScrollTo().performClick()
            rule.waitForIdle()
        }
        menu(MenuRow.UNITS)
        page("units", SettingLists.UNITS.size)
        for ((i, unit) in SettingLists.UNITS.withIndex()) {
            rule.onNodeWithTag(SettingsTags.row(i)).performClick()
            rule.waitForIdle()
            page(unit, SettingLists.list(unit).choices.size)
            rule.onNodeWithTag(SettingsTags.BACK).performClick()
            rule.waitForIdle()
        }
        rule.onNodeWithTag(SettingsTags.BACK).performClick()
        rule.waitForIdle()
        for ((row, list) in listOf(MenuRow.STARTUP_PAGE to "startupPage", MenuRow.REFRESH_INTERVAL to "refreshInterval", MenuRow.THEME to "theme")) {
            menu(row)
            page(list, SettingLists.list(list).choices.size)
            rule.onNodeWithTag(SettingsTags.BACK).performClick()
            rule.waitForIdle()
        }
        menu(MenuRow.ABOUT)
        rule.onNodeWithTag(PopupTags.POPUP).fetchSemanticsNode()
        problems += ShellFit.texts(rule, "about", safe)
        capture("$name-about")
        assertEquals("$lang $name", emptyList<String>(), problems.distinct())
        assertEquals(1, rule.onAllNodes(hasTestTag(PopupTags.BUTTON)).fetchSemanticsNodes().size)
    }

    private fun capture(name: String) {
        val image = rule.onRoot().captureToImage().asAndroidBitmap()
        File(out, "$lang-$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-xhdpi")
class SettingsFitKoTest : SettingsFitTest("ko-KR")

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "en-rUS-xhdpi")
class SettingsFitEnTest : SettingsFitTest("en-US")
