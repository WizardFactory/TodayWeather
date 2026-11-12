package net.wizardfactory.todayweather

import android.content.Intent
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.data.cityRecord
import net.wizardfactory.todayweather.core.domain.share.ShareMessage
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.closeStart
import net.wizardfactory.todayweather.core.storage.startShows
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.WeatherTabTags
import net.wizardfactory.todayweather.ui.start.LocationPopupTags
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Sharing from the weather and air tabs (#2895 AC1, O16) and the entry links (`todayweather://N`): the share buttons of
 * S03, S04 and S05 open the system chooser with the selected place's Cordova message as plain text; a place without a
 * location shares nothing (O02 comes with AN-10); a link's place index is queued for the session, other intents not.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class ShareTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val seoulBody = File(project, "../core-domain/src/test/resources/corpus/inputs/kma-seoul.json").readText()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val seoul = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))

    private class Memory(initial: AppState) : StateAccess {
        val flow = MutableStateFlow(initial)
        override fun current() = flow.value
        override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
    }

    @After fun stop() = scope.cancel()

    private lateinit var repository: WeatherRepository
    private lateinit var memory: Memory

    private fun show(places: List<Place>) {
        memory = Memory(AppState(places = places, placeIndex = 0, units = UnitSettings.defaults("KR")))
        repository = WeatherRepository("https://server.test.invalid", null, HttpGet { _, _ -> seoulBody }, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        rule.setContent {
            val state by memory.flow.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val share = WeatherShare(context, memory::current, { repository.weather.value }, session::openStartPopup)
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {},
                onShare = share::share)
            AppContent(state, entries, loading, retry, session, host, "test", onExit = {})
        }
        session.reload(WeatherSession.Sender.INIT)
        rule.waitForIdle()
    }

    private fun shared(): Intent? = shadowOf(rule.activity).nextStartedActivity

    @Test
    fun eachTabSharesTheSelectedPlacesMessage() {
        show(listOf(seoul))
        val record = cityRecord(seoul, repository.weather.value[WeatherRepository.key(seoul)])
        val expected = ShareMessage.build(record, ShareMessage.Texts("현재", "최고", "최저", "오늘날씨"), "ko-KR")!!
        assertTrue(expected.startsWith("회현동\n현재 ") && expected.endsWith("\n\n오늘날씨 https://twa.app.link/wgVmUTfVoM"), expected)
        for (tab in listOf(Tab.HOURLY, Tab.DAILY, Tab.AIR)) {
            rule.onNodeWithTag(ShellTags.tab(tab)).performClick()
            rule.waitForIdle()
            rule.onNodeWithTag(WeatherTabTags.SHARE).performClick()
            rule.waitForIdle()
            val chooser = shared()!!
            assertEquals(Intent.ACTION_CHOOSER, chooser.action, "$tab")
            assertNull(chooser.getCharSequenceExtra(Intent.EXTRA_TITLE), "no chooser title")
            @Suppress("DEPRECATION")
            val send = chooser.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!
            assertEquals(Intent.ACTION_SEND, send.action)
            assertEquals("text/plain", send.type)
            assertEquals(expected, send.getStringExtra(Intent.EXTRA_TEXT), "$tab")
            assertNull(send.getStringExtra(Intent.EXTRA_SUBJECT))
            assertTrue(send.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0 && send.flags and Intent.FLAG_ACTIVITY_CLEAR_WHEN_TASK_RESET != 0)
        }
    }

    @Config(qualifiers = "en-rUS-w384dp-h832dp-xhdpi")
    @Test
    fun otherLanguagesShareTheEnglishLink() {
        show(listOf(seoul))
        rule.onNodeWithTag(WeatherTabTags.SHARE).performClick()
        rule.waitForIdle()
        @Suppress("DEPRECATION")
        val text = shared()!!.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!.getStringExtra(Intent.EXTRA_TEXT)!!
        assertTrue(text.startsWith("회현동\nCurrent ") && text.endsWith("\n\nTodayWeather https://twa.app.link/II1JstpVoM"), text)
    }

    /** `doTabShare` without a location shares nothing and asks how to start (O02, AN-10). */
    @Test
    fun aPlaceWithoutALocationOpensTheStartChoice() {
        show(listOf(Place(currentPosition = true, disable = false)))
        rule.onNodeWithTag(LocationPopupTags.START_CHOICE).assertDoesNotExist()
        // INIT cannot load a current place without coordinates. Dismiss its modal error
        // before pressing the underlying share control, as a user must on device.
        rule.onNodeWithTag(net.wizardfactory.todayweather.ui.forecast.RETRY_DIALOG).assertExists()
        rule.onNodeWithText(rule.activity.getString(R.string.LOC_CLOSE)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(WeatherTabTags.SHARE).performClick()
        rule.waitForIdle()
        assertNull(shared())
        rule.onNodeWithTag(LocationPopupTags.START_CHOICE).assertExists()
    }

    @Test
    fun linksQueueTheirPlaceIndex() {
        val links = EntryLinks()
        assertTrue(links.accept(Intent(Intent.ACTION_VIEW, Uri.parse("todayweather://2"))))
        assertTrue(links.accept(Intent(Intent.ACTION_VIEW, Uri.parse("todayweather://"))), "a link without an index selects nothing")
        assertTrue(links.accept(Intent(Intent.ACTION_VIEW, Uri.parse("todayweather://x"))))
        assertTrue(!links.accept(Intent(Intent.ACTION_VIEW, Uri.parse("todayair://3"))))
        assertTrue(!links.accept(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)))
        assertTrue(!links.accept(Intent(Intent.ACTION_SEND, Uri.parse("todayweather://1"))))
        val fromRecents = Intent(Intent.ACTION_VIEW, Uri.parse("todayweather://0")).addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY)
        assertTrue(links.accept(fromRecents), "a task opened again from Recents gets its first link again, which selects nothing")
        assertEquals(2.0, links.indexes.tryReceive().getOrNull())
        assertNull(links.indexes.tryReceive().getOrNull())
    }

    /**
     * A cold start's link arrives with the migration's end, which can be before the saved state is read (the state is
     * null until then): the link waits for the state instead of being dropped.
     */
    @Test
    fun aLinkWaitsForTheSavedState() = runTest {
        val links = EntryLinks()
        val state = MutableStateFlow<AppState?>(null)
        val opened = mutableListOf<Double>()
        val delivery = launch { links.deliver(state) { opened += it } }
        links.accept(Intent(Intent.ACTION_VIEW, Uri.parse("todayweather://2")))
        runCurrent()
        assertEquals(emptyList(), opened, "nothing before the saved state")
        state.value = AppState()
        runCurrent()
        assertEquals(listOf(2.0), opened)
        links.accept(Intent(Intent.ACTION_VIEW, Uri.parse("todayweather://1")))
        runCurrent()
        assertEquals(listOf(2.0, 1.0), opened, "later links at once")
        delivery.cancel()
    }

    /** While the start page shows (AN-10), a link waits for it to close. */
    @Test
    fun aLinkWaitsForTheStartPage() = runTest {
        val links = EntryLinks()
        val state = MutableStateFlow<AppState?>(AppState())
        val opened = mutableListOf<Double>()
        val delivery = launch { links.deliver(state, ready = { !it.startShows }) { opened += it } }
        links.accept(Intent(Intent.ACTION_VIEW, Uri.parse("todayweather://0")))
        runCurrent()
        assertEquals(emptyList(), opened, "a new install shows the start page")
        state.value = AppState().closeStart()
        runCurrent()
        assertEquals(listOf(0.0), opened)
        delivery.cancel()
    }
}
