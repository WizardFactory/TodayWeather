package net.wizardfactory.todayweather.widget

import android.content.Context
import android.content.Intent
import net.wizardfactory.todayweather.MainActivity
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Place

/** A null key follows the main app selection. A pinned place stays pinned when the list changes. */
data class WidgetOptions(
    val placeKey: String? = null,
    val daily: Boolean = false,
    val yesterday: Boolean = false,
    val style: WidgetStyle = WidgetStyle.CLASSIC,
) {
    companion object {
        const val OPEN = "net.wizardfactory.todayweather.widget.OPEN"
        const val PLACE_KEY = "net.wizardfactory.todayweather.widget.PLACE_KEY"

        // PlaceList.indexOf identifies a saved place by its name and address. Length-prefix the name so
        // punctuation in either field cannot cause a collision. A geocode/cache fill may add coordinates.
        fun key(place: Place): String {
            if (place.currentPosition) return "current"
            val name = place.name.orEmpty()
            val address = place.address
            if (address == null && name.isEmpty()) return "location:${place.location}"
            return "saved:${name.length}:$name:${address.orEmpty()}"
        }

        fun resolve(state: AppState, placeKey: String?): Place? =
            if (placeKey == null) state.places.getOrNull(state.placeIndex)?.takeUnless { it.disable }
            else state.places.firstOrNull { !it.disable && key(it) == placeKey }

        private fun prefs(context: Context) = context.getSharedPreferences("widget_options", Context.MODE_PRIVATE)

        fun read(context: Context, id: Int): WidgetOptions = prefs(context).let {
            WidgetOptions(it.getString("place_$id", null), it.getBoolean("daily_$id", false), it.getBoolean("yesterday_$id", false),
                WidgetStyle.entries.find { style -> style.name == it.getString("style_$id", null) } ?: WidgetStyle.CLASSIC)
        }

        fun save(context: Context, id: Int, options: WidgetOptions) {
            prefs(context).edit().putString("place_$id", options.placeKey)
                .putBoolean("daily_$id", options.daily).putBoolean("yesterday_$id", options.yesterday)
                .putString("style_$id", options.style.name).apply()
        }

        fun remove(context: Context, id: Int) {
            prefs(context).edit().remove("place_$id").remove("daily_$id").remove("yesterday_$id").remove("style_$id").apply()
        }

        fun openIntent(context: Context, placeKey: String?): Intent =
            Intent(context, MainActivity::class.java).setAction(OPEN).putExtra(PLACE_KEY, placeKey)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
}
