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
        val opener = LinkOpener(saved.flow, preview, openPlace = { calls += "open $it" }, reload = { calls += "reload" })
        return Setup(saved, preview, opener, calls)
    }

    @Test
    fun aSavedPlaceNearbyIsSelectedAndLoaded() = runTest {
        val t = setup(started)
        t.preview.show(Place(false, false, "부산", location = Location(35.179, 129.076)))
        t.opener.open(DeepLinkTarget.Place("london", WeatherView.AIR, "pm10"))
        assertNull(t.preview.place.value, "a saved place ends the preview")
        assertEquals(listOf("open 1"), t.calls)
        assertEquals(LinkRoute.Weather(WeatherView.AIR, "pm10", 1, null), t.opener.requests.value?.route)
    }

    @Test
    fun anUnsavedPlaceIsAPreviewThatLoads() = runTest {
        val t = setup(started)
        t.opener.open(DeepLinkTarget.Coordinate(37.383, 127.119, "분당구", WeatherView.DAILY, null))
        assertEquals("분당구", t.preview.place.value?.name)
        assertEquals(started, t.saved.flow.value, "nothing saved")
        assertEquals(listOf("reload"), t.calls)
        assertEquals(WeatherView.DAILY, (t.opener.requests.value?.route as LinkRoute.Weather).view)
    }

    @Test
    fun eachLinkIsOneRequestHandledOnce() = runTest {
        val t = setup(started)
        t.opener.open(DeepLinkTarget.NationAir)
        val first = t.opener.requests.value!!
        t.opener.open(DeepLinkTarget.NationAir)
        val second = t.opener.requests.value!!
        assertEquals(LinkRoute.Page(LinkPage.NATION_AIR), second.route)
        assertEquals(true, second.id != first.id, "the same link again applies again")
        t.opener.handled(first.id)
        assertEquals(second, t.opener.requests.value, "an older id does not clear a newer request")
        t.opener.handled(second.id)
        assertNull(t.opener.requests.value)
    }

    @Test
    fun onTheStartPageALocationLinkPreviewsAtOnceWhileAPageWaitsForTheStartToClose() = runTest {
        val t = setup(AppState())
        t.opener.open(DeepLinkTarget.Place("seoul", WeatherView.HOURLY, null))
        assertEquals("서울", t.preview.place.value?.name, "S01 is bypassed by a preview")
        assertEquals(listOf("reload"), t.calls)
        val page = launch { t.opener.open(DeepLinkTarget.Warnings) }
        runCurrent()
        assertEquals(LinkRoute.Weather(WeatherView.HOURLY, null, null, t.preview.place.value), t.opener.requests.value?.route,
            "S12 waits while S01 is pending")
        t.saved.change { it.copy(cordovaExtras = closed) }
        page.join()
        assertEquals(LinkRoute.Page(LinkPage.WARNINGS), t.opener.requests.value?.route)
    }

    @Test
    fun openAndUnknownCitiesChangeNothing() = runTest {
        val t = setup(started)
        t.opener.open(DeepLinkTarget.Open("ko"))
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
        assertEquals(listOf("open 1"), t.calls)
    }
}
