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
    operator fun get(href: String): ImageBitmap? = load(href)
}

internal fun loadChartImage(context: Context, href: String): ImageBitmap? = runCatching {
    context.assets.open(href).use { BitmapFactory.decodeStream(it)?.apply { setHasMipMap(true) }?.asImageBitmap() }
}.getOrNull()

/**
 * Reads the activity's [ForecastChartImages] directly when one is provided (AppContent provides it), so a tab visit decodes
 * nothing again and the shared cache alone bounds what is kept (#3224). Without one, the images are kept for this
 * composition.
 */
@Composable
internal fun rememberChartImages(): ChartImages {
    val shared = LocalForecastChartImages.current
    val context = LocalContext.current
    return remember(shared, context) {
        if (shared != null) {
            ChartImages(shared::get)
        } else {
            val kept = HashMap<String, ImageBitmap?>()
            ChartImages { href -> kept.getOrPut(href) { loadChartImage(context, href) } }
        }
    }
}
