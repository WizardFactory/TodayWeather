package net.wizardfactory.todayweather

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.Warnings
import net.wizardfactory.todayweather.core.domain.WeatherConverter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Runs the Kotlin core on the device (minSdk 24 included) against the golden corpus: the converter on
 * the captured responses and the warning parser, which uses the platform's time zone data.
 */
@RunWith(AndroidJUnit4::class)
class CoreOnDeviceTest {
    private val assets = InstrumentationRegistry.getInstrumentation().context.assets
    private fun read(path: String): JsonElement = Json.parseToJsonElement(assets.open("corpus/$path").bufferedReader().readText())

    @Test
    fun warningsParseOnThisApiLevel() {
        for (case in read("special.json").jsonArray.map { it.jsonObject }) {
            val args = case["args"]!!.jsonArray.map { it.jsonPrimitive.content }
            val input = case["input"] ?: read("inputs/special.json")
            assertEquals(args.toString(), case["expected"], Warnings.parse(input, args[0], args[1]))
        }
    }

    @Test
    fun capturedResponsesConvert() {
        for (name in listOf("kma-seoul", "vc-london", "vc-newyork", "vc-sydney", "vc-tokyo")) {
            val expected = read("conversion/$name.json").jsonObject["expected"]
            assertNotNull(name, expected)
            assertEquals(name, expected, WeatherConverter.convert(read("inputs/$name.json")))
        }
    }
}
