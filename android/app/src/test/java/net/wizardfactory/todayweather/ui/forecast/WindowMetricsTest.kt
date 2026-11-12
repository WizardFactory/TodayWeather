package net.wizardfactory.todayweather.ui.forecast

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Rect
import android.view.WindowInsets
import android.view.WindowManager
import android.view.WindowMetrics
import androidx.test.core.app.ApplicationProvider
import java.lang.reflect.Proxy
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** A resized activity uses its window, even while the physical display stays at tablet size. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w1280dp-h800dp-xhdpi")
class WindowMetricsTest {
    @Test @Config(sdk = [24]) fun olderAndroidUsesTheApplicationDisplaySize() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        @Suppress("DEPRECATION")
        val display = context.getSystemService(WindowManager::class.java).defaultDisplay
        val shadow = org.robolectric.Shadows.shadowOf(display)
        shadow.setRealWidth(2560)
        shadow.setRealHeight(1600)
        shadow.setWidth(1280)
        shadow.setHeight(1500)
        val density = context.resources.displayMetrics.density
        assertEquals(1280.0 / density, screenMetrics(context).bodyWidth, 0.01)
        assertEquals(1500.0 / density, screenMetrics(context).bodyHeight, 0.01)
    }

    @Test fun aSplitWindowDoesNotKeepTheFullDisplayMetrics() {
        val base = ApplicationProvider.getApplicationContext<Context>()
        var current = Rect(0, 0, 1280, 1600)
        val maximum = Rect(0, 0, 2560, 1600)
        val manager = Proxy.newProxyInstance(WindowManager::class.java.classLoader, arrayOf(WindowManager::class.java)) { _, method, _ ->
            when (method.name) {
                "getCurrentWindowMetrics" -> WindowMetrics(current, WindowInsets.Builder().build())
                "getMaximumWindowMetrics" -> WindowMetrics(maximum, WindowInsets.Builder().build())
                else -> error("Unexpected window operation: ${method.name}")
            }
        }
        val context = object : ContextWrapper(base) {
            override fun getSystemService(name: String): Any? = if (name == Context.WINDOW_SERVICE) manager else super.getSystemService(name)
        }
        val density = base.resources.displayMetrics.density
        assertEquals(1280.0 / density, screenMetrics(context).bodyWidth, 0.01)
        assertEquals(1600.0 / density, screenMetrics(context).bodyHeight, 0.01)
        current = Rect(0, 0, 800, 1200)
        assertEquals(800.0 / density, screenMetrics(context).bodyWidth, 0.01)
        assertEquals(1200.0 / density, screenMetrics(context).bodyHeight, 0.01)
    }
}
