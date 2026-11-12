package net.wizardfactory.todayweather.ui.text

import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextMotion
import java.io.File
import kotlinx.serialization.json.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.createFontFamilyResolver
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.sp
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Text broken and drawn as Chrome does it (#2892): break opportunities between Korean letters whatever the platform
 * keeps whole (Samsung's Android keeps Korean words), none inside a value such as 1.6km/h; the characters Roboto has
 * stay in Roboto between Korean letters.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-xhdpi")
class ChromeTextTest {
    private val measurer = TextMeasurer(createFontFamilyResolver(ApplicationProvider.getApplicationContext()), Density(2f), LayoutDirection.Ltr)
    private val style = TextStyle(fontSize = 16.sp)

    @Test
    fun breaksGoBetweenKoreanLettersAndAroundBrackets() {
        val b = chromeBreaks("경상북도(울진평지), 1.6km/h")
        assertEquals("경\u200B상\u200B북\u200B도\u200B(울\u200B진\u200B평\u200B지), 1.6km/\u2060h", b.text)
        // Each index of the text with breaks stands for the original character it precedes, and the end for the end.
        assertEquals("경상북도(울진평지), 1.6km/h".length, b.source.last())
        assertEquals(b.text.length + 1, b.source.size)
        b.text.forEachIndexed { i, c -> if (c != '\u200B' && c != '\u2060') assertEquals(c, "경상북도(울진평지), 1.6km/h"[b.source[i]]) }
    }

    @Test
    fun noBreakBeforePunctuationOrInsideLatin() {
        assertEquals("다, 동", chromeBreaks("다, 동").text)
        assertEquals("1.6km/\u2060h", chromeBreaks("1.6km/h").text)
        assertEquals("<참\u200B고\u200B사\u200B항>", chromeBreaks("<참고사항>").text)
    }

    @Test
    fun linesBreakBetweenSyllablesAndKeepTheText() {
        val text = "동해남부앞바다(경북남부앞바다, 경북북부앞바다), 동해남부남쪽안쪽먼바다"
        val width = measurer.measure("동해남부앞바다(경북남부앞바다, 경북북부앞바다), 동해남", style).size.width
        val lines = chromeLines(measurer, text, style, width)
        assertEquals(text, lines.joinToString(""))
        assertEquals("동해남부앞바다(경북남부앞바다, 경북북부앞바다), 동해남", lines.first())
        assertTrue(lines.none { '\u200B' in it })
    }

    @Test
    fun theWidestPieceIsASyllableOrAWholeValue() {
        val syllable = measurer.measure("북", style).size.width
        assertTrue(chromeMinWidth(measurer, "북북서", style) <= syllable + 1)
        assertEquals(measurer.measure("1.6km/h", style).size.width, chromeMinWidth(measurer, "1.6km/h", style))
    }


    @Test
    fun englishAlarmDescriptionKeepsTheCapturedSlashWordsWhole() {
        val root = File(System.getProperty("tw.projectDir")!!, "src/test/resources/parity-reference")
        val textStyle = TextStyle(fontSize = 14.sp, fontFamily = FontFamily.SansSerif,
            letterSpacing = 0.sp, textMotion = TextMotion.Animated)
        for (size in listOf("384x832", "360x780", "412x892", "320x694")) {
            val capture = Json.parseToJsonElement(File(root, "$size/push/en-US/settings.json").readText()).jsonObject
            val description = capture["page"]!!.jsonObject["descriptions"]!!.jsonArray[0].jsonObject
            val expected = description["lines"]!!.jsonArray.map { it.jsonObject["text"]!!.jsonPrimitive.content.trim() }
            val text = description["text"]!!.jsonPrimitive.content
            val width = (size.substringBefore('x').toInt() - 32) * 2
            assertEquals(size, expected, chromeLines(measurer, text, textStyle, width).map(String::trim))
        }
    }

    @Test
    fun charactersRobotoHasStayInRoboto() {
        val runs = chromeRuns("강원도(동해평지, 삼척)")
        val latin = runs.spanStyles.map { runs.text.substring(it.start, it.end) to it.item }
        assertEquals(listOf("(", ", ", ")"), latin.map { it.first })
        assertTrue(latin.all { it.second == SpanStyle(fontFamily = FontFamily.SansSerif) })
    }
}
