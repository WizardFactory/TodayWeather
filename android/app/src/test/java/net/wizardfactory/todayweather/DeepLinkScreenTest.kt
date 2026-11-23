package net.wizardfactory.todayweather

import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.graphics.asAndroidBitmap
import android.graphics.Bitmap
import org.robolectric.annotation.GraphicsMode
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.LinkOpener
import net.wizardfactory.todayweather.core.data.LinkPreview
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.share.DeepLink
import net.wizardfactory.todayweather.core.domain.share.WeatherView
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.ui.air.AirTags
import net.wizardfactory.todayweather.ui.forecast.WeatherTabTags
import androidx.compose.ui.test.assertIsSelected
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.link.LinkPreviewTags
import net.wizardfactory.todayweather.ui.nation.NationTags
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.settings.SettingsTags
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The open tabs over a saved state, with a [LinkPreview] and a [LinkOpener] as the app wires them (#3096). */
abstract class DeepLinkScreens {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val seoulBody = File(project, "../core-domain/src/test/resources/corpus/inputs/kma-seoul.json").readText()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    protected val hoehyeon = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))
    protected val london = Place(false, false, "런던", "영국 런던", "GB", Location(51.507, -0.128))

    protected class Memory(initial: AppState) : StateAccess {
        val flow = MutableStateFlow<AppState?>(initial)
        override fun current() = flow.value
        override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value!!) }
    }

    @After fun stop() = scope.cancel()

    protected lateinit var memory: Memory
    protected lateinit var preview: LinkPreview
    private lateinit var opener: LinkOpener

    /** What the share button sent: the tab shared from and its pollutant. */
    protected val shared = mutableListOf<Pair<WeatherView, String?>>()

    protected fun show(places: List<Place>) {
        memory = Memory(AppState(places = places, placeIndex = 0, units = UnitSettings.defaults("KR"),
            cordovaExtras = mapOf("startVersion" to JsonPrimitive(1))))
        preview = LinkPreview(memory)
        val repository = WeatherRepository("https://server.test.invalid", null, HttpGet { _, _ -> seoulBody }, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, preview, { listOf("ko-KR") }, { null })
        opener = LinkOpener(memory.flow, preview, openPlace = { session.openPlace(it.toDouble()) },
            reload = { session.reload(WeatherSession.Sender.DEEPLINK) })
        rule.setContent {
            val saved by memory.flow.collectAsState()
            val shown by preview.place.collectAsState()
            val link by opener.requests.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            AppContent(preview.overlay(saved!!), entries, loading, retry, session, host, "test", onExit = {},
                link = link, onLinkHandled = opener::handled, preview = shown != null, onAddPreview = { preview.add() },
                onLeavePreview = preview::clear, share = { view, pollutant -> shared += view to pollutant })
        }
        session.reload(WeatherSession.Sender.INIT)
        rule.waitForIdle()
    }

    protected fun open(url: String) {
        scope.launch { opener.open(DeepLink.parse(url)!!) }
        rule.waitForIdle()
    }
}

