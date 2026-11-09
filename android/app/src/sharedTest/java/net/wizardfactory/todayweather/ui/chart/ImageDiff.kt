package net.wizardfactory.todayweather.ui.chart

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** ARGB pixels, row by row (JVM and device tests share this source, src/sharedTest). */
class Pixels(val width: Int, val height: Int, val argb: IntArray) {
    operator fun get(x: Int, y: Int) = argb[y * width + x]

    fun crop(x: Int, y: Int, w: Int, h: Int): Pixels {
        val cw = min(w, width - x)
        val ch = min(h, height - y)
        return Pixels(cw, ch, IntArray(cw * ch) { i -> this[x + i % cw, y + i / cw] })
    }
}

/**
 * Difference between a native capture and a Cordova capture of the same chart, over their common area.
 * [strong]: share of pixels whose largest channel difference exceeds 64 after a 3x3 box blur, which leaves out
 * anti-aliasing and glyph rasterization; [mean]: mean largest channel difference without blur.
 */
data class ImageDiff(val width: Int, val height: Int, val heightDifference: Int, val strong: Double, val mean: Double) {
    companion object {
        fun of(native: Pixels, cordova: Pixels): ImageDiff {
            val w = min(native.width, cordova.width)
            val h = min(native.height, cordova.height)
            val a = blur(native, w, h)
            val b = blur(cordova, w, h)
            var strong = 0
            var sum = 0.0
            for (y in 0 until h) for (x in 0 until w) {
                if (channelDiff(a[y * w + x], b[y * w + x]) > 64) strong++
                sum += channelDiff(native[x, y], cordova[x, y])
            }
            return ImageDiff(w, h, abs(native.height - cordova.height), strong.toDouble() / (w * h), sum / (w * h))
        }

        /** The strongly differing pixels in red over a faded Cordova capture. */
        fun overlay(native: Pixels, cordova: Pixels): Pixels {
            val w = min(native.width, cordova.width)
            val h = min(native.height, cordova.height)
            val a = blur(native, w, h)
            val b = blur(cordova, w, h)
            return Pixels(w, h, IntArray(w * h) { i ->
                val c = cordova[i % w, i / w]
                if (channelDiff(a[i], b[i]) > 64) 0xFFFF0000.toInt()
                else (0xFF shl 24) or (fade(c shr 16) shl 16) or (fade(c shr 8) shl 8) or fade(c)
            })
        }

        private fun fade(c: Int) = 255 - (255 - (c and 0xFF)) / 3

        private fun channelDiff(p: Int, q: Int): Int = max(abs((p shr 16 and 0xFF) - (q shr 16 and 0xFF)),
            max(abs((p shr 8 and 0xFF) - (q shr 8 and 0xFF)), abs((p and 0xFF) - (q and 0xFF))))

        private fun blur(image: Pixels, w: Int, h: Int): IntArray = IntArray(w * h) { i ->
            val x = i % w
            val y = i / w
            var r = 0; var g = 0; var b = 0; var n = 0
            for (dy in -1..1) for (dx in -1..1) {
                val xx = x + dx
                val yy = y + dy
                if (xx in 0 until w && yy in 0 until h) {
                    val p = image[xx, yy]
                    r += p shr 16 and 0xFF; g += p shr 8 and 0xFF; b += p and 0xFF; n++
                }
            }
            (r / n shl 16) or (g / n shl 8) or (b / n)
        }
    }
}
