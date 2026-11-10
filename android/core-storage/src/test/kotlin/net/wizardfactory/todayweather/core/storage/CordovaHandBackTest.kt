package net.wizardfactory.todayweather.core.storage

import java.util.TimeZone
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The hand-back to a fallback Cordova build (AN-17, #2896): the native state in the texts the Cordova app writes, the
 * contract's marker and the native start's re-migration after the fallback build claimed the state.
 */
class CordovaHandBackTest {
    private val seoul: TimeZone = TimeZone.getTimeZone("Asia/Seoul")
    private val now = 1794067200000L // 2026-11-07T16:00:00Z

    private val cities = """[{"currentPosition":true,"address":null,"location":null,"currentWeather":null,"timeTable":null,"timeChart":null,"dayTable":null,"dayChart":null,"disable":true,"photo":null,"loadTime":null},""" +
        """{"name":"명동","address":"대한민국 서울특별시 중구 명동","country":"KR","location":{"lat":37.56,"long":126.98},"currentPosition":false,"disable":false,"loadTime":"2026-11-07T16:09:45.810Z","photo":null,"source":"KMA","currentWeather":{"t1h":3},"index":1},""" +
        """{"name":"London","address":"United Kingdom London","country":"GB","location":{"lat":51.51,"long":-0.13},"currentPosition":false,"disable":false,"photo":null}]"""
    private val push = """{"registrationId":null,"type":"android","category":"","fcmToken":"token-a","pushList":[""" +
        """{"cityIndex":1,"id":1,"startTime":"2026-11-07T22:00:00.000Z","endTime":"2026-11-08T13:00:00.000Z","enable":true,"category":"alert","name":"명동"},""" +
        """{"cityIndex":1,"id":2,"time":"2026-11-07T22:40:00.000Z","dayOfWeek":[false,true,true,true,true,true,false],"enable":true,"category":"alarm"},""" +
        """{"cityIndex":2,"id":2,"time":"2026-11-07T21:00:00.000Z","dayOfWeek":[true,true,true,true,true,true,true],"enable":false,"category":"alarm"}]}"""
    private val cordova = mapOf(
        "cities" to cities, "cityIndex" to "2",
        "units" to """{"temperatureUnit":"F","windSpeedUnit":"km/h","pressureUnit":"hPa","distanceUnit":"km","precipitationUnit":"mm","airUnit":"airnow"}""",
        "settingsInfo" to """{"startupPage":"1","refreshInterval":"30","theme":"dark"}""",
        "pushData2" to push, "expandShortChart" to "true", "startVersion" to "1", "appVersion" to "\"1.1.1\"",
    )

    private fun migrate(local: Map<String, String>) = CordovaMigration.migrate(local, emptyMap(), emptyMap(), "KR", now, seoul)
    private fun json(text: String?) = Json.parseToJsonElement(text!!)

    @Test
    fun aStateIsHandedBackInTheTextsTheCordovaAppWrites() {
        val texts = CordovaHandBack.texts(migrate(cordova), consent = "false")
        assertEquals(CordovaHandBack.KEYS.toSet(), texts.keys)
        val handed = json(texts["cities"]).jsonArray.map { it.jsonObject }
        assertEquals(3, handed.size)
        // The record the Cordova app kept, without its caches; the caches empty as `createCity` leaves them.
        assertEquals(JsonPrimitive(1), handed[1]["index"], "a field the native app does not know survives")
        for (key in listOf("currentWeather", "timeTable", "timeChart", "dayTable", "dayChart")) assertEquals(JsonNull, handed[1][key], key)
        assertEquals("명동", handed[1]["name"]!!.jsonPrimitive.content)
        assertEquals(json("""{"lat":51.51,"long":-0.13}"""), handed[2]["location"])
        assertEquals(JsonPrimitive(true), handed[0]["disable"])
        assertEquals("2", texts["cityIndex"])
        // `_saveCitiesPreference`: the enabled places only, with their index.
        val summary = json(texts["cityList"]).jsonObject["cityList"]!!.jsonArray.map { it.jsonObject }
        assertEquals(listOf(1, 2), summary.map { it["index"]!!.jsonPrimitive.int })
        assertEquals(setOf("name", "currentPosition", "address", "location", "country", "index"), summary[0].keys)
        assertEquals(json(cordova["units"]), json(texts["units"]))
        assertEquals(json(cordova["settingsInfo"]), json(texts["settingsInfo"]))
        val pushData2 = json(texts["pushData2"]).jsonObject
        assertEquals("token-a", pushData2["fcmToken"]!!.jsonPrimitive.content)
        assertEquals(json(push).jsonObject["pushList"], pushData2["pushList"])
        assertNull(texts["pushData"], "legacy alarms are removed: they live in pushData2")
        assertEquals("true", texts["expandShortChart"])
        assertEquals("1", texts["startVersion"])
        assertEquals("\"1.1.1\"", texts["appVersion"])
        assertNull(texts["disableUpdateInfo"], "a key the state lacks is removed")
        assertEquals("false", texts["twAnalyticsConsentV1"])
        assertNull(CordovaHandBack.texts(migrate(cordova), consent = null)["twAnalyticsConsentV1"])
        assertNull(CordovaHandBack.texts(migrate(cordova), consent = "1")["twAnalyticsConsentV1"], "only a choice Monetization writes")
    }

    @Test
    fun theTextsMigrateBackToTheSameState() {
        val state = migrate(cordova)
        val texts = CordovaHandBack.texts(state, consent = "true")
        val again = migrate(texts.filterValues { it != null }.mapValues { it.value!! })
        assertEquals(state.places.map { it.copy(cordova = null) }, again.places.map { it.copy(cordova = null) })
        assertEquals(state.placeIndex, again.placeIndex)
        assertEquals(state.units, again.units)
        assertEquals(state.settings, again.settings)
        assertEquals(state.push, again.push)
        assertEquals(state.expandShortChart, again.expandShortChart)
        assertEquals(state.cordovaExtras, again.cordovaExtras)
        assertEquals(texts, CordovaHandBack.texts(again, consent = "true"), "a second hand-back writes the same texts")
    }

    @Test
    fun placesAndAlarmsDeletedInTheNativeAppAreNotHandedBack() {
        val state = migrate(cordova)
        // London removed in S02 (its alarms with it, AN-11); an alarm of 명동 deleted on S09 stays disabled (AN-14).
        val edited = PlaceList.remove(state, 2).let { s ->
            s.copy(push = s.push.copy(records = s.push.records.filter { (it["cityIndex"] as JsonPrimitive).int != 2 }
                .map { if (it["id"] == JsonPrimitive(2)) JsonObject(it + ("enable" to JsonPrimitive(false))) else it }))
        }
        val texts = CordovaHandBack.texts(edited, consent = null)
        val names = json(texts["cities"]).jsonArray.map { (it.jsonObject["name"] as? JsonPrimitive)?.content }
        assertEquals(listOf(null, "명동"), names)
        val list = json(texts["pushData2"]).jsonObject["pushList"]!!.jsonArray.map { it.jsonObject }
        assertEquals(listOf(1, 1), list.map { it["cityIndex"]!!.jsonPrimitive.int })
        assertEquals(JsonPrimitive(false), list[1]["enable"])
        assertEquals(listOf(1), json(texts["cityList"]).jsonObject["cityList"]!!.jsonArray.map { it.jsonObject["index"]!!.jsonPrimitive.int })
    }

    @Test
    fun aNameTheNativeAppGaveIsHandedBackAndAnAbsentOneAddsNoKey() {
        val state = migrate(cordova)
        val named = state.copy(places = state.places.mapIndexed { i, p -> if (i == 0) p.copy(name = "회현동", disable = false) else p })
        val first = json(CordovaHandBack.texts(named, null)["cities"]).jsonArray[0].jsonObject
        assertEquals("회현동", first["name"]!!.jsonPrimitive.content)
        assertEquals(JsonPrimitive(false), first["disable"])
        val plain = json(CordovaHandBack.texts(state, null)["cities"]).jsonArray[0].jsonObject
        assertFalse("name" in plain, "createCity's placeholder has no name")
    }

    @Test
    fun theMarkerOrdersTheHandOvers() {
        val text = CordovaHandBack.marker(4, CordovaHandBack.NATIVE)
        val marker = CordovaHandBack.parse(text)!!
        assertEquals(CordovaHandBack.Marker(1, 4, "native", true, CordovaHandBack.KEYS), marker)
        assertEquals(1, CordovaHandBack.nextGeneration(null))
        assertEquals(5, CordovaHandBack.nextGeneration(text))
        assertEquals(1, CordovaHandBack.nextGeneration("{broken"), "an unreadable marker starts over")
        assertNull(CordovaHandBack.parse("{broken"))
        assertNull(CordovaHandBack.parse("""{"schema":1,"writer":"native","complete":true,"keys":[]}"""), "no generation")
        assertNull(CordovaHandBack.parse("""{"schema":"1","generation":2,"writer":"native","complete":true,"keys":[]}"""))
    }

    @Test
    fun onlyAClaimByTheFallbackBuildMakesTheNativeAppMigrateAgain() {
        fun claim(schema: Int = 1, writer: String = "cordova", complete: Boolean = true) =
            """{"schema":$schema,"generation":6,"writer":"$writer","complete":$complete,"keys":[]}"""
        assertEquals(6, CordovaHandBack.cordovaClaim(claim())?.generation)
        assertNull(CordovaHandBack.cordovaClaim(claim(writer = "native")))
        assertNull(CordovaHandBack.cordovaClaim(claim(complete = false)), "partial: the stored state stays")
        assertNull(CordovaHandBack.cordovaClaim(claim(schema = 2)), "a schema this build does not know")
        assertNull(CordovaHandBack.cordovaClaim(null))
        assertNull(CordovaHandBack.cordovaClaim("not json"))
    }

    @Test
    fun theNativeStartMigratesAgainAfterTheFallbackBuildClaimedTheState() = runBlocking {
        val dir = createTempDirectory().toFile()
        val store = androidx.datastore.core.DataStoreFactory.create(AppStateSerializer) { java.io.File(dir, "app_state.json") }
        var sources = MigrationSources(cordova, emptyMap(), emptyMap())
        var marker: String? = null
        var clock = now
        val runner = MigrationRunner(store, { sources }, { clock }, { seoul }, { "KR" }, marker = { marker })
        val first = runner.runIfNeeded()
        assertEquals(3, first.places.size)
        // The native app handed back (writer native): a later start keeps the stored state.
        val fewer = cordova + ("cities" to cities.substringBeforeLast(",{\"name\":\"London\"") + "]") + ("cityIndex" to "1")
        sources = MigrationSources(fewer, emptyMap(), emptyMap())
        marker = CordovaHandBack.marker(3, CordovaHandBack.NATIVE)
        clock = now + 60_000
        assertEquals(first, runner.runIfNeeded())
        // The fallback build claimed it (writer cordova): its storage migrates again, as of now.
        marker = """{"schema":1,"generation":4,"writer":"cordova","complete":true,"keys":[]}"""
        val again = runner.runIfNeeded()
        assertEquals(2, again.places.size)
        assertEquals(1, again.placeIndex)
        assertEquals(now + 60_000, again.migration!!.migratedAtMillis)
        assertEquals(4, again.migration!!.handBackGeneration)
        // The same claim again (the hand-back not yet written): the adopted state stays.
        clock = now + 120_000
        assertEquals(again, runner.runIfNeeded())
        // An incomplete claim leaves the stored state.
        sources = MigrationSources(cordova, emptyMap(), emptyMap())
        marker = """{"schema":1,"generation":5,"writer":"cordova","complete":false,"keys":[]}"""
        assertEquals(again, runner.runIfNeeded())
    }

    @Test
    fun theFirstMigrationAdoptsTheClaimItFinds() = runBlocking {
        // A Cordova build with the hand-back claims the state at each start; the native app is then installed over it.
        val dir = createTempDirectory().toFile()
        val store = androidx.datastore.core.DataStoreFactory.create(AppStateSerializer) { java.io.File(dir, "app_state.json") }
        var sources = MigrationSources(cordova, emptyMap(), emptyMap())
        var clock = now
        val claim = """{"schema":1,"generation":1,"writer":"cordova","complete":true,"keys":[]}"""
        val runner = MigrationRunner(store, { sources }, { clock }, { seoul }, { "KR" }, marker = { claim })
        val first = runner.runIfNeeded()
        assertEquals(1, first.migration!!.handBackGeneration)
        // A start before the first hand-back was written (a process without the state writer) keeps the state.
        sources = MigrationSources(cordova + ("cityIndex" to "1"), emptyMap(), emptyMap())
        clock = now + 60_000
        assertEquals(first, runner.runIfNeeded())
    }
}
