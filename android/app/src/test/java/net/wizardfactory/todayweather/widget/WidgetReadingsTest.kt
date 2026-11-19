package net.wizardfactory.todayweather.widget

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import net.wizardfactory.todayweather.core.domain.YesterdayText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class WidgetReadingsTest {
    private val labels = YesterdayText("same", "%s° since yesterday")

    @Test fun onlyFutureHoursAndSelectedDaysAreShown() {
        val input = Json.parseToJsonElement("""{
            "currentWeather":{"date":"20261108","time":6,"t1h":0,"yesterday":{"t1h":3}},
            "timeTable":[{"date":"20261108","time":3,"t3h":7},{"date":"20261108","time":6,"t3h":0},
                {"date":"20261108","time":9,"t3h":2},{"date":"20261109","time":0,"t3h":3}],
            "dayChart":[{"values":[{"fromToday":-2},{"fromToday":-1,"date":"20261107","tmn":0,"tmx":3},
                {"fromToday":0,"date":"20261108","tmn":1,"tmx":5}]}]
        }""").jsonObject
        val readings = WidgetReadings(input, "C", labels)
        assertEquals("0°C", readings.current)
        assertEquals("-3° since yesterday", readings.comparison)
        val oldCache = WidgetReadings(input, null, labels)
        assertEquals("0°", oldCache.current)
        assertEquals("", oldCache.comparison)
        assertEquals(listOf("09:00","00:00"), readings.hours.map { it.label })
        assertEquals(listOf(-1,0), readings.days.map { it.offset })
    }

    @Test fun handlesSentinelsAndMissingAirWithoutShowingFakeTemperatures() {
        val input = Json.parseToJsonElement("""{
            "currentWeather":{"t1h":-50,"skyIcon":"moon","yesterday":{"t1h":4}},
            "airInfoList":[{"last":{"pm25Value":0,"pm10Value":-1}}]
        }""").jsonObject
        val readings = WidgetReadings(input, "F", labels)
        assertFalse("-50" in readings.current)
        assertEquals("", readings.comparison)
        assertEquals("0 ㎍/㎥", readings.pollutant("pm25"))
        assertEquals(null, readings.pollutant("pm10"))
    }
}
