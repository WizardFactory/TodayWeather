package net.wizardfactory.todayweather

import android.graphics.Bitmap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import net.wizardfactory.todayweather.core.data.NationSource
import net.wizardfactory.todayweather.core.data.PageLoad
import net.wizardfactory.todayweather.core.domain.Nationwide
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.nation.NationLoads
import net.wizardfactory.todayweather.ui.nation.NationPageState
import net.wizardfactory.todayweather.ui.nation.NationRoutes
import net.wizardfactory.todayweather.ui.nation.NationTags
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * S10, S11 and S12 against the production server (#2892 AC2), run by tools/emulator/run-production-weather.sh with
 * `weather` `production` and the app's language set to ko-KR (the rows show for region KR):
 * - 전국날씨: in each of its three modes, most cities show values;
 * - 전국미세먼지: in each of its six tabs, most provinces show a value;
 * - 기상특보: each card shows the whole heading (name and announcement time) of the answer the page loaded, and a
 *   second read of the endpoint here is a list of as many bulletins.
 * Each state is captured to the app's files (ac2/). The requests are read-only GETs; push requests are recorded by the
 * test app, not sent.
 */
@RunWith(AndroidJUnit4::class)
class ProductionNationTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    private val app get() = rule.activity.application as TestTodayWeatherApp
    private val seoul = Place(false, false, "서울", "대한민국 서울특별시 중구", "KR", Location(37.56, 126.98))

    @Test
    fun theNationwidePagesAndTheWarningsRenderFromProduction() {
        assumeTrue("needs -e weather production", TestRunner.args.getString("weather") == "production")
        rule.waitUntil(30_000) { app.appState.current() != null }
        rule.runOnUiThread { app.appState.change { it.copy(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1, units = UnitSettings.defaults("KR")) } }
        rule.waitForIdle()

        open(MenuRow.NATIONAL_WEATHER)
        for (mode in 0..2) {
            if (mode > 0) rule.onNodeWithTag(NationTags.mode(mode)).performClick()
            val shown = valued(Nationwide.WEATHER_CITIES.map { it.name }, lines = if (mode == 2) 3 else 2)
            capture("nation-mode-$mode")
            assertTrue("mode $mode: cities with values $shown", shown.size >= 12)
        }
        back()

        open(MenuRow.NATIONAL_AIR)
        for (type in Nationwide.AIR_TYPES) {
            // CO is past the strip's end: a swipe brings it in, as a user does. (The first tab starts 1 dp left of the
            // window, so it can never be scrolled wholly into view.)
            if (type == "co") rule.onNodeWithTag(NationTags.STRIP).performTouchInput { swipeLeft() }
            rule.onNodeWithTag(NationTags.tab(type)).performClick()
            val shown = valued(Nationwide.AIR_CITIES.map { it.name }, lines = 2)
            capture("nation-air-$type")
            assertTrue("$type: provinces with values $shown", shown.size >= 14)
        }
        back()

        // The page's own answer: each of its cards shows the bulletin's whole heading, name and announcement time, on
        // its first lines.
        open(MenuRow.SPECIAL_WEATHER)
        var opened: NationLoads? = null
        rule.runOnUiThread { opened = ViewModelProvider(rule.activity)[OpenedModel::class.java].nation }
        val loads = opened!!
        rule.waitUntil(10_000) { loads.pages.value[NationRoutes.WARNINGS] is NationPageState.Warnings }
        rule.waitForIdle()
        val cards = (loads.pages.value[NationRoutes.WARNINGS] as NationPageState.Warnings).cards
        capture("warnings")
        cards.forEachIndexed { i, card ->
            val heading = card.heading.filterNot(Char::isWhitespace)
            val texts = rule.onAllNodes(hasAnyAncestor(hasTestTag(NationTags.card(i))) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Text),
                useUnmergedTree = true).fetchSemanticsNodes().map { n -> n.config[SemanticsProperties.Text].joinToString("") { it.text }.filterNot(Char::isWhitespace) }
            val shown = buildString { for (t in texts) if (length < heading.length) append(t) }
            assertEquals("card $i", heading, shown)
        }
        assertEquals(cards.size, (0 until 20).count { rule.onAllNodesWithTag(NationTags.card(it)).fetchSemanticsNodes().isNotEmpty() })
        // A second read of the endpoint: a list of as many bulletins (unless one is published in between).
        val answer = runBlocking { NationSource(BuildConfig.SERVER_URL).special(listOf("ko-KR")) }
        assertEquals("the warnings answer: $answer", cards.size, ((answer as? PageLoad.Loaded)?.value as? JsonArray)?.size)
        back()
    }

    /** The menu's [row]: it closes the menu and opens its page, whose request is answered within 30 s. */
    private fun open(row: MenuRow) {
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.row(row)).performScrollTo().performClick()
        rule.waitUntil(30_000) { rule.onAllNodesWithTag(NationTags.LOADING).fetchSemanticsNodes().isEmpty() }
        rule.waitForIdle()
    }

    private fun back() {
        rule.onNodeWithTag(NationTags.BACK).performClick()
        rule.waitForIdle()
    }

    /** The names of the labels with at least [lines] texts (the name and its values). */
    private fun valued(names: List<String>, lines: Int): List<String> {
        rule.waitForIdle()
        return names.filter { name ->
            rule.onAllNodes(hasAnyAncestor(hasTestTag(NationTags.label(name))) and SemanticsMatcher.keyIsDefined(SemanticsProperties.Text),
                useUnmergedTree = true).fetchSemanticsNodes().size >= lines
        }
    }

    private fun capture(name: String) {
        rule.waitForIdle()
        Thread.sleep(500)
        val shot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return
        val dir = File(rule.activity.getExternalFilesDir(null), "ac2").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { shot.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
