package net.wizardfactory.todayweather.core.storage

import android.annotation.SuppressLint
import android.content.Context
import android.provider.Settings

/**
 * `Device-Id` sent to the legacy server: `Settings.Secure.ANDROID_ID`, which cordova-plugin-device
 * reported as `device.uuid`. Android 8+ scopes it to the signing key, user and device, so the native app
 * signed with the Cordova key keeps the value.
 */
object DeviceIdentity {
    @SuppressLint("HardwareIds")
    fun deviceId(context: Context): String? =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
}
