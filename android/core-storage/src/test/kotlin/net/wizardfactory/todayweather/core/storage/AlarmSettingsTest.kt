package net.wizardfactory.todayweather.core.storage

import java.util.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * PushCtrl's rules for one place (S09, AN-14): defaults and ids, the hour bar, the picker's answers and the list to save.
 * The whole page against the Cordova code is `AlarmPageTest` (core-data, corpus/alarms.json); these pin the rules alone.
 */
class AlarmSettingsTest {
    private val seoul = TimeZone.getTimeZone("Asia/Seoul")

    // 2026-11-07 12:00 in Seoul, the corpus's now.
    private val now = 1_794_020_400_000L
    private val myeongdong = Place(false, false, "명동", "대한민국 서울특별시 중구 명동", "KR", Location(37.56, 126.98), source = "KMA")
    private val places = listOf(Place.currentPositionPlaceholder(), myeongdong)
    private fun json(s: String) = Json.parseToJsonElement(s) as JsonObject
    private val town = """"name":"명동","source":"KMA","location":{"lat":37.56,"long":126.98},"town":{"first":"서울특별시","second":"중구","third":"명동"}"""

    @Test
    fun aPlaceWithoutRecordsGetsTheDefaultsAsEdits() {
        val s = AlarmSettings.load(emptyList(), 1, places, now, seoul)
        assertTrue(s.updated, "the defaults count as edits (D34)")
        assertEquals(7.0 to 22.0, s.startHour to s.endHour)
        assertEquals(listOf(false, true, true, true, true, true, false), s.days)
        assertEquals(listOf(1 to 7 * 3600 + 40 * 60, 2 to 20 * 3600 + 20 * 60).map { it.first - 1 to it.second }, s.rows(seoul))
        assertEquals(listOf(
            json("""{"cityIndex":1,"id":1,"startTime":"2026-11-06T22:00:00.000Z","endTime":"2026-11-07T13:00:00.000Z","enable":true,"category":"alert",$town}"""),
            json("""{"cityIndex":1,"id":2,"time":"2026-11-06T22:40:00.000Z","dayOfWeek":[false,true,true,true,true,true,false],"enable":true,"category":"alarm",$town}"""),
            json("""{"cityIndex":1,"id":3,"time":"2026-11-07T11:20:00.000Z","dayOfWeek":[false,true,true,true,true,true,false],"enable":true,"category":"alarm",$town}"""),
        ), s.toSave(now, seoul))
    }

    @Test
    fun storedRecordsLoadWithoutAnEditAndSaveNothing() {
        val records = listOf(
            json("""{"cityIndex":1,"id":4,"time":"2026-11-07T00:15:00.000Z","dayOfWeek":[true,false,false,false,false,false,true],"enable":false,"category":"alarm"}"""),
            json("""{"cityIndex":2,"id":1,"startTime":"2026-11-06T22:00:00.000Z","endTime":"2026-11-07T13:00:00.000Z","enable":true,"category":"alert"}"""),
            json("""{"cityIndex":1,"id":1,"startTime":"2026-11-06T23:00:00.000Z","endTime":"2026-11-07T12:00:00.000Z","enable":false,"category":"alert"}"""),
            json("""{"cityIndex":1,"id":5,"time":"2026-11-07T03:30:00.000Z","dayOfWeek":[false,false,false,true,false,false,false],"enable":true,"category":"alarm"}"""),
        )
        val s = AlarmSettings.load(records, 1, places, now, seoul)
        assertFalse(s.updated)
        assertNull(s.toSave(now, seoul))
        // The weekdays of the first alarm, the alert's local hours, the switch off and the bar hidden.
        assertEquals(listOf(true, false, false, false, false, false, true), s.days)
        assertEquals(8.0 to 21.0, s.startHour to s.endHour)
        assertFalse(s.alertOn)
        assertFalse(s.barShown)
        // Only enabled alarms are rows; the picker opens on the alarm's time or 08:00 for the add row.
        assertEquals(listOf(1 to 12 * 3600 + 30 * 60), s.rows(seoul))
        assertEquals(9 * 3600 + 15 * 60, s.pickerInput(0, seoul))
        assertEquals(8 * 3600, s.pickerInput(2, seoul))
    }

