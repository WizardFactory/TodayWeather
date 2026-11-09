package net.wizardfactory.todayweather.core.storage

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonPrimitive

/** WeatherInfo's `getIndexOfCity`, `addCity` and `disableCity`, and StartCtrl's gate and `close()` (AN-10). */
class PlaceListTest {
    private val placeholder = Place.currentPositionPlaceholder()
    private val seoul = Place(false, false, "서울", "대한민국 서울특별시", "KR", Location(37.567, 126.978))
    private val fresh = AppState(places = listOf(placeholder), placeIndex = -1)

    @Test
    fun aPlaceMatchesBySameAddressAndName() {
        val places = listOf(placeholder, seoul)
        assertEquals(1, PlaceList.indexOf(places, seoul.copy(location = Location(1.0, 2.0))))
        assertEquals(-1, PlaceList.indexOf(places, seoul.copy(name = "Seoul")))
        assertEquals(-1, PlaceList.indexOf(places, seoul.copy(address = "서울")))
        // Neither named: the address alone.
        assertEquals(1, PlaceList.indexOf(listOf(placeholder, seoul.copy(name = null)), seoul.copy(name = "")))
        // The current position matches only the current position.
        assertEquals(0, PlaceList.indexOf(places, Place(currentPosition = true, disable = false)))
        assertEquals(-1, PlaceList.indexOf(listOf(placeholder), Place(false, false, null, null)))
    }

    @Test
    fun addAppendsAnEnabledPlaceUnlessOneMatches() {
        val added = PlaceList.add(fresh, seoul.copy(disable = true))!!
        assertEquals(listOf(placeholder, seoul), added.places)
        assertNull(PlaceList.add(added, seoul), "already added")
        assertEquals(-1, added.placeIndex, "the index is S01's close to set")
    }

    @Test
    fun enablingTheCurrentPositionSelectsItWhileTheIndexIsAtMostZero() {
        val enabled = PlaceList.disableCurrent(fresh, false)
        assertFalse(enabled.places[0].disable)
        assertEquals(0, enabled.placeIndex)
        // Disabled again with a saved place: the first enabled one.
        val withSeoul = PlaceList.add(enabled, seoul)!!
        assertEquals(1, PlaceList.disableCurrent(withSeoul, true).placeIndex)
        // An index above 0 stays.
        assertEquals(1, PlaceList.disableCurrent(withSeoul.copy(placeIndex = 1), false).placeIndex)
    }

    @Test
    fun theStartPageShowsUntilItCloses() {
        assertTrue(fresh.startShows)
        assertTrue(fresh.copy(cordovaExtras = mapOf("startVersion" to JsonPrimitive("0.5"))).startShows)
        val closed = PlaceList.add(fresh, seoul)!!.closeStart()
        assertFalse(closed.startShows)
        assertEquals(JsonPrimitive(1), closed.cordovaExtras["startVersion"])
        assertEquals(1, closed.placeIndex, "the last place")
        assertEquals(0, PlaceList.disableCurrent(fresh, false).closeStart().placeIndex, "a new install's current position")
    }
}
