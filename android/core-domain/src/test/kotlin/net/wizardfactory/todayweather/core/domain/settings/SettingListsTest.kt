package net.wizardfactory.todayweather.core.domain.settings

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.chart.ChartTexts

/**
 * The settings pages' lists and labels, the menu's values, hand-offs and About against the Cordova controllers run under
 * Node (corpus/settings.json, tools/corpus/generate.mjs): every unit set's S07 rows in Korean and English, every S08
 * list, every value the menu shows (and one a list does not have), the wind map, store and feedback mail targets with
 * placeholder configuration, and the About popup in both languages.
 */
class SettingListsTest {
    private val corpus = Json.parseToJsonElement(File(javaClass.getResource("/corpus/settings.json")!!.toURI()).readText()).jsonObject
    private val catalogs = mapOf("ko" to catalog("values-ko"), "en" to catalog("values"))

    @Test
    fun unitsRowsAreUnitsCtrlsInBothLanguages() {
        val cases = corpus["units"]!!.jsonArray.map { it.jsonObject }
        assertEquals(22, cases.size)
        for (case in cases) {
            val name = "${case.str("name")} ${case.str("lang")}"
            val texts = catalogs.getValue(case.str("lang")!!)
            val units = case["units"]!!.jsonObject
            val rows = case["rows"]!!.jsonArray.map { it.jsonObject }
            assertEquals(SettingLists.UNITS, rows.map { it.str("name") }, name)
            for (row in rows) {
                val unit = row.str("name")!!
                val value = units[unit]!!.jsonPrimitive.content
                assertEquals(row.str("nameKey"), SettingLists.unitName(unit), "$name $unit")
                assertEquals(row.str("valueKey"), SettingLists.unitValue(unit, value), "$name $unit value")
                assertEquals(row.str("name_text"), texts[SettingLists.unitName(unit)], "$name $unit text")
                assertEquals(row.str("value_text"), SettingLists.unitValue(unit, value)?.let { texts[it] } ?: "", "$name $unit value text")
            }
        }
    }

    @Test
    fun everyListIsRadioListsWithItsTitleAndChoices() {
        val lists = corpus["lists"]!!.jsonArray.map { it.jsonObject }
        assertEquals(SettingLists.UNITS + SettingLists.SETTINGS, lists.map { it.str("name") })
        for (list in lists) {
            val name = list.str("name")!!
            val native = SettingLists.list(name)
            for ((lang, page) in listOf("ko" to list["page"]!!.jsonObject, "en" to list["en"]!!.jsonObject)) {
                assertEquals(page.str("title"), native.title, "$name $lang title")
                val items = page["items"]!!.jsonArray.map { it.jsonObject }
                assertEquals(items.map { Choice(it.str("label")!!, it.str("value")!!) }, native.choices, "$name $lang")
            }
            // The Korean label each choice shows (the translate filter keeps a missing key).
            val items = list["page"]!!.jsonObject["items"]!!.jsonArray.map { it.jsonObject }
            assertEquals(items.map { it.str("ko") }, native.choices.map { catalogs.getValue("ko")[it.label] }, "$name labels")
            assertEquals(name in SettingLists.UNITS, native.unit)
        }
    }

    @Test
    fun theMenuShowsTheValuesSettingCtrlGives() {
        val values = corpus["menuValues"]!!.jsonObject
        fun check(list: String, label: (String?) -> String) = values[list]!!.jsonArray.map { it.jsonObject }.forEach { v ->
            assertEquals(v.str("key"), label(v.str("value")), "$list ${v.str("value")}")
        }
        check("startupPage", SettingLists::startupPageLabel)
        check("refreshInterval", SettingLists::refreshIntervalLabel)
        check("theme", SettingLists::themeLabel)
        assertEquals("N/A", SettingLists.startupPageLabel(null))
    }

    @Test
    fun theHandOffsOpenTheCordovaTargets() {
        val config = corpus["config"]!!.jsonObject
        for (case in corpus["menu"]!!.jsonArray.map { it.jsonObject }) {
            val lang = case.str("lang")!!
            val row = case.str("row")!!
            val trace = case["trace"]!!.jsonArray.map { it.jsonArray }
            when (row) {
                "nullschool" -> assertEquals(listOf(listOf("InAppBrowser.open", Handoffs.NULLSCHOOL, "_system")), trace.map { e -> e.map { it.jsonPrimitive.content } }, lang)
                "openMarket" -> {
                    assertEquals(listOf("toggleLeft"), trace[0].map { it.jsonPrimitive.content }, "the menu closes first")
                    assertEquals(listOf("InAppBrowser.open", config.str("androidStoreUrl"), "_system"), trace[1].map { it.jsonPrimitive.content })
                    assertEquals(config.str("androidStoreUrl"), Handoffs.STORE)
                }
                "sendMail" -> {
                    assertEquals(listOf(listOf("toggleLeft")), trace.map { e -> e.map { it.jsonPrimitive.content } }, "the menu closes first")
                    val mail = Handoffs.feedbackMail(config.str("mailTo")!!, catalogs.getValue(lang)["LOC_SEND_FEEDBACK"], corpus.str("version")!!,
                        corpus.str("uuid")!!, corpus.str("ua")!!)
                    assertEquals(case.str("location"), mail, lang)
                }
                "openInfo" -> {
                    val alert = trace.single()[1].jsonObject
                    val about = About { catalogs.getValue(lang)[it] }
                    assertEquals(alert.str("title"), about.title, lang)
                    assertEquals(alert.str("template"), about.lines.joinToString("<br>"), lang)
                    assertEquals(alert.str("okText"), about.ok, lang)
                }
                else -> error(row)
            }
        }
    }

    @Test
    fun encodeUriComponentKeepsWhatJavaScriptKeeps() {
        assertEquals("a-_.!~*'()%20%2F%3F%3D%26%0A%EC%9D%98", Handoffs.encodeUriComponent("a-_.!~*'() /?=&\n의"))
    }

    @Test
    fun theAppLoadsEveryKeyThePagesShow() {
        val keys = SettingLists.KEYS.toSet()
        val shown = SettingLists.UNITS.map(SettingLists::unitName) + (SettingLists.UNITS + SettingLists.SETTINGS).flatMap { SettingLists.list(it).let { l -> listOf(l.title) + l.choices.map(Choice::label) } } +
            About.KEYS + listOf("LOC_UNITS", "LOC_SEND_FEEDBACK", "LOC_WEATHER")
        assertTrue(keys.containsAll(shown.filter { it.startsWith("LOC_") }), (shown.toSet() - keys).toString())
        for (key in keys) assertTrue(catalogs.getValue("ko").has(key) && catalogs.getValue("en").has(key), "$key is in the catalogs")
    }

    private class Catalog(private val strings: Map<String, String>) {
        operator fun get(key: String): String = ChartTexts(strings)[key]
        fun has(key: String) = key in strings
    }

    private fun catalog(dir: String): Catalog {
        val xml = File(System.getProperty("tw.projectDir"), "../app/src/main/res/$dir/client_strings.xml").readText()
        return Catalog(Regex("<string name=\"([^\"]+)\"[^>]*>(.*?)</string>").findAll(xml).associate { m ->
            m.groupValues[1] to m.groupValues[2].replace("\\'", "'").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        })
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it != JsonNull }?.content
}