    @Test
    fun theAlertIdFollowsTheAlarmsAndNewAlarmsTheLastId() {
        val alarm = json("""{"cityIndex":1,"id":6,"time":"2026-11-07T00:15:00.000Z","dayOfWeek":[true,true,true,true,true,true,true],"enable":true,"category":"alarm"}""")
        val s = AlarmSettings.load(listOf(alarm), 1, places, now, seoul)
        // No alert yet: `_generateId` after the alarms gives 7.
        assertEquals(JsonPrimitive(7), s.alert["id"])
        // The next alarm takes the last alarm's id + 1, the alert's id too: the two share a sequence only by call order.
        val added = s.pick(1, 6 * 3600, places, now, seoul)
        assertEquals(listOf(6, 7), added.alarms.map { PushRecords.id(it) })
        assertEquals(listOf(true, true, true, true, true, true, true).let(PushRecords::days), added.alarms[1]["dayOfWeek"])
    }

    @Test
    fun thePickerSetsDeletesOrLeavesAnAlarm() {
        val s = AlarmSettings.load(emptyList(), 1, places, now, seoul).copy(updated = false)
        assertEquals(s, s.pick(0, null, places, now, seoul), "Close")
        val deleted = s.pick(0, 0, places, now, seoul)
        assertTrue(deleted.updated)
        assertEquals(listOf(false, true), deleted.alarms.map(PushRecords::enabled), "Delete keeps the alarm, disabled")
        assertEquals(listOf(1 to 20 * 3600 + 20 * 60), deleted.rows(seoul))
        // Delete on the add row only marks an edit.
        assertEquals(s.alarms, s.pick(2, 0, places, now, seoul).alarms)
        assertTrue(s.pick(2, 0, places, now, seoul).updated)
        val set = deleted.pick(0, 21 * 3600 + 15 * 60, places, now, seoul)
        assertEquals(listOf(true, true), set.alarms.map(PushRecords::enabled))
        assertEquals(JsonPrimitive("2026-11-07T12:15:00.000Z"), set.alarms[0]["time"])
    }

    @Test
    fun fiveEnabledAlarmsHideTheAddRow() {
        var s = AlarmSettings.load(emptyList(), 1, places, now, seoul)
        repeat(3) { s = s.pick(s.alarms.size, (9 + it) * 3600, places, now, seoul) }
        assertFalse(s.canAdd)
        assertTrue(s.pick(0, 0, places, now, seoul).canAdd)
    }

    @Test
    fun anEndOfMidnightIs24OnlyOnALaterDayOfTheMonth() {
        fun alert(start: String, end: String) = json("""{"cityIndex":1,"id":1,"startTime":"$start","endTime":"$end","enable":true,"category":"alert"}""")
        val alarm = json("""{"cityIndex":1,"id":2,"time":"2026-11-07T00:15:00.000Z","dayOfWeek":[true,true,true,true,true,true,true],"enable":true,"category":"alarm"}""")
        // 07–24 saved on 2026-11-06: the end is the 7th, 00:00.
        assertEquals(24.0, AlarmSettings.load(listOf(alert("2026-11-05T22:00:00.000Z", "2026-11-06T15:00:00.000Z"), alarm), 1, places, now, seoul).endHour)
        // Saved on October 31st: the end is November 1st, a smaller day of the month (A23).
        assertEquals(0.0, AlarmSettings.load(listOf(alert("2026-10-30T22:00:00.000Z", "2026-10-31T15:00:00.000Z"), alarm), 1, places, now, seoul).endHour)
        // 24 saves as tomorrow's 00:00.
        val s = AlarmSettings.load(listOf(alarm), 1, places, now, seoul).setHours(0.0, 24.0)
        assertEquals(JsonPrimitive("2026-11-07T15:00:00.000Z"), s.toSave(now, seoul)!![0]["endTime"])
    }

    @Test
    fun equalHoursIgnoreTheSwitch() {
        val s = AlarmSettings.load(emptyList(), 1, places, now, seoul).setAlert(false).setHours(9.0, 9.0)
        assertTrue(s.equalHours)
        assertFalse(s.alertOn)
        assertEquals(JsonPrimitive(false), s.toSave(now, seoul)!![0]["enable"])
    }
}
