package net.wizardfactory.todayweather.core.domain

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.wizardfactory.todayweather.core.model.NationResponse

/** A city label on the nationwide maps: name and position in dp on the 330×485 map. */
data class MapLabel(val name: String, val top: Int, val left: Int)

/** Nationwide weather (S10, NationCtrl) and air (S11, NationAirCtrl). */
object Nationwide {
    val WEATHER_CITIES = listOf(
        MapLabel("서울", 60, 100), MapLabel("춘천", 20, 160), MapLabel("강릉", 40, 230), MapLabel("대전", 155, 90),
        MapLabel("청주", 130, 164), MapLabel("전주", 240, 78), MapLabel("광주", 322, 74), MapLabel("대구", 220, 190),
        MapLabel("부산", 300, 230), MapLabel("제주", 420, 60), MapLabel("인천", 70, 36), MapLabel("목포", 360, 0),
        MapLabel("여수", 320, 135), MapLabel("안동", 130, 225), MapLabel("울산", 220, 270),
    )
    val AIR_CITIES = listOf(
        MapLabel("서울", 90, 72), MapLabel("부산", 300, 210), MapLabel("대구", 240, 190), MapLabel("인천", 70, 14),
        MapLabel("광주", 322, 78), MapLabel("대전", 220, 110), MapLabel("울산", 260, 270), MapLabel("제주", 420, 60),
        MapLabel("경기", 80, 130), MapLabel("강원", 40, 200), MapLabel("충북", 140, 150), MapLabel("충남", 180, 24),
        MapLabel("전북", 240, 50), MapLabel("전남", 340, 16), MapLabel("경북", 180, 225), MapLabel("경남", 320, 150),
        MapLabel("세종", 170, 90),
    )
    val AIR_TYPES = listOf("pm2.5", "pm10", "o3", "no2", "so2", "co")

    /** The label background without a grade: `.nation-label` in the stylesheet and `grade2Color`'s fallback. */
    const val NO_GRADE = "rgba(0, 0, 0, 0.4)"

    enum class Mode { SKY_TEMPERATURE, RAIN, WIND }

    data class WeatherLabel(val icon: String?, val text1: JsonElement?, val text2: JsonElement?)


    /** NationCtrl `getIcon`/`getText1`/`getText2` for the first city whose region/city/town contains [name]. */
    fun weatherLabel(nation: NationResponse, mode: Mode, name: String): WeatherLabel {
        val city = nation.weather.firstOrNull {
            listOf("regionName", "cityName", "townName").joinToString("/") { k -> Js.string(it.raw(k)) }.contains(name)
        } ?: return WeatherLabel(null, null, null)
        val current = city.current ?: return WeatherLabel(null, null, null)
        return when (mode) {
            Mode.SKY_TEMPERATURE -> WeatherLabel(current.skyIcon, current.raw("t1h"), null)
            Mode.RAIN -> WeatherLabel(current.skyIcon, current.raw("rn1"), null)
            Mode.WIND -> WeatherLabel(null, current.raw("wdd"), current.raw("wsd"))
        }
    }

    /** The unit next to text1 (precipitation in rain mode) and text2 (wind speed in wind mode). */
    fun unitKeys(mode: Mode): Pair<String?, String?> = when (mode) {
        Mode.RAIN -> "precipitationUnit" to null
        Mode.WIND -> null to "windSpeedUnit"
        Mode.SKY_TEMPERATURE -> null to null
    }

    private fun airKey(type: String) = if (type == "pm2.5") "pm25" else type

    /** NationAirCtrl `getText1`: the value of [type] for the province [name]. */
    fun airValue(nation: NationResponse, type: String, name: String): JsonElement? =
        nation.air.firstOrNull { (it.raw("sidoName") as? JsonPrimitive)?.content == name }?.value(airKey(type))

    /** NationAirCtrl `grade2Color`: the grade color at 0.8 alpha, or translucent black without data. */
    fun airColor(nation: NationResponse, type: String, name: String, airUnit: String?): String {
        val fallback = NO_GRADE
        val city = nation.air.firstOrNull { (it.raw("sidoName") as? JsonPrimitive)?.content == name } ?: return fallback
        val grade = city.raw(airKey(type) + "Grade") ?: return fallback
        val standard = AirQuality.standard(airUnit) ?: return fallback
        val i = Js.number(grade) - 1
        if (i < 0 || i != kotlin.math.floor(i) || i >= standard.grades.size) return fallback
        val rgb = standard.grades[i.toInt()].color
        return "rgba(${rgb.substring(1, 3).toInt(16)},${rgb.substring(3, 5).toInt(16)},${rgb.substring(5, 7).toInt(16)},0.8)"
    }
}
