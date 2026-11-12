package net.wizardfactory.todayweather.core.storage

import java.io.File
import java.util.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

/** Requests after a start against those of the Cordova Push service (corpus/push.json). */
class PushRegistrationTest {
    private val corpus = Json.parseToJsonElement(File(javaClass.getResource("/corpus/push.json")!!.toURI()).readText()).jsonObject

    private val places = corpus["cities"]!!.jsonArray.map { c ->
        val o = c.jsonObject
        val loc = o["location"]!!.jsonObject
        Place(currentPosition = o["currentPosition"]!!.jsonPrimitive.content == "true", disable = false,
            name = o["name"]?.jsonPrimitive?.content, address = o["address"]?.jsonPrimitive?.content,
            country = o["country"]?.jsonPrimitive?.content, source = o["source"]?.jsonPrimitive?.content,
            location = Location(loc["lat"]!!.jsonPrimitive.content.toDouble(), loc["long"]!!.jsonPrimitive.content.toDouble()))
    }

    @Test
    fun requestsMatchCordovaForEveryTokenCase() {
        for (case in corpus["cases"]!!.jsonArray.map { it.jsonObject }) {
            fun str(k: String) = case[k]?.takeIf { it != JsonNull }?.jsonPrimitive?.content
            val units = UnitSettings("C", "m/s", "hPa", "km", "mm", str("airUnit")!!)
            val zone = (case["zone"] ?: corpus["zone"])!!.jsonPrimitive.content
            val ctx = PushRegistration.Context(
                deviceId = corpus["deviceId"]!!.jsonPrimitive.content, language = corpus["language"]!!.jsonPrimitive.content,
                appVersion = corpus["appVersion"]!!.jsonPrimitive.content, units = units,
                nowMillis = corpus["now"]!!.jsonPrimitive.long, zone = TimeZone.getTimeZone(zone),
            )
            val records = (case["pushList"] ?: corpus["pushList"])!!.jsonArray.map { it.jsonObject }
            val state = PushState(fcmToken = str("storedToken"), records = records)
            val result = PushRegistration.onStart(state, places, str("newToken"), ctx)
            val expected = case["requests"]!!.jsonArray.map { it.jsonObject }
            assertEquals(expected.size, result.requests.size, "${str("name")}: request count")
            expected.zip(result.requests).forEach { (e, a) ->
                val path = e["url"]!!.jsonPrimitive.content.removePrefix("https://server").replace("/v000902/", "/v000903/")
                assertEquals(e["method"]!!.jsonPrimitive.content, a.method, str("name"))
                assertEquals(path, a.path, str("name"))
                assertEquals(e["headers"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }, a.headers, str("name"))
                assertEquals(e["data"], a.body, "${str("name")} ${a.method} body")
            }
            assertEquals(str("newToken") ?: str("storedToken"), result.state.fcmToken, "${str("name")}: stored token")
        }
    }

    /** `Push.updateUnits` after a unit change on S08 (#2891): the repaired list with the new units, or nothing. */
    @Test
    fun aUnitChangePostsTheListAsCordovaDoes() {
        val cases = corpus["unitsChanged"]!!.jsonArray.map { it.jsonObject }
        assertEquals(4, cases.size)
        for (case in cases) {
            val name = case["name"]!!.jsonPrimitive.content
            val changed = case["units"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }
            val units = UnitSettings.defaults("KR").let { u -> changed.entries.fold(u) { acc, (k, v) -> acc.with(k, v) } }
            val ctx = PushRegistration.Context(
                deviceId = corpus["deviceId"]!!.jsonPrimitive.content, language = corpus["language"]!!.jsonPrimitive.content,
                appVersion = corpus["appVersion"]!!.jsonPrimitive.content, units = units,
                nowMillis = corpus["now"]!!.jsonPrimitive.long, zone = TimeZone.getTimeZone(corpus["zone"]!!.jsonPrimitive.content),
            )
            val token = case["storedToken"]?.takeIf { it != JsonNull }?.jsonPrimitive?.content
            val state = PushState(fcmToken = token, records = case["pushList"]!!.jsonArray.map { it.jsonObject })
            val result = PushRegistration.onUnitsChanged(state, places, ctx)
            val expected = case["requests"]!!.jsonArray.map { it.jsonObject }
            assertEquals(expected.size, result.requests.size, "$name: request count")
            expected.zip(result.requests).forEach { (e, a) ->
                assertEquals(e["method"]!!.jsonPrimitive.content, a.method, name)
                assertEquals(e["url"]!!.jsonPrimitive.content.removePrefix("https://server").replace("/v000902/", "/v000903/"), a.path, name)
                assertEquals(e["headers"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }, a.headers, name)
                assertEquals(e["data"], a.body, "$name body")
            }
            assertEquals(token, result.state.fcmToken, "$name: the token stays")
        }
    }

