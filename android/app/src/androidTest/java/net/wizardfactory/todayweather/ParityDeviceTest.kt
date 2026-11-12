package net.wizardfactory.todayweather

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.*
import net.wizardfactory.todayweather.ui.forecast.*
import net.wizardfactory.todayweather.ui.settings.SettingsTags
import net.wizardfactory.todayweather.ui.shell.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith

/** Real activity/navigation smoke with an offline weather cache; no production provider or push writes. */
@RunWith(AndroidJUnit4::class)
class ParityDeviceTest {
    private val rule = createAndroidComposeRule<MainActivity>()
    @get:Rule val chain: RuleChain = RuleChain.outerRule(StateRule { AppState().afterStart() }).around(rule)
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val app get() = rule.activity.application as TestTodayWeatherApp
    private val dir get() = File(app.filesDir, "parity-smoke").apply { mkdirs() }

    private fun capture(name: String) {
        rule.waitForIdle()
        instrumentation.uiAutomation.takeScreenshot()!!.let { bitmap ->
            File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }

    private fun closeRetry() {
        rule.waitUntil(30_000) { app.weather.loading.value.isEmpty() }
        rule.waitForIdle()
        if (rule.onAllNodesWithTag(RETRY_DIALOG).fetchSemanticsNodes().isNotEmpty()) {
            capture("retry")
            rule.onNode(hasText(rule.activity.getString(R.string.LOC_CLOSE)) and hasAnyAncestor(hasTestTag(RETRY_DIALOG))).performClick()
            rule.onNodeWithTag(RETRY_DIALOG).assertDoesNotExist()
        }
    }

    @Test fun themesAndNativePopupsRemainOperable() {
        rule.closeStartChoice()
        val place = Place(false, false, "서울", "대한민국 서울특별시 중구", "KR", Location(37.56, 126.98))
        val raw = instrumentation.context.assets.open("corpus/inputs/kma-seoul.json").bufferedReader().use { it.readText() }
        val body = Json.parseToJsonElement(raw).jsonObject.let { weather ->
            val mid = weather["midData"]!!.jsonObject
            val days = mid["dailyData"]!!.jsonArray.map { day -> JsonObject(day.jsonObject + mapOf(
                "pollenGrade" to JsonPrimitive(2), "pollenStr" to JsonPrimitive("높음"),
                "flowerPineGrade" to JsonPrimitive(2), "flowerPineStr" to JsonPrimitive("높음"))) }
            JsonObject(weather + ("midData" to JsonObject(mid + ("dailyData" to JsonArray(days))))).toString()
        }
        runBlocking {
            WeatherRepository("https://fixture.invalid", File(app.filesDir, "weather"), HttpGet { _, _ -> body })
                .load(place, UnitSettings.defaults("KR"), listOf("ko-KR"), true)
            app.weather.cached(place)
            app.appState.dataStore.updateData { it.copy(places = listOf(place), placeIndex = 0, units = UnitSettings.defaults("KR")) }
        }
        rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).performClick()
        closeRetry()
        rule.onNodeWithTag(ForecastTags.HEADER).assertExists()
        rule.onNodeWithTag(ForecastTags.POLLEN).performScrollTo().performClick()
        rule.onNodeWithTag(WeatherTabTags.POLLEN_DIALOG).assertExists()
        capture("pollen")
        rule.onNodeWithText(rule.activity.getString(R.string.LOC_POLLEN_SOURCE)).performScrollTo().assertIsDisplayed()
        capture("pollen-source")
        rule.onNodeWithTag(PopupTags.BUTTON).performClick()
        rule.onNodeWithTag(WeatherTabTags.POLLEN_DIALOG).assertDoesNotExist()
        rule.onNodeWithText("AIRKOREA ", substring = true, useUnmergedTree = true).performScrollTo().performClick()
        rule.onNodeWithTag(WeatherTabTags.SOURCE_DIALOG).assertExists()
        capture("source")
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.onNodeWithTag(WeatherTabTags.SOURCE_DIALOG).assertDoesNotExist()

        for ((theme, index) in listOf("dark" to 2, "old" to 3, "photo" to 0, "light" to 1)) {
            rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
            rule.onNodeWithTag(ShellTags.row(MenuRow.THEME)).performScrollTo().performClick()
            rule.onNodeWithTag(SettingsTags.row(index)).performScrollTo().performClick()
            rule.waitUntil(10_000) { app.appState.state.value?.settings?.theme == theme }
            closeRetry()
            // Selecting a radio value keeps S08 open, as in the original app.
            rule.onNodeWithTag(SettingsTags.BACK).performClick()
            rule.onNodeWithTag(SettingsTags.PAGE).assertDoesNotExist()
            rule.onNodeWithTag(ForecastTags.block(1)).performScrollTo()
            capture("$theme-hourly")
            rule.onNodeWithTag(ShellTags.tab(Tab.DAILY)).performClick()
            closeRetry()
            rule.onNodeWithTag(ForecastTags.block(1)).performScrollTo()
            capture("$theme-daily")
            rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).performClick()
            closeRetry()
        }
        // Use the production refresh route with the offline host to exercise retry -> close.
        app.weather.invalidate(place)
        // The production double-tap guard uses elapsed wall time, not Compose's animation clock.
        Thread.sleep(800)
        rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).performClick()
        rule.waitUntil(30_000) { rule.onAllNodesWithTag(RETRY_DIALOG).fetchSemanticsNodes().isNotEmpty() }
        closeRetry()
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.onNodeWithTag(PopupTags.POPUP).assertExists()
        capture("exit")
        rule.onAllNodesWithTag(PopupTags.BUTTON)[0].performClick()
        rule.onNodeWithTag(PopupTags.POPUP).assertDoesNotExist()
        assertFalse("cancel keeps the activity open", rule.activity.isFinishing)
        assertEquals(listOf(place), app.appState.state.value!!.places)
        File(dir, "result.txt").writeText("themes dark/old/photo/light saved; pollen/source/retry/exit callbacks passed; offline fixture only\n")
    }
}
