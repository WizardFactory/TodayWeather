package net.wizardfactory.todayweather.ui.shell

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.DpRect
import androidx.compose.ui.unit.dp
import java.io.File
import javax.imageio.ImageIO
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The usage analytics popup's boxes against the Cordova capture (privacy-reference/<lang>/analytics-popup.json): the
 * popup, its body and its two buttons within 0.5 dp, and each button's darkest text pixel (the `button-default` text
 * at the buttons' 0.87 opacity) within 10 levels of the capture's.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
class PrivacyGeometryTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val references = File(File(System.getProperty("tw.projectDir")!!), "src/test/resources/privacy-reference")

    @Test fun korean() = popup("ko-KR", "KR")

    @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    @Test fun english() = popup("en-US", "US")

    private fun popup(lang: String, region: String) {
        val capture = Json.parseToJsonElement(File(references, "$lang/analytics-popup.json").readText()).jsonObject
        rule.setContent {
            val texts = forecastTexts(LocalContext.current)
            Box(Modifier.size(384.dp, 762.dp).testTag(ROOT)) {
                SideMenu(ShellState(Theme.LIGHT, region, Tab.HOURLY, "1.1.1", mapOf(MenuRow.STARTUP_PAGE to texts["LOC_HOURLY_FORECAST"],
                    MenuRow.REFRESH_INTERVAL to texts["LOC_MANUAL"], MenuRow.THEME to texts["LOC_LIGHT_THEME"],
                    MenuRow.ANALYTICS to stringResource(R.string.LOC_ANALYTICS_DISABLED)))) {}
                IonicPopup(stringResource(R.string.LOC_ANALYTICS_CHOICE), listOf(stringResource(R.string.LOC_ANALYTICS_DETAIL)),
                    listOf(PopupButton(stringResource(R.string.LOC_ANALYTICS_DENY)) {}, PopupButton(stringResource(R.string.LOC_ANALYTICS_ALLOW)) {}),
                    onBack = {})
            }
        }
        rule.onNodeWithTag(ShellTags.row(MenuRow.ABOUT)).performScrollTo()
        rule.waitForIdle()
        val parts = capture["parts"]!!.jsonArray.map { it.jsonObject }
        fun part(cls: String) = parts.filter { it["cls"]!!.jsonPrimitive.content == cls }.map { it["rect"]!!.jsonObject }
        val expected = listOf("popup" to capture["popup"]!!.jsonObject["rect"]!!.jsonObject, "body" to part("popup-body").single()) +
            part("button button-default").mapIndexed { i, r -> "button $i" to r }
        val actual = listOf("popup" to rule.onNodeWithTag(PopupTags.POPUP).getUnclippedBoundsInRoot(),
            "body" to rule.onNodeWithTag(PopupTags.BODY).getUnclippedBoundsInRoot()) +
            rule.onAllNodesWithTag(PopupTags.BUTTON).fetchSemanticsNodes().indices.map { i ->
                "button $i" to rule.onAllNodesWithTag(PopupTags.BUTTON)[i].getUnclippedBoundsInRoot()
            }
        assertEquals(expected.map { it.first }, actual.map { it.first })
        for ((e, a) in expected.zip(actual)) {
            val (x, y, w, h) = listOf("x", "y", "w", "h").map { e.second[it]!!.jsonPrimitive.double.toFloat() }
            val r = a.second
            for ((what, want, got) in listOf(Triple("left", x, r.left.value), Triple("top", y, r.top.value),
                    Triple("width", w, r.right.value - r.left.value), Triple("height", h, r.bottom.value - r.top.value))) {
                assertEquals("$lang ${e.first} $what", want, got, 0.5f)
            }
        }
        // The darkest pixel of each button's text: #444 at 0.87 opacity over the button.
        val native = rule.onNodeWithTag(ROOT).captureToImage().asAndroidBitmap()
        val cordova = ImageIO.read(File(references, "$lang/analytics-popup.png"))
        for ((name, rect) in actual.filter { it.first.startsWith("button") }) {
            val darkestNative = darkest(rect) { px, py -> native.getPixel(px, py) }
            val darkestCordova = darkest(rect) { px, py -> cordova.getRGB(px, py) }
            assertTrue("$lang $name darkest text $darkestNative, Cordova $darkestCordova", kotlin.math.abs(darkestNative - darkestCordova) <= 10)
        }
    }

    /** The smallest channel value inside [rect] (dp, at density 2). */
    private fun darkest(rect: DpRect, pixel: (Int, Int) -> Int): Int {
        var min = 255
        for (py in (rect.top.value * 2).toInt() until (rect.bottom.value * 2).toInt()) {
            for (px in (rect.left.value * 2).toInt() until (rect.right.value * 2).toInt()) {
                val c = pixel(px, py)
                min = minOf(min, (c shr 16) and 0xFF, (c shr 8) and 0xFF, c and 0xFF)
            }
        }
        return min
    }

    private companion object {
        const val ROOT = "privacy-geometry-root"
    }
}
