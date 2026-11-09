package net.wizardfactory.todayweather.core.domain.nation

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import net.wizardfactory.todayweather.core.domain.Js
import net.wizardfactory.todayweather.core.domain.Nationwide
import net.wizardfactory.todayweather.core.domain.forecast.ForecastPage
import net.wizardfactory.todayweather.core.model.NationResponse

/** A value line of a map label: the value and the unit in its 12 px span (S10), or the value alone (S11). */
data class LabelLine(val text: String, val unit: String = "")

/** A label of the S10 or S11 map as nation.html and nation-air.html draw it, at its CSS px position on the map. */
data class NationLabel(
    val name: String,
    val top: Int,
    val left: Int,
    /** S10: the sky icon's file name in the theme's weather folder, when `getIcon` returns one. */
    val icon: String? = null,
    val lines: List<LabelLine> = emptyList(),
    /** S11: `grade2Color`, `rgba(r,g,b,a)`; S10 keeps the stylesheet's `rgba(0, 0, 0, 0.4)`. */
    val background: String = Nationwide.NO_GRADE,
)

/** What the nationwide pages show: the labels of nation.html (S10) and nation-air.html (S11), and the S12 cards. */
object NationPages {
    /** The catalog strings S10, S11 and S12 show. */
    val KEYS = listOf("LOC_KOREA", "LOC_CHINA", "LOC_USA", "LOC_UK", "LOC_TYPE_SPECIAL_WEATHER", "LOC_SPECIAL_WEATHER_NOTE", "LOC_WEATHER",
        "LOC_TEMP", "LOC_PRECIPITATION", "LOC_WIND_DIRECTION", "LOC_WIND_SPEED")

    /** `getNationName` for the region; null leaves the title empty, as the Cordova filter of undefined does. */
    fun title(region: String): String? = when (region) {
        "KR" -> "LOC_KOREA"
        "JP", "CN" -> "LOC_CHINA" // JP shows China in the Cordova app too
        "US" -> "LOC_USA"
        "GB" -> "LOC_UK"
        else -> null
    }

    /** The S10 mode buttons' texts (`changeWeatherType(0/1/2)`), as catalog keys joined by "/". */
    val MODE_KEYS = listOf(listOf("LOC_WEATHER", "LOC_TEMP"), listOf("LOC_PRECIPITATION"), listOf("LOC_WIND_DIRECTION", "LOC_WIND_SPEED"))

    /**
     * nation.html in [mode]: each city of NationCtrl's list with its icon and values. Without a response (while
     * loading, after a failure), only the names. [unit] is `Units.getUnit` (the stored unit value).
     */
    fun weather(nation: NationResponse?, mode: Nationwide.Mode, unit: (String) -> String?): List<NationLabel> {
        val (unit1, unit2) = Nationwide.unitKeys(mode)
        return Nationwide.WEATHER_CITIES.map { city ->
            val label = nation?.let { Nationwide.weatherLabel(it, mode, city.name) }
            NationLabel(
                name = city.name, top = city.top, left = city.left,
                icon = label?.icon,
                lines = listOfNotNull(
                    label?.text1?.let { LabelLine(Js.display(it), unit1?.let(unit) ?: "") },
                    label?.text2?.let { LabelLine(Js.display(it), unit2?.let(unit) ?: "") },
                ),
            )
        }
    }

    /** nation-air.html for the pollutant [type] (`pm2.5`, `pm10`, `o3`, `no2`, `so2`, `co`) in the air standard [airUnit]. */
    fun air(nation: NationResponse?, type: String, airUnit: String?): List<NationLabel> = Nationwide.AIR_CITIES.map { city ->
        NationLabel(
            name = city.name, top = city.top, left = city.left,
            lines = listOfNotNull(nation?.let { Nationwide.airValue(it, type, city.name) }?.let { LabelLine(Js.display(it)) }),
            background = nation?.let { Nationwide.airColor(it, type, city.name, airUnit) } ?: Nationwide.NO_GRADE,
        )
    }
}

/** A situation of an S12 card: the bold hazard and level, then a line per `info`. */
data class WarningSituation(val title: String, val lines: List<String>)

