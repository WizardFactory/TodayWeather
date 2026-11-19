package net.wizardfactory.todayweather.ui.forecast

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.unit.sp
import org.junit.Assert.assertEquals
import org.junit.Test

class TemperatureNumberTest {
    @Test fun decimalPointAndFractionalDigitsUseSeventyPercentOfTheRequestedSize() {
        for (value in listOf("-0.1", "12.34", "0.0", "7", "")) {
            val text = temperatureNumber(value, 76.8)
            assertEquals(value, text.text)
            val expected = if ('.' in value) {
                listOf(AnnotatedString.Range(SpanStyle(fontSize = 53.76.sp), value.indexOf('.'), value.length))
            } else emptyList()
            assertEquals(value, expected, text.spanStyles)
        }
    }
}
