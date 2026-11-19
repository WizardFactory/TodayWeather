package net.wizardfactory.todayweather.ui.shell

import androidx.compose.ui.graphics.toArgb
import androidx.core.graphics.ColorUtils
import java.awt.image.BufferedImage
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.ui.chart.Pixels

/** Substitute only the xhdpi icon cells whose glyphs differ from the Cordova capture. */
internal fun Pixels.withCurrentTabIconsFrom(native: Pixels, vararg tabs: Tab): Pixels {
    if (width != native.width || height != native.height) return this
    val pixels = argb.copyOf()
    val tabTop = height - 49 * 2
    val iconTop = tabTop + 2 * 2
    val iconSize = 32 * 2
    for (tab in tabs) {
        val center = (2 * tab.ordinal + 1) * width / 8
        for (y in iconTop until iconTop + iconSize) {
            val start = y * width + center - iconSize / 2
            native.argb.copyInto(pixels, start, start, start + iconSize)
        }
    }
    return Pixels(width, height, pixels)
}

/** Update the xhdpi Cordova reference with the new indicator and tint the existing label in place. */
internal fun Pixels.withTabAccent(tab: Tab, colors: ShellColors): Pixels {
    val image = BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB)
    image.setRGB(0, 0, width, height, argb, 0, width)
    val top = height - 98
    val left = width * tab.ordinal / 4
    val center = left + width / 8
    val accent = colors.tabSelected.toArgb()
    val g = image.createGraphics()
    g.color = java.awt.Color(accent, true)
    g.fillRoundRect(center - 24, top + 2, 48, 5, 5, 5)
    g.dispose()

    // Recover each label pixel's ink coverage on its flat background to preserve text and position.
    val background = colors.tabBar.toArgb()
    val backgroundRed = android.graphics.Color.red(background)
    val inkRange = android.graphics.Color.red(colors.tabText.toArgb()) - backgroundRed
    for (y in top + 68 until height) {
        for (x in left until left + width / 4) {
            val coverage = (android.graphics.Color.red(image.getRGB(x, y)) - backgroundRed).toFloat() / inkRange
            image.setRGB(x, y, ColorUtils.blendARGB(background, accent, coverage.coerceIn(0f, 1f)))
        }
    }
    return Pixels(width, height, image.getRGB(0, 0, width, height, null, 0, width))
}
