package net.wizardfactory.todayweather.analytics

import android.content.Context
import android.os.Build

/**
 * `traffic_type` of the analytics events (#3228), so business metrics can drop the team's installs:
 * - `development`: a build with Google's test ad units (debug builds), whatever its installer.
 * - `production`: a release build installed by Google Play. Play's internal and closed testing tracks install
 *   through Play too, so their testers stay `production`; the queries' pre-release dates cover only the versions
 *   built before this tag.
 * - `internal`: a release build from any other installer or none (adb, a file manager, another store).
 *
 * A failed installer read keeps `production`: a read of the app's own install source has no expected failure, and
 * a real user must not drop out of the metrics because of one.
 */
object TrafficType {
    const val PLAY_STORE = "com.android.vending"
    const val DEVELOPMENT = "development"
    const val PRODUCTION = "production"
    const val INTERNAL = "internal"

    fun of(releaseAds: Boolean, installer: () -> String?): String {
        if (!releaseAds) return DEVELOPMENT
        val name = try {
            installer()
        } catch (e: Exception) {
            return PRODUCTION
        }
        return if (name == PLAY_STORE) PRODUCTION else INTERNAL
    }

    /** The package that installed this app: `getInstallSourceInfo` from Android 11, the older installer name before. */
    fun installer(context: Context): String? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
    } else {
        @Suppress("DEPRECATION")
        context.packageManager.getInstallerPackageName(context.packageName)
    }
}
