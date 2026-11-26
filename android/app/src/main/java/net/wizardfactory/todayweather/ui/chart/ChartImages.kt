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
internal class ChartImages(private val load: (String) -> ImageBitmap?) {
    private val cache = HashMap<String, ImageBitmap?>()

    operator fun get(href: String): ImageBitmap? = cache.getOrPut(href) { load(href) }
}

internal fun loadChartImage(context: Context, href: String): ImageBitmap? = runCatching {
    context.assets.open(href).use { BitmapFactory.decodeStream(it)?.apply { setHasMipMap(true) }?.asImageBitmap() }
}.getOrNull()

/** Reads through the activity's [ForecastChartImages] when one is provided, so a tab visit decodes nothing again (#3224). */
@Composable
internal fun rememberChartImages(): ChartImages {
    val shared = LocalForecastChartImages.current
    val context = LocalContext.current
    return remember(shared, context) { if (shared != null) ChartImages(shared::get) else ChartImages { loadChartImage(context, it) } }
}
