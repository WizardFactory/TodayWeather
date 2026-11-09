package net.wizardfactory.todayweather.location

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.location.LocationListenerCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.location.LocationRequestCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ResolvableApiException
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationSettingsRequest
import com.google.android.gms.location.Priority
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import net.wizardfactory.todayweather.core.data.LocationAccess
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import net.wizardfactory.todayweather.core.storage.Location

/**
 * The device's location on the platform (the Cordova diagnostic, geolocation and location-accuracy plugins, #2889):
 * - the status: precise or approximate access is granted; a denial with the system's rationale is `DENIED_ONCE`; one
 *   the system answered without a prompt, after a request was refused without a rationale, is `DENIED_ALWAYS` (the
 *   plugin's "requested" flag, kept in this app's own preferences, which are not backed up);
 * - positions from Google Play services' fused provider at high accuracy, the first fix within 60 s, one up to 60 s old
 *   counting (`watchPosition` with `timeout`, `maximumAge` 60000 and `enableHighAccuracy`); without Play services the
 *   platform's provider;
 * - Play services' dialog that turns location services on (`REQUEST_PRIORITY_HIGH_ACCURACY`).
 * The system's prompt and dialog belong to an activity: each new one [attach]es its launchers in `onCreate`, and an
 * answer reaches the request through the launcher of whichever activity is shown when it comes.
 */
class AndroidLocationAccess(private val context: Context) : LocationAccess {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val locationManager = context.getSystemService(LocationManager::class.java)
    private var activity: Activity? = null
    private var permissionLauncher: ActivityResultLauncher<Array<String>>? = null
    private var settingsLauncher: ActivityResultLauncher<IntentSenderRequest>? = null
    private var permissionAnswer: CompletableDeferred<Map<String, Boolean>>? = null
    private var settingsAnswer: CompletableDeferred<Boolean>? = null

