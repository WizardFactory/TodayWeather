package net.wizardfactory.todayweather.ui.places

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.core.data.GeocodeClient
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.LocationAccess
import net.wizardfactory.todayweather.core.data.PlacesPage
import net.wizardfactory.todayweather.core.data.StartFlow
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import net.wizardfactory.todayweather.core.domain.start.TownSearch
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.Settings
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.core.storage.closeStart
import net.wizardfactory.todayweather.search.BundledTowns
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
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

/** S02 favorites, editing and search at large text in changing window sizes. */
abstract class PlacesFitTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val seoul = Place(false, false, "서울", "대한민국 서울특별시", "KR", Location(37.567, 126.978))
    private val busan = Place(false, false, "부산광역시", "대한민국 부산광역시", "KR", Location(35.18, 129.08))
    private val london = Place(false, false, "London", "London, UK", "GB", Location(51.51, -0.13))

    private class Memory(initial: AppState) : StateAccess {
        val flow = MutableStateFlow(initial)
        override fun current() = flow.value
        override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
    }

    private object Device : LocationAccess {
        override fun enabled() = true
        override fun status() = PermissionStatus.GRANTED
        override suspend fun request() = PermissionStatus.GRANTED
        override suspend fun position() = Location(37.5665, 126.978)
        override suspend fun requestHighAccuracy() = true
    }

    @After fun stop() = scope.cancel()

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

    @Test @Config(qualifiers = "+w384dp-h832dp-port", fontScale = 1.3f) fun phone() = fits()
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
    private fun show(places: List<Place>) {
        val memory = Memory(AppState(places = places, placeIndex = 1, units = UnitSettings.defaults("KR"), settings = Settings(startupPage = "2")).closeStart()
            .copy(placeIndex = 1))
        val http = HttpGet { url, _ ->
            when {
                "/geocode/" in url -> File(inputs, "geocode-seoul.json").readText()
                "51.51" in url -> File(inputs, "vc-london.json").readText()
                else -> File(inputs, "kma-seoul.json").readText()
            }
        }
        val repository = WeatherRepository("https://server.test.invalid", null, http, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        rule.setContent {
            val state by memory.flow.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            val places = PlacesHost(null, { TownSearch(BundledTowns.load(context)) }) { s ->
                PlacesPage(memory, repository, session, StartFlow(memory, repository, GeocodeClient("https://server.test.invalid", http), Device,
                    { listOf("ko-KR") }), Device, s, removeAlarms = {})
            }
            Box(Modifier) {
                AppContent(state, entries, loading, retry, session, host, "test", onExit = {}, places = places)
            }
        }
        rule.waitForIdle()
    }


    private fun fits() {
        show(listOf(Place.currentPositionPlaceholder(), seoul, busan, london))
        fun check(name: String) {
            rule.waitForIdle()
            val safe = ShellFit.safeArea(rule.activity, rule.onRoot().fetchSemanticsNode().boundsInRoot)
            assertEquals(name, emptyList<String>(), ShellFit.texts(rule, name, safe))
        }
        check("favorites")
        rule.onNodeWithTag(PlacesTags.MODE).performClick()
        check("edit")
        rule.onNodeWithTag(PlacesTags.MODE).performClick()
        rule.onNodeWithTag(PlacesTags.INPUT).performClick()
        rule.onNodeWithTag(PlacesTags.INPUT).performTextInput("부산")
        check("search")
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-xhdpi")
class PlacesFitKoTest : PlacesFitTest()

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "en-rUS-xhdpi")
class PlacesFitEnTest : PlacesFitTest()
