package net.wizardfactory.todayweather

import android.graphics.Rect
import android.graphics.drawable.InsetDrawable
import android.os.Build
import android.view.ContextThemeWrapper
import androidx.test.core.app.ApplicationProvider
import java.io.File
import javax.imageio.ImageIO
import kotlin.math.hypot
import kotlin.math.roundToInt
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The launch splash shows only the centre of its icon and masks everything outside a centred circle of 2/3 of the icon
 * area (#3223). Android 12+ draws the icon at 240 dp (with an icon background) or 288 dp (without); core-splashscreen on
 * older versions draws it at the theme's `splashScreenIconSize`. Every opaque pixel of the imported artwork, as the
 * theme's splash drawable places it, must lie inside that circle at each of those sizes.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 34], qualifiers = "xxhdpi")
class SplashIconTest {
    private val appDir = File(System.getProperty("tw.projectDir") ?: "app")

    @Test
    fun theWholeIconFitsInsideTheSplashMask() {
        val context = ContextThemeWrapper(ApplicationProvider.getApplicationContext(), R.style.Theme_TodayWeather_Starting)
        val attrs = context.obtainStyledAttributes(intArrayOf(
            androidx.core.splashscreen.R.attr.windowSplashScreenAnimatedIcon, androidx.core.splashscreen.R.attr.splashScreenIconSize))
        val icon = attrs.getDrawable(0)!!
        val compatSide = attrs.getDimensionPixelSize(1, 0)
        attrs.recycle()

        val art = ImageIO.read(File(appDir, "src/main/res/drawable-nodpi/splash_icon.png"))
        val density = context.resources.displayMetrics.density
        val sides = if (Build.VERSION.SDK_INT >= 31) listOf(240, 288).map { (it * density).roundToInt() } else listOf(compatSide)
        assertTrue("no icon size", sides.all { it > 0 })
        for (side in sides) {
            val sizeDp = (side / density).roundToInt()
            icon.setBounds(0, 0, side, side)
            val drawn: Rect = (icon as? InsetDrawable)?.drawable?.bounds ?: icon.bounds
            val centre = side / 2.0
            var farthest = 0.0
            for (y in 0 until art.height) for (x in 0 until art.width) {
                if ((art.getRGB(x, y) ushr 24) <= 16) continue
                val px = drawn.left + (x + 0.5) * drawn.width() / art.width
                val py = drawn.top + (y + 0.5) * drawn.height() / art.height
                farthest = maxOf(farthest, hypot(px - centre, py - centre))
            }
            val safe = side / 3.0
            assertTrue("at $sizeDp dp an opaque pixel is ${"%.1f".format(farthest)} px from the centre, beyond the mask radius " +
                "${"%.1f".format(safe)} px (drawn at $drawn)", farthest <= safe)
        }
    }
}
