package net.wizardfactory.todayweather.core.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.domain.share.DeepLinkTarget
import net.wizardfactory.todayweather.core.domain.share.WeatherView
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place

/** Where a `link.todayweather.ai` link goes (specs/deeplink.md §6.2): a saved place within 0.01°, a preview, a page. */
class LinkRoutesTest {
    private val current = Place(currentPosition = true, disable = false, name = "현재 위치", location = Location(37.567, 126.978))
    private val gangnam = Place(currentPosition = false, disable = false, name = "강남", address = "서울특별시 강남구", location = Location(37.498, 127.028))
    private val busanOff = Place(currentPosition = false, disable = true, name = "부산", location = Location(35.179, 129.076))
    private val seoulSaved = Place(currentPosition = false, disable = false, name = "중구", address = "서울특별시 중구", location = Location(37.575, 126.985))
    private val state = AppState(places = listOf(current, gangnam, busanOff), placeIndex = 1, cordovaExtras = mapOf("startVersion" to JsonPrimitive(1)))

    @Test
    fun aCatalogCityWithoutASavedPlaceNearbyIsAPreview() {
        // The current position is at Seoul's coordinates: a shared place is never the moving current position.
        val route = LinkRoutes.of(DeepLinkTarget.Place("seoul", WeatherView.DAILY, null), state)
        assertEquals(LinkRoute.Weather(WeatherView.DAILY, null, null,
            Place(false, false, "서울", "서울특별시 중구", "KR", Location(37.567, 126.978))), route)
    }

    @Test
    fun anEnabledSavedPlaceWithinAHundredthOfADegreeIsSelected() {
        val saved = state.copy(places = state.places + seoulSaved)
        assertEquals(LinkRoute.Weather(WeatherView.AIR, "pm25", 3, null),
            LinkRoutes.of(DeepLinkTarget.Place("seoul", WeatherView.AIR, "pm25"), saved))
        assertEquals(LinkRoute.Weather(WeatherView.HOURLY, null, 1, null),
            LinkRoutes.of(DeepLinkTarget.Coordinate(37.49, 127.02, "역삼", WeatherView.HOURLY, null), saved))
        // A disabled place does not match: Busan is a preview.
        assertEquals(LinkRoute.Weather(WeatherView.HOURLY, null, null,
            Place(false, false, "부산", "부산광역시 중구", "KR", Location(35.179, 129.076))),
            LinkRoutes.of(DeepLinkTarget.Place("busan", WeatherView.HOURLY, null), saved))
    }

    @Test
    fun coordinatesPreviewWithTheirNameOrTheCoordinates() {
        assertEquals(LinkRoute.Weather(WeatherView.HOURLY, null, null, Place(false, false, "분당구", location = Location(37.383, 127.119))),
            LinkRoutes.of(DeepLinkTarget.Coordinate(37.383, 127.119, "분당구", WeatherView.HOURLY, null), state))
        assertEquals(LinkRoute.Weather(WeatherView.HOURLY, null, null, Place(false, false, "-33.869, 151.209", location = Location(-33.869, 151.209))),
            LinkRoutes.of(DeepLinkTarget.Coordinate(-33.869, 151.209, null, WeatherView.HOURLY, null), state))
    }

    @Test
    fun pagesAndTheAppOpen() {
        assertEquals(LinkRoute.Page(LinkPage.NATION_WEATHER), LinkRoutes.of(DeepLinkTarget.NationWeather, state))
        assertEquals(LinkRoute.Page(LinkPage.NATION_AIR), LinkRoutes.of(DeepLinkTarget.NationAir, state))
        assertEquals(LinkRoute.Page(LinkPage.WARNINGS), LinkRoutes.of(DeepLinkTarget.Warnings, state))
        assertEquals(LinkRoute.App, LinkRoutes.of(DeepLinkTarget.Open("ko"), state))
    }

    @Test
    fun anUnknownCatalogSlugAndALegacyIndexGoNowhereHere() {
        assertNull(LinkRoutes.of(DeepLinkTarget.Place("not-in-catalog", WeatherView.DAILY, null), state))
        assertNull(LinkRoutes.of(DeepLinkTarget.LegacyWidgetIndex(2.0), state))
    }
}