    /** The launchers of [activity], registered before it starts. */
    fun attach(activity: ComponentActivity) {
        this.activity = activity
        permissionLauncher = activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { answer ->
            permissionAnswer?.complete(answer)
        }
        settingsLauncher = activity.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
            settingsAnswer?.complete(result.resultCode == Activity.RESULT_OK)
        }
    }

    fun detach(activity: ComponentActivity) {
        if (this.activity !== activity) return
        this.activity = null
        permissionLauncher = null
        settingsLauncher = null
    }

    override fun enabled(): Boolean = LocationManagerCompat.isLocationEnabled(locationManager)

    override fun status(): PermissionStatus {
        if (granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)) return PermissionStatus.GRANTED
        val shown = activity
        if (shown != null && PERMISSIONS.any { ActivityCompat.shouldShowRequestPermissionRationale(shown, it) }) return PermissionStatus.DENIED_ONCE
        return if (prefs.getBoolean(KEY_REFUSED, false)) PermissionStatus.DENIED_ALWAYS else PermissionStatus.NOT_REQUESTED
    }

    /**
     * The prompt for precise and approximate access; without an activity, the status as it is. A request the system
     * interrupted (an answer without permissions) records nothing.
     */
    override suspend fun request(): PermissionStatus {
        val launcher = permissionLauncher ?: return status()
        val answer = CompletableDeferred<Map<String, Boolean>>()
        permissionAnswer?.cancel()
        permissionAnswer = answer
        launcher.launch(PERMISSIONS)
        if (answer.await().isEmpty()) return status()
        val status = status()
        // A refusal the system gives no rationale for is final: the next request shows no prompt.
        if (status == PermissionStatus.NOT_REQUESTED) prefs.edit().putBoolean(KEY_REFUSED, true).apply()
        else if (status == PermissionStatus.GRANTED) prefs.edit().remove(KEY_REFUSED).apply()
        return if (status == PermissionStatus.NOT_REQUESTED) PermissionStatus.DENIED_ALWAYS else status
    }

    override suspend fun position(): Location? = try {
        withTimeoutOrNull(TIMEOUT_MS) { if (playServices()) fused() else platform() }?.let { Location(it.latitude, it.longitude) }
    } catch (e: SecurityException) {
        null
    }

    override suspend fun requestHighAccuracy(): Boolean {
        val shown = activity ?: return false
        val launcher = settingsLauncher ?: return false
        if (!playServices()) return false
        val request = LocationSettingsRequest.Builder().addLocationRequest(LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10_000).build())
            .setAlwaysShow(true).build()
        return try {
            LocationServices.getSettingsClient(shown).checkLocationSettings(request).await()
            true
        } catch (e: ResolvableApiException) {
            val answer = CompletableDeferred<Boolean>()
            settingsAnswer?.cancel()
            settingsAnswer = answer
            launcher.launch(IntentSenderRequest.Builder(e.resolution).build())
            answer.await()
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            false
        }
    }

    private fun granted(permission: String) = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun playServices() = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

    /** One fused fix at high accuracy, a cached one up to 60 s old counting. */
    @SuppressLint("MissingPermission")
    private suspend fun fused(): android.location.Location? {
        val client = LocationServices.getFusedLocationProviderClient(context)
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1_000).setMaxUpdates(1).setDurationMillis(TIMEOUT_MS)
            .setMaxUpdateAgeMillis(MAX_AGE_MS).build()
        return suspendCancellableCoroutine { continuation ->
            val callback = object : LocationCallback() {
                override fun onLocationResult(result: LocationResult) {
                    client.removeLocationUpdates(this)
                    if (continuation.isActive) continuation.resume(result.lastLocation)
                }
            }
            client.requestLocationUpdates(request, callback, Looper.getMainLooper()).addOnFailureListener {
                if (continuation.isActive) continuation.resume(null)
            }
            continuation.invokeOnCancellation { client.removeLocationUpdates(callback) }
        }
    }

    /**
     * Without Play services: the provider's last fix when it is at most 60 s old, else its next one (one update; the
     * platform's `getCurrentLocation` would give up after 30 s).
     */
    @SuppressLint("MissingPermission")
    private suspend fun platform(): android.location.Location? {
        val provider = when {
            granted(Manifest.permission.ACCESS_FINE_LOCATION) && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> return null
        }
        locationManager.getLastKnownLocation(provider)?.takeIf { (SystemClock.elapsedRealtimeNanos() - it.elapsedRealtimeNanos) / 1_000_000 <= MAX_AGE_MS }
            ?.let { return it }
        return suspendCancellableCoroutine { continuation ->
            val listener = object : LocationListenerCompat {
                override fun onLocationChanged(location: android.location.Location) {
                    LocationManagerCompat.removeUpdates(locationManager, this)
                    if (continuation.isActive) continuation.resume(location)
                }
            }
            val request = LocationRequestCompat.Builder(1_000).setQuality(LocationRequestCompat.QUALITY_HIGH_ACCURACY).setMaxUpdates(1).build()
            LocationManagerCompat.requestLocationUpdates(locationManager, provider, request, ContextCompat.getMainExecutor(context), listener)
            continuation.invokeOnCancellation { LocationManagerCompat.removeUpdates(locationManager, listener) }
        }
    }

    companion object {
        private const val PREFS = "tw_location"
        private const val KEY_REFUSED = "refused"
        private const val TIMEOUT_MS = 60_000L
        private const val MAX_AGE_MS = 60_000L
        private val PERMISSIONS = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

        /** `switchToSettings()`: the app's details page in the system settings. */
        fun openAppSettings(context: Context) {
            runCatching {
                context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }

        /** `switchToLocationSettings()`: the device's location settings. */
        fun openLocationSettings(context: Context) {
            runCatching { context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }
}

/**
 * `registerLocationStateChangeHandler` (app.js): [onEnabled] runs when location services turn on, as the plugin's
 * `PROVIDERS_CHANGED_ACTION` receiver reported them, from [register] until [unregister].
 */
class LocationSwitch(private val context: Context, private val onEnabled: () -> Unit) {
    private val locationManager = context.getSystemService(LocationManager::class.java)
    private var enabled = LocationManagerCompat.isLocationEnabled(locationManager)
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val now = LocationManagerCompat.isLocationEnabled(locationManager)
            val turnedOn = !enabled && now
            enabled = now
            if (turnedOn) onEnabled()
        }
    }

    fun register() {
        enabled = LocationManagerCompat.isLocationEnabled(locationManager)
        ContextCompat.registerReceiver(context, receiver, IntentFilter(LocationManager.PROVIDERS_CHANGED_ACTION), ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    fun unregister() {
        runCatching { context.unregisterReceiver(receiver) }
    }
}