    /**
     * `Push.updateCityInfo` after `WeatherInfo.updateCity` (AN-10): the moved current position posts its records, an
     * unchanged place posts nothing, a changed source posts that place's records, and without a token the list is only
     * saved.
     */
    @Test
    fun aChangedPlaceUpdatesItsRecordsAsCordovaDoes() {
        val cases = corpus["cityChanged"]!!.jsonArray.map { it.jsonObject }
        assertEquals(5, cases.size)
        for (case in cases) {
            val name = case["name"]!!.jsonPrimitive.content
            val after = case["cities"]!!.jsonArray.map { c ->
                val o = c.jsonObject
                val loc = o["location"]!!.jsonObject
                Place(currentPosition = o["currentPosition"]!!.jsonPrimitive.content == "true", disable = false,
                    name = o["name"]?.jsonPrimitive?.content, address = o["address"]?.jsonPrimitive?.content,
                    country = o["country"]?.jsonPrimitive?.content, source = o["source"]?.jsonPrimitive?.content,
                    location = Location(loc["lat"]!!.jsonPrimitive.content.toDouble(), loc["long"]!!.jsonPrimitive.content.toDouble()))
            }
            val ctx = PushRegistration.Context(
                deviceId = corpus["deviceId"]!!.jsonPrimitive.content, language = corpus["language"]!!.jsonPrimitive.content,
                appVersion = corpus["appVersion"]!!.jsonPrimitive.content, units = UnitSettings.defaults("KR"),
                nowMillis = corpus["now"]!!.jsonPrimitive.long, zone = TimeZone.getTimeZone(corpus["zone"]!!.jsonPrimitive.content),
            )
            val token = case["storedToken"]?.takeIf { it != JsonNull }?.jsonPrimitive?.content
            val before = case["before"]!!.jsonArray.map { it.jsonObject }
            val result = PushRegistration.onCityChanged(PushState(fcmToken = token, records = before), after, case["index"]!!.jsonPrimitive.content.toInt(), ctx)
            val expected = case["requests"]!!.jsonArray.map { it.jsonObject }
            assertEquals(expected.size, result.requests.size, "$name: request count")
            expected.zip(result.requests).forEach { (e, a) ->
                assertEquals(e["method"]!!.jsonPrimitive.content, a.method, name)
                assertEquals(e["url"]!!.jsonPrimitive.content.removePrefix("https://server").replace("/v000902/", "/v000903/"), a.path, name)
                assertEquals(e["headers"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }, a.headers, name)
                assertEquals(e["data"], a.body, "$name body")
            }
            val saved = case["saved"]?.takeIf { it != JsonNull }?.jsonArray?.map { it.jsonObject }
            assertEquals(saved ?: before, result.state.records, "$name: the saved list")
        }
    }

    /**
     * `Push.removePushListByCityIndex` after S02's delete or the current position turned off (AN-11): `DELETE /push`
     * with the token or the registration ID, the place's records dropped, no other renumbered (A24); nothing without
     * either credential.
     */
    @Test
    fun aRemovedPlaceDeletesItsRecordsAsCordovaDoes() {
        val cases = corpus["cityRemoved"]!!.jsonArray.map { it.jsonObject }
        assertEquals(5, cases.size)
        val ctx = PushRegistration.Context(
            deviceId = corpus["deviceId"]!!.jsonPrimitive.content, language = corpus["language"]!!.jsonPrimitive.content,
            appVersion = corpus["appVersion"]!!.jsonPrimitive.content, units = UnitSettings.defaults("KR"),
            nowMillis = corpus["now"]!!.jsonPrimitive.long, zone = TimeZone.getTimeZone(corpus["zone"]!!.jsonPrimitive.content),
        )
        for (case in cases) {
            val name = case["name"]!!.jsonPrimitive.content
            fun str(k: String) = case[k]?.takeIf { it != JsonNull }?.jsonPrimitive?.content
            val before = case["before"]!!.jsonArray.map { it.jsonObject }
            val result = PushRegistration.onCityRemoved(PushState(fcmToken = str("storedToken"), registrationId = str("registrationId"), records = before),
                case["index"]!!.jsonPrimitive.content.toInt(), ctx)
            val expected = case["requests"]!!.jsonArray.map { it.jsonObject }
            assertEquals(expected.size, result.requests.size, "$name: request count")
            expected.zip(result.requests).forEach { (e, a) ->
                assertEquals(e["method"]!!.jsonPrimitive.content, a.method, name)
                assertEquals(e["url"]!!.jsonPrimitive.content.removePrefix("https://server").replace("/v000902/", "/v000903/"), a.path, name)
                assertEquals(e["headers"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }, a.headers, name)
                assertEquals(e["data"], a.body, "$name body")
            }
            val saved = case["saved"]?.takeIf { it != JsonNull }?.jsonArray?.map { it.jsonObject }
            assertEquals(saved ?: before, result.state.records, "$name: the saved list")
        }
    }

