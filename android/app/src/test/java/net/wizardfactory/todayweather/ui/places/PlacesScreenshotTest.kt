package net.wizardfactory.todayweather.ui.places

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
import net.wizardfactory.todayweather.ui.chart.ImageDiff
import net.wizardfactory.todayweather.ui.chart.Pixels
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * S02 against the Cordova build (#2890, manual pages 13, 14, 18 and 19), captured by tools/places-reference/capture.sh at
 * 384×762 dp (the WebView) and density 2 in places-reference/<lang>: the list with 서울, the search for 부산, edit mode
 * with 현재위치, 서울, 부산광역시 and London, and the find-by-location result. The app's screens run with the same
 * fixtures over a fake server. Each comparison passes within the tolerance recorded in places-reference/tolerances.json,
 * and the rows lie where the capture has them. Renders and overlays go to build/places-compare/.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class PlacesScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val references = File(project, "src/test/resources/places-reference")
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val tolerances = Json.parseToJsonElement(File(references, "tolerances.json").takeIf { it.isFile }?.readText() ?: "{}").jsonObject
    private val out = File(project, "build/places-compare").apply { mkdirs() }
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

    @Test fun koreanList() = checked { listAndSearch("ko-KR") }

    @Test fun koreanEdit() = checked { editAndLocation("ko-KR") }

    @Config(qualifiers = "en-rUS-w384dp-h832dp-xhdpi")
    @Test fun englishList() = checked { listAndSearch("en-US") }

    @Config(qualifiers = "en-rUS-w384dp-h832dp-xhdpi")
    @Test fun englishEdit() = checked { editAndLocation("en-US") }

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
            Box(Modifier.size(384.dp, 762.dp).testTag(ROOT)) {
                AppContent(state, entries, loading, retry, session, host, "test", onExit = {}, places = places)
            }
        }
        rule.waitForIdle()
    }

    private fun listAndSearch(lang: String) {
        show(listOf(Place.currentPositionPlaceholder(), seoul))
        compare("$lang/favorites")
        rule.onNodeWithTag(PlacesTags.INPUT).performClick()
        rule.onNodeWithTag(PlacesTags.INPUT).performTextInput("부산")
        rule.waitForIdle()
        compare("$lang/search")
    }

    private fun editAndLocation(lang: String) {
        show(listOf(Place.currentPositionPlaceholder(), seoul, busan, london))
        rule.onNodeWithTag(PlacesTags.MODE).performClick()
        rule.waitForIdle()
        compare("$lang/edit")
        rule.onNodeWithTag(PlacesTags.MODE).performClick()
        rule.onNodeWithTag(PlacesTags.INPUT).performClick()
        rule.onNodeWithTag(PlacesTags.FIND).performClick()
        rule.waitForIdle()
        compare("$lang/location")
    }

    /**
     * The rows of edit mode and the search's find button against the capture's boxes: each row's top and height within
     * 1 dp (the first row includes its top border, as the capture's item does), the button within 0.5 dp.
     */
    @Test
    fun koreanBoxes() {
        val capture = Json.parseToJsonElement(File(references, "ko-KR/edit.json").readText()).jsonObject
        show(listOf(Place.currentPositionPlaceholder(), seoul, busan, london))
        rule.onNodeWithTag(PlacesTags.MODE).performClick()
        rule.waitForIdle()
        capture["rows"]!!.jsonArray.forEachIndexed { i, row ->
            val want = row.jsonObject["item"]!!.jsonObject["rect"]!!.jsonObject
            val r = rule.onNodeWithTag(PlacesTags.row(i)).getUnclippedBoundsInRoot()
            assertEquals("row $i top", want["y"]!!.jsonPrimitive.double.toFloat(), r.top.value, 1f)
            assertEquals("row $i height", want["h"]!!.jsonPrimitive.double.toFloat(), r.bottom.value - r.top.value, 1f)
            assertEquals("row $i left", want["x"]!!.jsonPrimitive.double.toFloat(), r.left.value, 0.5f)
        }
        val search = Json.parseToJsonElement(File(references, "ko-KR/search.json").readText()).jsonObject
        rule.onNodeWithTag(PlacesTags.MODE).performClick()
        rule.onNodeWithTag(PlacesTags.INPUT).performClick()
        rule.waitForIdle()
        val want = search["find"]!!.jsonObject["rect"]!!.jsonObject
        val r = rule.onNodeWithTag(PlacesTags.FIND).getUnclippedBoundsInRoot()
        assertEquals(listOf("x", "y", "w", "h").map { want[it]!!.jsonPrimitive.double.toFloat() },
            listOf(r.left.value, r.top.value, r.right.value - r.left.value, r.bottom.value - r.top.value))
    }

    private val failures = mutableListOf<String>()

    private fun compare(name: String) {
        val native = rule.onNodeWithTag(ROOT).captureToImage().asAndroidBitmap().toPixels()
        val cordova = ImageIO.read(File(references, "$name.png")).toPixels()
        val diff = ImageDiff.of(native, cordova)
        val base = name.replace('/', '-')
        ImageIO.write(native.toBufferedImage(), "png", File(out, "$base-native.png"))
        ImageIO.write(ImageDiff.overlay(native, cordova).toBufferedImage(), "png", File(out, "$base-diff.png"))
        println("places-compare $name native=${native.width}x${native.height} cordova=${cordova.width}x${cordova.height} $diff")
        val limit = tolerances["cases"]?.jsonObject?.get(name)?.jsonObject
        val margin = tolerances["margin"]?.jsonObject
        if (limit == null || margin == null) {
            failures += "$name: no recorded tolerance, $diff"
        } else if (native.width != cordova.width || diff.heightDifference > limit.num("heightDifference") + margin.num("heightDifference") ||
            diff.strong > limit.num("strong") + margin.num("strong") || diff.mean > limit.num("mean") + margin.num("mean")) {
            failures += "$name: $diff, recorded $limit"
        }
    }

    private fun checked(comparisons: () -> Unit) {
        comparisons()
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    private fun JsonObject.num(k: String) = this[k]!!.jsonPrimitive.double
    private fun Bitmap.toPixels() = Pixels(width, height, IntArray(width * height).also { getPixels(it, 0, width, 0, 0, width, height) })
    private fun BufferedImage.toPixels() = Pixels(width, height, getRGB(0, 0, width, height, null, 0, width))
    private fun Pixels.toBufferedImage() = BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB).apply { setRGB(0, 0, width, height, argb, 0, width) }

    private companion object {
        const val ROOT = "places-compare-root"
    }
}
