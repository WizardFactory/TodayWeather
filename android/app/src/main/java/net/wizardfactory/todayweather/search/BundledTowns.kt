package net.wizardfactory.todayweather.search

import android.content.Context
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.start.Town

/** The bundled towns (`window.towns` of town.js, imported as assets/data/towns.json by AN-01), in their file order. */
object BundledTowns {
    private const val ASSET = "data/towns.json"

    fun load(context: Context): List<Town> = parse(context.assets.open(ASSET).use { it.readBytes().decodeToString() })

    internal fun parse(json: String): List<Town> = Json.parseToJsonElement(json).jsonArray.map { element ->
        val town = element.jsonObject
        fun text(key: String) = town.getValue(key).jsonPrimitive.content
        Town(text("first"), text("second"), text("third"), town.getValue("lat").jsonPrimitive.double, town.getValue("long").jsonPrimitive.double)
    }
}
