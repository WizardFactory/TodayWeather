package net.wizardfactory.todayweather.ui.chart

import android.app.ActivityManager
import android.content.Context
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalContext
import net.wizardfactory.todayweather.core.domain.chart.Svg
import net.wizardfactory.todayweather.core.domain.chart.SvgGroup
import net.wizardfactory.todayweather.core.domain.chart.SvgImage
import net.wizardfactory.todayweather.core.domain.chart.SvgNode

internal val LocalForecastChartImages = staticCompositionLocalOf<ForecastChartImages?> { null }

/**
 * The activity's decoded asset images, shared across tabs and visits: chart SVG images, Daily detail icons and every image
 * the screens draw through [rememberChartImages] (#3224). Missing paths are retained until eviction.
 */
internal class ForecastChartImages(
    maxBytes: Int = 4 * 1024 * 1024,
    private val load: (String) -> ImageBitmap?,
) {
    constructor(context: Context) : this(
        maxBytes = budgetBytes((context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.memoryClass ?: 0),
        load = { loadChartImage(context, it) },
    )

    private class Entry(val bitmap: ImageBitmap?)

    private val cache = object : LruCache<String, Entry>(maxBytes) {
        override fun sizeOf(key: String, value: Entry): Int =
            // Charge each entry for its key and bookkeeping, including absent images.
            maxOf(1024, value.bitmap?.asAndroidBitmap()?.allocationByteCount ?: 0)
    }

    operator fun get(path: String): ImageBitmap? =
        (cache.get(path) ?: Entry(load(path)).also { cache.put(path, it) }).bitmap

    fun prepare(colors: ChartColors, vararg scenes: Svg): Map<String, ImageBitmap> {
        val images = mutableMapOf<String, ImageBitmap?>()
        fun collect(node: SvgNode) {
            when (node) {
                is SvgGroup -> node.children.forEach(::collect)
                is SvgImage -> if (node.href !in images) {
                    val path = when {
                        node.href.startsWith("img/weather_default/") -> colors.weatherImages + node.href.removePrefix("img/weather_default")
                        node.href.startsWith("img/icons_default/") -> colors.iconImages + node.href.removePrefix("img/icons_default")
                        else -> node.href
                    }
                    images[node.href] = this@ForecastChartImages[path]
                }
                else -> Unit
            }
        }
        scenes.forEach { scene -> scene.children.forEach(::collect) }
        return buildMap { images.forEach { (href, image) -> if (image != null) put(href, image) } }
    }

    companion object {
        private const val MIB = 1024 * 1024

        /** 1/16 of the app's memory class: a session's theme icons (240 px, about 300 KB decoded) fit without thrashing. */
        fun budgetBytes(memoryClassMb: Int): Int = (memoryClassMb.toLong() * MIB / 16).coerceIn(4L * MIB, 16L * MIB).toInt()
    }
}

@Composable
internal fun rememberForecastChartImages(): ForecastChartImages {
    val shared = LocalForecastChartImages.current
    val context = LocalContext.current
    return shared ?: remember(context) { ForecastChartImages(context) }
}
