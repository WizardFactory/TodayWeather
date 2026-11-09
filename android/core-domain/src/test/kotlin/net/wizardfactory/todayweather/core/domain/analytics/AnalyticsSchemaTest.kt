package net.wizardfactory.todayweather.core.domain.analytics

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * `Monetization.track` (service.monetization.js) and its schema (#2894, V22): only the listed events and fields,
 * exact enumerations, and bounded non-negative integers; anything else drops the whole event.
 */
class AnalyticsSchemaTest {
    @Test
    fun theSchemaListsTheCordovaEventsAndFields() {
        assertEquals(
            mapOf(
                "weather_fetch" to listOf("outcome", "duration_ms"),
                "weather_load" to listOf("outcome", "duration_ms"),
                "favorite_change" to listOf("action"),
                "location_permission" to listOf("outcome"),
                "ad_lifecycle" to listOf("action", "ad_format"),
                "ad_load_error" to listOf("ad_format", "error_code"),
                "ad_policy_exposure" to listOf("delay_seconds"),
            ),
            AnalyticsSchema.EVENTS.mapValues { it.value.keys.toList() },
        )
        assertEquals(listOf("start", "guide", "units", "setting-radio", "setting-push", "kma-special", "nation", "nation-air", "tab",
            "tab.search", "tab.air", "tab.forecast", "tab.dailyforecast", "tab.weather"), AnalyticsSchema.SCREENS)
    }

    @Test
    fun validEventsKeepOnlyTheirFields() {
        assertEquals(mapOf("outcome" to "success", "duration_ms" to 1234L),
            AnalyticsSchema.validate("weather_fetch", mapOf("outcome" to "success", "duration_ms" to 1234, "city" to "회현동", "lat" to 37.5)))
        assertEquals(mapOf("action" to "impression", "ad_format" to "banner"),
            AnalyticsSchema.validate("ad_lifecycle", mapOf("action" to "impression", "ad_format" to "banner")))
        assertEquals(mapOf("ad_format" to "banner", "error_code" to 3L),
            AnalyticsSchema.validate("ad_load_error", mapOf("ad_format" to "banner", "error_code" to 3.0)))
        assertEquals(mapOf("delay_seconds" to 120L), AnalyticsSchema.validate("ad_policy_exposure", mapOf("delay_seconds" to 120L)))
        assertEquals(mapOf("outcome" to "unknown"), AnalyticsSchema.validate("location_permission", mapOf("outcome" to "unknown")))
        assertEquals(mapOf("action" to "remove"), AnalyticsSchema.validate("favorite_change", mapOf("action" to "remove")))
        assertEquals(mapOf("outcome" to "invalid_response", "duration_ms" to 600_000L),
            AnalyticsSchema.validate("weather_load", mapOf("outcome" to "invalid_response", "duration_ms" to 600_000)))
    }

    @Test
    fun anythingOutsideTheSchemaDropsTheEvent() {
        val dropped = listOf(
            "screen_view" to mapOf("screen_name" to "units"),
            "purchase" to mapOf("value" to 1),
            "toString" to emptyMap<String, Any?>(),
            "weather_fetch" to null,
            "weather_fetch" to mapOf("outcome" to "success"),
            "weather_fetch" to mapOf("outcome" to "timeout", "duration_ms" to 1),
            "weather_fetch" to mapOf("outcome" to "SUCCESS", "duration_ms" to 1),
            "weather_fetch" to mapOf("outcome" to "success", "duration_ms" to -1),
            "weather_fetch" to mapOf("outcome" to "success", "duration_ms" to 600_001),
            "weather_fetch" to mapOf("outcome" to "success", "duration_ms" to 1.5),
            "weather_fetch" to mapOf("outcome" to "success", "duration_ms" to Double.NaN),
            "weather_fetch" to mapOf("outcome" to "success", "duration_ms" to Double.POSITIVE_INFINITY),
            "weather_fetch" to mapOf("outcome" to "success", "duration_ms" to "5"),
            "weather_fetch" to mapOf("outcome" to "success", "duration_ms" to true),
            "weather_load" to mapOf("outcome" to "invalid_input", "duration_ms" to 1),
            "ad_lifecycle" to mapOf("action" to "click", "ad_format" to "banner"),
            "ad_lifecycle" to mapOf("action" to "show", "ad_format" to "interstitial"),
            "ad_load_error" to mapOf("ad_format" to "banner", "error_code" to 1000),
            "ad_policy_exposure" to mapOf("delay_seconds" to 121),
            "favorite_change" to mapOf("action" to 1),
        )
        for ((name, params) in dropped) assertNull(AnalyticsSchema.validate(name, params), "$name $params")
    }
}
