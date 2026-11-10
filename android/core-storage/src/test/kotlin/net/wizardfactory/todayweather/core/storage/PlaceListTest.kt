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

    /** `removeCity` (AN-11): the selection resets only when it equals the new count, to the first enabled place. */
    @Test
    fun aRemovedPlaceKeepsTheSelectedNumberUnlessItWasTheLast() {
        val a = seoul.copy(name = "A", address = "a")
        val b = seoul.copy(name = "B", address = "b")
        val c = seoul.copy(name = "C", address = "c")
        val four = AppState(places = listOf(placeholder, a, b, c), placeIndex = 3)
        // The selected last place: the first enabled one, not the previous one.
        assertEquals(1, PlaceList.remove(four, 3).placeIndex)
        // An earlier place: the same number, now the next place.
        val earlier = PlaceList.remove(four.copy(placeIndex = 2), 1)
        assertEquals(listOf(placeholder, b, c), earlier.places)
        assertEquals(2, earlier.placeIndex)
        assertEquals(1, PlaceList.remove(four.copy(placeIndex = 1), 3).placeIndex)
        // The last favorite with slot 0 off: no enabled place, the index stays (out of range).
        assertEquals(1, PlaceList.remove(AppState(places = listOf(placeholder, a), placeIndex = 1), 1).placeIndex)
        // With slot 0 on, the first enabled place is slot 0.
        assertEquals(0, PlaceList.remove(four.copy(places = listOf(placeholder.copy(disable = false), a, b, c)), 3).placeIndex)
        assertEquals(four, PlaceList.remove(four, 9))
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
