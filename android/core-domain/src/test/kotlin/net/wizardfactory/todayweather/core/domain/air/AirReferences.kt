package net.wizardfactory.todayweather.core.domain.air

import java.io.File
import java.util.TimeZone
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import net.wizardfactory.todayweather.core.domain.Js
import net.wizardfactory.todayweather.core.domain.WeatherConverter
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.chart.ChartTexts

/**
 * The S05 states tools/air-reference captured from the Cordova build (app/src/test/resources/air-reference), rebuilt
 * from the same places and taps: [scope] is the visit the capture showed.
 */
object AirReferences {
    private val project = File(System.getProperty("tw.projectDir"))
    private val corpus = File(AirReferences::class.java.getResource("/corpus/air.json")!!.toURI()).parentFile

    val STATES = listOf("kma-seoul", "kma-seoul-pm25", "kma-seoul-station-1", "kma-seoul-o3", "kma-seoul-dark", "vc-london", "kma-jeju-no-air")

    fun capture(state: String): JsonObject =
        Json.parseToJsonElement(File(project, "../app/src/test/resources/air-reference/$state/air.json").readText()).jsonObject

    val ko: ChartTexts by lazy {
        val xml = File(project, "../app/src/main/res/values-ko/client_strings.xml").readText()
        ChartTexts(Regex("<string name=\"([^\"]+)\"[^>]*>(.*?)</string>").findAll(xml).associate { m ->
            m.groupValues[1] to m.groupValues[2].replace("\\'", "'").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        })
    }

    /** The visit of [state] at 384×832 in Seoul's zone: the places capture.mjs added, then its link code or tap. */
    fun scope(state: String): AirScope {
        val scope = AirScope(ChartMetrics(384.0, 832.0), "airkorea", TimeZone.getTimeZone("Asia/Seoul"))
        when (state) {
            "vc-london" -> scope.open(record("vc-london", "런던", "영국 런던", "GB"), null, 2, false)
            "kma-jeju-no-air" -> scope.open(noAir(), null, 3, false)
            "kma-seoul-o3" -> scope.open(seoul(), "o3", 1, false)
            else -> scope.open(seoul(), null, 1, false)
        }
        if (state == "kma-seoul-pm25") scope.setCode("pm25")
        if (state == "kma-seoul-station-1") scope.setStation(1)
        return scope
    }

    fun seoul(): JsonObject = record("kma-seoul", "회현동", "대한민국 서울특별시 중구 회현동", "KR")

    /** 연동 (kma-jeju) without its stations and observation, as capture.mjs adds it. */
    fun noAir(): JsonObject = record("kma-jeju", "연동", "대한민국 제주특별자치도 제주시 연동", "KR").let { c ->
        JsonObject(c - "airInfoList" + ("currentWeather" to JsonObject(c["currentWeather"]!!.jsonObject - "arpltn")))
    }

    /** A place as the capture added it: the converted fixture's truthy fields and the place's own fields. */
    fun record(fixture: String, name: String, address: String, country: String): JsonObject {
        val converted = WeatherConverter.convert(Json.parseToJsonElement(File(corpus, "inputs/$fixture.json").readText()))!!
        return JsonObject(converted.filterValues { Js.truthy(it) } + mapOf("name" to JsonPrimitive(name), "address" to JsonPrimitive(address),
            "country" to JsonPrimitive(country), "currentPosition" to JsonPrimitive(false)))
    }

    /** [record] with [value] at [path] (object keys and array indexes). */
    fun set(record: JsonObject, path: List<Any>, value: JsonElement): JsonObject {
        fun at(e: JsonElement, rest: List<Any>): JsonElement = if (rest.isEmpty()) value else when (val k = rest.first()) {
            is Int -> JsonArray(e.jsonArray.toMutableList().also { it[k] = at(it[k], rest.drop(1)) })
            else -> JsonObject(e.jsonObject + (k.toString() to at(e.jsonObject[k.toString()]!!, rest.drop(1))))
        }
        return at(record, path) as JsonObject
    }
}
