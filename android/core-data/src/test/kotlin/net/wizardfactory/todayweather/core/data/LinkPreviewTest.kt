package net.wizardfactory.todayweather.core.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.startShows

/**
 * A place a `link.todayweather.ai` link opened without saving it (specs/deeplink.md §6.2): shown and loaded as the
 * selected place, never written to the saved places until Add to favorites.
 */
class LinkPreviewTest {
    private class Memory(value: AppState) : StateAccess {
        val flow = MutableStateFlow<AppState?>(value)
        val value get() = flow.value!!
        override fun current() = flow.value
        override fun change(update: (AppState) -> AppState) { flow.value = update(value) }
    }

    private val current = Place(currentPosition = true, disable = false, name = "현재 위치", location = Location(37.38, 127.12))
    private val london = Place(currentPosition = false, disable = false, name = "런던", address = "영국 런던", location = Location(51.51, -0.13))
    private val seoul = Place(currentPosition = false, disable = false, name = "서울", address = "서울특별시 중구", country = "KR",
        location = Location(37.567, 126.978))
    private val started = AppState(places = listOf(current, london), placeIndex = 1,
        cordovaExtras = mapOf("startVersion" to JsonPrimitive(1)))

    @Test
    fun aPreviewIsShownSelectedButNeverSaved() = runTest {
        val saved = Memory(started)
        val preview = LinkPreview(saved)
        preview.show(seoul)
        val shown = preview.current()!!
        assertEquals(listOf(current, london, seoul), shown.places)
        assertEquals(2, shown.placeIndex)
        assertEquals(started, saved.value, "nothing saved")
        assertEquals(shown, preview.overlay(saved.value))
        assertTrue(preview.isPreview(2))
        assertFalse(preview.isPreview(1))
    }

    @Test
    fun aResponseForThePreviewStaysInMemoryWhileOtherChangesAreSaved() = runTest {
        val saved = Memory(started)
        val preview = LinkPreview(saved)
        preview.show(seoul)
        // WeatherSession.save: every place with the response's key gets its source and photo.
        preview.change { s -> s.copy(places = s.places.map { if (it.name == "서울") it.copy(source = "KMA", photo = "p.jpg") else it.copy(photo = "q.jpg") }) }
        assertEquals("KMA", preview.place.value?.source)
        assertEquals("p.jpg", preview.current()!!.places[2].photo)
        assertEquals(listOf(current.copy(photo = "q.jpg"), london.copy(photo = "q.jpg")), saved.value.places)
        assertEquals(1, saved.value.placeIndex, "the saved selection stays for the return")
    }

    @Test
    fun selectingASavedPlaceEndsThePreview() = runTest {
        val saved = Memory(started)
        val preview = LinkPreview(saved)
        preview.show(seoul)
        // A swipe, a widget link or a notification tap selects a saved place.
        preview.change { it.copy(placeIndex = 0) }
        assertNull(preview.place.value)
        assertEquals(0, saved.value.placeIndex)
        assertEquals(started.places, saved.value.places)
        assertEquals(saved.value, preview.current())
    }

    @Test
    fun clearingReturnsToTheSavedState() = runTest {
        val saved = Memory(started)
        val preview = LinkPreview(saved)
        preview.show(seoul)
        preview.clear()
        assertEquals(started, preview.current())
        assertEquals(started, saved.value)
    }

    @Test
    fun addSavesThePreviewAsAPlaceAndSelectsIt() = runTest {
        val saved = Memory(started)
        val preview = LinkPreview(saved)
        preview.show(seoul.copy(source = "KMA"))
        assertEquals(2, preview.add())
        assertEquals(listOf(current, london, seoul.copy(source = "KMA")), saved.value.places)
        assertEquals(2, saved.value.placeIndex)
        assertNull(preview.place.value)
        assertEquals(saved.value, preview.current())
        assertNull(preview.add(), "nothing to add")
    }

    @Test
    fun addingAPlaceAlreadySavedSelectsIt() = runTest {
        val saved = Memory(started.copy(places = listOf(current, london, seoul), placeIndex = 0))
        val preview = LinkPreview(saved)
        preview.show(seoul)
        assertEquals(2, preview.add())
        assertEquals(listOf(current, london, seoul), saved.value.places)
        assertEquals(2, saved.value.placeIndex)
    }

    @Test
    fun onTheStartPageAPreviewShowsWithoutClosingItAndAddClosesItAsAFirstPlace() = runTest {
        val fresh = AppState()
        assertTrue(fresh.startShows)
        val saved = Memory(fresh)
        val preview = LinkPreview(saved)
        preview.show(seoul)
        assertTrue(preview.bypassesStart(preview.current()!!), "the tabs show over S01 while the preview does")
        assertTrue(saved.value.startShows, "S01 stays pending")
        assertEquals(listOf(Place.currentPositionPlaceholder()), saved.value.places)
        preview.clear()
        assertFalse(preview.bypassesStart(preview.current()!!), "leaving the preview returns to S01")
        preview.show(seoul)
        assertEquals(1, preview.add())
        assertFalse(saved.value.startShows, "the first place closed S01 (closeStart)")
        assertEquals(listOf(Place.currentPositionPlaceholder(), seoul), saved.value.places)
        assertEquals(1, saved.value.placeIndex)
    }

    @Test
    fun aDisabledPlaceIsShownEnabled() = runTest {
        val saved = Memory(started)
        val preview = LinkPreview(saved)
        preview.show(seoul.copy(disable = true))
        assertEquals(seoul, preview.current()!!.places.last())
    }
}
