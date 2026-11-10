package net.wizardfactory.todayweather.ui.alarms

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
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import java.awt.image.BufferedImage
import java.io.File
import java.util.TimeZone
import javax.imageio.ImageIO
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.AlertIntro
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.core.data.AlarmPage
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.NotificationAccess
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PushRecords
import net.wizardfactory.todayweather.core.storage.PushState
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.core.storage.closeStart
import net.wizardfactory.todayweather.notify.PushMessage
import net.wizardfactory.todayweather.ui.chart.ImageDiff
import net.wizardfactory.todayweather.ui.chart.Pixels
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.WeatherTabTags
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.shell.PopupTags
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * S09 against the Cordova build (#2893, manual pages 21–23), captured by tools/push-reference/capture.sh at 384×762 dp
 * (the WebView) and density 2 in push-reference/<lang>: the defaults of 서울 (page 21), the time picker on the add row
 * (22), the save confirmation after Cancel (23), O13 for a stored alert from 09 to 09 and O11 while notifications are
 * off. Each comparison passes within the tolerance recorded in push-reference/tolerances.json; the cards, rows, weekday
 * buttons, the bar and the popups lie where the capture has them. O06 and O07, over Hourly, are checked by their boxes.
 * Renders and overlays go to build/push-compare/.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class AlarmsScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val references = File(project, "src/test/resources/push-reference")
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val tolerances = Json.parseToJsonElement(File(references, "tolerances.json").takeIf { it.isFile }?.readText() ?: "{}").jsonObject
    private val out = File(project, "build/push-compare").apply { mkdirs() }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val seoulZone = TimeZone.getTimeZone("Asia/Seoul")
    private var savedZone: TimeZone? = null

    private val seoul = Place(false, false, "서울", "대한민국 서울특별시", "KR", Location(37.567, 126.978))
    private val places = listOf(Place.currentPositionPlaceholder(), seoul)

    private class Memory(initial: AppState) : StateAccess {
        val flow = MutableStateFlow(initial)
        override fun current() = flow.value
        override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
    }

    private class Access(var on: Boolean = true) : NotificationAccess {
        override val available = true
        override fun enabled() = on
        override suspend fun request() = on
    }

    private val access = Access()
    private val messages = MutableSharedFlow<PushMessage>(extraBufferCapacity = 4)

    @Before fun zone() {
        savedZone = TimeZone.getDefault()
        TimeZone.setDefault(seoulZone)
    }

    @After fun stop() {
        scope.cancel()
        savedZone?.let(TimeZone::setDefault)
    }

    @Test fun koreanDefaults() = checked { defaults("ko-KR") }

    @Test fun koreanStored() = checked { stored("ko-KR") }

    @Config(qualifiers = "en-rUS-w384dp-h832dp-xhdpi")
    @Test fun englishDefaults() = checked { defaults("en-US") }

    @Config(qualifiers = "en-rUS-w384dp-h832dp-xhdpi")
    @Test fun englishStored() = checked { stored("en-US") }

    /** An alert from [start] to [end] and an alarm at 07:40 on weekdays for 서울, as the capture seeded them. */
    private fun records(start: Double, end: Double) = listOf(
        PushRecords.newAlert(1, 1, start, end, places, System.currentTimeMillis(), seoulZone),
        PushRecords.newAlarm(2, 1, 7 * 3600 + 40 * 60, listOf(false, true, true, true, true, true, false), places, System.currentTimeMillis(), seoulZone))

    private fun show(push: PushState, intro: Boolean = false) {
        val memory = Memory(AppState(places = places, placeIndex = 1, units = UnitSettings.defaults("KR"), push = push).closeStart().copy(placeIndex = 1))
        val http = HttpGet { _, _ -> File(inputs, "kma-seoul.json").readText() }
        val repository = WeatherRepository("https://server.test.invalid", null, http, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        val alarms = AlarmsHost { s, openSettings -> AlarmPage(memory, access, post = {}, openSettings = openSettings, scope = s) }
        val alertIntro = object : AlertIntro {
            override fun due() = intro
            override fun answer(enable: Boolean) {}
        }
        rule.setContent {
            val state by memory.flow.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            Box(Modifier.size(384.dp, 762.dp).testTag(ROOT)) {
                AppContent(state, entries, loading, retry, session, host, "test", onExit = {}, startTab = Tab.HOURLY, alarms = alarms,
                    messages = messages, alertIntro = alertIntro)
            }
        }
        rule.waitForIdle()
    }

    private fun openS09() {
        rule.onNodeWithTag(WeatherTabTags.BELL).performClick()
        rule.waitForIdle()
    }

    private fun defaults(lang: String) {
        show(PushState(fcmToken = "t"))
        openS09()
        compare("$lang/settings")
        boxes("$lang/settings")
        rule.onNodeWithTag(AlarmsTags.ADD).performClick()
        rule.waitForIdle()
        compare("$lang/picker")
        pickerBoxes("$lang/picker")
        rule.onNodeWithTag(AlarmsTags.PICKER_CLOSE).performClick()
        rule.onNodeWithTag(AlarmsTags.CANCEL).performClick()
        rule.waitForIdle()
        compare("$lang/confirm")
        popupBoxes("$lang/confirm")
    }

    private fun stored(lang: String) {
        show(PushState(fcmToken = "t", records = records(9.0, 9.0)))
        openS09()
        rule.onNodeWithTag(AlarmsTags.SAVE).performClick()
        rule.waitForIdle()
        compare("$lang/equal")
        popupBoxes("$lang/equal")
    }

    /** O11 over the stored 07–22 alert after Save, with notifications off. */
    @Test
    fun koreanPermission() = checked {
        show(PushState(fcmToken = "t", records = records(7.0, 22.0)))
        openS09()
        access.on = false
        rule.onNodeWithTag(AlarmsTags.SAVE).performClick()
        rule.waitForIdle()
        compare("ko-KR/permission")
        popupBoxes("ko-KR/permission")
    }

    /** O06 and O07 over Hourly: the popup, its title, lines and buttons where the capture has them. */
    @Test
    fun koreanIntroAndForeground() = checked {
        show(PushState(fcmToken = "t", records = records(7.0, 22.0), needsAlertIntro = true), intro = true)
        rule.mainClock.advanceTimeBy(600)
        rule.waitForIdle()
        popupBoxes("ko-KR/intro")
        rule.onAllNodesWithTag(PopupTags.BUTTON)[0].performClick()
        rule.waitForIdle()
        messages.tryEmit(PushMessage("서울 맑음 3˚", "내일 아침 -1˚, 낮 9˚", emptyMap(), "1", false))
        rule.waitForIdle()
        popupBoxes("ko-KR/foreground")
    }

    private fun rect(o: JsonObject) = o["rect"]!!.jsonObject.let { r -> listOf("x", "y", "w", "h").map { r[it]!!.jsonPrimitive.double.toFloat() } }

    private fun bounds(tag: String, i: Int = 0) = rule.onAllNodesWithTag(tag)[i].getUnclippedBoundsInRoot().let {
        listOf(it.left.value, it.top.value, it.right.value - it.left.value, it.bottom.value - it.top.value)
    }

    private fun near(what: String, want: List<Float>, got: List<Float>, tolerance: Float) {
        println("push-box $what capture=$want native=$got")
        want.zip(got).forEachIndexed { i, (w, g) ->
            if (kotlin.math.abs(w - g) > tolerance) failures += "$what ${"xywh"[i]}: capture $w, native $g"
        }
    }

    /** The weekday buttons, the alarm rows, the bar and the bottom buttons at the capture's boxes (0.6 dp). */
    private fun boxes(name: String) {
        val page = Json.parseToJsonElement(File(references, "$name.json").readText()).jsonObject["page"]!!.jsonObject
        page["days"]!!.jsonArray.forEachIndexed { i, d -> near("$name day $i", rect(d.jsonObject), bounds(AlarmsTags.day(i)), 0.6f) }
        val titles = page["items"]!!.jsonArray.map { it.jsonObject }.filter { "item-title" in it["cls"]!!.jsonPrimitive.content }
        titles.forEachIndexed { i, t -> near("$name title $i", rect(t), bounds(AlarmsTags.title(i)), 0.6f) }
        page["descriptions"]!!.jsonArray.forEachIndexed { i, d -> near("$name description $i", rect(d.jsonObject), bounds(AlarmsTags.description(i)), 0.6f) }
        val items = page["items"]!!.jsonArray.map { it.jsonObject }.filter { "item-icon-right" in it["cls"]!!.jsonPrimitive.content }
        near("$name row 0", rect(items[0]), bounds(AlarmsTags.row(0)), 0.6f)
        near("$name row 1", rect(items[1]), bounds(AlarmsTags.row(1)), 0.6f)
        near("$name add row", rect(items[2]), bounds(AlarmsTags.ADD), 0.6f)
        near("$name bar", rect(page["slider"]!!.jsonObject["irs"]!!.jsonObject), bounds(AlarmsTags.BAR), 0.6f)
        val buttons = page["buttons"]!!.jsonArray.map { it.jsonObject }
        near("$name cancel", rect(buttons[0]), bounds(AlarmsTags.CANCEL), 0.6f)
        near("$name save", rect(buttons[1]), bounds(AlarmsTags.SAVE), 0.6f)
        near("$name toggle", rect(page["toggle"]!!.jsonObject["toggle"]!!.jsonObject), bounds(AlarmsTags.TOGGLE), 0.6f)
    }

    private fun popupBoxes(name: String) {
        val popup = Json.parseToJsonElement(File(references, "$name.json").readText()).jsonObject["popup"]!!.jsonObject
        near("$name popup", rect(popup["popup"]!!.jsonObject), bounds(PopupTags.POPUP), 0.6f)
        popup["buttons"]!!.jsonArray.forEachIndexed { i, b -> near("$name button $i", rect(b.jsonObject), bounds(PopupTags.BUTTON, i), 0.6f) }
    }

    private fun pickerBoxes(name: String) {
        val popup = Json.parseToJsonElement(File(references, "$name.json").readText()).jsonObject["popup"]!!.jsonObject
        near("$name picker", rect(popup["popup"]!!.jsonObject), bounds(AlarmsTags.PICKER), 0.6f)
        near("$name heading", rect(popup["heading"]!!.jsonObject), bounds(AlarmsTags.PICKER_HEADING), 0.6f)
        listOf(AlarmsTags.PICKER_SET, AlarmsTags.PICKER_DELETE, AlarmsTags.PICKER_CLOSE).forEachIndexed { i, tag ->
            near("$name button $i", rect(popup["buttons"]!!.jsonArray[i].jsonObject), bounds(tag), 0.6f)
        }
        val arrows = popup["arrows"]!!.jsonArray.map { it.jsonObject }
        // The capture lists each column's arrows in turn: up, down.
        (0..2).forEach { c ->
            near("$name up $c", rect(arrows[c * 2]), bounds(AlarmsTags.up(c)), 0.6f)
            near("$name down $c", rect(arrows[c * 2 + 1]), bounds(AlarmsTags.down(c)), 0.6f)
        }
    }

    private val failures = mutableListOf<String>()

    private fun compare(name: String) {
        val native = rule.onNodeWithTag(ROOT).captureToImage().asAndroidBitmap().toPixels()
        val cordova = ImageIO.read(File(references, "$name.png")).toPixels()
        val diff = ImageDiff.of(native, cordova)
        val base = name.replace('/', '-')
        ImageIO.write(native.toBufferedImage(), "png", File(out, "$base-native.png"))
        ImageIO.write(ImageDiff.overlay(native, cordova).toBufferedImage(), "png", File(out, "$base-diff.png"))
        println("push-compare $name native=${native.width}x${native.height} cordova=${cordova.width}x${cordova.height} $diff")
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
        const val ROOT = "push-compare-root"
    }
}
