package net.wizardfactory.todayweather

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.InsetDrawable
import android.os.Build
import android.view.ContextThemeWrapper
import androidx.test.core.app.ApplicationProvider
import java.io.File
import javax.imageio.ImageIO
import kotlin.math.hypot
import kotlin.math.roundToInt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The launch splash shows only the centre of its icon (#3223).
 * - Android 12+ draws the icon at 240 dp (with an icon background) or 288 dp (without) and masks everything outside a
 *   centred circle of 2/3 of that size.
 * - core-splashscreen on Android 6–11 draws it at the theme's `splashScreenIconSize` and covers it with a ring: an oval
 *   of `splashscreen_icon_mask_size_with_background` whose stroke of `splashscreen_icon_mask_stroke_with_background`
 *   leaves a hole of radius size / 2 − stroke, both rounded to whole pixels.
 * The theme's splash drawable must draw the imported artwork at a readable size with every visible pixel inside the hole,
 * at every screen density. `drawable-v26` serves both the compat path (API 26–30) and Android 12+.
 */
@RunWith(RobolectricTestRunner::class)
class SplashIconTest {
    private val appDir = File(System.getProperty("tw.projectDir") ?: "app")
    private val art = ImageIO.read(File(appDir, "src/main/res/drawable-nodpi/splash_icon.png"))

    /** The art's visible pixels (alpha > 0), relative to its top-left corner. */
    private val artPixels: List<Pair<Int, Int>> = buildList {
        for (y in 0 until art.height) for (x in 0 until art.width) if ((art.getRGB(x, y) ushr 24) > 0) add(x to y)
    }

    private class Mask(val label: String, val side: Int, val radius: Double)

    private fun themed(dpi: Int): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val config = Configuration(base.resources.configuration).apply { densityDpi = dpi }
        return ContextThemeWrapper(base.createConfigurationContext(config), R.style.Theme_TodayWeather_Starting)
    }

    private fun splashIcon(context: Context): Drawable {
        val attrs = context.obtainStyledAttributes(intArrayOf(androidx.core.splashscreen.R.attr.windowSplashScreenAnimatedIcon))
        try {
            return attrs.getDrawable(0)!!
        } finally {
            attrs.recycle()
        }
    }

    private fun masks(context: Context, dpi: Int): List<Mask> {
        val res = context.resources
        // Theme.SplashScreen.IconBackground selects this size below API 31 (splash_screen_view.xml sizes the icon by it).
        val compatSide = res.getDimensionPixelSize(androidx.core.splashscreen.R.dimen.splashscreen_icon_size_with_background)
        if (Build.VERSION.SDK_INT < 31) {
            val attrs = context.obtainStyledAttributes(intArrayOf(androidx.core.splashscreen.R.attr.splashScreenIconSize))
            assertEquals("the compat theme's icon size", compatSide, attrs.getDimensionPixelSize(0, 0))
            attrs.recycle()
        }
        val ring = res.getDimensionPixelSize(androidx.core.splashscreen.R.dimen.splashscreen_icon_mask_size_with_background)
        val stroke = res.getDimensionPixelSize(androidx.core.splashscreen.R.dimen.splashscreen_icon_mask_stroke_with_background)
        assertTrue("no compat icon size", compatSide > 0 && ring > 2 * stroke)
        val compat = Mask("compat at $dpi dpi", compatSide, ring / 2.0 - stroke)
        if (Build.VERSION.SDK_INT < 26) return listOf(compat)
        val density = res.displayMetrics.density
        return listOf(compat) + listOf(240, 288).map { dp ->
            val side = (dp * density).roundToInt()
            Mask("Android 12+ $dp dp at $dpi dpi", side, side / 3.0)
        }
    }

    /** Where the theme's drawable draws the imported art in a [side] square: the art itself, at a readable size. */
    private fun placedArt(icon: Drawable, side: Int, label: String): Rect {
        icon.setBounds(0, 0, side, side)
        val child = (icon as InsetDrawable).drawable as BitmapDrawable
        assertEquals("$label: not the imported splash_icon", art.width, child.bitmap.width)
        assertEquals("$label: not the imported splash_icon", art.height, child.bitmap.height)
        val drawn = Rect(child.bounds)
        assertTrue("$label: the art is drawn at $drawn, under 40% of $side px", drawn.width() >= side * 0.4 && drawn.height() >= side * 0.4)
        return drawn
    }

    @Test
    @Config(sdk = [24, 34])
    fun theArtFitsTheMaskAtEveryDensity() {
        for (dpi in DENSITIES) {
            val context = themed(dpi)
            val icon = splashIcon(context)
            for (mask in masks(context, dpi)) {
                val drawn = placedArt(icon, mask.side, mask.label)
                val centre = mask.side / 2.0
                val farthest = artPixels.maxOf { (x, y) ->
                    hypot(drawn.left + (x + 0.5) * drawn.width() / art.width - centre, drawn.top + (y + 0.5) * drawn.height() / art.height - centre)
                }
                // One pixel for centring the icon in the window and for the pixel's own extent.
                assertTrue("${mask.label}: a visible pixel is ${"%.2f".format(farthest)} px from the centre, beyond the mask's " +
                    "${"%.2f".format(mask.radius)} px less 1 px (art drawn at $drawn in ${mask.side} px)", farthest + 1.0 <= mask.radius)
            }
        }
    }

    @Test
    @Config(sdk = [34])
    @GraphicsMode(GraphicsMode.Mode.NATIVE)
    fun theDrawnIconStaysInsideTheMaskAndShows() {
        for (dpi in DENSITIES) {
            val context = themed(dpi)
            val icon = splashIcon(context)
            for (mask in masks(context, dpi)) {
                val bitmap = Bitmap.createBitmap(mask.side, mask.side, Bitmap.Config.ARGB_8888)
                icon.setBounds(0, 0, mask.side, mask.side)
                icon.draw(Canvas(bitmap))
                val centre = mask.side / 2.0
                var opaque = 0
                for (y in 0 until mask.side) for (x in 0 until mask.side) {
                    val alpha = bitmap.getPixel(x, y) ushr 24
                    if (alpha == 0) continue
                    if (alpha == 255) opaque++
                    val distance = hypot(x + 0.5 - centre, y + 0.5 - centre)
                    assertTrue("${mask.label}: pixel ($x, $y) is drawn ${"%.2f".format(distance)} px from the centre, outside the " +
                        "mask's ${"%.2f".format(mask.radius)} px", distance + 0.5 <= mask.radius)
                }
                // The art is an opaque rounded square: at half size it covers about a fifth of the icon area.
                assertTrue("${mask.label}: only $opaque opaque pixels of ${mask.side * mask.side}", opaque >= mask.side * mask.side * 0.15)
            }
        }
    }

    private companion object {
        val DENSITIES = listOf(120, 160, 180, 213, 240, 280, 320, 360, 400, 420, 440, 480, 560, 640)
    }
}
