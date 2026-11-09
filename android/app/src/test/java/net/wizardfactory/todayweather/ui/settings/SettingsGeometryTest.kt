package net.wizardfactory.todayweather.ui.settings

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import java.io.File
import kotlin.math.abs
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.settings.About
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Settings
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.shell.IonicAlert
import net.wizardfactory.todayweather.ui.shell.PopupTags
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Where the settings pages put their rows and the check mark, against the rects the capture recorded on the Cordova
 * build (settings-reference/ko-KR/<state>.json), within half a dp: each row's top and height (its top border included,
 * the next row's shared), and the check mark's line inside the `.radio-icon` box and its 14 px padding. A glyph a few
 * dp off changes too few pixels for the page comparison (SettingsScreenshotTest); this test sees it.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class SettingsGeometryTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val references = File(System.getProperty("tw.projectDir")!!, "src/test/resources/settings-reference/ko-KR")
    private var route by mutableStateOf("")

    @Test fun units() = rows("units", SettingsRoutes.UNITS)
    @Test fun windSpeedList() = rows("radio-windSpeedUnit", SettingsRoutes.list("windSpeedUnit"))
    @Test fun refreshIntervalList() = rows("radio-refreshInterval", SettingsRoutes.list("refreshInterval"))
    @Test fun themeList() = rows("radio-theme", SettingsRoutes.list("theme"))

    private fun rows(state: String, to: String) {
        val record = Json.parseToJsonElement(File(references, "$state.json").readText()).jsonObject
        route = to
        rule.setContent {
            val texts = forecastTexts(LocalContext.current)
            Box(Modifier.size(384.dp, 762.dp)) {
                SettingsScreen(route, AppState(units = UnitSettings.defaults("KR"), settings = Settings()), Theme.LIGHT, texts, {}, {}, { _, _ -> })
            }
        }
        rule.waitForIdle()
        val density = rule.activity.resources.displayMetrics.density
        val items = record["items"]!!.jsonArray.map { it.jsonObject }
        items.forEachIndexed { i, item ->
            val bounds = rule.onNodeWithTag(SettingsTags.row(i)).fetchSemanticsNode().boundsInRoot
            val rect = item["rect"]!!.jsonObject
            near(rect.num("y"), bounds.top / density, "$state row $i top")
            // The native row is its top border and its box; the Cordova item also counts the bottom border it shares.
            near(rect.num("h"), bounds.height / density + 1, "$state row $i height")
            val check = item["check"] as? JsonObject ?: return@forEachIndexed
            if (check["visibility"]!!.jsonPrimitive.content != "visible") return@forEachIndexed
            val mark = rule.onNodeWithTag(SettingsTags.CHECK, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            val box = check["rect"]!!.jsonObject
            near(box.num("y") + 14, mark.top / density, "$state check top")
            near(box.num("x") + box.num("w") - 14, mark.right / density, "$state check right")
            near(box.num("w") - 28, mark.width / density, "$state check width")
        }
        assertEquals(1, record["items"]!!.jsonArray.count { (it.jsonObject["check"] as? JsonObject)?.get("visibility")?.jsonPrimitive?.content == "visible" }
            .let { if (to == SettingsRoutes.UNITS) 1 else it })
    }

    @Test fun aboutPopup() = popup("ko-KR")

    @Config(qualifiers = "en-rUS-w384dp-h832dp-xhdpi")
    @Test fun aboutPopupEnglish() = popup("en-US")

    /** The About popup's box and its head, body and buttons, against the parts the capture recorded (about.json). */
    private fun popup(lang: String) {
        val record = Json.parseToJsonElement(File(references.parentFile, "$lang/about.json").readText()).jsonObject
        rule.setContent {
            val texts = forecastTexts(LocalContext.current)
            Box(Modifier.size(384.dp, 762.dp)) {
                About { texts[it] }.let { a -> IonicAlert(a.title, a.lines, a.ok, onClose = {}) }
            }
        }
        rule.waitForIdle()
        val density = rule.activity.resources.displayMetrics.density
        val popup = rule.onNodeWithTag(PopupTags.POPUP).fetchSemanticsNode().boundsInRoot
        val box = record["popup"]!!.jsonObject["rect"]!!.jsonObject
        near(box.num("x"), popup.left / density, "$lang popup left")
        near(box.num("y"), popup.top / density, "$lang popup top")
        near(box.num("w"), popup.width / density, "$lang popup width")
        near(box.num("h"), popup.height / density, "$lang popup height")
        val parts = record["parts"]!!.jsonArray.map { it.jsonObject }
        fun part(cls: String) = parts.first { it["cls"]!!.jsonPrimitive.content == cls }["rect"]!!.jsonObject
        val button = rule.onNodeWithTag(PopupTags.BUTTON).fetchSemanticsNode().boundsInRoot
        val buttonRect = part("button button-positive")
        near(buttonRect.num("y"), button.top / density, "$lang button top")
        near(buttonRect.num("h"), button.height / density, "$lang button height")
        // The body under the head (its 1 dp line included), then the buttons' 10 dp padding.
        val body = part("popup-body")
        val nativeBody = rule.onNodeWithTag(PopupTags.BODY).fetchSemanticsNode().boundsInRoot
        near(body.num("y"), nativeBody.top / density, "$lang body top")
        near(body.num("h"), nativeBody.height / density, "$lang body height")
        near(body.num("y") + body.num("h"), button.top / density - 10, "$lang body bottom")
    }

    private fun near(expected: Double, actual: Float, what: String) {
        if (abs(expected - actual) > 0.5) throw AssertionError("$what: Cordova $expected dp, native $actual dp")
    }

    private fun JsonObject.num(k: String) = this[k]!!.jsonPrimitive.double
}
