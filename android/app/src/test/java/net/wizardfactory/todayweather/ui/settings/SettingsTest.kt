package net.wizardfactory.todayweather.ui.settings

import android.content.Intent
import android.net.Uri
import android.provider.Browser
import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import java.io.File
import java.net.URLDecoder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.BuildConfig
import net.wizardfactory.todayweather.Handoff
import net.wizardfactory.todayweather.MenuHandoffs
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.SettingsActions
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.settings.Handoffs
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.DeviceIdentity
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.Settings
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.forecast.ForecastTags
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.shell.PopupTags
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The settings pages and the menu's rows in the app's screens (#2891): 단위설정 and the menu's lists open over the tabs
 * and close the menu; a choice is saved, posts the push list for a unit and loads the weather in the new units at once;
 * back and Android back leave the pages; the standard links of S03 and S05 open S07; 널스쿨 풍향 keeps the menu open while
 * 의견보내기 and 응원리뷰쓰기 close it; About opens over the menu in the app's language; the hand-off intents are those the
 * Cordova build sent. The real session and repository answer from a fake server with the AN-02 corpus.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class SettingsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val seoulC = File(inputs, "kma-seoul.json").readText()
    private val seoulF = File(inputs, "kma-seoul-f.json").readText()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val requests = mutableListOf<String>()
    private val pushes = mutableListOf<UnitSettings>()
    private val opened = mutableListOf<String>()
    private var feedback = 0
    private val seoul = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))

    private class Memory(initial: AppState) : StateAccess {
        val flow = MutableStateFlow(initial)
        val state: StateFlow<AppState> = flow
        override fun current() = flow.value
        override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
    }

    private lateinit var memory: Memory

    @After fun stop() = scope.cancel()

    private var failing = false

    /**
     * The app on Seoul (the current position off) opening on [startupPage], with the photo [feed]; the server answers in
     * the requested unit, or fails once [failing] is set.
     */
    private var feedNow: net.wizardfactory.todayweather.core.domain.shell.WeatherPhotos? = null
    private lateinit var session: WeatherSession

    private fun show(startupPage: String = "0", feed: net.wizardfactory.todayweather.core.domain.shell.WeatherPhotos? = null, theme: String = "light") {
        feedNow = feed
        memory = Memory(AppState(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1,
            units = UnitSettings.defaults("KR"), settings = Settings(startupPage = startupPage, theme = theme)))
        val repository = WeatherRepository("https://server.test.invalid", null,
            HttpGet { url, _ ->
                requests += url
                if (failing) throw net.wizardfactory.todayweather.core.data.HttpStatusException(500)
                if ("temperatureUnit=F" in url) seoulF else seoulC
            }, io = Dispatchers.Unconfined)
        session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { feedNow })
        val settings = SettingsActions(memory, session) { pushes += memory.current().units }
        val handoffs = MenuHandoffs(openSystem = { opened += it }, sendFeedback = { feedback++ })
        rule.setContent {
            val state by memory.state.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            AppContent(state, entries, loading, retry, session, host, "test", onExit = {}, settings = settings, handoffs = handoffs)
        }
        session.reload(WeatherSession.Sender.INIT)
        rule.waitForIdle()
    }

    private fun string(id: Int) = rule.activity.getString(id)
    private fun menu(row: MenuRow) {
        if (rule.onAllNodesWithTag(ShellTags.MENU).fetchSemanticsNodes().isEmpty()) {
            rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
            rule.waitForIdle()
        }
        rule.onNodeWithTag(ShellTags.row(row)).performScrollTo().performClick()
        rule.waitForIdle()
    }
    private fun onPage(text: String) = rule.onNode(hasText(text) and hasAnyAncestor(hasTestTag(SettingsTags.PAGE)), useUnmergedTree = true)
    private fun inPopup(text: String) = rule.onNode(hasText(text) and hasAnyAncestor(hasTestTag(PopupTags.POPUP)), useUnmergedTree = true)
    private fun menuOpen() = rule.onAllNodesWithTag(ShellTags.MENU).fetchSemanticsNodes().isNotEmpty()
    private fun back() = rule.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }.also { rule.waitForIdle() }

    @Test
    fun aUnitChosenOnS08IsSavedPostedAndLoadedAtOnce() {
        show()
        assertEquals(1, requests.size)
        menu(MenuRow.UNITS)
        assertTrue("단위설정 closes the menu", !menuOpen())
        onPage(string(R.string.LOC_UNITS)).assertExists()
        for (text in listOf("온도단위", "C", "풍속단위", "m/s", "기압단위", "hPa", "거리", "km", "강수량", "mm", "대기환경기준", "한국환경공단")) onPage(text).assertExists()

        rule.onNodeWithTag(SettingsTags.row(0)).performClick()
        rule.waitForIdle()
        onPage("온도단위").assertExists()
        rule.onAllNodesWithTag(SettingsTags.CHECK, useUnmergedTree = true).assertCountEquals(1)
        rule.onNode(hasTestTag(SettingsTags.CHECK) and hasAnyAncestor(hasTestTag(SettingsTags.row(0))), useUnmergedTree = true).assertExists()
        rule.onNodeWithTag(SettingsTags.row(0)).performClick()
        rule.waitForIdle()
        assertEquals("the chosen value does nothing", 1, requests.size)

        rule.onNodeWithTag(SettingsTags.row(1)).performClick()
        rule.waitForIdle()
        assertEquals("F", memory.current().units.temperatureUnit)
        assertEquals("the push list goes once, with the new unit", listOf("F"), pushes.map { it.temperatureUnit })
        assertEquals("the weather in °F at once, within the gate", 2, requests.size)
        assertTrue(requests.last(), "temperatureUnit=F&" in requests.last())
        rule.onNode(hasTestTag(SettingsTags.CHECK) and hasAnyAncestor(hasTestTag(SettingsTags.row(1))), useUnmergedTree = true).assertExists()

        back()
        onPage("F").assertExists()
        rule.onNodeWithTag(SettingsTags.BACK).performClick()
        rule.waitForIdle()
        rule.onAllNodesWithTag(SettingsTags.PAGE).assertCountEquals(0)
        rule.onNodeWithText("37", substring = true, useUnmergedTree = true).assertExists()
    }

    @Test
    fun theMenusListsSaveTheirSettingAndTheMenuShowsIt() {
        show()
        menu(MenuRow.STARTUP_PAGE)
        assertTrue(!menuOpen())
        onPage(string(R.string.LOC_STARTUP_PAGE)).assertExists()
        rule.onNodeWithTag(SettingsTags.row(1)).performClick()
        rule.waitForIdle()
        assertEquals("1", memory.current().settings.startupPage)
        assertEquals("a setting reloads the selected place too", 2, requests.size)
        assertEquals(emptyList<UnitSettings>(), pushes)
        back()
        rule.onAllNodesWithTag(SettingsTags.PAGE).assertCountEquals(0)
        rule.onNodeWithTag(ShellTags.page(Tab.HOURLY)).assertExists()
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.waitForIdle()
        rule.onNode(hasText(string(R.string.LOC_DAILY_FORECAST)) and hasAnyAncestor(hasTestTag(ShellTags.row(MenuRow.STARTUP_PAGE))), useUnmergedTree = true).assertExists()

        menu(MenuRow.THEME)
        rule.onNodeWithTag(SettingsTags.row(2)).performClick()
        rule.waitForIdle()
        assertEquals("dark", memory.current().settings.theme)
        back()
        menu(MenuRow.REFRESH_INTERVAL)
        rule.onNodeWithTag(SettingsTags.row(5)).performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals("720", memory.current().settings.refreshInterval)
    }

    /**
     * #2915 F2: TabCtrl's `applyEvent` at the start of a load applies the place as it is, so the photo theme chosen on S08
     * shows the place's photo (here its fallback: the photo's address refuses the connection at once) even when the
     * reload fails. The feed gives the place its photo with the first load, in the light theme.
     */
    @Test
    fun thePhotoThemeShowsTheSavedPhotoWhenTheReloadFails() {
        show(feed = net.wizardfactory.todayweather.core.domain.shell.WeatherPhotos.parse(kotlinx.serialization.json.Json.parseToJsonElement(
            """[{"tags": ["moon", "bigcloud"], "twUrls": {"regular": "http://127.0.0.1:9/moon.jpg"}}]""")))
        assertEquals("http://127.0.0.1:9/moon.jpg", memory.current().places[1].photo)
        rule.onAllNodesWithTag(ForecastTags.PHOTO).assertCountEquals(0)
        failing = true
        menu(MenuRow.THEME)
        rule.onNodeWithTag(SettingsTags.row(0)).performClick()
        rule.waitForIdle()
        assertEquals("photo", memory.current().settings.theme)
        rule.waitUntil(10_000) { rule.onAllNodesWithTag(ForecastTags.PHOTO, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
    }

    /** The scroll of the chart in block 1 of the shown weather page, in px. */
    private fun chartScroll(): Float = rule.onNode(
        androidx.compose.ui.test.SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsProperties.HorizontalScrollAxisRange) and
            hasAnyAncestor(hasTestTag(ForecastTags.block(1))), useUnmergedTree = true,
    ).fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.HorizontalScrollAxisRange].value()

    private fun swipeChart() {
        rule.onNodeWithTag(ForecastTags.block(1)).performTouchInput { swipeLeft(startX = right - 10f, endX = left + 10f, durationMillis = 300) }
        rule.waitForIdle()
    }

    /**
     * #2915 F3: ForecastCtrl sets both charts' `scrollLeft` to today's position after every complete apply, the same data
     * too: a theme chosen on S08 starts a load, whose apply brings a chart the user moved back, even when the reload fails
     * (Hourly) and when it answers with the same data (Daily).
     */
    @Test
    fun aReapplyBringsTheChartsBackToToday() {
        show()
        val hourly = chartScroll()
        swipeChart()
        assertTrue("the hourly chart moved: $hourly", chartScroll() != hourly)
        failing = true
        menu(MenuRow.THEME)
        rule.onNodeWithTag(SettingsTags.row(2)).performClick()
        rule.waitForIdle()
        // A failed reload opens a modal above settings; dismiss it before navigating back.
        rule.onNodeWithTag(net.wizardfactory.todayweather.ui.forecast.RETRY_DIALOG).assertExists()
        rule.onNode(hasText(string(R.string.LOC_CLOSE))).performClick()
        rule.waitForIdle()
        back()
        rule.onNodeWithTag(SettingsTags.PAGE).assertDoesNotExist()
        assertEquals("the failed reload's apply brought it back", hourly, chartScroll(), 0.5f)

        failing = false
        rule.onNodeWithTag(ShellTags.tab(Tab.DAILY)).performClick()
        rule.waitForIdle()
        val daily = chartScroll()
        swipeChart()
        assertTrue("the daily chart moved: $daily", chartScroll() != daily)
        menu(MenuRow.THEME)
        rule.onNodeWithTag(SettingsTags.row(1)).performClick()
        rule.waitForIdle()
        back()
        assertEquals("the same data applied again brought it back", daily, chartScroll(), 0.5f)
    }

    /**
     * #2915 F4: a feed that arrives after the weather gives the place its photo alone (`loadWeatherPhotosEvent`): the photo
     * theme shows it, and the hourly chart stays where the user moved it (no apply, no scroll).
     */
    @Test
    fun aPhotoFromTheFeedAloneKeepsTheChartWhereItWas() {
        show(theme = "photo")
        rule.onAllNodesWithTag(ForecastTags.PHOTO, useUnmergedTree = true).assertCountEquals(0)
        val opening = chartScroll()
        swipeChart()
        val moved = chartScroll()
        assertTrue("the hourly chart moved: $opening", moved != opening)
        feedNow = net.wizardfactory.todayweather.core.domain.shell.WeatherPhotos.parse(kotlinx.serialization.json.Json.parseToJsonElement(
            """[{"tags": ["moon", "bigcloud"], "twUrls": {"regular": "http://127.0.0.1:9/moon.jpg"}}]"""))
        kotlinx.coroutines.runBlocking { session.photosLoaded() }
        rule.waitForIdle()
        assertEquals("http://127.0.0.1:9/moon.jpg", memory.current().places[1].photo)
        rule.waitUntil(10_000) { rule.onAllNodesWithTag(ForecastTags.PHOTO, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        assertEquals("the photo alone does not scroll the chart", moved, chartScroll(), 0.5f)
    }

    @Test
    fun theStandardLinksOfS03AndS05OpenS07() {
        show()
        rule.onNodeWithText("한국환경공단", substring = true, useUnmergedTree = true).performScrollTo().performClick()
        rule.waitForIdle()
        onPage(string(R.string.LOC_UNITS)).assertExists()
        back()
        rule.onAllNodesWithTag(SettingsTags.PAGE).assertCountEquals(0)
        rule.onNodeWithTag(ForecastTags.PAGE).assertExists()

        rule.onNodeWithTag(ShellTags.tab(Tab.AIR)).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("한국환경공단", substring = true, useUnmergedTree = true).performScrollTo().performClick()
        rule.waitForIdle()
        onPage(string(R.string.LOC_UNITS)).assertExists()
    }

    @Test
    fun theHandOffsKeepOrCloseTheMenuAsCordovaDoes() {
        show()
        menu(MenuRow.NULLSCHOOL_WIND)
        assertEquals(listOf(Handoffs.NULLSCHOOL), opened)
        assertTrue("널스쿨 풍향 keeps the menu open", menuOpen())
        menu(MenuRow.VERSION)
        assertTrue(menuOpen())
        menu(MenuRow.SEND_FEEDBACK)
        assertEquals(1, feedback)
        assertTrue("의견보내기 closes the menu", !menuOpen())
        menu(MenuRow.RATE)
        assertEquals(listOf(Handoffs.NULLSCHOOL, Handoffs.STORE), opened)
        assertTrue("응원리뷰쓰기 closes the menu", !menuOpen())
    }

    @Test
    fun aboutOpensOverTheMenuAndClosesWithItsButtonOrBack() {
        show()
        menu(MenuRow.ABOUT)
        rule.onNodeWithTag(PopupTags.POPUP).assertExists()
        inPopup("오늘날씨").assertExists()
        rule.onNodeWithText("기상정보 : 기상청", substring = true, useUnmergedTree = true).assertExists()
        rule.onNodeWithText("대기오염정보 : 환경부/한국환경공단", substring = true, useUnmergedTree = true).assertExists()
        rule.onNodeWithText("인증되지 않은 실시간 자료이므로 자료 오류가 있을 수 있습니다.", substring = true, useUnmergedTree = true).assertExists()
        back()
        rule.onAllNodesWithTag(PopupTags.POPUP).assertCountEquals(0)
        assertTrue("back closes the popup first", menuOpen())
        menu(MenuRow.ABOUT)
        rule.onNodeWithTag(PopupTags.BUTTON).performClick()
        rule.waitForIdle()
        rule.onAllNodesWithTag(PopupTags.POPUP).assertCountEquals(0)
        assertTrue(menuOpen())
    }

    @Config(qualifiers = "en-rUS-w384dp-h832dp-xhdpi")
    @Test
    fun aboutIsInTheAppsLanguage() {
        show()
        menu(MenuRow.ABOUT)
        inPopup("TodayWeather").assertExists()
        rule.onNodeWithText("Weather information : Korea Meteorological Administration", substring = true, useUnmergedTree = true).assertExists()
        inPopup("OK").assertExists()
    }

    /** Saved state from another version: routes it does not know are dropped; the shell restores what it can. */
    @Test
    fun savedStateFromAnotherVersionDoesNotBreakTheScreens() {
        assertTrue(SettingsRoutes.known(SettingsRoutes.UNITS))
        assertTrue(SettingsRoutes.known(SettingsRoutes.list("airUnit")))
        assertTrue(SettingsRoutes.known(SettingsRoutes.list("theme")))
        assertTrue(!SettingsRoutes.known(SettingsRoutes.list("language")))
        assertTrue(!SettingsRoutes.known("nation"))
        val scope = androidx.compose.runtime.saveable.SaverScope { true }
        val saver = net.wizardfactory.todayweather.ui.shell.ShellNavigation.Saver
        val saved = with(saver) { scope.save(net.wizardfactory.todayweather.ui.shell.ShellNavigation(Tab.AIR, menuOpen = true)) }!!
        with(saver.restore(saved)!!) { assertEquals(Tab.AIR, selected); assertTrue(menuOpen) }
        with(saver.restore("DAILY")!!) { assertEquals("the tab's name alone (AN-09)", Tab.DAILY, selected); assertTrue(!menuOpen) }
        assertEquals(null, saver.restore(listOf("WIND", true)))
        assertEquals(null, saver.restore(3))
    }

    /** The intents the Cordova build sent (InAppBrowser `_system`, the WebView's `mailto:`), from the activity. */
    @Test
    fun theHandOffIntentsAreTheCordovaOnes() {
        val activity = rule.activity
        Handoff.openSystem(activity, Handoffs.NULLSCHOOL)
        shadowOf(activity).nextStartedActivity.let { i ->
            assertEquals(Intent.ACTION_VIEW, i.action)
            assertEquals(Uri.parse(Handoffs.NULLSCHOOL), i.data)
            assertEquals(activity.packageName, i.getStringExtra(Browser.EXTRA_APPLICATION_ID))
            assertEquals("started from the activity, in its task", 0, i.flags and Intent.FLAG_ACTIVITY_NEW_TASK)
            assertEquals(null, i.categories)
        }
        Handoff.openSystem(activity, Handoffs.STORE)
        assertEquals(Uri.parse("market://details?id=net.wizardfactory.todayweather"), shadowOf(activity).nextStartedActivity.data)

        val mail = Handoff.feedbackMail(activity)
        Handoff.openLink(activity, mail)
        shadowOf(activity).nextStartedActivity.let { i ->
            assertEquals(Intent.ACTION_VIEW, i.action)
            assertEquals(setOf(Intent.CATEGORY_BROWSABLE), i.categories)
            assertEquals(Uri.parse(mail), i.data)
            assertEquals(null, i.extras)
        }
        assertTrue(mail, mail.startsWith("mailto:${BuildConfig.MAIL_TO}?subject=의견보내기&body="))
        val body = URLDecoder.decode(mail.substringAfter("&body="), "UTF-8")
        assertEquals("\n====================\nApp Version : ${BuildConfig.VERSION_NAME}\nUUID : ${DeviceIdentity.deviceId(activity) ?: "undefined"}\nUA : ",
            body.substringBefore("UA : ") + "UA : ")
        assertTrue(body.endsWith("\n====================\n"))
    }
}
