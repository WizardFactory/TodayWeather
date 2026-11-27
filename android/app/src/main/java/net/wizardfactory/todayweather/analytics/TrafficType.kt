package net.wizardfactory.todayweather.analytics

import android.content.Context
import android.os.Build

/**
 * `traffic_type` of the analytics events (#3228), so business metrics can drop the team's installs:
 * - `development`: a build with Google's test ad units (debug builds), whatever its installer.
 * - `internal`: a release build installed the ways the team sideloads: no installer or the shell (`adb install`),
 *   or a package installer (an APK opened from a file manager or a download).
 * - `production`: everything else. Google Play, and every other installer: real users also arrive through them,
 *   such as a phone moved with Samsung Smart Switch, Galaxy Store or another store, and an `internal` tag would
 *   drop them from the reports on every date. Play's internal, closed and open testing tracks install through
 *   Play too, so their testers stay `production`; the queries' release-date rule excludes installations that ran
 *   a version before its production release, for every version (docs/operations/monetization.md).
 *
 * A failed installer read keeps `production`: a read of the app's own install source has no expected failure, and
 * a real user must not drop out of the metrics because of one.
 */
object TrafficType {
    const val PLAY_STORE = "com.android.vending"
    const val DEVELOPMENT = "development"
    const val PRODUCTION = "production"
    const val INTERNAL = "internal"

    /** The installers of the team's sideloads; `null` (no installer, `adb install`) counts too. */
    val SIDELOAD_INSTALLERS = setOf("com.android.shell", "com.android.packageinstaller", "com.google.android.packageinstaller")

    fun of(releaseAds: Boolean, installer: () -> String?): String {
        if (!releaseAds) return DEVELOPMENT
        val name = try {
            installer()
        } catch (e: Exception) {
            return PRODUCTION
        }
        return if (name == null || name in SIDELOAD_INSTALLERS) INTERNAL else PRODUCTION
    }

    /** The package that installed this app: `getInstallSourceInfo` from Android 11, the older installer name before. */
    fun installer(context: Context): String? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
    } else {
        @Suppress("DEPRECATION")
        context.packageManager.getInstallerPackageName(context.packageName)
    }
}
