package net.wizardfactory.todayweather.core.domain.places

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.start.LocationMessage
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import net.wizardfactory.todayweather.core.domain.start.RetryButton
import net.wizardfactory.todayweather.core.domain.start.RetryConfirm

/** SearchCtrl's rows, `goPage`, the S02 Places query and O03 `search` (AN-11, #2890). */
class PlacesDomainTest {
    private fun weather(json: String) = Json.parseToJsonElement(json) as JsonObject
    private val texts = PlaceRows.Texts(current = "현재", location = "위치")

    @Test
    fun aRowIsNamedByItsNameElseItsShortenedAddressElseNothing() {
        assertEquals(listOf("서울"), PlaceRows.label("서울", "대한민국 서울특별시", false, "ko-KR", texts))
        // getShortenAddress, split on its comma.
        assertEquals(listOf("서울시", "중구"), PlaceRows.label(null, "대한민국 서울특별시 중구", false, "ko-KR", texts))
        assertEquals(listOf(""), PlaceRows.label("", null, false, "ko-KR", texts))
        // The current position without an address, joined without a space in ko, ja, zh-CN and the zh-TU typo.
        assertEquals(listOf("현재위치"), PlaceRows.label(null, null, true, "ko-KR", texts))
        assertEquals(listOf("Current Location"), PlaceRows.label(null, null, true, "en-US", PlaceRows.Texts("Current", "Location")))
        assertEquals(listOf("Current Location"), PlaceRows.label(null, null, true, "zh-TW", PlaceRows.Texts("Current", "Location")))
        // A named current position with an address keeps its name.
        assertEquals(listOf("회현동"), PlaceRows.label("회현동", "서울특별시 중구 회현동", true, "ko-KR", texts))
    }

    @Test
    fun theWeatherCellsShowOnlyWithATemperature() {
        val row = PlaceRows.row("서울", "대한민국 서울특별시", false, false, weather("""{"skyIcon":"MoonSmallCloud","t1h":7.2,"today":{"tmn":0.5,"tmx":-0.4}}"""),
            hasPush = true, "ko-KR", texts)
        assertEquals("MoonSmallCloud", row.skyIcon)
        // toFixed(0): half away from zero, "-0" kept.
        assertEquals("7˚", row.temperature)
        assertEquals("1˚/-0˚", row.minMax)
        assertEquals(true, row.hasPush)
        val none = PlaceRows.row(null, null, true, true, null, false, "ko-KR", texts)
        assertEquals("sun", none.skyIcon)
        assertNull(none.temperature)
        assertNull(none.minMax)
        // A temperature without today's values: "˚/˚", as the template prints undefined.
        assertEquals("˚/˚", PlaceRows.row("A", null, false, false, weather("""{"t1h":3}"""), false, "ko-KR", texts).minMax)
    }

    @Test
    fun aSelectedRowOpensTheStartupPageExceptTheLocationsTab() {
        assertEquals(Tab.HOURLY, PlaceRows.startTab("0"))
        assertEquals(Tab.DAILY, PlaceRows.startTab("1"))
        assertEquals(Tab.HOURLY, PlaceRows.startTab("2"))
        assertEquals(Tab.AIR, PlaceRows.startTab("3"))
        assertEquals(Tab.HOURLY, PlaceRows.startTab("4"))
        assertEquals(Tab.HOURLY, PlaceRows.startTab(null))
    }

    @Test
    fun s02GeocodesAPredictionByItsTermsJoinedByCommas() {
        assertEquals("London,UK", SearchQuery.of("London, UK"))
        assertEquals("대한민국,부산광역시", SearchQuery.of("대한민국 부산광역시"))
        assertEquals("Paris", SearchQuery.of("Paris"))
    }

    @Test
    fun theSearchRetryClosesFirstAndRetriesFindingByLocation() {
        val denied = LocationMessage.DENIED
        assertEquals(RetryConfirm(denied.lines + "LOC_OPENS_THE_APP_INFO_PAGE", listOf(RetryButton.CLOSE, RetryButton.APP_SETTINGS)),
            SearchLocation.retry(denied, PermissionStatus.DENIED_ALWAYS, true))
        assertEquals(RetryConfirm(denied.lines, listOf(RetryButton.CLOSE, RetryButton.RETRY)), SearchLocation.retry(denied, null, true))
        assertEquals(RetryConfirm(LocationMessage.TURN_ON.lines, listOf(RetryButton.CLOSE, RetryButton.LOCATION_SETTINGS, RetryButton.RETRY)),
            SearchLocation.retry(LocationMessage.TURN_ON, PermissionStatus.GRANTED, false))
        assertEquals(RetryConfirm(LocationMessage.NOT_FOUND.lines, listOf(RetryButton.CLOSE, RetryButton.RETRY)),
            SearchLocation.retry(LocationMessage.NOT_FOUND, PermissionStatus.GRANTED, true))
    }
}
