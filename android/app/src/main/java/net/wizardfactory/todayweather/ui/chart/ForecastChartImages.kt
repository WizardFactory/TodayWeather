package net.wizardfactory.todayweather.ui.chart

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

/** Prepared SVG icons shared by the forecast tabs, including misses for the lifetime of a cache entry. */
internal class ForecastChartImages(
    maxBytes: Int = 4 * 1024 * 1024,
    private val load: (String) -> ImageBitmap?,
) {
    constructor(context: Context) : this(load = { loadChartImage(context, it) })

    private class Entry(val bitmap: ImageBitmap?)

    private val cache = object : LruCache<String, Entry>(maxBytes) {
        override fun sizeOf(key: String, value: Entry): Int =
            // Charge each entry for its key and bookkeeping, including absent images.
            maxOf(1024, value.bitmap?.asAndroidBitmap()?.allocationByteCount ?: 0)
    }

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
                    val entry = cache.get(path) ?: Entry(load(path)).also { cache.put(path, it) }
                    images[node.href] = entry.bitmap
                }
                else -> Unit
            }
        }
        scenes.forEach { scene -> scene.children.forEach(::collect) }
        return buildMap { images.forEach { (href, image) -> if (image != null) put(href, image) } }
    }
}

@Composable
internal fun rememberForecastChartImages(): ForecastChartImages {
    val shared = LocalForecastChartImages.current
    val context = LocalContext.current
    return shared ?: remember(context) { ForecastChartImages(context) }
}
