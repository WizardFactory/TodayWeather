package net.wizardfactory.todayweather.core.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

data class CoordinateWarnings(
    val lat: Double,
    val lon: Double,
    val checkedAt: Long,
    val sources: List<Source>,
    val warnings: List<Warning>,
) {
    enum class State { Current, Unavailable, Unsupported }

    data class Source(val issuer: String, val state: State, val asOf: Long?, val freshUntil: Long?, val payload: JsonObject)
    data class Warning(
        val issuer: String, val id: String, val event: String,
        val effectiveAt: Long, val expiresAt: Long, val endsAt: Long?, val payload: JsonObject,
    )

    /** Reevaluate a response on read, including after resume while offline. */
    fun current(now: Long): CoordinateWarnings {
        val available = sources.map { source ->
            if (source.state == State.Current && source.freshUntil != null && source.freshUntil <= now)
                source.copy(state = State.Unavailable)
            else source
        }
        val issuers = available.filter { it.state == State.Current }.map { it.issuer }.toSet()
        return copy(sources = available, warnings = warnings.filter { row ->
            row.issuer in issuers && row.effectiveAt <= now && row.expiresAt > now && (row.endsAt ?: Long.MAX_VALUE) > now
        })
    }

    companion object {
        internal fun decode(json: JsonObject, lat: Double, lon: Double, parseTime: (String?) -> Long?): CoordinateWarnings? {
            val point = json["location"] as? JsonObject ?: return null
            if ((point["lat"] as? JsonPrimitive)?.doubleOrNull != lat ||
                (point["lon"] as? JsonPrimitive)?.doubleOrNull != lon) return null
            fun JsonObject.string(key: String): String? =
                (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
            val checkedAt = parseTime(json.string("checkedAt")) ?: return null
            val rawSources = (json["sources"] as? JsonArray)?.takeIf { it.isNotEmpty() } ?: return null
            val rawWarnings = json["warnings"] as? JsonArray ?: return null

            val sources = rawSources.map {
                val row = it as? JsonObject ?: return null
                val issuer = row.string("issuer") ?: return null
                val state = when (row.string("state")) {
                    "current" -> State.Current
                    "unavailable" -> State.Unavailable
                    "unsupported" -> State.Unsupported
                    else -> return null
                }
                val asOf = parseTime(row.string("asOf"))
                val freshUntil = parseTime(row.string("freshUntil"))
                if (state == State.Current && (asOf == null || freshUntil == null)) return null
                Source(issuer, state, asOf, freshUntil, row)
            }
            val warnings = rawWarnings.map {
                val row = it as? JsonObject ?: return null
                val issuer = row.string("issuer") ?: return null
                val id = row.string("id") ?: return null
                val event = row.string("event") ?: return null
                val effectiveAt = parseTime(row.string("effectiveAt")) ?: return null
                val expiresAt = parseTime(row.string("expiresAt")) ?: return null
                val endsAt = parseTime(row.string("endsAt"))
                if ("endsAt" in row && endsAt == null) return null
                Warning(issuer, id, event, effectiveAt, expiresAt, endsAt, row)
            }
            return CoordinateWarnings(lat, lon, checkedAt, sources, warnings)
        }
    }
}
