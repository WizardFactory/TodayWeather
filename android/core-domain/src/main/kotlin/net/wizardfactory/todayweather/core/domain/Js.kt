package net.wizardfactory.todayweather.core.domain

import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.floor
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * JavaScript value semantics over JSON, so the Kotlin core decides exactly as the Cordova code.
 * A Kotlin `null` element stands for JavaScript `undefined` (an absent property); [JsonNull] is `null`.
 */
internal object Js {
    /** JavaScript ToNumber. */
    fun number(value: JsonElement?): Double = when (value) {
        null -> Double.NaN
        JsonNull -> 0.0
        is JsonPrimitive -> when {
            value.isString -> stringToNumber(value.content)
            value.booleanOrNull != null -> if (value.booleanOrNull == true) 1.0 else 0.0
            else -> value.content.toDouble()
        }
        is JsonArray -> when (value.size) {
            0 -> 0.0
            1 -> number(value[0].let { if (it is JsonPrimitive || it is JsonNull) JsonPrimitive(string(it)) else it })
            else -> Double.NaN
        }
        is JsonObject -> Double.NaN
    }

    private fun stringToNumber(s: String): Double {
        val t = s.trim()
        if (t.isEmpty()) return 0.0
        if (t.startsWith("0x") || t.startsWith("0X")) return t.substring(2).toLongOrNull(16)?.toDouble() ?: Double.NaN
        return when (t) {
            "Infinity", "+Infinity" -> Double.POSITIVE_INFINITY
            "-Infinity" -> Double.NEGATIVE_INFINITY
            else -> if (t.any { it.isLetter() && it != 'e' && it != 'E' }) Double.NaN else t.toDoubleOrNull() ?: Double.NaN
        }
    }

    /** JavaScript ToBoolean. */
    fun truthy(value: JsonElement?): Boolean = when (value) {
        null, JsonNull -> false
        is JsonPrimitive -> when {
            value.isString -> value.content.isNotEmpty()
            value.booleanOrNull != null -> value.booleanOrNull!!
            else -> value.content.toDouble().let { it != 0.0 && !it.isNaN() }
        }
        else -> true
    }

    /** `value != undefined` (loose): neither undefined nor null. */
    fun present(value: JsonElement?): Boolean = value != null && value != JsonNull

    /** `a > b` for a number literal b. */
    fun greater(value: JsonElement?, b: Double): Boolean = number(value) > b

    /** `a >= b` for a number literal b. */
    fun greaterOrEqual(value: JsonElement?, b: Double): Boolean = number(value) >= b

    /** JavaScript `a == b` for primitives (objects compare by identity, which JSON cannot express). */
    fun looseEquals(a: JsonElement?, b: JsonElement?): Boolean {
        val aNullish = a == null || a == JsonNull
        val bNullish = b == null || b == JsonNull
        if (aNullish || bNullish) return aNullish && bNullish
        if (a is JsonPrimitive && b is JsonPrimitive) {
            if (a.isString && b.isString) return a.content == b.content
            return number(a) == number(b)
        }
        return a === b
    }

    /** `a == number`. */
    fun looseEquals(a: JsonElement?, b: Double): Boolean = looseEquals(a, JsonPrimitive(b))

    /** JavaScript ToString for primitives. */
    fun string(value: JsonElement?): String = when (value) {
        null -> "undefined"
        JsonNull -> "null"
        is JsonPrimitive -> if (value.isString || value.booleanOrNull != null) value.content else numberToString(number(value))
        else -> "[object Object]"
    }

    /** JavaScript Number.prototype.toString() for the values the app formats. */
    fun numberToString(d: Double): String = when {
        d.isNaN() -> "NaN"
        d.isInfinite() -> if (d > 0) "Infinity" else "-Infinity"
        d == floor(d) && kotlin.math.abs(d) < 1e21 -> BigDecimal(d).toPlainString().removeSuffix(".0")
        else -> d.toString().let { if (it.contains('E')) BigDecimal(it).stripTrailingZeros().toPlainString() else it }
    }

    /** `Math.round`: half rounds toward positive infinity. */
    fun round(d: Double): Double = if (d.isNaN() || d.isInfinite()) d else floor(d + 0.5)

    /** `parseFloat(d.toFixed(digits))`. toFixed rounds the exact binary value half away from zero. */
    fun toFixedNumber(d: Double, digits: Int): Double =
        if (d.isNaN() || d.isInfinite()) d else BigDecimal(d).setScale(digits, RoundingMode.HALF_UP).toDouble()

    /** A number literal as JSON, integral values without a fraction. */
    fun json(d: Double): JsonPrimitive =
        if (d == floor(d) && !d.isInfinite() && kotlin.math.abs(d) < 9e15) JsonPrimitive(d.toLong()) else JsonPrimitive(d)
}
