package net.wizardfactory.todayweather.core.domain.start

/** The location permission as cordova.plugins.diagnostic reported it on Android, which the app keeps as its record. */
enum class PermissionStatus { GRANTED, NOT_REQUESTED, DENIED_ONCE, DENIED_ALWAYS }

/** `Util.classifyLocationPermission` (service.util.js L70-L86): only a requestable status shows the system prompt. */
enum class PermissionClass {
    GRANTED, REQUESTABLE, DENIED;

    companion object {
        fun of(status: PermissionStatus): PermissionClass = when (status) {
            PermissionStatus.GRANTED -> GRANTED
            PermissionStatus.NOT_REQUESTED, PermissionStatus.DENIED_ONCE -> REQUESTABLE
            PermissionStatus.DENIED_ALWAYS -> DENIED
        }
    }
}

/** What ends a failed location attempt, as the lines of the retry confirmation's body. */
enum class LocationMessage(val lines: List<String>) {
    DENIED(listOf("LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED")),
    TURN_ON(listOf("LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION")),

    /** No position: `strFailToGetCurrentPosition` with the Android line about location and WiFi. */
    NOT_FOUND(listOf("LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION", "LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI")),

    /** The reverse geocode failed (StartCtrl). */
    NO_INFORMATION(listOf("LOC_FAIL_TO_GET_LOCATION_INFORMATION")),

    /** The prompt was answered with a denial (TabCtrl). */
    PROMPT_DENIED(listOf("LOC_PERMISSION_REQUEST_DENIED_PLEASE_SEARCH_BY_LOCATION_NAME_OR_RETRY")),
}

/** The next step of a location attempt. */
sealed interface LocationStep {
    /** Take a position. */
    data object Locate : LocationStep

    /** Show the system prompt; on S01 with location on the loading overlay hides first. */
    data class Ask(val hideLoading: Boolean) : LocationStep

    /** End in the retry confirmation with [message]. */
    data class Fail(val message: LocationMessage) : LocationStep

    /** Location off with a saved place: it loads as saved (TabCtrl). */
    data object UseSaved : LocationStep

    /** Location off without a saved place: Google Play services' high-accuracy dialog (TabCtrl only, D37). */
    data object AskHighAccuracy : LocationStep
}

/** A button of a retry confirmation, left to right: its label and whether it is `button-positive`. */
enum class RetryButton(val key: String, val positive: Boolean) {
    CLOSE("LOC_CLOSE", false),

    /** TabCtrl: disable the current position and open the Locations tab. */
    SEARCH("LOC_SEARCH", false),

    /** `switchToSettings()`: the app's details page. */
    APP_SETTINGS("LOC_SETTING", true),

    /** `switchToLocationSettings()`: the device's location settings. */
    LOCATION_SETTINGS("LOC_SETTING", false),

    /** `LOC_OK`, which tries again (A26: `LOC_RETRY` is unused). */
    RETRY("LOC_OK", true),
}

/** A retry confirmation (`showRetryConfirm`, titled `LOC_ERROR`): the body's lines and the buttons. */
data class RetryConfirm(val lines: List<String>, val buttons: List<RetryButton>)

private const val APP_INFO_HINT = "LOC_OPENS_THE_APP_INFO_PAGE"

/**
 * StartCtrl's location attempt on Android (controller.start.js L395-L573) and its retry confirmation (O04, L683-L814).
 * Every branch settles: a message, or a grant that runs the attempt again (#2871).
 */
object StartLocation {
    fun decide(enabled: Boolean, status: PermissionStatus): LocationStep = when (PermissionClass.of(status)) {
        PermissionClass.GRANTED -> if (enabled) LocationStep.Locate else LocationStep.Fail(LocationMessage.TURN_ON)
        PermissionClass.DENIED -> LocationStep.Fail(LocationMessage.DENIED)
        PermissionClass.REQUESTABLE -> LocationStep.Ask(hideLoading = enabled)
    }

    /** The prompt's answer: a grant runs again at once (null), anything else is the denial. */
    fun afterPrompt(granted: Boolean): LocationMessage? = if (granted) null else LocationMessage.DENIED

    /**
     * O04's variants, in order, for the status [recorded] last (`gLocationAuthorizationStatus`, null when none was):
     * denied always adds the app-info hint and Settings to the app's page; an unrecorded status matches diagnostic 7.x's
     * undefined `DENIED` and gets Settings to the app's page; location off gets Settings to the location settings.
     */
    fun retry(message: LocationMessage, recorded: PermissionStatus?, enabled: Boolean): RetryConfirm = when {
        recorded == PermissionStatus.DENIED_ALWAYS ->
            RetryConfirm(message.lines + APP_INFO_HINT, listOf(RetryButton.CLOSE, RetryButton.APP_SETTINGS, RetryButton.RETRY))
        recorded == null -> RetryConfirm(message.lines, listOf(RetryButton.CLOSE, RetryButton.APP_SETTINGS, RetryButton.RETRY))
        !enabled -> RetryConfirm(message.lines, listOf(RetryButton.CLOSE, RetryButton.LOCATION_SETTINGS, RetryButton.RETRY))
        else -> RetryConfirm(message.lines, listOf(RetryButton.CLOSE, RetryButton.RETRY))
    }
}

/**
 * TabCtrl's lookup of the current position on Android (controller.tabctrl.js L954-L1088) and its retry confirmation of
 * type `forecast` (O03, L435-L636). Location off reads no permission status.
 */
object TabLocation {
    fun decide(enabled: Boolean, status: PermissionStatus, hasSaved: Boolean): LocationStep = when {
        !enabled -> if (hasSaved) LocationStep.UseSaved else LocationStep.AskHighAccuracy
        else -> when (PermissionClass.of(status)) {
            PermissionClass.GRANTED -> LocationStep.Locate
            PermissionClass.DENIED -> LocationStep.Fail(LocationMessage.DENIED)
            PermissionClass.REQUESTABLE -> LocationStep.Ask(hideLoading = false)
        }
    }

    /** A grant settles silently and the resume reloads; a denial asks to search or retry. */
    fun afterPrompt(granted: Boolean): LocationMessage? = if (granted) null else LocationMessage.PROMPT_DENIED

    /** The high-accuracy dialog: turned on settles silently and `locationOn` reloads; otherwise the turn-on message. */
    fun afterHighAccuracy(turnedOn: Boolean): LocationMessage? = if (turnedOn) null else LocationMessage.TURN_ON

    /** O03 `forecast` variants, in order (denied always on Android, unrecorded, location off, otherwise). */
    fun retry(message: LocationMessage, recorded: PermissionStatus?, enabled: Boolean): RetryConfirm = when {
        recorded == PermissionStatus.DENIED_ALWAYS -> RetryConfirm(message.lines + APP_INFO_HINT, listOf(RetryButton.SEARCH, RetryButton.APP_SETTINGS))
        recorded == null -> RetryConfirm(message.lines, listOf(RetryButton.SEARCH, RetryButton.RETRY))
        !enabled -> RetryConfirm(message.lines, listOf(RetryButton.SEARCH, RetryButton.LOCATION_SETTINGS, RetryButton.RETRY))
        else -> RetryConfirm(message.lines, listOf(RetryButton.CLOSE, RetryButton.RETRY))
    }
}
