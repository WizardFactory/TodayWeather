package net.wizardfactory.todayweather.core.storage

import java.util.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive

class CordovaMigrationTest {
    private val seoul: TimeZone = TimeZone.getTimeZone("Asia/Seoul")
    private val now = 1794067200000L // 2026-11-07T16:00:00Z, 2026-11-08 01:00 KST

    private val cities = """[{"currentPosition":true,"address":null,"location":null,"currentWeather":null,"timeTable":null,"timeChart":null,"dayTable":null,"dayChart":null,"disable":true,"photo":null,"loadTime":null},""" +
        """{"name":"명동","address":"대한민국 서울특별시 중구 명동","country":"KR","location":{"lat":37.56,"long":126.98},"currentPosition":false,"disable":false,"loadTime":"2026-11-07T16:09:45.810Z","photo":null,"source":"KMA","currentWeather":{"t1h":3}},""" +
        """{"name":"London","address":"United Kingdom London","country":"GB","location":{"lat":51.51,"long":-0.13},"currentPosition":false,"disable":false,"photo":null}]"""
    private val push = """{"registrationId":null,"type":"android","category":"","fcmToken":null,"pushList":[""" +
        """{"cityIndex":1,"id":1,"startTime":"2026-11-07T22:00:00.000Z","endTime":"2026-11-08T13:00:00.000Z","enable":true,"category":"alert","name":"명동"},""" +
        """{"cityIndex":1,"id":2,"time":"2026-11-07T22:40:00.000Z","dayOfWeek":[false,true,true,true,true,true,false],"enable":true,"category":"alarm"},""" +
        """{"cityIndex":2,"id":2,"time":"2026-11-07T21:00:00.000Z","dayOfWeek":[true,true,true,true,true,true,true],"enable":false,"category":"alarm"}]}"""
    private val current = mapOf(
        "cities" to cities, "cityIndex" to "2",
        "units" to """{"temperatureUnit":"F","windSpeedUnit":"km/h","pressureUnit":"hPa","distanceUnit":"km","precipitationUnit":"mm","airUnit":"airnow"}""",
        "settingsInfo" to """{"startupPage":"1","refreshInterval":"30","theme":"dark"}""",
        "pushData2" to push, "expandShortChart" to "true", "startVersion" to "1",
    )

    private fun migrate(local: Map<String, String> = emptyMap(), suite: Map<String, String?> = emptyMap(),
                        legacy: Map<String, String?> = emptyMap(), region: String? = "KR") =
        CordovaMigration.migrate(local, suite, legacy, region, now, seoul)

    @Test
    fun currentStoreMigratesEveryValue() {
        val s = migrate(local = current)
        assertEquals(3, s.places.size)
        assertTrue(s.places[0].currentPosition && s.places[0].disable)
        assertEquals("명동", s.places[1].name)
        assertEquals(Location(51.51, -0.13), s.places[2].location)
        assertEquals("KMA", s.places[1].source)
        assertFalse("currentWeather" in s.places[1].cordova!!, "weather caches are not migrated")
        assertEquals(2, s.placeIndex)
        assertEquals(UnitSettings("F", "km/h", "hPa", "km", "mm", "airnow"), s.units)
        assertEquals(Settings("1", "30", "dark"), s.settings)
        assertEquals(3, s.push.records.size)
        assertEquals(listOf(1, 1, 2), s.push.records.map { it["cityIndex"]!!.jsonPrimitive.int })
        assertEquals("2026-11-07T22:40:00.000Z", s.push.records[1]["time"]!!.jsonPrimitive.content)
        assertFalse(s.push.needsAlertIntro)
        assertTrue(s.expandShortChart)
        assertEquals(JsonPrimitive(1), s.cordovaExtras["startVersion"])
        assertEquals("migrated", s.migration!!.keys["cities"])
        assertTrue("cities=localStorage" in s.migration!!.source)
    }

    @Test
    fun suiteFillsKeysMissingOrBrokenInLocalStorage() {
        val local = current - "cities" + ("units" to "{broken")
        val s = migrate(local = local, suite = current)
        assertEquals(3, s.places.size)
        assertEquals("F", s.units.temperatureUnit)
        assertTrue("cities=suite" in s.migration!!.source && "units=suite" in s.migration!!.source)
    }

    @Test
    fun theNewestValueWinsWhenTheSuiteMissedAWrite() {
        // Observed on an emulator: the suite kept the first of two quick `cities` writes.
        val stale = current + ("cities" to cities.substringBeforeLast(",{\"name\":\"London\"") + "]")
        val s = migrate(local = current, suite = stale)
        assertEquals(3, s.places.size)
    }

    @Test
    fun missingOrMalformedValuesTakeCordovaDefaults() {
        val s = migrate(suite = mapOf("cities" to "[oops", "cityIndex" to "\"x\"", "units" to "7", "settingsInfo" to "null",
            "pushData2" to "{", "expandShortChart" to "\"yes\""))
        assertEquals(listOf(Place.currentPositionPlaceholder()), s.places)
        assertEquals(-1, s.placeIndex)
        assertEquals(UnitSettings.defaults("KR"), s.units)
        assertEquals(Settings(), s.settings)
        assertTrue(s.push.records.isEmpty())
        assertFalse(s.expandShortChart)
        assertEquals("malformed", s.migration!!.keys["cities"])
        assertEquals("malformed", s.migration!!.keys["pushData2"])
    }

