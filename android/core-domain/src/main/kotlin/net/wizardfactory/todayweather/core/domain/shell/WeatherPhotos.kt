package net.wizardfactory.todayweather.core.domain.shell

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The weather photo feed of the photo theme (`loadWeatherPhotos` and `findWeatherPhoto` in
 * client/www/js/service.weatherutil.js): photos grouped by their joined tags, and a photo for a sky icon.
 */
class WeatherPhotos private constructor(private val groups: Map<String, List<JsonObject>>) {
    /**
     * `findWeatherPhoto`: the first group whose key is in [skyIcon] and has photos, and its photo at
     * `floor(random * (size - 1))`, so the last photo of a group is never chosen. [random] is in [0, 1).
     */
    fun find(skyIcon: String?, random: Double): String? {
        if (skyIcon.isNullOrEmpty()) return null
        for (key in KEYS) {
            if (!skyIcon.contains(key)) continue
            val photos = groups[key].orEmpty()
            if (photos.isNotEmpty()) {
                val photo = photos[kotlin.math.floor(random * (photos.size - 1)).toInt()]
                return ((photo["twUrls"] as? JsonObject)?.get("regular") as? JsonPrimitive)?.content
            }
        }
        return null
    }

    companion object {
        val KEYS = listOf("lightning", "rain", "snow", "sun_smallcloud", "sun_bigcloud", "sun", "moon_smallcloud", "moon_bigcloud", "moon", "cloud")

        /** Groups the feed's `data` items; items without a `tags` array are skipped. */
        fun parse(feed: JsonElement): WeatherPhotos {
            val groups = KEYS.associateWith { mutableListOf<JsonObject>() }
            val items = ((feed as? JsonObject)?.get("data") as? JsonArray).orEmpty()
            for (item in items) {
                val photo = item as? JsonObject ?: continue
                val tags = photo["tags"] as? JsonArray ?: continue
                // Array.prototype.join: null and undefined join as "".
                val tag = tags.joinToString("_") { if (it is JsonNull) "" else (it as? JsonPrimitive)?.content ?: "[object Object]" }
                val key = when {
                    "lightning" in tag -> "lightning"
                    "rain" in tag -> "rain"
                    "snow" in tag -> "snow"
                    "sun" in tag -> if ("smallcloud" in tag) "sun_smallcloud" else if ("bigcloud" in tag) "sun_bigcloud" else "sun"
                    "moon" in tag -> if ("smallcloud" in tag) "moon_smallcloud" else if ("bigcloud" in tag) "moon_bigcloud" else "moon"
                    "cloud" in tag -> "cloud"
                    else -> null
                }
                key?.let { groups.getValue(it) += photo }
            }
            return WeatherPhotos(groups)
        }
    }
}
