package net.wizardfactory.todayweather

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri

/**
 * Keeps Firebase Analytics off until the user opts in on the menu's 선택적 이용 통계 (AN-15, `Analytics`).
 *
 * The Cordova app records the opt-in `twAnalyticsConsentV1` only in WebView storage, and the Firebase SDK
 * keeps a collection flag that the Cordova build may have enabled; that persisted flag overrides the
 * manifest default. So before Firebase starts collecting, collection is disabled and every consent type
 * is denied, and then the native choice applies. [EarlyStartProvider] runs this before `FirebaseInitProvider`
 * (higher `initOrder`).
 */
object AnalyticsGuard {
    private const val MEASUREMENT_PREFS = "com.google.android.gms.measurement.prefs"

    /**
     * Turns the SDK's persisted collection flags off synchronously, before Firebase reads them. The API
     * call below persists asynchronously; on the emulator upgrade test the process ended before that
     * write and the next start collected again, logging `app_update` (SDK prefs observed with
     * firebase-analytics 23.x; the upgrade test checks the result).
     */
    fun beforeFirebase(context: Context) {
        context.getSharedPreferences(MEASUREMENT_PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("measurement_enabled_from_api", false)
            .putBoolean("measurement_enabled", false)
            .commit()
    }
}

/**
 * Runs before the other content providers of the app, so before Firebase initializes: collection off, a withdrawal made in
 * a fallback Cordova build that claimed the state ([HandBackConsent]), then the native choice (`platformReady`:
 * `Monetization.init`), so an opt-in made in this app collects again from the start.
 */
class EarlyStartProvider : ContentProvider() {
    override fun onCreate(): Boolean {
        AnalyticsGuard.beforeFirebase(context!!)
        HandBackConsent.beforeStart(context!!)
        (context!!.applicationContext as TodayWeatherApp).analytics.start()
        return true
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