    @Test
    fun emptyStoreIsANewInstall() {
        val s = migrate()
        assertEquals(AppState(units = UnitSettings.defaults("KR"), migration = s.migration), s)
        assertEquals("absent", s.migration!!.keys["cities"])
    }

    @Test
    fun selectionFollowsLoadCities() {
        fun index(v: String?, first: Boolean = true): Int {
            val c = if (first) cities.replace("\"disable\":true", "\"disable\":false") else cities
            return migrate(local = current + ("cities" to c) + (if (v == null) emptyMap() else mapOf("cityIndex" to v)) -
                (if (v == null) setOf("cityIndex") else emptySet())).placeIndex
        }
        assertEquals(1, index("1"))
        assertEquals(0, index("5"), "out of range: first index, current position enabled")
        assertEquals(1, index("5", first = false), "out of range: first favorite")
        assertEquals(0, index("-1"), "negative: first index (Cordova keeps it)")
        assertEquals(0, index(null), "absent: first index")
        assertEquals(0, migrate(local = mapOf("cityIndex" to "0")).placeIndex, "an in-range index is kept, as loadCities does")
        assertEquals(-1, migrate().placeIndex, "only the disabled placeholder and no index")
    }

    @Test
    fun unitsFollowLoadUnits() {
        val s = migrate(local = mapOf("units" to """{"temperatureUnit":"F","airUnit":"aircn","windSpeedUnit":"warp"}"""), region = "US")
        assertEquals(UnitSettings("F", "mph", "inHg", "mi", "in", "airnow"), s.units)
        assertEquals("partial", s.migration!!.keys["units"])
        val legacy = migrate(legacy = mapOf("units" to """{"temperatureUnit":"F","windSpeedUnit":"m/s","pressureUnit":"hPa","distanceUnit":"km","precipitationUnit":"mm","airUnit":"airkorea"}"""))
        assertEquals("F", legacy.units.temperatureUnit)
        assertEquals("legacy", legacy.migration!!.keys["units"])
    }

    @Test
    fun standaloneLegacySettingsBecomeSettingsInfo() {
        val s = migrate(local = mapOf("startupPage" to "2", "refreshInterval" to "60"))
        assertEquals(Settings("2", "60", "light"), s.settings)
        assertEquals("legacy", s.migration!!.keys["settingsInfo"])
    }

    @Test
    fun legacyPushDataConvertsLikeLoadOldPushInfo() {
        val legacy = """{"registrationId":"r1","type":"android","alarmList":[{"cityIndex":1,"time":1794103200000},{"cityIndex":0,"time":"2026-11-07T23:00:00.000Z"}]}"""
        val s = migrate(local = current - "pushData2" + ("pushData" to legacy))
        val r = s.push.records
        assertEquals(4, r.size)
        assertTrue(s.push.needsAlertIntro)
        assertEquals("r1", s.push.registrationId)
        // alerts first: id 1, disabled, 07:00-22:00 local on the migration day, with city info
        assertEquals(listOf("alert", "alert", "alarm", "alarm"), r.map { it["category"]!!.jsonPrimitive.content })
        assertEquals(listOf(1, 1), r.take(2).map { it["id"]!!.jsonPrimitive.int })
        assertEquals("false", r[0]["enable"]!!.jsonPrimitive.content)
        assertEquals("2026-11-07T22:00:00.000Z", r[0]["startTime"]!!.jsonPrimitive.content)
        assertEquals("2026-11-08T13:00:00.000Z", r[0]["endTime"]!!.jsonPrimitive.content)
        assertEquals("명동", r[0]["name"]!!.jsonPrimitive.content)
        assertEquals("서울특별시", r[0]["town"]!!.let { it as kotlinx.serialization.json.JsonObject }["first"]!!.jsonPrimitive.content)
        assertNull(r[1]["name"], "the current-position placeholder has no city info")
        // alarms: id cityIndex+1, enabled, every day, time as an ISO instant
        assertEquals(listOf(2, 1), r.drop(2).map { it["id"]!!.jsonPrimitive.int })
        assertEquals("2026-11-08T02:00:00.000Z", r[2]["time"]!!.jsonPrimitive.content)
        assertEquals(7, r[2]["dayOfWeek"]!!.jsonArray.count { it.jsonPrimitive.content == "true" })
    }

    /** `_setBackwardCompatibility`: only an old `guideVersion` stands for `startVersion`, so S01 stays closed (AN-10). */
    @Test
    fun anOldGuideVersionCountsAsStartVersion() {
        assertEquals(JsonPrimitive(1), migrate(local = current - "startVersion" + ("guideVersion" to "1")).cordovaExtras["startVersion"])
        assertEquals(JsonPrimitive(1), migrate(local = current + ("guideVersion" to "0")).cordovaExtras["startVersion"], "startVersion wins")
        assertNull(migrate(local = current - "startVersion").cordovaExtras["startVersion"])
    }

    @Test
    fun migrationIsDeterministic() {
        assertEquals(migrate(local = current, suite = current), migrate(local = current, suite = current))
    }
}
