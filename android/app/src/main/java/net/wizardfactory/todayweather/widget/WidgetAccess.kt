package net.wizardfactory.todayweather.widget

import android.content.Context
import java.util.concurrent.TimeUnit

/** Only a foreground visit to MainActivity resets this device-local window. */
internal object WidgetAccess {
    val visitWindow = TimeUnit.DAYS.toMillis(5)

    private fun preferences(context: Context) = context.getSharedPreferences("widget_access", Context.MODE_PRIVATE)

    fun allowedAt(lastVisit: Long, now: Long): Boolean =
        lastVisit > 0 && now >= lastVisit && now - lastVisit < visitWindow

    fun lastVisit(context: Context): Long = preferences(context).getLong("last_visit", 0)

    fun remainingMillis(context: Context): Long {
        val visit = lastVisit(context)
        val now = System.currentTimeMillis()
        return if (allowedAt(visit, now)) visitWindow - (now - visit) else 0
    }

    fun allowed(context: Context): Boolean = remainingMillis(context) > 0

    fun mainAppOpened(context: Context) {
        preferences(context).edit().putLong("last_visit", System.currentTimeMillis()).apply()
        WidgetRefresh.enqueue(context)
    }
}
