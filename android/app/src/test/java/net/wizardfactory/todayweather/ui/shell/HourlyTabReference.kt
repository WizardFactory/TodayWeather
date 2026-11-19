package net.wizardfactory.todayweather.ui.shell

import net.wizardfactory.todayweather.ui.chart.Pixels

/**
 * The xhdpi Cordova captures show a reload glyph and the old calendar under Hourly.
 * Compare the rest of the 49 dp bottom bar, including its labels and the two other icons.
 * ShellTest checks all four native glyphs for each selected tab.
 */
internal fun Pixels.withHourlyTabIconsFrom(native: Pixels): Pixels {
    if (width != native.width || height != native.height) return this
    val pixels = argb.copyOf()
    val tabTop = height - 49 * 2
    val iconTop = tabTop + 2 * 2
    val iconSize = 32 * 2
    for (center in listOf(width * 3 / 8, width * 5 / 8)) {
        for (y in iconTop until iconTop + iconSize) {
            val start = y * width + center - iconSize / 2
            native.argb.copyInto(pixels, start, start, start + iconSize)
        }
    }
    return Pixels(width, height, pixels)
}
