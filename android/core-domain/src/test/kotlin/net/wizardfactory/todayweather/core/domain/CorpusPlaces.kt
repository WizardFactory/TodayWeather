package net.wizardfactory.todayweather.core.domain

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** The places of the corpus visits (forecast.json, air.json): what the generator's `cityRecord` builds for each. */
object CorpusPlaces {
    /**
     * A place's record as the generator builds it (core-data cityRecord): the converted response's truthy weather
     * fields and the place's own fields, with the case's mutations.
     */
    fun record(corpus: File, place: JsonObject): JsonObject {
        val input = Json.parseToJsonElement(File(corpus, "inputs/${place.str("fixture")}.json").readText())
        val converted = WeatherConverter.convert(input)!!
        val fields = LinkedHashMap<String, JsonElement>()
        for (f in listOf("currentWeather", "timeTable", "timeChart", "dayTable", "dayChart", "source", "airInfo", "airInfoList")) {
            converted[f]?.takeIf { Js.truthy(it) }?.let { fields[f] = it }
        }
        val own = place["place"]!!.jsonObject
        for (k in listOf("name", "address", "country", "location")) own[k]?.takeIf { it != JsonNull }?.let { fields[k] = it }
        fields["currentPosition"] = JsonPrimitive(own["currentPosition"]?.jsonPrimitive?.boolean == true)
        own["photo"]?.takeIf { it != JsonNull }?.let { fields["photo"] = it }
        var city = JsonObject(fields)
        place["mutations"]?.jsonArray?.forEach { m -> city = mutate(city, m.jsonObject["path"]!!.jsonArray, m.jsonObject) as JsonObject }
        return city
    }

    private fun mutate(value: JsonElement, path: List<JsonElement>, m: JsonObject): JsonElement {
        val key = path.first().jsonPrimitive
        val last = path.size == 1
        return when (value) {
            is JsonObject -> {
                val k = key.content
                val map = LinkedHashMap(value)
                if (last && m.str("op") == "delete") map.remove(k)
                else map[k] = if (last) m["value"]!! else mutate(value[k]!!, path.drop(1), m)
                JsonObject(map)
            }
            is JsonArray -> {
                val i = key.int
                val list = value.toMutableList()
                if (last && m.str("op") == "delete") list.removeAt(i) else list[i] = if (last) m["value"]!! else mutate(value[i], path.drop(1), m)
                JsonArray(list)
            }
            else -> error("cannot mutate $value at $path")
        }
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it != JsonNull }?.content
}
