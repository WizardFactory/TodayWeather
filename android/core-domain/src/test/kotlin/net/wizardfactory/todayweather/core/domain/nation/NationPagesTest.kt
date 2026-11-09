package net.wizardfactory.todayweather.core.domain.nation

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.Nationwide
import net.wizardfactory.todayweather.core.domain.Warnings
import net.wizardfactory.todayweather.core.model.NationResponse

/**
 * What S10, S11 and S12 show (#2892 AC1), against the pages the Cordova build drew from the same answers
 * (nation-reference/<lang>/<state>.json: every label's name, icon and values, every card's parts); the empty and
 * failed answers; and `ng-bind-html` of the comments.
 */
class NationPagesTest {
    private val corpus = File(javaClass.getResource("/corpus")!!.toURI())
    private val nation = NationResponse(Json.parseToJsonElement(File(corpus, "inputs/nation.json").readText()).jsonObject)
    private val special = Json.parseToJsonElement(File(corpus, "inputs/special.json").readText())
    private val references = File("../app/src/test/resources/nation-reference")
    private val kr = mapOf("temperatureUnit" to "C", "windSpeedUnit" to "m/s", "precipitationUnit" to "mm", "airUnit" to "airkorea")

    private fun capture(state: String) = Json.parseToJsonElement(File(references, "$state.json").readText()).jsonObject

    /** A captured label: its name, icon file and the text of each value line (value and unit). */
    private data class Drawn(val name: String, val icon: String?, val lines: List<String>, val background: String)

    private fun drawn(state: String): List<Drawn> = capture(state)["labels"]!!.jsonArray.map { it.jsonObject }.map { l ->
        val parts = l["parts"]!!.jsonArray.map { it.jsonObject }
        val name = l["name"]!!.jsonPrimitive.content
        // The value lines are the label's inner divs with their own text (the outer div has none); a unit is its span.
        val values = parts.drop(2).filter { it["tag"]!!.jsonPrimitive.content == "div" }.map { div ->
            val text = div["text"]!!.jsonPrimitive.content
            val span = parts.firstOrNull { it["tag"]!!.jsonPrimitive.content == "span" && it["rect"]!!.jsonObject["y"]!!.jsonPrimitive.content
                .toDouble() > div["rect"]!!.jsonObject["y"]!!.jsonPrimitive.content.toDouble() - 1 &&
                it["rect"]!!.jsonObject["y"]!!.jsonPrimitive.content.toDouble() < div["rect"]!!.jsonObject["y"]!!.jsonPrimitive.content.toDouble() +
                div["rect"]!!.jsonObject["h"]!!.jsonPrimitive.content.toDouble() }
            text + (span?.get("text")?.jsonPrimitive?.content ?: "")
        }
        val icon = parts.firstOrNull { it["tag"]!!.jsonPrimitive.content == "img" }?.get("src")?.jsonPrimitive?.content
        Drawn(name, icon?.substringAfterLast('/')?.removeSuffix(".png"), values, l["style"]!!.jsonObject["background"]!!.jsonPrimitive.content)
    }

    private fun native(labels: List<NationLabel>) = labels.map { l ->
        Drawn(l.name, l.icon, l.lines.map { it.text + it.unit }, css(l.background))
    }

    /** `rgba(50,161,255,0.8)` as the computed style writes it: `rgba(50, 161, 255, 0.8)`. */
    private fun css(color: String) = color.replace(Regex(""",\s*"""), ", ")

    @Test
    fun weatherLabelsAreTheCordovaOnes() {
        for ((state, mode, units) in listOf(Triple("nation-weather", Nationwide.Mode.SKY_TEMPERATURE, kr), Triple("nation-rain", Nationwide.Mode.RAIN, kr),
            Triple("nation-wind", Nationwide.Mode.WIND, kr), Triple("nation-wind-kph", Nationwide.Mode.WIND, kr + ("windSpeedUnit" to "km/h")))) {
            assertEquals(drawn("ko-KR/$state"), native(NationPages.weather(nation, mode) { units[it] }), state)
        }
        assertEquals(drawn("en-KR/nation-weather"), native(NationPages.weather(nation, Nationwide.Mode.SKY_TEMPERATURE) { kr[it] }))
    }

    @Test
    fun airLabelsAreTheCordovaOnes() {
        for (type in Nationwide.AIR_TYPES) {
            assertEquals(drawn("ko-KR/nation-air-$type"), native(NationPages.air(nation, type, "airkorea")), type)
        }
        assertEquals(drawn("ko-KR/nation-air-pm2.5-airnow"), native(NationPages.air(nation, "pm2.5", "airnow")))
        assertEquals(drawn("en-KR/nation-air-pm2.5"), native(NationPages.air(nation, "pm2.5", "airkorea")))
    }

    @Test
    fun withoutAnAnswerTheLabelsShowTheirNames() {
        // A failed request (the capture's 500) or an empty answer: names on translucent black, no icon or value.
        val empty = NationResponse(JsonObject(mapOf("nation" to JsonPrimitive("KR"), "weather" to JsonArray(emptyList()), "air" to JsonArray(emptyList()))))
        for (response in listOf(null, empty)) {
            assertEquals(drawn("ko-KR/nation-weather-failed"), native(NationPages.weather(response, Nationwide.Mode.SKY_TEMPERATURE) { kr[it] }))
            assertEquals(drawn("ko-KR/nation-air-failed"), native(NationPages.air(response, "pm2.5", "airkorea")))
        }
    }

