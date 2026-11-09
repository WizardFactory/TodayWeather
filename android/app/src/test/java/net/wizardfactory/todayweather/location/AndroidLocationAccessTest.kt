package net.wizardfactory.todayweather.location

import android.Manifest
import android.app.Application
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import net.wizardfactory.todayweather.core.domain.start.PermissionStatus
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The platform's location permission as the start page and the current position read it (#2889): precise or
 * approximate access is granted, the system's rationale makes a denial requestable, a refusal without one is final
 * (the plugin's "requested" flag), and [LocationSwitch] reports location services turning on.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AndroidLocationAccessTest {
    private val app = ApplicationProvider.getApplicationContext<Application>()
    private val scope = CoroutineScope(Dispatchers.Main)
    private val fine = Manifest.permission.ACCESS_FINE_LOCATION
    private val coarse = Manifest.permission.ACCESS_COARSE_LOCATION

    @After fun stop() = scope.cancel()

    private fun activity(access: AndroidLocationAccess): ComponentActivity {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).create()
        access.attach(controller.get())
        return controller.start().resume().get()
    }

    /** Runs the prompt and answers it with [granted] for (fine, coarse), the system showing a rationale or not. */
    private fun prompt(access: AndroidLocationAccess, activity: ComponentActivity, granted: Pair<Boolean, Boolean>, rationale: Boolean): PermissionStatus {
        val answer = scope.async { access.request() }
        shadowOf(Looper.getMainLooper()).idle()
        val asked = shadowOf(activity).lastRequestedPermission
        assertTrue("waits for the answer", !answer.isCompleted)
        assertEquals(listOf(fine, coarse), asked.requestedPermissions.toList())
        if (granted.first) shadowOf(app).grantPermissions(fine)
        if (granted.second) shadowOf(app).grantPermissions(coarse)
        shadowOf(activity.packageManager).setShouldShowRequestPermissionRationale(fine, rationale)
        shadowOf(activity.packageManager).setShouldShowRequestPermissionRationale(coarse, rationale)
        val results = listOf(granted.first, granted.second).map { if (it) PackageManager.PERMISSION_GRANTED else PackageManager.PERMISSION_DENIED }
        activity.onRequestPermissionsResult(asked.requestCode, asked.requestedPermissions, results.toIntArray())
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(answer.isCompleted)
        return answer.getCompleted()
    }

    @Test
    fun aNewInstallIsRequestableAndApproximateAccessIsGranted() {
        val access = AndroidLocationAccess(app)
        val activity = activity(access)
        assertEquals(PermissionStatus.NOT_REQUESTED, access.status())
        // Android 12+'s "Approximate": only coarse access.
        assertEquals(PermissionStatus.GRANTED, prompt(access, activity, granted = false to true, rationale = false))
        assertEquals(PermissionStatus.GRANTED, access.status())
        // "Only this time" ends after the app: the next attempt asks again (the plugin's flag made it final, B24).
        shadowOf(app).denyPermissions(fine, coarse)
        assertEquals(PermissionStatus.NOT_REQUESTED, access.status())
    }

    @Test
    fun aDenialWithTheRationaleAsksAgainAndOneWithoutIsFinal() {
        val access = AndroidLocationAccess(app)
        val activity = activity(access)
        assertEquals(PermissionStatus.DENIED_ONCE, prompt(access, activity, granted = false to false, rationale = true))
        assertEquals(PermissionStatus.DENIED_ONCE, access.status())
        // "Don't allow" again, from the activity shown now: no rationale any more, so the system would not ask; the app
        // keeps that answer.
        access.detach(activity)
        val next = activity(access)
        assertEquals(PermissionStatus.DENIED_ALWAYS, prompt(access, next, granted = false to false, rationale = false))
        assertEquals(PermissionStatus.DENIED_ALWAYS, access.status())
        assertEquals("kept for the next app open", PermissionStatus.DENIED_ALWAYS, AndroidLocationAccess(app).status())
    }

    /** A request the system interrupted answers with no permissions: nothing is recorded. */
    @Test
    fun anInterruptedRequestRecordsNothing() {
        val access = AndroidLocationAccess(app)
        val activity = activity(access)
        val answer = scope.async { access.request() }
        shadowOf(Looper.getMainLooper()).idle()
        activity.onRequestPermissionsResult(shadowOf(activity).lastRequestedPermission.requestCode, arrayOf(), intArrayOf())
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(PermissionStatus.NOT_REQUESTED, answer.getCompleted())
        assertEquals(PermissionStatus.NOT_REQUESTED, AndroidLocationAccess(app).status())
    }

    @Test
    fun withoutAnActivityNothingIsAsked() {
        val access = AndroidLocationAccess(app)
        val answer = scope.async { access.request() }
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(PermissionStatus.NOT_REQUESTED, answer.getCompleted())
    }

    @Test
    fun locationServicesTurningOnAreReported() {
        val manager = app.getSystemService(LocationManager::class.java)
        shadowOf(manager).setLocationEnabled(false)
        var turnedOn = 0
        val switch = LocationSwitch(app) { turnedOn++ }
        switch.register()
        // The system's broadcast after each change.
        fun set(enabled: Boolean) {
            shadowOf(manager).setLocationEnabled(enabled)
            app.sendBroadcast(Intent(LocationManager.PROVIDERS_CHANGED_ACTION).setPackage(app.packageName))
            shadowOf(Looper.getMainLooper()).idle()
        }
        set(true)
        assertEquals(1, turnedOn)
        set(true)
        assertEquals("a change of provider with location on", 1, turnedOn)
        set(false)
        assertEquals("turning off reloads nothing", 1, turnedOn)
        switch.unregister()
        set(true)
        assertEquals(1, turnedOn)
    }
}
