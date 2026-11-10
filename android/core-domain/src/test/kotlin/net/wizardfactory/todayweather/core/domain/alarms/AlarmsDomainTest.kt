package net.wizardfactory.todayweather.core.domain.alarms

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The time picker O14, a notification tap's place and the foreground popup O07 (AN-14, #2893) against the Cordova code
 * run in Node (corpus/alarms.json, tools/corpus/generate.mjs): ionic-timepicker with the app's configuration and the
 * notification callback of `Push.init`.
 */
class AlarmsDomainTest {
    private val corpus = Json.parseToJsonElement(File(javaClass.getResource("/corpus/alarms.json")!!.toURI()).readText()).jsonObject

    @Test
    fun thePickerOpensStepsAndSetsAsIonicTimepickerDoes() {
        val cases = corpus["picker"]!!.jsonArray.map { it.jsonObject }
        assertEquals(63, cases.size)
        for (c in cases) {
            val input = c["inputTime"]!!.jsonPrimitive.int
            val steps = c["steps"]!!.jsonArray.map { it.jsonPrimitive.content }
            val name = "$input $steps"
            val opening = TimePicker.of(input)
            val o = c["opening"]!!.jsonObject
            assertEquals(Triple(o["hours"]!!.jsonPrimitive.content, o["minutes"]!!.jsonPrimitive.content, o["meridian"]!!.jsonPrimitive.content),
                Triple(opening.hours, opening.minutes, opening.meridian), name)
            val shown = steps.fold(opening) { t, s ->
                when (s) {
                    "up" -> t.increaseHours()
                    "down" -> t.decreaseHours()
                    "minUp" -> t.increaseMinutes()
                    "minDown" -> t.decreaseMinutes()
                    else -> t.changeMeridian()
                }
            }
            val sh = c["shown"]!!.jsonObject
            assertEquals(Triple(sh["hours"]!!.jsonPrimitive.content, sh["minutes"]!!.jsonPrimitive.content, sh["meridian"]!!.jsonPrimitive.content),
                Triple(shown.hours, shown.minutes, shown.meridian), name)
            assertEquals("${sh["hours"]!!.jsonPrimitive.content} : ${sh["minutes"]!!.jsonPrimitive.content} ${sh["meridian"]!!.jsonPrimitive.content}",
                shown.heading, name)
            assertEquals(c["set"]!!.jsonPrimitive.int, shown.seconds(), name)
            // Delete answers 0 and Close nothing, whatever the time.
            assertEquals(0, c["deleted"]!!.jsonPrimitive.int, name)
            assertEquals(JsonNull, c["closed"], name)
        }
        // Noon opens as 12 AM, so Set turns 12:00 PM into 0 (Delete) and 12:30 PM into 00:30 (kept, AN-06).
        assertEquals(0, TimePicker.of(12 * 3600).seconds())
        assertEquals(30 * 60, TimePicker.of(12 * 3600 + 30 * 60).seconds())
        assertEquals(listOf("Set", "Delete", "Close"), cases[0]["buttons"]!!.jsonArray.map { it.jsonObject["text"]!!.jsonPrimitive.content })
    }

    @Test
    fun aTapSelectsThePlaceItsCityIndexParsesTo() {
        val cases = corpus["taps"]!!.jsonArray.map { it.jsonObject }
        for (c in cases) {
            val payload = c["payload"]!!.jsonObject
            if (payload["tap"] == null) continue
            val events = c["events"]!!.jsonArray.map { it.jsonArray }
            val expected = events.firstOrNull { it[0].jsonPrimitive.content == "setCityIndex" }?.get(1)?.jsonPrimitive?.intOrNull
            val actual = NotificationTap.placeIndex(payload["cityIndex"]?.jsonPrimitive?.content)
            assertEquals(expected, actual?.toInt(), payload.toString())
            // A parsed index always reloads ('push'), also out of range; no number does nothing.
            assertEquals(if (expected == null) 0 else 1, events.count { it[0].jsonPrimitive.content == "reloadEvent" }, payload.toString())
        }
    }

    @Test
    fun theForegroundPopupJoinsTheTitleAndBodyWithABreak() {
        val cases = corpus["taps"]!!.jsonArray.map { it.jsonObject }.filter { it["payload"]!!.jsonObject["tap"] == null }
        assertEquals(4, cases.size)
        for (c in cases) {
            val payload = c["payload"]!!.jsonObject
            val event = c["events"]!!.jsonArray.single().jsonArray[1].jsonObject
            // TabCtrl's template: the title, a break only when both are there, then the message (the body on Android).
            val expected = listOfNotNull(event["title"]?.jsonPrimitive?.content?.takeIf { it.isNotEmpty() },
                event["message"]?.jsonPrimitive?.content?.takeIf { it.isNotEmpty() }).joinToString("<br>")
            assertEquals(expected, ForegroundMessage.template(payload["title"]?.jsonPrimitive?.content, payload["body"]?.jsonPrimitive?.content),
                payload.toString())
        }
    }

    @Test
    fun anAlarmRowShowsTheLocalHourUnpaddedAndTwoDigitMinutes() {
        assertEquals("7:40", AlarmRow.text(7 * 3600 + 40 * 60))
        assertEquals("0:05", AlarmRow.text(5 * 60))
        assertEquals("21:15", AlarmRow.text(21 * 3600 + 15 * 60))
    }
}