    /**
     * The S09 save (`updatePushListByCityIndex`, AN-14) and the O06 answers (`enableAlertForOldAlarm`) against the Cordova
     * service: the place's list posted alone, the others kept with the start's repair, nothing without a token.
     */
    @Test
    fun aSavedPlaceAndTheAlertIntroductionPostAsCordovaDoes() {
        val ctx = PushRegistration.Context(
            deviceId = corpus["deviceId"]!!.jsonPrimitive.content, language = corpus["language"]!!.jsonPrimitive.content,
            appVersion = corpus["appVersion"]!!.jsonPrimitive.content, units = UnitSettings.defaults("KR"),
            nowMillis = corpus["now"]!!.jsonPrimitive.long, zone = TimeZone.getTimeZone(corpus["zone"]!!.jsonPrimitive.content),
        )
        val saved = corpus["placeSaved"]!!.jsonArray.map { it.jsonObject }
        val intro = corpus["alertIntro"]!!.jsonArray.map { it.jsonObject }
        assertEquals(5, saved.size)
        assertEquals(3, intro.size)
        for (case in saved + intro) {
            val name = case["name"]!!.jsonPrimitive.content
            val stored = case["pushList"]!!.jsonArray.map { it.jsonObject }
            val push = PushState(fcmToken = case["storedToken"]?.takeIf { it != JsonNull }?.jsonPrimitive?.content, records = stored)
            val result = if ("answer" in case) {
                PushRegistration.onAlertIntro(push.copy(needsAlertIntro = true), places, case["answer"]!!.jsonPrimitive.content == "intro-ok", ctx)
                    .also { assertEquals(false, it.state.needsAlertIntro, "$name: the introduction is answered") }
            } else {
                PushRegistration.onPlaceSaved(push, places, case["list"]!!.jsonArray.map { it.jsonObject }, case["index"]!!.jsonPrimitive.content.toInt(), ctx)
            }
            val expected = case["requests"]!!.jsonArray.map { it.jsonObject }
            assertEquals(expected.size, result.requests.size, "$name: request count")
            expected.zip(result.requests).forEach { (e, a) ->
                assertEquals(e["method"]!!.jsonPrimitive.content, a.method, name)
                assertEquals(e["url"]!!.jsonPrimitive.content.removePrefix("https://server").replace("/v000902/", "/v000903/"), a.path, name)
                assertEquals(e["headers"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }, a.headers, name)
                assertEquals(e["data"], a.body, "$name body")
            }
            assertEquals(case["saved"]!!.jsonArray.map { it.jsonObject }, result.state.records, "$name: the saved list")
            // The posts after the page's change (review F1) send the same from the stored list.
            val after = if ("answer" in case) {
                if (case["answer"]!!.jsonPrimitive.content == "intro-ok") PushRegistration.listPost(result.state, ctx) else emptyList()
            } else {
                PushRegistration.placePost(result.state, case["index"]!!.jsonPrimitive.content.toInt(), ctx)
            }
            assertEquals(result.requests, after, "$name: the post from the stored list")
        }
        // Without a server nothing is sent, and the records are replaced all the same.
        val offline = PushRegistration.onPlaceSaved(PushState(fcmToken = "t"), places, listOf(corpus["pushList"]!!.jsonArray[1].jsonObject), 1, null)
        assertEquals(emptyList(), offline.requests)
        assertEquals(1, offline.state.records.size)
    }

    @Test
    fun aRefreshedTokenIsReplacedWithoutTheStartRepost() {
        val ctx = PushRegistration.Context("d", "ko-KR", "2.0.0", UnitSettings.defaults("KR"), 0, TimeZone.getTimeZone("UTC"))
        val record = corpus["pushList"]!!.jsonArray[2].jsonObject
        val changed = PushRegistration.onTokenRefresh(PushState(fcmToken = "a", records = listOf(record)), emptyList(), "b", ctx)
        assertEquals(listOf("PUT"), changed.requests.map { it.method })
        val first = PushRegistration.onTokenRefresh(PushState(records = listOf(record)), emptyList(), "b", ctx)
        assertEquals(listOf("PUT", "POST"), first.requests.map { it.method }, "a first token also posts the list")
        assertEquals(emptyList(), PushRegistration.onTokenRefresh(PushState(fcmToken = "b", records = listOf(record)), emptyList(), "b", ctx).requests)
    }

    @Test
    fun nothingIsSentWithoutRecordsOrToken() {
        val ctx = PushRegistration.Context("d", "ko-KR", "2.0.0", UnitSettings.defaults("KR"), 0, TimeZone.getTimeZone("UTC"))
        assertEquals(emptyList(), PushRegistration.onStart(PushState(), emptyList(), null, ctx).requests)
        val first = PushRegistration.onStart(PushState(), emptyList(), "t", ctx)
        assertEquals(listOf("PUT"), first.requests.map { it.method }, "a first token is still registered")
        assertEquals(JsonObject(mapOf("newToken" to JsonPrimitive("t"), "oldToken" to JsonNull)), first.requests.single().body)
    }
}