/**
 * `link.todayweather.ai` links on the open tabs (#3096, specs/deeplink.md §6.2): the menu and the pages over the tabs
 * close, then the link's tab opens on a saved place within 0.01° or on a linked place not saved, with Add to favorites
 * over the tab bar; the Locations tab ends that preview; a page link opens S10, S11 or S12.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class DeepLinkScreenTest : DeepLinkScreens() {
    @Test
    fun aLinkToAPlaceNotSavedShowsItOnItsTabWithAddToFavorites() {
        show(listOf(hoehyeon))
        open("https://link.todayweather.ai/loc?lat=37.383&lon=127.119&name=%EB%B6%84%EB%8B%B9%EA%B5%AC&view=daily")
        rule.onNodeWithTag(ShellTags.page(Tab.DAILY)).assertExists()
        rule.onNodeWithText("분당구").assertExists()
        rule.onNodeWithTag(LinkPreviewTags.BAR).assertExists()
        assertEquals(listOf("회현동"), memory.current()!!.places.map { it.name }, "nothing saved")
        rule.onNodeWithTag(LinkPreviewTags.ADD).performClick()
        rule.waitForIdle()
        assertEquals(listOf("회현동", "분당구"), memory.current()!!.places.map { it.name })
        assertEquals(1, memory.current()!!.placeIndex)
        rule.onNodeWithTag(LinkPreviewTags.BAR).assertDoesNotExist()
        rule.onNodeWithText("분당구").assertExists()
    }

    @Test
    fun aLinkToASavedPlaceNearbySelectsItOnTheAirTab() {
        show(listOf(hoehyeon, london))
        open("https://link.todayweather.ai/air/london?pollutant=pm10")
        assertEquals(1, memory.current()!!.placeIndex)
        assertNull(preview.place.value)
        rule.onNodeWithTag(ShellTags.page(Tab.AIR)).assertExists()
        rule.onNodeWithTag(LinkPreviewTags.BAR).assertDoesNotExist()
    }

    @Test
    fun theLocationsTabEndsThePreview() {
        show(listOf(hoehyeon))
        open("https://link.todayweather.ai/place/busan")
        rule.onNodeWithTag(LinkPreviewTags.BAR).assertExists()
        rule.onNodeWithTag(ShellTags.tab(Tab.LOCATIONS)).performClick()
        rule.waitForIdle()
        assertNull(preview.place.value)
        rule.onNodeWithTag(LinkPreviewTags.BAR).assertDoesNotExist()
        assertEquals(listOf("회현동"), memory.current()!!.places.map { it.name })
    }

    @Test
    fun aLinkClosesTheMenuAndThePagesThenOpensItsPage() {
        show(listOf(hoehyeon))
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.onNodeWithTag(ShellTags.row(MenuRow.UNITS)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(SettingsTags.PAGE).assertExists()
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.waitForIdle()
        open("https://link.todayweather.ai/warnings")
        rule.onNodeWithTag(SettingsTags.PAGE).assertDoesNotExist()
        rule.onNodeWithTag(NationTags.PAGE).assertExists()
        rule.onNodeWithTag(ShellTags.MENU).assertDoesNotExist()
    }

    /**
     * CODEX-3164-3, -2: an Air link opens its pollutant also while Air shows, and a share from Air sends the pollutant
     * shown, also after a tap on another one.
     */
    @Test
    fun airLinksOpenTheirPollutantAndShareWhatAirShows() {
        show(listOf(hoehyeon, london))
        open("https://link.todayweather.ai/air/seoul?pollutant=pm10")
        rule.onNodeWithTag(AirTags.code("pm10")).assertIsSelected()
        open("https://link.todayweather.ai/air/seoul?pollutant=pm25")
        rule.onNodeWithTag(AirTags.code("pm25")).assertIsSelected()
        rule.onNodeWithTag(WeatherTabTags.SHARE).performClick()
        rule.onNodeWithTag(AirTags.code("pm10")).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(WeatherTabTags.SHARE).performClick()
        rule.waitForIdle()
        assertEquals(listOf<Pair<WeatherView, String?>>(WeatherView.AIR to "pm25", WeatherView.AIR to "pm10"), shared.toList())
    }

    /** CODEX-3164-7: `/open` closes the menu and the pages over the tabs and keeps the tab and place. */
    @Test
    fun anOpenLinkClosesThePagesOverTheTabs() {
        show(listOf(hoehyeon))
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.onNodeWithTag(ShellTags.row(MenuRow.UNITS)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(SettingsTags.PAGE).assertExists()
        open("https://link.todayweather.ai/open")
        rule.onNodeWithTag(SettingsTags.PAGE).assertDoesNotExist()
        rule.onNodeWithTag(ShellTags.page(Tab.HOURLY)).assertExists()
        assertEquals(0, memory.current()!!.placeIndex)
    }
}

/**
 * The user-manual captures of a shared link (docs/user/android-app/shared-links): the same screens rendered with native
 * graphics, written to build/deeplink-manual for the manual tool.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class DeepLinkManualCaptureTest : DeepLinkScreens() {
    private val out = File(System.getProperty("tw.projectDir")!!, "build/deeplink-manual").apply { mkdirs() }

    private fun capture(name: String) {
        rule.waitForIdle()
        val bitmap = rule.onRoot().captureToImage().asAndroidBitmap()
        File(out, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test
    fun captureTheSharedPlaceAndItsAdd() {
        show(listOf(hoehyeon))
        open("https://link.todayweather.ai/loc?lat=37.383&lon=127.119&name=%EB%B6%84%EB%8B%B9%EA%B5%AC&view=daily")
        rule.onNodeWithTag(LinkPreviewTags.BAR).assertExists()
        capture("shared-place")
        rule.onNodeWithTag(LinkPreviewTags.ADD).performClick()
        rule.onNodeWithTag(LinkPreviewTags.BAR).assertDoesNotExist()
        capture("added-place")
    }
}
