package net.wizardfactory.todayweather.widget

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import net.wizardfactory.todayweather.MainActivity
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 34])
class WidgetOptionsTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val home = Place(false, false, name = "Home", address = "Same street")
    private val work = home.copy(name = "Office")
    private val current = Place(true, false, location = Location(37.5, 127.0))

    @Test fun settingsAreIndependentAndRemovalAffectsOnlyThatInstance() {
        val weather = WidgetOptions(WidgetOptions.key(home), yesterday = true, style = WidgetStyle.PAPER)
        val forecast = WidgetOptions(WidgetOptions.key(work), daily = true, style = WidgetStyle.BLUE)
        WidgetOptions.save(context, 9, weather)
        WidgetOptions.save(context, 17, forecast)
        assertEquals(weather, WidgetOptions.read(context, 9))
        assertEquals(forecast, WidgetOptions.read(context, 17))
        WidgetOptions.remove(context, 9)
        assertEquals(WidgetOptions(), WidgetOptions.read(context, 9))
        assertEquals(forecast, WidgetOptions.read(context, 17))
    }

    @Test fun oldWidgetsStartAutomaticAndManualModeBelongsOnlyToItsInstance() {
        val prefs = context.getSharedPreferences("widget_options", Context.MODE_PRIVATE)
        prefs.edit().putString("style_4", WidgetStyle.BLUE.name).commit()
        val old = WidgetOptions.read(context, 4)
        assertEquals(WidgetStyle.BLUE, old.style)
        assertEquals(false, old.manualRefresh)
        WidgetOptions.save(context, 4, old.copy(manualRefresh = true))
        assertEquals(true, WidgetOptions.read(context, 4).manualRefresh)
        assertEquals(false, WidgetOptions.read(context, 5).manualRefresh)
        WidgetOptions.remove(context, 4)
        assertEquals(false, WidgetOptions.read(context, 4).manualRefresh)
    }

    @Test fun pinnedLocationSurvivesReorderAndGeocodeFillButDoesNotFallBackAfterDeletion() {
        val options = WidgetOptions(WidgetOptions.key(home))
        val filled = home.copy(location = Location(37.5, 126.9))
        val reordered = AppState(places = listOf(work, filled), placeIndex = 0)
        assertNotEquals(WidgetOptions.key(work), options.placeKey)
        assertEquals(filled, WidgetOptions.resolve(reordered, options.placeKey))
        assertEquals(work, WidgetOptions.resolve(reordered, null))
        assertNull(WidgetOptions.resolve(reordered.copy(places = listOf(work)), options.placeKey))
        assertNull(WidgetOptions.resolve(reordered.copy(places = listOf(work, filled.copy(disable = true))), options.placeKey))
    }

    @Test fun currentPositionKeyIsIndependentOfMovementAndIntentCarriesTheStableSelection() {
        val moved = current.copy(location = Location(35.1, 129.0), name = "Busan", address = "A new street")
        assertEquals(WidgetOptions.key(current), WidgetOptions.key(moved))
        val intent = WidgetOptions.openIntent(context, WidgetOptions.key(home))
        assertEquals(MainActivity::class.java.name, intent.component?.className)
        assertEquals(WidgetOptions.OPEN, intent.action)
        assertEquals(WidgetOptions.key(home), intent.getStringExtra(WidgetOptions.PLACE_KEY))
    }
}
