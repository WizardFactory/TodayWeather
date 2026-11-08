package net.wizardfactory.todayweather.ui.chart

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext

/**
 * Chart images from the imported Cordova assets (`assets/img/…`, AN-01) by the SVG `href`; null for an image
 * the Cordova app does not have either (such as `Rain.png`), which the WebView does not draw.
 */
internal class ChartImages(private val context: Context) {
    private val cache = HashMap<String, ImageBitmap?>()

    operator fun get(href: String): ImageBitmap? = cache.getOrPut(href) {
        runCatching {
            context.assets.open(href).use { BitmapFactory.decodeStream(it)?.apply { setHasMipMap(true) }?.asImageBitmap() }
        }.getOrNull()
    }
}

@Composable
internal fun rememberChartImages(): ChartImages {
    val context = LocalContext.current
    return remember(context) { ChartImages(context) }
}
