package net.wizardfactory.todayweather.core.data

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place

/**
 * `getGeoInfoByLocation` and `getGeoInfoByAddr` (#2889): the gateway's routes with the weather requests' language
 * header, the address unencoded as Cordova concatenated it, failures and a missing server as null, and the `geoInfo`
 * copied into a place as `saveCity` does. The coordinates answer is the AN-02 corpus capture.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GeocodeClientTest {
    private val geocodeBody = File(File(javaClass.getResource("/corpus")!!.toURI()), "inputs/geocode-seoul.json").readText()

    @Test
    fun theRoutesCarryTheCoordinatesAndTheAddressAsCordovaBuiltThem() = runTest {
        val requests = mutableListOf<Pair<String, String?>>()
        val client = GeocodeClient("https://server.test.invalid", HttpGet { url, headers -> requests += url to headers["Accept-Language"]; geocodeBody })
        val found = client.byLocation(Location(37.5, 127.0), listOf("ko-KR", "en-US"))!!
        assertEquals(JsonPrimitive("회현동"), found["name"])
        client.byAddress("대한민국 서울특별시 중구 회현동", listOf("ko-KR"))
        // JavaScript prints 37.5 and 127; the address is not encoded.
        assertEquals(listOf<Pair<String, String?>>("https://server.test.invalid/geocode/v000903/coord/37.5,127" to "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            "https://server.test.invalid/geocode/v000903/addr/대한민국 서울특별시 중구 회현동" to "ko-KR,ko;q=0.9"), requests)
    }

    @Test
    fun failuresAndAMissingServerAnswerNothing() = runTest {
        assertNull(GeocodeClient("https://server.test.invalid", HttpGet { _, _ -> throw HttpStatusException(501) }).byAddress("x", listOf("ko-KR")))
        assertNull(GeocodeClient("https://server.test.invalid", HttpGet { _, _ -> "not json" }).byAddress("x", listOf("ko-KR")))
        var asked = false
        assertNull(GeocodeClient("", HttpGet { _, _ -> asked = true; geocodeBody }).byLocation(Location(37.56, 126.98), listOf("ko-KR")))
        assertEquals(false, asked)
        // A JSON answer that is no object reads as one without fields.
        assertEquals(JsonObject(emptyMap()), GeocodeClient("https://server.test.invalid", HttpGet { _, _ -> "[]" }).byAddress("x", listOf("ko-KR")))
    }

    @Test
    fun aGeoInfoBecomesAPlace() = runTest {
        val geoInfo = GeocodeClient("https://server.test.invalid", HttpGet { _, _ -> geocodeBody }).byLocation(Location(37.56, 126.98), listOf("ko-KR"))!!
        assertEquals(Place(currentPosition = true, disable = false, name = "회현동", address = "서울특별시 중구 회현동", country = "KR",
            location = Location(37.56, 126.98)), GeocodeClient.place(geoInfo, currentPosition = true))
        // The address answer has no name; a location without both numbers is none.
        val address = kotlinx.serialization.json.Json.parseToJsonElement("""{"country":"KR","address":"서울","location":{"lat":"37.5"}}""") as JsonObject
        assertEquals(Place(currentPosition = false, disable = false, name = null, address = "서울", country = "KR", location = null),
            GeocodeClient.place(address, currentPosition = false))
    }
}
