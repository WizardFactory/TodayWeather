package net.wizardfactory.todayweather.core.data

import java.io.File
import java.util.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import net.wizardfactory.todayweather.core.domain.alarms.AlarmRow
import net.wizardfactory.todayweather.core.domain.alarms.TimePicker
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.PushRegistration
import net.wizardfactory.todayweather.core.storage.PushRequest
import net.wizardfactory.todayweather.core.storage.PushState
import net.wizardfactory.todayweather.core.storage.UnitSettings

/**
 * S09 (AN-14, #2893) against PushCtrl and the `Push` service run in Node (corpus/alarms.json, tools/corpus/generate.mjs):
 * every case opens the page and replays its steps (weekdays, the switch, the hour bar, the picker's Set, Delete and Close,
 * Cancel, Save, the popups' answers and Android back, the permission). After each step the rows, the add row, the
 * weekdays, the switch, the popup that opened, the requests, the saved list, going back, the permission calls and the
 * selected place equal Cordova's.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AlarmPageTest {
    private val corpus = Json.parseToJsonElement(File(javaClass.getResource("/corpus/alarms.json")!!.toURI()).readText()).jsonObject
    private val zone = TimeZone.getTimeZone(corpus["zone"]!!.jsonPrimitive.content)
    private val now = corpus["now"]!!.jsonPrimitive.long
    private val ctx = PushRegistration.Context("device-uuid", "ko-KR", "1.1.1", UnitSettings.defaults("KR"), now, zone)

    private class Memory(var value: AppState) : StateAccess {
        override fun current() = value
        override fun change(update: (AppState) -> AppState) { value = update(value) }
    }

    private class Access(override val available: Boolean, var on: Boolean) : NotificationAccess {
        val calls = mutableListOf<String>()
        override fun enabled(): Boolean { calls += "has"; return on }
        override suspend fun request(): Boolean { calls += "grant"; return on }
    }

    private fun place(json: JsonObject): Place {
        val loc = json["location"]!!.jsonObject
        return Place(currentPosition = json["currentPosition"]!!.jsonPrimitive.boolean, disable = json["disable"]!!.jsonPrimitive.boolean,
            name = json["name"]?.jsonPrimitive?.content, address = json["address"]?.jsonPrimitive?.content,
            country = json["country"]?.jsonPrimitive?.content, source = json["source"]?.jsonPrimitive?.content,
            location = Location(loc["lat"]!!.jsonPrimitive.content.toDouble(), loc["long"]!!.jsonPrimitive.content.toDouble()))
    }

    @Test
    fun everyCordovaSessionReplaysAlike() = runTest {
        val cases = corpus["pages"]!!.jsonArray.map { it.jsonObject }
        assertEquals(26, cases.size)
        for (c in cases) check(c)
    }

    private fun kotlinx.coroutines.test.TestScope.check(c: JsonObject) {
        val name = c["name"]!!.jsonPrimitive.content
        val places = c["cities"]!!.jsonArray.map { place(it.jsonObject) }
        val token = c["storedToken"]?.takeIf { it != JsonNull }?.jsonPrimitive?.content
        val memory = Memory(AppState(places = places, placeIndex = (c["selected"]?.jsonPrimitive?.int ?: 1),
            units = UnitSettings.defaults("KR"), push = PushState(fcmToken = token, records = c["list"]!!.jsonArray.map { it.jsonObject })))
        val access = Access(c["inited"]?.jsonPrimitive?.boolean ?: true, c["permission"]?.jsonPrimitive?.boolean ?: true)
        val requests = mutableListOf<PushRequest>()
        val settingsOpened = mutableListOf<String>()
        var saved = false
        // The save changed the state; its post sends the place's list as stored (`placePost`).
        val page = AlarmPage(memory, access, post = { index ->
            requests += PushRegistration.placePost(memory.value.push, index, ctx)
            saved = true
        }, openSettings = { settingsOpened += "app" }, scope = backgroundScope, clock = { now }, zone = { zone })
        page.open(c["fav"]?.jsonPrimitive?.int)
        runCurrent()

        fun compare(expected: JsonObject, label: String, closedBefore: Boolean) {
            val s = page.settings.value!!
            assertEquals(expected["title"]!!.jsonPrimitive.content, page.title.value, "$label title")
            val rows = expected["rows"]!!.jsonArray.map { it.jsonObject }
            assertEquals(rows.map { it["id"]!!.jsonPrimitive.int to it["enable"]!!.jsonPrimitive.boolean },
                s.alarms.map { it["id"]!!.jsonPrimitive.int to (it["enable"]!!.jsonPrimitive.boolean) }, "$label alarms")
            assertEquals(rows.filter { it["enable"]!!.jsonPrimitive.boolean }.map { it["text"]!!.jsonPrimitive.content },
                s.rows(zone).map { AlarmRow.text(it.second) }, "$label rows")
            assertEquals(expected["canAdd"]!!.jsonPrimitive.boolean, s.canAdd, "$label add row")
            assertEquals(expected["days"]!!.jsonArray.map { it.jsonPrimitive.boolean }, s.days, "$label weekdays")
            assertEquals(expected["alertOn"]!!.jsonPrimitive.boolean, s.alertOn, "$label switch")
            val opened = expected["opened"]!!.jsonArray.map { it.jsonObject }
            val popup = page.popup.value
            if (opened.isEmpty()) {
                assertEquals(null, popup, "$label: no popup")
            } else {
                val o = opened.last()
                when (o["kind"]!!.jsonPrimitive.content) {
                    "picker" -> {
                        val p = popup as AlarmPopup.Picker
                        assertEquals(TimePicker.of(o["inputTime"]!!.jsonPrimitive.int), p.time, "$label picker")
                        assertEquals(listOf("setLabel", "cancelLabel", "closeLabel").map { o[it]!!.jsonPrimitive.content }, p.buttons.map { it.first }, label)
                    }
                    else -> {
                        assertEquals(o["title"]?.takeIf { it != JsonNull }?.jsonPrimitive?.content, popup!!.title, "$label popup title")
                        assertEquals(o["template"]!!.jsonPrimitive.content, popup.body, "$label popup body")
                        assertEquals(o["buttons"]!!.jsonArray.map { b -> b.jsonObject["text"]!!.jsonPrimitive.content to (b.jsonObject["type"]?.takeIf { it != JsonNull }?.jsonPrimitive?.content == "button-dark") },
                            popup.buttons, "$label popup buttons")
                    }
                }
            }
            val sent = expected["requests"]!!.jsonArray.map { it.jsonObject }
            assertEquals(sent.size, requests.size, "$label request count")
            sent.zip(requests).forEach { (e, a) ->
                assertEquals(e["method"]!!.jsonPrimitive.content, a.method, label)
                assertEquals(e["url"]!!.jsonPrimitive.content.removePrefix("https://server").replace("/v000902/", "/v000903/"), a.path, label)
                assertEquals(e["headers"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }, a.headers, label)
                assertEquals(e["data"], a.body, "$label body")
            }
            requests.clear()
            val list = expected["saved"]?.takeIf { it != JsonNull }?.jsonArray?.map { it.jsonObject }
            assertEquals(list != null, saved, "$label saved")
            if (list != null) assertEquals(list, memory.value.push.records, "$label saved list")
            saved = false
            assertEquals(expected["back"]!!.jsonPrimitive.int > 0, page.closed.value && !closedBefore, "$label back")
            assertEquals(expected["permission"]!!.jsonArray.map { it.jsonPrimitive.content }, access.calls, "$label permission")
            access.calls.clear()
            assertEquals(expected["selected"]!!.jsonPrimitive.int, memory.value.placeIndex, "$label selected")
        }

        val open = c["open"]!!.jsonObject
        val slider = open["slider"]!!.jsonObject
        val s = page.settings.value!!
        assertEquals(slider["from"]!!.jsonPrimitive.content.toDouble() to slider["to"]!!.jsonPrimitive.content.toDouble(), s.startHour to s.endHour,
            "$name hour bar")
        compare(open, "$name open", closedBefore = false)
        for (after in c["after"]!!.jsonArray.map { it.jsonObject }) {
            val step = after["step"]!!.jsonObject
            val closedBefore = page.closed.value
            when (step["op"]!!.jsonPrimitive.content) {
                "day" -> page.toggleDay(step["day"]!!.jsonPrimitive.int)
                "alert" -> page.setAlert(step["enable"]!!.jsonPrimitive.boolean)
                "hours" -> page.setHours(step["from"]!!.jsonPrimitive.content.toDouble(), step["to"]!!.jsonPrimitive.content.toDouble())
                "picker" -> page.openPicker(step["index"]!!.jsonPrimitive.int)
                "set" -> page.answerPicker(step["secs"]!!.jsonPrimitive.int)
                "delete" -> page.answerPicker(0)
                "close" -> page.answerPicker(null)
                "cancel" -> page.cancel()
                "save" -> page.save()
                "answer" -> when (step["value"]?.jsonPrimitive?.content) {
                    "save" -> page.answerSaveChanges(true)
                    "close" -> if (page.popup.value == AlarmPopup.SaveChanges) page.answerSaveChanges(false) else page.answerPermission(false)
                    "settings" -> page.answerPermission(true)
                    else -> page.back()
                }
                "permission" -> access.on = step["enabled"]!!.jsonPrimitive.boolean
            }
            runCurrent()
            compare(after, "$name $step", closedBefore)
        }
        assertEquals(c["settingsOpened"]!!.jsonArray.map { it.jsonPrimitive.content }, settingsOpened, "$name settings")
    }

    @Test
    fun androidBackLeavesWithoutTheConfirmationAndClosesPopups() = runTest {
        val memory = Memory(AppState(places = listOf(Place.currentPositionPlaceholder(), Place(false, false, "서울", "대한민국 서울특별시", "KR",
            Location(37.567, 126.978))), placeIndex = 1, units = UnitSettings.defaults("KR")))
        val access = Access(available = true, on = true)
        var saves = 0
        val page = AlarmPage(memory, access, post = { saves++ }, openSettings = {}, scope = backgroundScope, clock = { now }, zone = { zone })
        page.open(1)
        runCurrent()
        // The defaults are edits, yet back leaves at once without O12 and saves nothing (D34).
        page.openPicker(0)
        page.back()
        assertEquals(null, page.popup.value, "back closes the picker without an answer")
        assertEquals(false, page.closed.value)
        page.back()
        assertEquals(true, page.closed.value)
        assertEquals(0, saves)
    }
}
