package net.wizardfactory.todayweather.core.domain.analytics

/**
 * The analytics events of `Monetization` (service.monetization.js): no raw error strings, URLs, identifiers or
 * places, only these fields. A field is a list of allowed strings or the largest allowed non-negative integer.
 */
object AnalyticsSchema {
    /** Added to every event (`emit`). */
    const val MEASUREMENT_VERSION = 1L

    private const val DURATION = 600_000L
    private const val DELAY = 120L
    private const val CODE = 999L

    val EVENTS: Map<String, Map<String, Any>> = mapOf(
        "weather_fetch" to mapOf("outcome" to listOf("success", "network_error", "invalid_input"), "duration_ms" to DURATION),
        "weather_load" to mapOf("outcome" to listOf("success", "network_error", "invalid_response"), "duration_ms" to DURATION),
        "favorite_change" to mapOf("action" to listOf("add", "remove")),
        "location_permission" to mapOf("outcome" to listOf("granted", "denied", "unknown")),
        "ad_lifecycle" to mapOf("action" to listOf("request", "loaded", "failed", "impression", "show", "hide", "consent_failed"),
            "ad_format" to listOf("banner")),
        "ad_load_error" to mapOf("ad_format" to listOf("banner"), "error_code" to CODE),
        "ad_policy_exposure" to mapOf("delay_seconds" to DELAY),
    )

    /** The fixed route names a `screen_view` may carry (`screens`). */
    val SCREENS = listOf("start", "guide", "units", "setting-radio", "setting-push", "kma-special", "nation", "nation-air", "tab",
        "tab.search", "tab.air", "tab.forecast", "tab.dailyforecast", "tab.weather")

    /** The event's own fields, or null to drop it: an unknown event, a missing or invalid field. Numbers become Long. */
    fun validate(name: String, params: Map<String, Any?>?): Map<String, Any>? {
        val fields = EVENTS[name] ?: return null
        if (params == null) return null
        val safe = LinkedHashMap<String, Any>()
        for ((key, rule) in fields) {
            val value = params[key]
            if (rule is List<*>) {
                if (value !is String || value !in rule) return null
                safe[key] = value
            } else {
                val n = (value as? Number)?.toDouble() ?: return null
                if (n.isNaN() || n.isInfinite() || n < 0 || n > (rule as Long) || Math.floor(n) != n) return null
                safe[key] = n.toLong()
            }
        }
        return safe
    }
}
