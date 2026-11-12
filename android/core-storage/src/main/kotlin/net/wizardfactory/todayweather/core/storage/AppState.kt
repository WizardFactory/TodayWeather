package net.wizardfactory.todayweather.core.storage

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Everything the native app persists. Version 1 mirrors the Cordova keys it replaces
 * (`cities`, `cityIndex`, `units`, `settingsInfo`, `pushData2`, `expandShortChart`).
 */
@Serializable
data class AppState(
    val schemaVersion: Int = 1,
    val places: List<Place> = listOf(Place.currentPositionPlaceholder()),
    /** Selected index into [places]; -1 when nothing can be shown (Cordova `cityIndex`). */
    val placeIndex: Int = -1,
    val units: UnitSettings = UnitSettings.defaults(null),
    val settings: Settings = Settings(),
    val push: PushState = PushState(),
    val expandShortChart: Boolean = false,
    /** Cordova onboarding/update values kept for the rollback hand-back (AN-17). */
    val cordovaExtras: Map<String, JsonElement> = emptyMap(),
    val migration: MigrationInfo? = null,
)

/**
 * A saved place. Index 0 is the current position by convention, as in the Cordova app. [cordova] keeps
 * the other fields of the Cordova city record (weather caches removed) for the hand-back.
 */
@Serializable
data class Place(
    val currentPosition: Boolean,
    val disable: Boolean,
    val name: String? = null,
    val address: String? = null,
    val country: String? = null,
    val location: Location? = null,
    val source: String? = null,
    val photo: String? = null,
    val cordova: JsonObject? = null,
) {
    companion object {
        /** Cordova `createCity()` without an item: current position, disabled. */
        fun currentPositionPlaceholder() = Place(currentPosition = true, disable = true)
    }
}

@Serializable
data class Location(val lat: Double, val long: Double)

/** The six Cordova unit settings (`Units`). */
@Serializable
data class UnitSettings(
    val temperatureUnit: String,
    val windSpeedUnit: String,
    val pressureUnit: String,
    val distanceUnit: String,
    val precipitationUnit: String,
    val airUnit: String,
) {
    fun value(key: String): String = when (key) {
        "temperatureUnit" -> temperatureUnit
        "windSpeedUnit" -> windSpeedUnit
        "pressureUnit" -> pressureUnit
        "distanceUnit" -> distanceUnit
        "precipitationUnit" -> precipitationUnit
        "airUnit" -> airUnit
        else -> throw IllegalArgumentException(key)
    }

    /** These units with [key] set to [value] (`Units.setUnit`). */
    fun with(key: String, value: String): UnitSettings = when (key) {
        "temperatureUnit" -> copy(temperatureUnit = value)
        "windSpeedUnit" -> copy(windSpeedUnit = value)
        "pressureUnit" -> copy(pressureUnit = value)
        "distanceUnit" -> copy(distanceUnit = value)
        "precipitationUnit" -> copy(precipitationUnit = value)
        "airUnit" -> copy(airUnit = value)
        else -> throw IllegalArgumentException(key)
    }

    companion object {
        val KEYS = listOf("temperatureUnit", "windSpeedUnit", "pressureUnit", "distanceUnit", "precipitationUnit", "airUnit")

        /** Choices of the Cordova unit screen (`Units.getSelectList`). */
        val OPTIONS = mapOf(
            "temperatureUnit" to listOf("C", "F"),
            "windSpeedUnit" to listOf("mph", "km/h", "m/s", "bft", "kt"),
            "pressureUnit" to listOf("mmHg", "inHg", "mb", "hPa"),
            "distanceUnit" to listOf("km", "mi"),
            "precipitationUnit" to listOf("mm", "in"),
            "airUnit" to listOf("airkorea", "airkorea_who", "airnow", "aqicn"),
        )

        /** `Units._getDefaultUnits()` for the device region (`Util.region`, an ISO country code). */
        fun defaults(region: String?): UnitSettings = when (region) {
            "KR" -> UnitSettings("C", "m/s", "hPa", "km", "mm", "airkorea")
            "JP" -> UnitSettings("C", "m/s", "mmHg", "km", "mm", "airnow")
            "US" -> UnitSettings("F", "mph", "inHg", "mi", "in", "airnow")
            "DE" -> UnitSettings("C", "km/h", "mb", "km", "mm", "airnow")
            "CN" -> UnitSettings("C", "km/h", "hPa", "km", "mm", "airnow")
            "TW" -> UnitSettings("C", "km/h", "mmHg", "km", "mm", "airnow")
            else -> UnitSettings("C", "m/s", "hPa", "km", "mm", "airnow")
        }

        fun of(values: Map<String, String>) = UnitSettings(
            values.getValue("temperatureUnit"), values.getValue("windSpeedUnit"), values.getValue("pressureUnit"),
            values.getValue("distanceUnit"), values.getValue("precipitationUnit"), values.getValue("airUnit"),
        )
    }
}

/** Cordova `settingsInfo`: startup page "0" hourly, "1" daily, "2" favorites, "3" air; refresh minutes, "0" manual. */
@Serializable
data class Settings(
    val startupPage: String = "0",
    val refreshInterval: String = "0",
    val theme: String = "light",
) {
    fun value(key: String): String = when (key) {
        "startupPage" -> startupPage
        "refreshInterval" -> refreshInterval
        "theme" -> theme
        else -> throw IllegalArgumentException(key)
    }

    /** These settings with [key] set to [value] (`$rootScope.settingsInfo[type] = value`). */
    fun with(key: String, value: String): Settings = when (key) {
        "startupPage" -> copy(startupPage = value)
        "refreshInterval" -> copy(refreshInterval = value)
        "theme" -> copy(theme = value)
        else -> throw IllegalArgumentException(key)
    }
}

/**
 * Cordova `pushData2`. [records] keep the alert and alarm records as the Cordova app stores them
 * (`cityIndex`, `id`, `category`, `enable`, ISO time fields, `dayOfWeek`, city info) so AN-04 can
 * re-register them unchanged. [needsAlertIntro] is set when legacy `pushData` alarms were converted
 * (the O06 introduction).
 */
@Serializable
data class PushState(
    val registrationId: String? = null,
    val type: String = "android",
    val category: String = "",
    val fcmToken: String? = null,
    val records: List<JsonObject> = emptyList(),
    val needsAlertIntro: Boolean = false,
)

@Serializable
data class MigrationInfo(
    val source: String,
    val migratedAtMillis: Long,
    /** What happened to each Cordova key: `migrated`, `default`, `malformed`, `legacy`, `absent`. */
    val keys: Map<String, String>,
    /** The generation of the fallback Cordova build's claim this migration adopted ([CordovaHandBack]); null without one. */
    val handBackGeneration: Int? = null,
)