/** A card of kma-special.html: `name announcement`, the image, the situations, the note heading and the comment's lines. */
data class WarningCard(
    val heading: String,
    val imageUrl: String?,
    val situations: List<WarningSituation>,
    /** `special.type === 1 || special.type === 2`: the LOC_SPECIAL_WEATHER_NOTE heading. */
    val note: Boolean,
    val comment: List<String>,
)

object WarningCards {
    /**
     * The cards of kma-special.html for a list [Warnings.parse][net.wizardfactory.todayweather.core.domain.Warnings.parse]
     * returned; no card for anything but a list (`ng-if="specialList"` with a failed request, or a body that is not a
     * list). Texts are as the WebView renders them: AngularJS interpolation, then HTML white-space collapsing.
     */
    fun cards(list: JsonElement?): List<WarningCard> {
        if (list !is JsonArray) return emptyList()
        return list.map { special ->
            val o = special as? JsonObject
            WarningCard(
                heading = ForecastPage.collapse(Js.display(o?.get("name")) + " " + Js.display(o?.get("announcement"))),
                imageUrl = Js.display(o?.get("imageUrl")).takeIf { it.isNotEmpty() },
                situations = repeated(o?.get("situationList")).takeIf { Js.truthy(o?.get("situationList")) }.orEmpty().map { s ->
                    val so = s as? JsonObject
                    WarningSituation(
                        title = ForecastPage.collapse(Js.display(so?.get("weatherStr")) + Js.display(so?.get("levelStr"))),
                        lines = repeated(so?.get("info")).takeIf { Js.truthy(so?.get("info")) }.orEmpty().map { info ->
                            val io = info as? JsonObject
                            ForecastPage.collapse(Js.display(io?.get("timeStr")) + " " + Js.display(io?.get("location")))
                        },
                    )
                },
                // Strict equality with the numbers 1 and 2: not a string, a boolean or null.
                note = o?.get("type").let { it is JsonPrimitive && !it.isString && it != JsonNull && it.booleanOrNull == null &&
                    (it.doubleOrNull == 1.0 || it.doubleOrNull == 2.0) },
                comment = BoundHtml.lines(o?.get("comment")),
            )
        }
    }

    /** What `ng-repeat` walks: a list's items, an object's values; nothing for anything else. */
    private fun repeated(value: JsonElement?): List<JsonElement> = when (value) {
        is JsonArray -> value
        is JsonObject -> value.values.toList()
        else -> emptyList()
    }
}

/**
 * `ng-bind-html`: the comment through `$sanitize`, as lines. `<br>` ends a line; other tags go, keeping their text,
 * except `script` and `style`, whose content goes too; comments go; entities become their characters. White space
 * collapses as in HTML: each run becomes one space, none at the start or end of a line. A final `<br>` makes no
 * empty line; two in a row make one.
 */
object BoundHtml {
    private val BR = Regex("""<br\s*/?>""", RegexOption.IGNORE_CASE)
    private val BLOCKED = Regex("""<(script|style)\b[^>]*>.*?</\1\s*>""", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
    private val COMMENT = Regex("""<!--.*?-->""", RegexOption.DOT_MATCHES_ALL)
    private val TAG = Regex("""</?[A-Za-z][^>]*>""")
    private val ENTITY = Regex("""&(#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z]+);""")
    private val NAMED = mapOf("lt" to "<", "gt" to ">", "amp" to "&", "quot" to "\"", "apos" to "'", "nbsp" to " ")

    fun lines(value: JsonElement?): List<String> {
        val html = Js.display(value)
        if (html.isEmpty()) return emptyList()
        val parts = html.replace(COMMENT, "").replace(BLOCKED, "").split(BR).map { part ->
            ForecastPage.collapse(decode(part.replace(TAG, "")))
        }
        return if (parts.size > 1 && parts.last().isEmpty()) parts.dropLast(1) else parts
    }

    private fun decode(text: String): String = ENTITY.replace(text) { m ->
        val e = m.groupValues[1]
        when {
            e.startsWith("#x") || e.startsWith("#X") -> e.substring(2).toIntOrNull(16)?.let { String(Character.toChars(it)) }
            e.startsWith("#") -> e.substring(1).toIntOrNull()?.let { String(Character.toChars(it)) }
            else -> NAMED[e]
        } ?: m.value
    }
}
