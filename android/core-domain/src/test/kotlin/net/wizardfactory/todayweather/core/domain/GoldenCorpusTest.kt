package net.wizardfactory.todayweather.core.domain

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Compares the Kotlin weather core with outputs of the Cordova client code
 * (android/tools/corpus/generate.mjs). Every case in the corpus must match exactly.
 */
class GoldenCorpusTest {
    private val corpus = File(javaClass.getResource("/corpus/functions.json")!!.toURI()).parentFile
    private fun read(name: String): JsonElement = Json.parseToJsonElement(File(corpus, name).readText())

    @Test
    fun conversionMatchesCordova() {
        val cases = File(corpus, "conversion").listFiles()!!.sorted()
        assertTrue(cases.size >= 29, "corpus has ${cases.size} conversion cases")
        for (file in cases) {
            val case = Json.parseToJsonElement(file.readText()).jsonObject
            val input = case["input"] ?: read(case["inputFile"]!!.jsonPrimitive.content)
            val actual = WeatherConverter.convert(input)
            val expected = case["expected"]
            if (expected == null || expected is JsonNull) {
                assertEquals(null, actual, "${file.name}: Cordova returned null")
            } else {
                assertJsonEquals(expected, actual ?: fail("${file.name}: Kotlin returned null"), file.name)
            }
        }
    }

    @Test
    fun functionsMatchCordova() {
        val functions = read("functions.json").jsonObject
        fun cases(name: String) = functions[name]!!.jsonArray.map { it.jsonObject["args"]!!.jsonArray to it.jsonObject["expected"]!! }
        fun str(e: JsonElement) = e.jsonPrimitive.content

        for ((args, expected) in cases("shortenAddress")) {
            assertEquals(str(expected), AddressFormat.shorten(str(args[0])), "shortenAddress $args")
        }
        for ((args, expected) in cases("addressArray")) {
            assertEquals(expected.jsonArray.map(::str), AddressFormat.split(str(args[0])), "addressArray $args")
        }
        for ((args, expected) in cases("townFromAddress")) {
            val town = AddressFormat.town(AddressFormat.split(str(args[0])))
            val e = expected.jsonObject
            assertEquals(Town(str(e["first"]!!), str(e["second"]!!), str(e["third"]!!)), town, "townFromAddress $args")
        }
        for ((args, expected) in cases("weatherEmoji")) {
            assertEquals(str(expected), ForecastText.weatherEmoji(str(args[0])), "weatherEmoji $args")
        }
        for ((args, expected) in cases("geolocationNormalize")) {
            val a = args[0].jsonObject
            val (lat, long) = GeoLocation.normalize(a["lat"]!!.jsonPrimitive.double, a["long"]!!.jsonPrimitive.double)
            assertEquals(expected.jsonObject["lat"]!!.jsonPrimitive.double, lat, "lat $args")
            assertEquals(expected.jsonObject["long"]!!.jsonPrimitive.double, long, "long $args")
        }
        val en = yesterdayText("values")
        val ko = yesterdayText("values-ko")
        for ((args, expected) in cases("diffTodayYesterday")) {
            val text = if (str(args[0]) == "ko") ko else en
            val current = args[2].jsonObject["t1h"]
            val yesterday = args[3] as? JsonObject
            assertEquals(str(expected), ForecastText.diffTodayYesterday(current, yesterday, str(args[1]) == "F", text), "diff $args")
        }
        for ((args, expected) in cases("rainSnowFall")) {
            assertJsonEquals(expected, ForecastText.rainSnowFall(args[0].jsonObject), "rainSnowFall $args")
        }
        for ((args, expected) in cases("rainSnowFallSymbol")) {
            assertEquals(str(expected), ForecastText.rainSnowFallSymbol(args[0].jsonObject), "symbol $args")
        }
        for ((args, expected) in cases("todayPosition")) {
            val city = WeatherConverter.convert(read("inputs/${str(args[0])}.json"))!!
            val position = ChartPosition.todayOffset(str(args[1]), args[2].jsonPrimitive.double, city)
            assertEquals(expected.jsonPrimitive.double, position, 1e-9, "todayPosition $args")
        }
    }

    @Test
    fun lateResponseIsAListedDifference() {
        val case = read("weather-info.json").jsonArray.single().jsonObject
        assertEquals(0, case["requestedForIndex"]!!.jsonPrimitive.content.toInt())
        assertEquals(1, case["appliedToIndex"]!!.jsonPrimitive.content.toInt(), "Cordova applies late responses to the new selection")
        val differences = File(System.getProperty("tw.projectDir"), "../tools/corpus/differences.md")
        assertTrue(differences.readText().contains("A01"), "A01 must be listed in differences.md")
    }

    /** The imported Cordova catalog strings (android/app/src/main/res), not copies in the test. */
    private fun yesterdayText(dir: String): YesterdayText {
        val xml = File(System.getProperty("tw.projectDir"), "../app/src/main/res/$dir/client_strings.xml").readText()
        fun get(key: String) = Regex("<string name=\"$key\"[^>]*>(.*?)</string>").find(xml)!!.groupValues[1]
        return YesterdayText(same = get("LOC_SAME_AS_YESTERDAY"), than = get("LOC_THAN_YESTERDAY"))
    }

    private fun assertJsonEquals(expected: JsonElement, actual: JsonElement, path: String) {
        when {
            expected is JsonObject && actual is JsonObject -> {
                assertEquals(expected.keys, actual.keys, "$path: keys")
                for (key in expected.keys) assertJsonEquals(expected[key]!!, actual[key]!!, "$path.$key")
            }
            expected is JsonArray && actual is JsonArray -> {
                assertEquals(expected.size, actual.size, "$path: size")
                expected.indices.forEach { assertJsonEquals(expected[it], actual[it], "$path[$it]") }
            }
            expected is JsonPrimitive && actual is JsonPrimitive && !expected.isString && !actual.isString &&
                expected.doubleOrNull != null && actual.doubleOrNull != null ->
                assertEquals(expected.double, actual.double, "$path: number")
            else -> assertEquals(expected, actual, path)
        }
    }
}
