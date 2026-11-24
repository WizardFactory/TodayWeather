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
 * A place opened without saving it, by a search result or a `link.todayweather.ai` link (#3180, specs/deeplink.md
 * §6.2): shown and loaded as the last place of the list, never written to the saved places until its star adds it.
 * One such place is kept: it stays while the user moves to saved places and back, and goes when another replaces it
 * or the app starts again.
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

    /** #3180, AK's choice 2: a swipe to a saved place keeps the unsaved one, and a swipe back shows it again. */
    @Test
    fun movingToASavedPlaceKeepsTheUnsavedOneAndMovingBackSelectsIt() = runTest {
        val saved = Memory(started)
        val preview = LinkPreview(saved)
        preview.show(seoul)
        assertTrue(preview.selected.value)
        // A swipe, a widget link or a notification tap selects a saved place.
        preview.change { it.copy(placeIndex = 0) }
        assertEquals(seoul, preview.place.value, "it stays in the list")
        assertFalse(preview.selected.value)
        assertEquals(0, saved.value.placeIndex)
        assertEquals(started.places, saved.value.places)
        assertEquals(listOf(current, london, seoul), preview.current()!!.places)
        assertEquals(0, preview.current()!!.placeIndex)
        // What a screen draws from the collected flows equals what the session reads.
        assertEquals(preview.current(), LinkPreview.overlay(saved.value, preview.place.value, preview.selected.value))
        // A response for the saved place selected now is saved, and the unsaved place's own fields stay in memory.
        preview.change { s -> s.copy(places = s.places.mapIndexed { i, p -> if (i == 0) p.copy(photo = "a.jpg") else p }) }
        assertEquals("a.jpg", saved.value.places[0].photo)
        assertEquals(seoul, preview.place.value)
        // The swipe back: the last place of the list.
        preview.change { it.copy(placeIndex = 2) }
        assertTrue(preview.selected.value)
        assertEquals(2, preview.current()!!.placeIndex)
        assertEquals(0, saved.value.placeIndex, "the saved selection is the one before it")
    }

    @Test
    fun anotherPlaceReplacesTheUnsavedOneAndANewStartHasNone() = runTest {
        val saved = Memory(started)
        val preview = LinkPreview(saved)
        preview.show(seoul)
        preview.change { it.copy(placeIndex = 0) }
        val busan = Place(false, false, "부산", location = Location(35.179, 129.076))
        preview.show(busan)
        assertEquals(busan, preview.place.value, "one unsaved place: the new one replaces it")
        assertTrue(preview.selected.value)
        assertEquals(listOf(current, london, busan), preview.current()!!.places)
        assertEquals(started.places, saved.value.places)
        // The app started again: nothing was saved, so nothing is left.
        assertEquals(saved.value, LinkPreview(saved).current())
    }

    @Test
    fun clearingReturnsToTheSavedState() = runTest {
        val saved = Memory(started)
        val preview = LinkPreview(saved)
        preview.show(seoul)
        preview.clear()
        assertEquals(started, preview.current())
        assertEquals(started, saved.value)
        assertFalse(preview.selected.value)
    }

    /** The star on a saved place does nothing; on the unsaved place moved away from, nothing either. */
    @Test
    fun addAppliesOnlyWhileTheUnsavedPlaceIsSelected() = runTest {
        val saved = Memory(started)
        val preview = LinkPreview(saved)
        preview.show(seoul)
        preview.change { it.copy(placeIndex = 1) }
        assertNull(preview.add())
        assertEquals(started, saved.value)
        assertEquals(seoul, preview.place.value)
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

    /** CODEX-3164-4: an add matches a saved place by its coordinates, not by a name without an address. */
    @Test
    fun addingAPlaceWithTheNameOfAFarPlaceAddsIt() = runTest {
        val home = Place(false, false, "Home", location = Location(10.0, 20.0))
        val saved = Memory(started.copy(places = started.places + home, placeIndex = 0))
        val preview = LinkPreview(saved)
        val other = Place(false, false, "Home", location = Location(40.0, 50.0))
        preview.show(other)
        assertEquals(3, preview.add())
        assertEquals(listOf(current, london, home, other), saved.value.places)
        // Within 0.01°, the saved place is selected instead.
        preview.show(Place(false, false, "Home 2", location = Location(10.004, 20.004)))
        assertEquals(2, preview.add())
        assertEquals(4, saved.value.places.size)
    }
}
