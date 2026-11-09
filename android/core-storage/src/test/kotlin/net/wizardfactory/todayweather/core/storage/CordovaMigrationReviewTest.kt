package net.wizardfactory.todayweather.core.storage

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.Locale
import java.util.TimeZone
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.Warnings
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Review round 1 of #2905: slots, coordinates, DST, locale, record validation, re-run. */
class CordovaMigrationReviewTest {
    private val seoul = TimeZone.getTimeZone("Asia/Seoul")
    private val now = 1794067200000L
    private val placeholder = """{"currentPosition":true,"address":null,"location":null,"disable":true}"""
    private val seoulCity = """{"name":"명동","address":"대한민국 서울특별시 중구 명동","location":{"lat":37.56,"long":126.98},"currentPosition":false,"disable":false,"source":"KMA"}"""

    private fun migrate(local: Map<String, String>, zone: TimeZone = seoul, at: Long = now) =
        CordovaMigration.migrate(local, emptyMap(), emptyMap(), "KR", at, zone)

    @Test
    fun brokenCityEntriesKeepTheirSlot() {
        val alarm = """{"cityIndex":2,"id":2,"time":"2026-11-07T22:40:00.000Z","dayOfWeek":[true,true,true,true,true,true,true],"enable":true,"category":"alarm"}"""
        val s = migrate(mapOf("cities" to "[$placeholder,null,$seoulCity]", "cityIndex" to "2",
            "pushData2" to """{"pushList":[$alarm]}"""))
        assertEquals(3, s.places.size)
        assertEquals("명동", s.places[s.placeIndex].name)
        assertTrue(s.places[1].disable && !s.places[1].currentPosition, "broken entry becomes a disabled slot")
        assertEquals(2, s.push.records.single()["cityIndex"]!!.jsonPrimitive.content.toInt())
        assertEquals("partial", s.migration!!.keys["cities"])
    }

    @Test
    fun invalidCoordinatesAreDroppedAndTheStateSerializes() {
        val bad = listOf("""{"lat":"NaN","long":1}""", """{"lat":1e999,"long":1}""", """{"lat":91,"long":1}""",
            """{"lat":37,"long":-181}""", """{"lat":37}""")
        val cities = bad.joinToString(",", "[$placeholder,", "]") { """{"name":"x","address":"a","location":$it,"currentPosition":false}""" }
        val s = migrate(mapOf("cities" to cities))
        assertTrue(s.places.drop(1).all { it.location == null })
        val out = ByteArrayOutputStream()
        runBlocking { AppStateSerializer.writeTo(s, out) }
        assertEquals(s, runBlocking { AppStateSerializer.readFrom(ByteArrayInputStream(out.toByteArray())) })
    }

    @Test
    fun legacyAlertWindowUsesLocalWallTimeOnDaylightSavingDays() {
        val ny = TimeZone.getTimeZone("America/New_York")
        val legacy = mapOf("cities" to "[$placeholder,$seoulCity]",
            "pushData" to """{"alarmList":[{"cityIndex":1,"time":0}]}""")
        // 2026-03-08 (clocks go forward at 02:00) and 2026-11-01 (back at 02:00), noon local
        for ((at, start, end) in listOf(
            Triple(1772985600000L, "2026-03-08T11:00:00.000Z", "2026-03-09T02:00:00.000Z"),
            Triple(1793552400000L, "2026-11-01T12:00:00.000Z", "2026-11-02T03:00:00.000Z"),
        )) {
            val alert = migrate(legacy, ny, at).push.records.first()
            assertEquals(start, alert["startTime"]!!.jsonPrimitive.content)
            assertEquals(end, alert["endTime"]!!.jsonPrimitive.content)
        }
    }

