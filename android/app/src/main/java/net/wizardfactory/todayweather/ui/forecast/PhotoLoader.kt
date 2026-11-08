package net.wizardfactory.todayweather.ui.forecast

import android.content.Context
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * The photo theme's pictures (`photo-url` in app.js): a photo of the feed loaded like the WebView's `new Image()`,
 * kept for the process, or [fallback] (`img/bg.png`) when it does not load. Decoded to about the screen's width.
 */
class PhotoLoader(private val context: Context) {
    private val client = OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build()
    private val cache = LruCache<String, ImageBitmap>(4)

    /** The photo at [url]; null when it cannot be loaded or decoded. */
    suspend fun load(url: String): ImageBitmap? {
        cache.get(url)?.let { return it }
        return withContext(Dispatchers.IO) {
            runCatching {
                client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                    if (!response.isSuccessful) return@use null
                    decode(response.body.bytes())
                }
            }.getOrNull()
        }?.also { cache.put(url, it) }
    }

    /** `url("img/bg.png")`: the picture a photo that fails to load is replaced with. */
    suspend fun fallback(): ImageBitmap? = cache.get(FALLBACK) ?: withContext(Dispatchers.IO) {
        runCatching { context.assets.open(FALLBACK).use { decode(it.readBytes()) } }.getOrNull()
    }?.also { cache.put(FALLBACK, it) }

    private fun decode(bytes: ByteArray): ImageBitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val screen = context.resources.displayMetrics.widthPixels.coerceAtLeast(1)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= screen) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
    }

    private companion object {
        const val FALLBACK = "img/bg.png"
    }
}
