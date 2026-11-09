package net.wizardfactory.todayweather.core.data

/**
 * An analytics event as the Cordova code reports it (`Monetization.track`): its name and fields. The app checks them
 * against the schema and sends them only after the user opted in.
 */
fun interface Telemetry {
    fun track(name: String, params: Map<String, Any>)

    companion object {
        val NONE = Telemetry { _, _ -> }
    }
}