    @Test
    fun isoAndWarningTimesIgnoreTheDefaultLocale() {
        val saved = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("ar-EG"))
            assertEquals("2026-11-07T16:00:00.000Z", CordovaMigration.iso(now))
            val warning = Warnings.parse(JsonArray(listOf(JsonObject(mapOf("announcement" to JsonPrimitive("2026-11-07T15:00:00.000Z"),
                "comment" to JsonPrimitive("a"))))), "ko-KR", "Asia/Seoul")
            assertEquals("2026. 11. 8. 오전 12:00:00", ((warning as JsonArray)[0] as JsonObject)["announcement"]!!.jsonPrimitive.content)
        } finally {
            Locale.setDefault(saved)
        }
    }

    @Test
    fun malformedPushRecordsAreDroppedAndOrphansKept() {
        val ok = """{"cityIndex":1,"id":2,"time":"2026-11-07T22:40:00.000Z","dayOfWeek":[true,true,true,true,true,true,true],"enable":true,"category":"alarm"}"""
        val alert = """{"cityIndex":1,"id":1,"startTime":"2026-11-07T22:00:00.000Z","endTime":"2026-11-08T13:00:00.000Z","enable":false,"category":"alert"}"""
        val orphan = ok.replace("\"cityIndex\":1", "\"cityIndex\":5")
        val broken = listOf(
            ok.replace("\"time\":\"2026-11-07T22:40:00.000Z\",", ""),
            ok.replace("[true,true,true,true,true,true,true]", "[true,true]"),
            ok.replace("\"enable\":true", "\"enable\":\"yes\""),
            ok.replace("\"id\":2", "\"id\":\"2\""),
            ok.replace("\"time\":\"2026-11-07T22:40:00.000Z\"", "\"time\":\"tomorrow\""),
            alert.replace("\"startTime\":\"2026-11-07T22:00:00.000Z\",", ""),
            ok.replace("\"category\":\"alarm\"", "\"category\":\"other\""),
        )
        // ISO-shaped but impossible dates and times are dropped too.
        val impossible = listOf("2026-13-07T22:40:00.000Z", "2026-02-30T22:40:00.000Z", "2026-11-07T24:00:00.000Z",
            "2026-11-07T22:60:00.000Z", "2026-11-07T22:40:60.000Z", "2026-00-07T22:40:00.000Z")
        val impossibleRecords = impossible.map { ok.replace("2026-11-07T22:40:00.000Z", it) } +
            alert.replace("2026-11-08T13:00:00.000Z", "2026-11-31T13:00:00.000Z")
        val s = migrate(mapOf("cities" to "[$placeholder,$seoulCity]",
            "pushData2" to (listOf(ok, alert, orphan) + broken + impossibleRecords).joinToString(",", """{"pushList":[""", "]}")))
        assertEquals(3, s.push.records.size)
        assertEquals("partial", s.migration!!.keys["pushData2"])
        assertEquals("14 dropped, 1 orphan", s.migration!!.keys["pushData2.records"])
    }

    @Test
    fun secondRunKeepsTheStoredStateEvenWhenSourcesChange() = runBlocking {
        val dir = createTempDirectory().toFile()
        val store = androidx.datastore.core.DataStoreFactory.create(AppStateSerializer) { java.io.File(dir, "app_state.json") }
        var sources = MigrationSources(mapOf("cities" to "[$placeholder,$seoulCity]", "cityIndex" to "1"), emptyMap(), emptyMap())
        var clock = now
        val runner = MigrationRunner(store, { sources }, { clock }, { seoul }, { "KR" })
        val first = runner.runIfNeeded()
        val bytes = java.io.File(dir, "app_state.json").readBytes()
        sources = MigrationSources(mapOf("cities" to "[$placeholder]"), mapOf("cityIndex" to "0"), emptyMap())
        clock = now + 86_400_000
        assertEquals(first, runner.runIfNeeded())
        assertTrue(bytes.contentEquals(java.io.File(dir, "app_state.json").readBytes()))
        assertEquals(now, first.migration!!.migratedAtMillis)
        assertNull(null)
    }
}
