package net.wizardfactory.todayweather

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import net.wizardfactory.todayweather.ui.forecast.RETRY_DIALOG
import net.wizardfactory.todayweather.core.data.HttpStatusException
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.forecast.ForecastTags
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Exercise the release gesture through the production pages, session and repository with an offline response. */
@RunWith(AndroidJUnit4::class)
class PullRefreshDeviceTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    @After fun stop() = scope.cancel()

    @Test fun eachWeatherPagePullsTheSelectedPlaceOnceWithFreshData() {
        val instrument = InstrumentationRegistry.getInstrumentation()
        val body = instrument.context.assets.open("corpus/inputs/kma-seoul.json").bufferedReader().use { it.readText() }
        val place = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))
        val saved = MutableStateFlow(AppState(places = listOf(Place.currentPositionPlaceholder(), place),
            placeIndex = 1, units = UnitSettings.defaults("KR")))
        val state = object : StateAccess {
            override fun current() = saved.value
            override fun change(update: (AppState) -> AppState) { saved.value = update(saved.value) }
        }
        val requests = CopyOnWriteArrayList<String>()
        val hold = AtomicBoolean(false)
        val delayed = CompletableDeferred<Unit>()
        val failNext = AtomicBoolean(false)
        val repository = WeatherRepository("https://fixture.invalid", null, HttpGet { url, _ ->
            requests.add(url)
            if (hold.get()) delayed.await()
            if (failNext.getAndSet(false)) throw HttpStatusException(500)
            body
        })
        val session = WeatherSession(repository, scope, state, { listOf("ko-KR") }, { null })
        val host = WeatherTabHost(forecastTexts(rule.activity), PhotoLoader(rule.activity), { repository.cached(it) },
            session::previous, session::next, { expand -> state.change { it.copy(expandShortChart = expand) } })
        rule.setContent {
            val model by saved.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            AppContent(model, entries, loading, retry, session, host, "test", onExit = {})
        }
        rule.runOnUiThread { session.reload(WeatherSession.Sender.INIT) }
        rule.waitUntil(15_000) { repository.weather.value.isNotEmpty() && repository.loading.value.isEmpty() }
        for ((index, tab) in listOf(Tab.HOURLY, Tab.DAILY, Tab.AIR).withIndex()) {
            rule.onNodeWithTag(ShellTags.tab(tab)).performClick()
            rule.onNodeWithTag(ShellTags.tab(tab)).performClick()
            rule.onNodeWithTag(ShellTags.page(tab)).assertIsDisplayed()
            rule.onNodeWithTag(ShellTags.tab(tab)).assertIsSelected()
            assertEquals("selecting or re-tapping the tab keeps the cache", 1 + index, requests.size)
            rule.onNodeWithTag(ShellTags.page(tab)).performTouchInput { swipeDown(startY = height * 0.22f) }
            rule.waitUntil(10_000) { requests.size >= 2 + index }
            rule.waitUntil(10_000) { repository.loading.value.isEmpty() }
            rule.onNodeWithTag(ShellTags.page(tab)).assertIsDisplayed()
            assertEquals(1, state.current().placeIndex)
            assertEquals(List(2 + index) { requests.first() }, requests.toList())
            if (tab == Tab.HOURLY) {
                val page = rule.onNodeWithTag(ShellTags.page(tab))
                fun scrollOffset() = rule.onNodeWithTag(ForecastTags.PAGE).fetchSemanticsNode()
                    .config[SemanticsProperties.VerticalScrollAxisRange].value()
                page.performTouchInput { swipeUp(durationMillis = 300) }
                val before = scrollOffset()
                assertTrue("the page scrolled away from its top", before > 0f)
                page.performTouchInput { swipeDown(startY = height * 0.35f, endY = height * 0.48f, durationMillis = 320) }
                val after = scrollOffset()
                assertTrue("the downward drag scrolled within the page", after > 0f && after < before)
                assertEquals("ordinary downward scrolling keeps the cache", 2, requests.size)
            }
        }

        // Count raw HTTP requests above with immediate replies. During a held reply the transport deliberately
        // starts another attempt every two seconds, so the progress check controls the whole response window.
        rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).performClick()
        val appliesBeforePull = session.applies.value
        hold.set(true)
        val hourly = rule.onNodeWithTag(ShellTags.page(Tab.HOURLY))
        hourly.performTouchInput { swipeDown(startY = height * 0.22f) }
        rule.waitUntil(10_000) { repository.loading.value.isNotEmpty() }
        rule.onNodeWithTag(ShellTags.REFRESHING).assertIsDisplayed()
        if (TestRunner.args.getString("capture") == "true") {
            rule.mainClock.advanceTimeBy(500)
            rule.waitForIdle()
            capture("pull-refresh")
        }
        assertEquals("one manual refresh started while the response was held", appliesBeforePull + 1, session.applies.value)
        hold.set(false)
        delayed.complete(Unit)
        rule.waitUntil(10_000) { repository.loading.value.isEmpty() }
        rule.onNodeWithTag(ShellTags.REFRESHING).assertDoesNotExist()

        failNext.set(true)
        hourly.performTouchInput { swipeDown(startY = height * 0.22f) }
        rule.waitUntil(10_000) { session.retry.value }
        rule.onNodeWithTag(RETRY_DIALOG).assertIsDisplayed()
        val beforeRetry = requests.size
        rule.onNodeWithText(rule.activity.getString(R.string.LOC_OK)).performClick()
        rule.waitUntil(10_000) { requests.size == beforeRetry + 1 && repository.loading.value.isEmpty() }
        rule.onNodeWithTag(RETRY_DIALOG).assertDoesNotExist()
        assertEquals(requests.first(), requests.last())
        if (TestRunner.args.getString("capture") == "true") captureWeatherAndAir(rule, ::capture)
    }

    private fun capture(name: String) {
        val image = rule.onRoot().captureToImage().asAndroidBitmap()
        val file = File(rule.activity.filesDir, "$name.png")
        file.outputStream().use { check(image.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}
