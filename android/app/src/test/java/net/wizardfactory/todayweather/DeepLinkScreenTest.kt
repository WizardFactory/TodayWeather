package net.wizardfactory.todayweather

import net.wizardfactory.todayweather.core.data.GeocodeClient
import net.wizardfactory.todayweather.core.data.LocationAccess
import net.wizardfactory.todayweather.core.data.PlacesPage
import net.wizardfactory.todayweather.core.data.StartFlow
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import net.wizardfactory.todayweather.core.domain.start.TownSearch
import net.wizardfactory.todayweather.search.BundledTowns
import net.wizardfactory.todayweather.ui.places.PlacesHost
import net.wizardfactory.todayweather.ui.places.PlacesTags
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import kotlin.test.assertTrue
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

    /** No location service: the search's find-by-location row is not used here. */
    private object NoLocation : LocationAccess {
        override fun enabled() = false
        override fun status() = PermissionStatus.NOT_REQUESTED
        override suspend fun request() = PermissionStatus.NOT_REQUESTED
        override suspend fun position(): Location? = null
        override suspend fun requestHighAccuracy() = false
    }

    protected lateinit var memory: Memory
    protected lateinit var preview: LinkPreview
    private lateinit var opener: LinkOpener

    /** What the share button sent: the tab shared from and its pollutant. */
    protected val shared = mutableListOf<Pair<WeatherView, String?>>()

    protected fun show(places: List<Place>) {
        memory = Memory(AppState(places = places, placeIndex = 0, units = UnitSettings.defaults("KR"),
            cordovaExtras = mapOf("startVersion" to JsonPrimitive(1))))
        preview = LinkPreview(memory)
        val http = HttpGet { _, _ -> seoulBody }
        val repository = WeatherRepository("https://server.test.invalid", null, http, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, preview, { listOf("ko-KR") }, { null })
        opener = LinkOpener(memory.flow, preview, openPlace = { session.openPlace(it.toDouble()) },
            reload = { session.reload(WeatherSession.Sender.DEEPLINK) })
        rule.setContent {
            val saved by memory.flow.collectAsState()
            val unsaved by preview.unsaved.collectAsState()
            val shown = unsaved?.place
            val link by opener.requests.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            // S02's search over the bundled towns; a chosen result goes where the app sends it (LinkOpener.show).
            val places = PlacesHost(null, { TownSearch(BundledTowns.load(context)) }) { s ->
                PlacesPage(preview.savedAccess, repository, session, StartFlow(preview.savedAccess, repository, GeocodeClient("https://server.test.invalid", http), NoLocation,
                    { listOf("ko-KR") }), NoLocation, s, removeAlarms = {}, openPlace = opener::show)
            }
            AppContent(LinkPreview.overlay(saved!!, unsaved), entries, loading, retry, session, host, "test", onExit = {}, places = places,
                link = link, onLinkHandled = opener::handled, preview = shown != null, onAddPreview = { preview.add() }, share = { view, pollutant -> shared += view to pollutant })
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
 * close, then the link's tab opens on a saved place within 0.01° or on a linked place not saved, with a star in the
 * bell's position that saves it (#3180); the Locations tab ends that preview; a page link opens S10, S11 or S12.
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
        rule.onNodeWithTag(WeatherTabTags.STAR).assertExists()
        rule.onNodeWithTag(WeatherTabTags.BELL).assertDoesNotExist()
        assertEquals(listOf("회현동"), memory.current()!!.places.map { it.name }, "nothing saved")
        rule.onNodeWithTag(WeatherTabTags.STAR).performClick()
        rule.waitForIdle()
        assertEquals(listOf("회현동", "분당구"), memory.current()!!.places.map { it.name })
        assertEquals(1, memory.current()!!.placeIndex)
        rule.onNodeWithTag(WeatherTabTags.STAR).assertDoesNotExist()
        rule.onNodeWithTag(WeatherTabTags.BELL).assertExists()
        rule.onNodeWithText("분당구").assertExists()
    }

    @Test
    fun aLinkToASavedPlaceNearbySelectsItOnTheAirTab() {
        show(listOf(hoehyeon, london))
        open("https://link.todayweather.ai/air/london?pollutant=pm10")
        assertEquals(1, memory.current()!!.placeIndex)
        assertNull(preview.unsaved.value?.place)
        rule.onNodeWithTag(ShellTags.page(Tab.AIR)).assertExists()
        rule.onNodeWithTag(WeatherTabTags.STAR).assertDoesNotExist()
    }

    /**
     * #3180, AK's choice 2: the unsaved place is the last place of the list. An arrow to a saved place shows the bell,
     * the arrow back shows the unsaved place and its star again, and the Locations tab keeps it without listing it.
     */
    @Test
    fun theUnsavedPlaceStaysWhileMovingToSavedPlacesAndTabs() {
        show(listOf(hoehyeon))
        open("https://link.todayweather.ai/air/busan")
        rule.onNodeWithTag(WeatherTabTags.STAR).assertExists()
        rule.onNodeWithTag(AirTags.NEXT).performClick()
        rule.waitForIdle()
        assertEquals("부산", preview.unsaved.value?.place?.name)
        assertEquals(0, memory.current()!!.placeIndex)
        rule.onNodeWithTag(WeatherTabTags.BELL).assertExists()
        rule.onNodeWithTag(WeatherTabTags.STAR).assertDoesNotExist()
        rule.onNodeWithTag(AirTags.PREVIOUS).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(WeatherTabTags.STAR).assertExists()
        rule.onNodeWithTag(ShellTags.tab(Tab.LOCATIONS)).performClick()
        rule.waitForIdle()
        assertEquals("부산", preview.unsaved.value?.place?.name)
        rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(WeatherTabTags.STAR).assertExists()
        assertEquals(listOf("회현동"), memory.current()!!.places.map { it.name })
        // Another link replaces it.
        open("https://link.todayweather.ai/place/daegu")
        assertEquals("대구", preview.unsaved.value?.place?.name)
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
 * The header's fit, measured with real glyph widths (native graphics), as the other fit tests are.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w320dp-h568dp-xhdpi", fontScale = 1.3f)
class HeaderFitTest : DeepLinkScreens() {
    /**
     * #3180: at 320 dp with a 1.3 font scale and a long name, the header keeps every control whole and apart: menu,
     * the search button after the name, the star and share. The name gives way with an ellipsis.
     */
    @Test
    fun theHeaderControlsFitANarrowWindowWithALongName() {
        show(listOf(hoehyeon))
        open("https://link.todayweather.ai/loc?lat=37.383&lon=127.119&name=%EA%B2%BD%EA%B8%B0%EB%8F%84%20%EC%84%B1%EB%82%A8%EC%8B%9C%20%EB%B6%84%EB%8B%B9%EA%B5%AC%20%EC%A0%95%EC%9E%90%EC%9D%BC%EB%A1%9C%20%EB%B6%84%EB%8B%B9%EB%82%B4%EA%B3%A1%EB%A1%9C%20%EA%B8%B4%20%EC%9D%B4%EB%A6%84")
        val width = rule.onRoot().getUnclippedBoundsInRoot().right
        val menu = rule.onNodeWithTag(ShellTags.MENU_BUTTON).getUnclippedBoundsInRoot()
        val search = rule.onNodeWithTag(WeatherTabTags.SEARCH).getUnclippedBoundsInRoot()
        val star = rule.onNodeWithTag(WeatherTabTags.STAR).getUnclippedBoundsInRoot()
        val share = rule.onNodeWithTag(WeatherTabTags.SHARE).getUnclippedBoundsInRoot()
        for (control in listOf(rule.onNodeWithTag(ShellTags.MENU_BUTTON), rule.onNodeWithTag(WeatherTabTags.SEARCH),
            rule.onNodeWithTag(WeatherTabTags.STAR), rule.onNodeWithTag(WeatherTabTags.SHARE))) control.assertIsDisplayed()
        assertTrue(menu.left >= 0.dp && share.right <= width, "inside the window: $menu $share of $width")
        assertTrue(menu.right <= search.left, "the name and its search button start after the menu: $menu $search")
        assertTrue(search.right <= star.left, "the search button ends before the star: $search $star")
        assertTrue(star.right <= share.left + 1.dp, "the star ends before share: $star $share")
        // The search button keeps its touch size (36 × 44 dp) though the name is cut.
        assertTrue(search.right - search.left >= 36.dp && search.bottom - search.top >= 44.dp, "touch size: $search")
        // The name ends with an ellipsis (CODEX-3190-6).
        assertTrue(ellipsized("경기도 성남시 분당구 정자일로 분당내곡로 긴 이름"), "the name is cut with an ellipsis")
    }

    /** The current position's glyph before a long name: the glyph, the name, its search button and the bell all fit. */
    @Test
    fun theCurrentPositionGlyphFitsBeforeALongName() {
        show(listOf(Place(true, false, "현재 위치", "대한민국 경기도 성남시 분당구 정자일로 분당내곡로 아주 긴 동네 이름", "KR", Location(37.38, 127.12))))
        val width = rule.onRoot().getUnclippedBoundsInRoot().right
        val menu = rule.onNodeWithTag(ShellTags.MENU_BUTTON).getUnclippedBoundsInRoot()
        val glyph = rule.onNodeWithTag(WeatherTabTags.LOCATION).getUnclippedBoundsInRoot()
        val search = rule.onNodeWithTag(WeatherTabTags.SEARCH).getUnclippedBoundsInRoot()
        val bell = rule.onNodeWithTag(WeatherTabTags.BELL).getUnclippedBoundsInRoot()
        val share = rule.onNodeWithTag(WeatherTabTags.SHARE).getUnclippedBoundsInRoot()
        for (tag in listOf(ShellTags.MENU_BUTTON, WeatherTabTags.LOCATION, WeatherTabTags.SEARCH, WeatherTabTags.BELL, WeatherTabTags.SHARE)) {
            rule.onNodeWithTag(tag).assertIsDisplayed()
        }
        assertTrue(menu.right <= glyph.left && glyph.right <= search.left, "menu, glyph, then the name and search: $menu $glyph $search")
        assertTrue(search.right <= bell.left && bell.right <= share.left + 1.dp && share.right <= width, "$search $bell $share of $width")
        assertTrue(ellipsizedBetween(glyph.right, search.left), "the name is cut with an ellipsis")
    }

    /** True when the text node showing [text] ends its last line with an ellipsis. */
    private fun ellipsized(text: String): Boolean {
        val layouts = mutableListOf<TextLayoutResult>()
        rule.onNodeWithText(text, useUnmergedTree = true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        val layout = layouts.single()
        return layout.isLineEllipsized(layout.lineCount - 1)
    }

    /** True when the header's text between [left] and [right] (the title) ends with an ellipsis. */
    private fun ellipsizedBetween(left: androidx.compose.ui.unit.Dp, right: androidx.compose.ui.unit.Dp): Boolean {
        val titles = rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult), useUnmergedTree = true)
            .fetchSemanticsNodes().filter { node ->
                val bounds = with(rule.density) { node.boundsInRoot.let { it.left.toDp() to it.right.toDp() } }
                bounds.first >= left - 1.dp && bounds.second <= right + 1.dp && node.boundsInRoot.top < with(rule.density) { 60.dp.toPx() }
            }
        val layouts = mutableListOf<TextLayoutResult>()
        titles.single().config[SemanticsActions.GetTextLayoutResult].action!!.invoke(layouts)
        val layout = layouts.single()
        return layout.isLineEllipsized(layout.lineCount - 1)
    }
}

/**
 * The user-manual captures of the header search and an unsaved place (docs/user/android-app/header-search), rendered with native
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

    /** The manual's screens: the header of a saved place, the search it opens, a result shown unsaved, and after its star. */
    @Test
    fun captureTheSearchAndTheUnsavedPlace() {
        show(listOf(hoehyeon))
        rule.onNodeWithTag(WeatherTabTags.BELL).assertExists()
        capture("saved-place")
        rule.onNodeWithTag(WeatherTabTags.SEARCH).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(PlacesTags.INPUT).performTextInput("부산")
        rule.waitForIdle()
        rule.onNodeWithTag(PlacesTags.town(0)).assertExists()
        capture("search")
        rule.onNodeWithTag(PlacesTags.town(0)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(WeatherTabTags.STAR).assertExists()
        capture("unsaved-place")
        rule.onNodeWithTag(WeatherTabTags.STAR).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(WeatherTabTags.STAR).assertDoesNotExist()
        rule.onNodeWithTag(WeatherTabTags.BELL).assertExists()
        capture("added-place")
    }
}
