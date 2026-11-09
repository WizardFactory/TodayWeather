package net.wizardfactory.todayweather.ui.nation

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.unit.dp
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.Warnings
import net.wizardfactory.todayweather.core.domain.nation.WarningCard
import net.wizardfactory.todayweather.core.domain.nation.WarningCards
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.model.NationResponse
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.chart.ImageDiff
import net.wizardfactory.todayweather.ui.chart.Pixels
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The native nationwide and warning pages against the Cordova build (#2892 AC3). tools/nation-reference/capture.sh
 * captured the references at 384×832 dp and density 2, in nation-reference/<lang>:
 * - S10 in its three modes (manual pages 33 and 34) and S11 in its six tabs (page 35), CO after a swipe of the strip;
 * - S12 as it opens (page 32) and each card whole;
 * - the loading, failed and empty states, the dark and old themes, and the units km/h and AirNow;
 * - S10, S11 and S12 in English.
 * Each comparison passes within the tolerance recorded for it in nation-reference/tolerances.json. Renders and
 * overlays go to build/nation-compare/.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h4400dp-xhdpi")
class NationScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val references = File(project, "src/test/resources/nation-reference")
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val tolerances = Json.parseToJsonElement(File(references, "tolerances.json").takeIf { it.isFile }?.readText() ?: "{}").jsonObject
    private val out = File(project, "build/nation-compare").apply { mkdirs() }
    private val kr = UnitSettings.defaults("KR")
    private val nation = NationPageState.Nation(NationResponse(Json.parseToJsonElement(File(inputs, "nation.json").readText()).jsonObject))

    @Test fun weatherModes() = checked {
        page(NationRoutes.NATION, nation)
        compare("ko-KR/nation-weather")
        rule.onNodeWithTag(NationTags.mode(1)).performClick()
        compare("ko-KR/nation-rain")
        rule.onNodeWithTag(NationTags.mode(2)).performClick()
        compare("ko-KR/nation-wind")
    }

    @Test fun airTabs() = checked {
        page(NationRoutes.NATION_AIR, nation)
        for (type in listOf("pm2.5", "pm10", "o3", "no2", "so2", "co")) {
            if (type == "co") rule.onNodeWithTag(NationTags.STRIP).performTouchInput { swipeLeft() }
            rule.onNodeWithTag(NationTags.tab(type)).performClick()
            compare("ko-KR/nation-air-$type")
        }
    }

    @Test fun warnings() = checked {
        page(NationRoutes.WARNINGS, warnings("ko-KR"))
        compare("ko-KR/warnings", crop = false)
        cards("ko-KR")
    }

    @Test fun loading() = checked {
        page(NationRoutes.NATION, NationPageState.Loading)
        compare("ko-KR/nation-loading", crop = false)
    }

    @Test fun failedAndEmpty() = checked {
        page(NationRoutes.NATION, NationPageState.Nation(null))
        compare("ko-KR/nation-weather-failed")
        page(NationRoutes.NATION_AIR, NationPageState.Nation(null))
        compare("ko-KR/nation-air-failed")
        page(NationRoutes.WARNINGS, NationPageState.Warnings(emptyList()))
        compare("ko-KR/warnings-empty", crop = false)
        compare("ko-KR/warnings-failed", crop = false)
    }

    @Test fun themes() = checked {
        for (theme in listOf(Theme.DARK, Theme.OLD)) {
            page(NationRoutes.NATION, nation, theme)
            compare("ko-KR/nation-weather-${theme.key}")
            page(NationRoutes.WARNINGS, warnings("ko-KR"), theme)
            compare("ko-KR/warnings-${theme.key}", crop = false)
        }
    }

    @Test fun units() = checked {
        page(NationRoutes.NATION, nation, units = kr.copy(windSpeedUnit = "km/h"))
        rule.onNodeWithTag(NationTags.mode(2)).performClick()
        compare("ko-KR/nation-wind-kph")
        page(NationRoutes.NATION_AIR, nation, units = kr.copy(airUnit = "airnow"))
        compare("ko-KR/nation-air-pm2.5-airnow")
    }

    @Config(qualifiers = "en-rKR-w384dp-h4400dp-xhdpi")
    @Test fun english() = checked {
        page(NationRoutes.NATION, nation)
        compare("en-KR/nation-weather")
        page(NationRoutes.NATION_AIR, nation)
        compare("en-KR/nation-air-pm2.5")
        page(NationRoutes.WARNINGS, warnings("en-KR"))
        compare("en-KR/warnings", crop = false)
        cards("en-KR")
    }

    private fun warnings(lang: String) = NationPageState.Warnings(WarningCards.cards(
        Warnings.parse(Json.parseToJsonElement(File(inputs, "special.json").readText()), lang, "Asia/Seoul")))

    private var route by mutableStateOf("")
    private var state by mutableStateOf<NationPageState>(NationPageState.Loading)
    private var theme by mutableStateOf(Theme.LIGHT)
    private var units by mutableStateOf(kr)
    private var card by mutableStateOf<WarningCard?>(null)
    private var generation by mutableIntStateOf(0)
    private var started = false

    /** Shows what the fields name, composed afresh, so a page's mode and tab start as they open. */
    private fun show() {
        generation++
        if (!started) {
            started = true
            rule.setContent {
                val texts = forecastTexts(LocalContext.current)
                key(generation) {
                    val shown = card
                    if (shown != null) {
                        Box(Modifier.width(384.dp).testTag(ROOT)) { WarningCardBox(shown, texts["LOC_SPECIAL_WEATHER_NOTE"], Modifier) }
                    } else {
                        Box(Modifier.size(384.dp, 762.dp).testTag(ROOT)) { NationScreen(route, state, theme, "KR", units, texts, onBack = {}) }
                    }
                }
            }
        }
        rule.waitForIdle()
    }

    /** A page in the WebView's 384×762 dp. */
    private fun page(route: String, state: NationPageState, theme: Theme = Theme.LIGHT, units: UnitSettings = kr) {
        this.route = route
        this.state = state
        this.theme = theme
        this.units = units
        card = null
        show()
    }

    /**
     * Each S12 card whole, drawn alone at the window's width, against `warnings-<i>.png`; the top the header hides in
     * the WebView (`clipTop`, the first card's border) is left out.
     */
    private fun cards(lang: String) {
        warnings(lang).cards.forEachIndexed { i, c ->
            card = c
            show()
            val clip = Json.parseToJsonElement(File(references, "$lang/warnings-$i.json").readText()).jsonObject["clipTop"]!!.jsonPrimitive.double
            val native = rule.onNodeWithTag(ROOT).captureToImage().asAndroidBitmap().toPixels()
            val top = Math.round(clip * 2).toInt()
            compareImage("$lang/warnings-$i", native.crop(0, top, native.width, native.height - top), crop = false)
        }
        card = null
    }

    private val failures = mutableListOf<String>()

    /** The page against the capture of the same name; [crop] cuts the native page to the capture's height. */
    private fun compare(name: String, crop: Boolean = true) {
        rule.waitForIdle()
        compareImage(name, rule.onNodeWithTag(ROOT).captureToImage().asAndroidBitmap().toPixels(), crop)
    }

    private fun compareImage(name: String, native: Pixels, crop: Boolean) {
        val cordova = ImageIO.read(File(references, "$name.png")).toPixels()
        val shown = if (crop) native.crop(0, 0, native.width, minOf(native.height, cordova.height)) else native
        val diff = ImageDiff.of(shown, cordova)
        val base = name.replace('/', '-')
        ImageIO.write(shown.toBufferedImage(), "png", File(out, "$base-native.png"))
        ImageIO.write(ImageDiff.overlay(shown, cordova).toBufferedImage(), "png", File(out, "$base-diff.png"))
        println("nation-compare $name native=${shown.width}x${shown.height} cordova=${cordova.width}x${cordova.height} $diff")
        val limit = tolerances["cases"]?.jsonObject?.get(name)?.jsonObject
        val margin = tolerances["margin"]?.jsonObject
        if (limit == null || margin == null) {
            failures += "$name: no recorded tolerance, $diff"
        } else if (shown.width != cordova.width || diff.heightDifference > limit.num("heightDifference") + margin.num("heightDifference") ||
            diff.strong > limit.num("strong") + margin.num("strong") || diff.mean > limit.num("mean") + margin.num("mean")) {
            failures += "$name: $diff, recorded $limit"
        }
    }

    /** Runs [comparisons], then fails with every comparison over its tolerance. */
    private fun checked(comparisons: () -> Unit) {
        comparisons()
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    private fun JsonObject.num(k: String) = this[k]!!.jsonPrimitive.double
    private fun Bitmap.toPixels() = Pixels(width, height, IntArray(width * height).also { getPixels(it, 0, width, 0, 0, width, height) })
    private fun BufferedImage.toPixels() = Pixels(width, height, getRGB(0, 0, width, height, null, 0, width))
    private fun Pixels.toBufferedImage() = BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB).apply { setRGB(0, 0, width, height, argb, 0, width) }

    private companion object {
        const val ROOT = "nation-compare-root"
    }
}
