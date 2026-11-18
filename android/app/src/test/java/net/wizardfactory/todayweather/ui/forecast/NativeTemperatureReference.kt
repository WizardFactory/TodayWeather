package net.wizardfactory.todayweather.ui.forecast

import java.awt.Color
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO
import kotlin.math.ceil
import kotlin.math.floor
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Replace the Cordova temperature and sky group with its native reference. All coordinates are capture pixels. */
internal fun applyNativeTemperatureRow(reference: BufferedImage, header: JsonObject, project: File, style: String = "light", dimmed: Boolean = false) {
    val elements = header.getValue("elements").jsonArray.take(3).map { it.jsonObject }
    val value = elements.first().getValue("text").jsonPrimitive.content
    if ('.' !in value) return
    val rects = elements.map { it.getValue("rect").jsonObject }
    val scale = reference.width / header.getValue("rect").jsonObject.getValue("w").jsonPrimitive.double
    fun JsonObject.coord(name: String) = getValue(name).jsonPrimitive.double * scale
    val left = floor(rects.minOf { it.coord("x") }).toInt()
    val top = floor(rects.minOf { it.coord("y") }).toInt()
    val right = ceil(rects.maxOf { it.coord("x") + it.coord("w") }).toInt()
    val bottom = ceil(rects.maxOf { it.coord("y") + it.coord("h") }).toInt()
    val patch = ImageIO.read(File(project, "src/test/resources/native-temperature/${reference.width}-$style-$value.png"))
    require(patch.width == right - left && patch.height == bottom - top)
    val g = reference.createGraphics()
    try {
        g.drawImage(patch, left, top, null)
        if (dimmed) {
            // Ionic alert scrim: black at 40% opacity above the forecast.
            g.color = Color(0, 0, 0, 102)
            g.fillRect(left, top, patch.width, patch.height)
        }
    } finally {
        g.dispose()
    }
}