    @Test
    fun theTitleIsTheRegionsName() {
        assertEquals("LOC_KOREA", NationPages.title("KR"))
        assertEquals("LOC_CHINA", NationPages.title("JP")) // as getNationName has it
        assertEquals(null, NationPages.title("FR"))
    }

    /**
     * A captured card: its heading, the bold lines and the other lines, in order. The comment span's own text is its
     * text nodes run together (the <br>s between them leave nothing), so it is compared without white space.
     */
    private fun drawnCard(lang: String, i: Int): List<Pair<String, String>> {
        val card = capture("$lang/warnings-$i")["card"]!!.jsonObject
        return card["parts"]!!.jsonArray.map { it.jsonObject }.filter { it["text"]!!.jsonPrimitive.content.isNotEmpty() }.map {
            val tag = it["tag"]!!.jsonPrimitive.content
            val text = it["text"]!!.jsonPrimitive.content
            tag to if (tag == "span") text.filterNot(Char::isWhitespace) else text
        }
    }

    /** The same parts from a native card: h2, then per situation its b and info divs, the note's b, the comment span. */
    private fun nativeCard(card: WarningCard, note: String): List<Pair<String, String>> = buildList {
        add("h2" to card.heading)
        card.situations.forEach { s -> add("b" to s.title); s.lines.forEach { add("div" to it) } }
        if (card.note) add("b" to note)
        if (card.comment.isNotEmpty()) add("span" to card.comment.joinToString("").filterNot(Char::isWhitespace))
    }

    @Test
    fun warningCardsAreTheCordovaOnes() {
        for ((lang, note) in listOf("ko-KR" to "<참고사항>", "en-KR" to "<Note>")) {
            val cards = WarningCards.cards(Warnings.parse(special, lang, "Asia/Seoul"))
            assertEquals(3, cards.size)
            cards.forEachIndexed { i, card -> assertEquals(drawnCard(lang, i), nativeCard(card, note), "$lang card $i") }
        }
    }

    @Test
    fun theNoteShowsForNumericTypesOneAndTwo() {
        fun note(type: kotlinx.serialization.json.JsonElement) =
            WarningCards.cards(JsonArray(listOf(JsonObject(mapOf("type" to type, "comment" to JsonPrimitive("c")))))).single().note
        assertTrue(note(JsonPrimitive(1)) && note(JsonPrimitive(2)) && note(JsonPrimitive(1.0)))
        // Strict equality: a string type, other types and a missing type hide it.
        assertTrue(listOf(JsonPrimitive("1"), JsonPrimitive(3), JsonPrimitive(4), JsonNull, JsonPrimitive(true)).none { note(it) })
    }

    @Test
    fun noCardForAnythingButAList() {
        for (answer in listOf(null, JsonNull, JsonPrimitive("x"), JsonObject(emptyMap()))) assertEquals(emptyList(), WarningCards.cards(answer))
        assertEquals(emptyList(), WarningCards.cards(JsonArray(emptyList())))
    }

    @Test
    fun missingFieldsShowNothing() {
        // `{{undefined}}` is empty; an item without info or situations has no lines; a missing comment no span.
        val card = WarningCards.cards(JsonArray(listOf(JsonObject(mapOf("situationList" to JsonArray(listOf(JsonObject(emptyMap())))))))).single()
        assertEquals("", card.heading)
        assertEquals(listOf(WarningSituation("", emptyList())), card.situations)
        assertEquals(emptyList(), card.comment)
        assertEquals(false, card.note)
    }

    @Test
    fun numericEntitiesDecodeAsTheHtmlParserDoes() {
        fun lines(html: String) = BoundHtml.lines(JsonPrimitive(html))
        // Outside Unicode, zero, a surrogate and an overflowing number become U+FFFD (review F1: they threw).
        assertEquals(listOf("a \uFFFD b \uFFFD c \uFFFD d \uFFFD e \uFFFD"), lines("a &#1114112; b &#x110000; c &#0; d &#xD800; e &#99999999999;"))
        // 0x80-0x9F follow windows-1252 where it has a character, as the HTML parser's table does.
        assertEquals(listOf("\u20AC \u201A \u0178 \u0081"), lines("&#128; &#x82; &#159; &#129;"))
        assertEquals(listOf("\uAC00 \uD83D\uDE00"), lines("&#xAC00; &#128512;"))
    }

    @Test
    fun boundHtmlIsWhatSanitizeLeaves() {
        fun lines(html: String) = BoundHtml.lines(JsonPrimitive(html))
        assertEquals(listOf("a", "b"), lines("a<br>b"))
        assertEquals(listOf("a", "", "b"), lines("a<br><br>b"))
        assertEquals(listOf("a"), lines("a<br>"), "a final <br> makes no empty line")
        assertEquals(listOf("a", ""), lines("a<br><br>"))
        assertEquals(listOf("a b"), lines("  a \t\n b  "), "white space collapses")
        assertEquals(listOf("<참고사항> & \"x\""), lines("&lt;참고사항&gt; &amp; &quot;x&quot;"))
        assertEquals(listOf("bold"), lines("<b>bold</b><script>alert(1)</script><!-- c -->"))
        assertEquals(listOf("<기온 현황과 전망>"), lines("<기온 현황과 전망>"), "a < before Korean is text")
        assertEquals(listOf("a  b"), lines("a&nbsp; b"), "a no-break space stays")
        assertEquals(listOf("x", "y"), lines("x<BR/>y"))
        assertEquals(emptyList(), BoundHtml.lines(null))
        assertEquals(emptyList(), BoundHtml.lines(JsonNull))
    }
}
