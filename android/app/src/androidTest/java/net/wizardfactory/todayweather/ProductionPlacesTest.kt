package net.wizardfactory.todayweather

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeRight
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.forecast.ForecastTags
import net.wizardfactory.todayweather.ui.places.PlacesTags
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith

/**
 * S02 against the production server (#2890 AC2), run by tools/emulator/run-production-places.sh on an emulator: with
 * 서울 saved, 부산 is searched and its town added, London is searched and its Places prediction added (a bundled town
 * without the build's key: 런던 is none, so the key is required), the header is swiped back to 부산광역시, and London is
 * deleted in edit mode. Weather and geocode requests are read-only GETs; push requests are recorded by the test app. The
 * screens are captured to the app's files (places/).
 */
@RunWith(AndroidJUnit4::class)
class ProductionPlacesTest {
    val rule = createAndroidComposeRule<MainActivity>()

    private val seoul = Place(false, false, "서울", "대한민국 서울특별시", "KR", Location(37.567, 126.978))

    @get:Rule val chain: RuleChain = RuleChain.outerRule(StateRule {
        it.copy(places = listOf(Place.currentPositionPlaceholder(), seoul), placeIndex = 1, units = UnitSettings.defaults("KR"))
    }).around(rule)

    private val app get() = rule.activity.application as TestTodayWeatherApp

    @Test
    fun busanAndLondonAreAddedSwitchedAndOneDeleted() {
        assumeTrue("needs -e weather production", TestRunner.args.getString("weather") == "production")
        assumeTrue("needs the build's Places key", BuildConfig.PLACES_API_KEY.isNotBlank())
        rule.waitUntil(30_000) { app.appState.current() != null }
        add("부산", PlacesTags.town(0))
        val busan = app.appState.current()!!.places.last()
        assertEquals("부산광역시", busan.name)
        shows(busan)
        capture("busan")
        add("London", PlacesTags.prediction(0))
        val london = app.appState.current()!!.places.last()
        assertEquals("London", london.name)
        shows(london)
        capture("london")
        // A swipe right on the header: the previous place.
        rule.onNodeWithTag(ForecastTags.HEADER).performTouchInput { swipeRight(durationMillis = 100) }
        rule.waitForIdle()
        assertEquals(2, app.appState.current()!!.placeIndex)
        capture("swiped")
        // Edit mode: London's ⊗.
        rule.onNodeWithTag(ShellTags.tab(Tab.LOCATIONS)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(PlacesTags.MODE).performClick()
        rule.waitForIdle()
        capture("edit")
        rule.onNodeWithTag(PlacesTags.delete(3)).performClick()
        rule.waitForIdle()
        assertEquals(listOf(null, "서울", "부산광역시"), app.appState.current()!!.places.map { it.name })
        capture("deleted")
    }

    /** Types [word] into S02's search and chooses the result [tag]; a first tap with the keyboard up only closes it. */
    private fun add(word: String, tag: String) {
        rule.onNodeWithTag(ShellTags.tab(Tab.LOCATIONS)).performClick()
        rule.waitForIdle()
        val count = app.appState.current()!!.places.size
        rule.onNodeWithTag(PlacesTags.INPUT).performClick().performTextInput(word)
        rule.waitUntil(30_000) { rule.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty() }
        Espresso.closeSoftKeyboard()
        rule.waitForIdle()
        Thread.sleep(500)
        rule.onNodeWithTag(tag).performClick()
        rule.waitUntil(60_000) { app.appState.current()!!.places.size == count + 1 }
        rule.waitForIdle()
    }

    /** Hourly with [place] selected and its weather. */
    private fun shows(place: Place) {
        rule.waitUntil(60_000) { app.weather.weather.value.containsKey(WeatherRepository.key(place)) }
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.page(Tab.HOURLY)).assertExists()
        assertEquals(app.appState.current()!!.places.lastIndex, app.appState.current()!!.placeIndex)
    }

    private fun capture(name: String) {
        val dir = File(rule.activity.getExternalFilesDir(null), "places").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { rule.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
