package net.wizardfactory.todayweather.core.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.domain.share.DeepLinkTarget
import net.wizardfactory.todayweather.core.domain.share.WeatherView
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place

/**
 * A link that arrived (cold or warm start) applied as specs/deeplink.md §6.2 says: a saved place selected and loaded, a
 * preview shown and loaded, a page or the app as it is; the screens then get one request per link.
 */
class LinkOpenerTest {
    private class Memory(value: AppState?) : StateAccess {
        val flow = MutableStateFlow(value)
        override fun current() = flow.value
        override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value!!) }
    }

    private val london = Place(currentPosition = false, disable = false, name = "런던", address = "영국 런던", location = Location(51.507, -0.128))
    private val closed = mapOf("startVersion" to JsonPrimitive(1))
    private val started = AppState(places = listOf(Place.currentPositionPlaceholder(), london), placeIndex = 1, cordovaExtras = closed)

    private class Setup(val saved: Memory, val preview: LinkPreview, val opener: LinkOpener, val calls: MutableList<String>)

    private fun setup(state: AppState?): Setup {
        val saved = Memory(state)
        val preview = LinkPreview(saved)
        val calls = mutableListOf<String>()
        val opener = LinkOpener(saved.flow, preview, openPlace = { calls += "open $it" }, reload = { calls += "reload" },
            unblock = { calls += "unblock" })
        return Setup(saved, preview, opener, calls)
    }

    @Test
    fun aSavedPlaceNearbyIsSelectedAndLoaded() = runTest {
        val t = setup(started)
        t.preview.show(Place(false, false, "부산", location = Location(35.179, 129.076)))
        t.opener.open(DeepLinkTarget.Place("london", WeatherView.AIR, "pm10"))
        assertEquals("부산", t.preview.unsaved.value?.place?.name, "the unsaved place opened earlier stays in the list")
        assertEquals(listOf("unblock", "open 1"), t.calls)
        assertEquals(LinkRoute.Weather(WeatherView.AIR, "pm10", 1, null), t.opener.requests.value?.route)
    }

    @Test
    fun anUnsavedPlaceIsAPreviewThatLoads() = runTest {
        val t = setup(started)
        t.opener.open(DeepLinkTarget.Coordinate(37.383, 127.119, "분당구", WeatherView.DAILY, null))
        assertEquals("분당구", t.preview.unsaved.value?.place?.name)
        assertEquals(started, t.saved.flow.value, "nothing saved")
        assertEquals(listOf("unblock", "reload"), t.calls)
        assertEquals(WeatherView.DAILY, (t.opener.requests.value?.route as LinkRoute.Weather).view)
    }

    /** CODEX-3164-12: requests queue, so a link the screens have not applied yet is never replaced by the next. */
    @Test
    fun linksAreAppliedOneAtATimeInOrder() = runTest {
        val t = setup(started)
        t.opener.open(DeepLinkTarget.Coordinate(37.383, 127.119, "분당구", WeatherView.DAILY, null))
        val first = t.opener.requests.value!!
        t.opener.open(DeepLinkTarget.Open(null))
        t.opener.open(DeepLinkTarget.NationAir)
        assertEquals(first, t.opener.requests.value, "the Daily tab is still to be applied")
        t.opener.handled(first.id)
        val second = t.opener.requests.value!!
        assertEquals(LinkRoute.App, second.route)
        t.opener.handled(first.id)
        assertEquals(second, t.opener.requests.value, "an id already handled clears nothing")
        t.opener.handled(second.id)
        val third = t.opener.requests.value!!
        assertEquals(LinkRoute.Page(LinkPage.NATION_AIR), third.route)
        // The same link again applies again.
        t.opener.open(DeepLinkTarget.NationAir)
        t.opener.handled(third.id)
        val fourth = t.opener.requests.value!!
        assertEquals(LinkRoute.Page(LinkPage.NATION_AIR), fourth.route)
        assertEquals(true, fourth.id != third.id)
        t.opener.handled(fourth.id)
        assertNull(t.opener.requests.value)
    }

    /**
     * CODEX-3164-1: on S01 a place link previews at once; a page link or `/open` is ignored there (spec §6.2.3 "defer or
     * ignore") and never holds back the links after it; a saved place within 0.01° also previews, as S01 stays.
     */
    @Test
    fun onTheStartPageAPlaceLinkPreviewsAndNothingWaits() = runTest {
        val seoulSaved = Place(false, false, "중구", location = Location(37.567, 126.978))
        val t = setup(AppState(places = listOf(Place.currentPositionPlaceholder(), seoulSaved)))
        t.opener.open(DeepLinkTarget.Warnings)
        t.opener.open(DeepLinkTarget.Open(null))
        assertNull(t.opener.requests.value, "S01 stays")
        t.opener.open(DeepLinkTarget.Place("seoul", WeatherView.HOURLY, null))
        assertEquals("서울", t.preview.unsaved.value?.place?.name, "S01 is bypassed by a preview, also with a saved place nearby")
        assertEquals(listOf("unblock", "reload"), t.calls)
        assertEquals(LinkRoute.Weather(WeatherView.HOURLY, null, null, t.preview.unsaved.value?.place), t.opener.requests.value?.route)
    }

    /** CODEX-3164-7: `/open` changes no place but still asks the screens to close the menu and pages. */
    @Test
    fun openClosesThePagesAndUnknownCitiesChangeNothing() = runTest {
        val t = setup(started)
        t.opener.open(DeepLinkTarget.Open("ko"))
        assertEquals(LinkRoute.App, t.opener.requests.value?.route)
        t.opener.handled(t.opener.requests.value!!.id)
        t.opener.open(DeepLinkTarget.Place("not-in-catalog", WeatherView.DAILY, null))
        assertEquals(emptyList(), t.calls)
        assertNull(t.opener.requests.value)
        assertEquals(started, t.saved.flow.value)
    }

    @Test
    fun aLinkBeforeTheStateIsReadWaitsForIt() = runTest {
        val t = setup(null)
        val link = launch { t.opener.open(DeepLinkTarget.Place("london", WeatherView.HOURLY, null)) }
        runCurrent()
        assertEquals(emptyList(), t.calls)
        t.saved.flow.value = started
        link.join()
        assertEquals(listOf("unblock", "open 1"), t.calls)
    }

    /**
     * #3180: a place chosen in the search shows without being saved, or selects the saved place within 0.01°. The
     * search loads it and chooses the tab, so there is no reload here and no request for the screens.
     */
    @Test
    fun aSearchResultShowsUnsavedOrSelectsTheSavedPlaceNearby() = runTest {
        val t = setup(started)
        t.opener.show(Place(false, false, "부산광역시", "부산광역시", "KR", Location(35.18, 129.08)))
        assertEquals("부산광역시", t.preview.unsaved.value?.place?.name)
        assertEquals(started, t.saved.flow.value, "nothing saved")
        t.saved.change { it.copy(placeIndex = 0) }
        t.opener.show(Place(false, false, "London", "London, UK", "GB", Location(51.51, -0.13)))
        assertEquals("부산광역시", t.preview.unsaved.value?.place?.name, "the saved London is selected; the unsaved place stays")
        assertEquals(false, (t.preview.unsaved.value?.selected == true))
        assertEquals(1, t.saved.flow.value!!.placeIndex)
        // Another result replaces the unsaved place.
        t.opener.show(Place(false, false, "대구광역시", "대구광역시", "KR", Location(35.87, 128.6)))
        assertEquals("대구광역시", t.preview.unsaved.value?.place?.name)
        assertEquals(true, (t.preview.unsaved.value?.selected == true))
        assertEquals(started.places, t.saved.flow.value!!.places)
        assertEquals(emptyList(), t.calls)
        assertNull(t.opener.requests.value)
    }

    /**
     * CODEX-3190-4: a search result within 0.01° of the enabled current position opens it, as #3180 counts it among the
     * saved places; the unsaved place stays. A link still skips the current position, which moves.
     */
    @Test
    fun aSearchResultNearTheCurrentPositionOpensIt() = runTest {
        val here = Place(currentPosition = true, disable = false, name = "현재 위치", location = Location(37.38, 127.12))
        val t = setup(started.copy(places = listOf(here, london), placeIndex = 1))
        t.opener.show(Place(false, false, "부산광역시", "부산광역시", "KR", Location(35.18, 129.08)))
        t.opener.show(Place(false, false, "분당구", "경기도 성남시 분당구", "KR", Location(37.385, 127.12)))
        assertEquals(0, t.saved.flow.value!!.placeIndex)
        assertEquals("부산광역시", t.preview.unsaved.value?.place?.name, "the unsaved place stays")
        assertEquals(false, (t.preview.unsaved.value?.selected == true))
        // Disabled, the current position is not a place to open.
        t.saved.change { it.copy(places = listOf(here.copy(disable = true), london), placeIndex = 1) }
        t.opener.show(Place(false, false, "분당구", "경기도 성남시 분당구", "KR", Location(37.385, 127.12)))
        assertEquals("분당구", t.preview.unsaved.value?.place?.name)
    }
}
