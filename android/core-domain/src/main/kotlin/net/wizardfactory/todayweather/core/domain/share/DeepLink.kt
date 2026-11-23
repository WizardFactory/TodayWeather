package net.wizardfactory.todayweather.core.domain.share

import java.io.ByteArrayOutputStream
import kotlin.math.abs
import net.wizardfactory.todayweather.core.domain.Js

/** The tab a `link.todayweather.ai` link opens (`view`): unknown or missing values are Hourly. */
enum class WeatherView(val wire: String) {
    HOURLY("hourly"), DAILY("daily"), AIR("air");

    companion object {
        fun of(raw: String?): WeatherView = entries.firstOrNull { it.wire == raw } ?: HOURLY
    }
}

/** What a link opens (specs/deeplink.md §6.1). A pollutant is set only for the Air view. */
sealed interface DeepLinkTarget {
    /** `/` or `/open`: the app on its current or startup tab. */
    data class Open(val lang: String?) : DeepLinkTarget

    /** `/place/{slug}` or `/air/{slug}`: a catalog city, which may be unknown to [DeepLinkCatalog]. */
    data class Place(val slug: String, val view: WeatherView, val pollutant: String?) : DeepLinkTarget

    /** `/loc`: coordinates rounded to three decimals, with an optional display name. */
    data class Coordinate(val lat: Double, val lon: Double, val name: String?, val view: WeatherView, val pollutant: String?) : DeepLinkTarget

    data object NationWeather : DeepLinkTarget
    data object NationAir : DeepLinkTarget
    data object Warnings : DeepLinkTarget

    /** `todayweather://N`, the widget's place index (A20). */
    data class LegacyWidgetIndex(val index: Double) : DeepLinkTarget
}

/** A city of the shared catalog (packages/weather-core `PLACES`): its slug, name, address, country and coordinates. */
data class CatalogPlace(val id: String, val name: String, val address: String, val country: String, val lat: Double, val lon: Double)

/** The web app's `PLACES`, in its order; `DeepLinkTest` checks it against the web catalog and the golden vectors. */
object DeepLinkCatalog {
    val PLACES: List<CatalogPlace> = listOf(
        CatalogPlace("seoul", "서울", "서울특별시 중구", "KR", 37.567, 126.978),
        CatalogPlace("busan", "부산", "부산광역시 중구", "KR", 35.179, 129.076),
        CatalogPlace("incheon", "인천", "인천광역시 남동구", "KR", 37.456, 126.705),
        CatalogPlace("daegu", "대구", "대구광역시 중구", "KR", 35.871, 128.601),
        CatalogPlace("daejeon", "대전", "대전광역시 서구", "KR", 36.35, 127.385),
        CatalogPlace("gwangju", "광주", "광주광역시 서구", "KR", 35.16, 126.852),
        CatalogPlace("ulsan", "울산", "울산광역시 남구", "KR", 35.539, 129.311),
        CatalogPlace("jeju", "제주", "제주특별자치도 제주시", "KR", 33.499, 126.531),
        CatalogPlace("gangneung", "강릉", "강원특별자치도 강릉시", "KR", 37.752, 128.876),
        CatalogPlace("suwon", "수원", "경기도 수원시", "KR", 37.263, 127.029),
        CatalogPlace("chuncheon", "춘천", "강원특별자치도 춘천시", "KR", 37.881, 127.73),
        CatalogPlace("cheongju", "청주", "충청북도 청주시", "KR", 36.642, 127.489),
        CatalogPlace("jeonju", "전주", "전북특별자치도 전주시", "KR", 35.824, 127.148),
        CatalogPlace("pohang", "포항", "경상북도 포항시", "KR", 36.019, 129.343),
        CatalogPlace("mokpo", "목포", "전라남도 목포시", "KR", 34.811, 126.392),
        CatalogPlace("yeosu", "여수", "전라남도 여수시", "KR", 34.761, 127.662),
        CatalogPlace("andong", "안동", "경상북도 안동시", "KR", 36.569, 128.729),
        CatalogPlace("tokyo", "도쿄", "Tokyo, Japan", "JP", 35.69, 139.692),
        CatalogPlace("london", "런던", "London, United Kingdom", "GB", 51.507, -0.128),
        CatalogPlace("new-york", "뉴욕", "New York, United States", "US", 40.713, -74.006),
        CatalogPlace("berlin", "베를린", "Berlin, Germany", "DE", 52.52, 13.405),
        CatalogPlace("singapore", "싱가포르", "Singapore", "SG", 1.352, 103.82),
    )

    fun find(slug: String): CatalogPlace? = PLACES.firstOrNull { it.id == slug }

    /** The first city within 0.04° on both axes (`nearbyCatalog`), as a share link prefers it to coordinates. */
    fun nearby(lat: Double, lon: Double): CatalogPlace? =
        PLACES.firstOrNull { abs(it.lat - lat) < DeepLink.CATALOG_MATCH_DEGREES && abs(it.lon - lon) < DeepLink.CATALOG_MATCH_DEGREES }
}

/**
 * The `link.todayweather.ai` contract (specs/deeplink.md §2, §7): [parse] reads a link that opened the app, [shareUrl]
 * builds the link a share message ends with. Both follow the reference parser of scripts/verification/deeplink-golden.test.mjs.
 */
object DeepLink {
    const val HOST = "link.todayweather.ai"
    const val ORIGIN = "https://$HOST"
    const val CATALOG_MATCH_DEGREES = 0.04
    val POLLUTANTS = listOf("aqi", "pm25", "pm10", "o3", "no2", "so2", "co")
    private const val MAX_NAME = 80
    private val SLUG = Regex("^[a-z0-9-]{1,64}$")
    private val COORDINATE = Regex("""^-?(?:\d+\.?\d*|\.\d+)$""")
    private val LANG = Regex("^[a-z]{2,3}$")
    private val URL = Regex("""^([A-Za-z][A-Za-z0-9+.-]*)://([^/?#]*)([^#]*)""")
    private val PORT = Regex(""":(\d*)$""")

    /** The target of [url], or null for another host or scheme, an unknown path or invalid required parameters. */
    fun parse(url: String): DeepLinkTarget? {
        val legacy = "${EntryLink.SCHEME}://"
        if (url.startsWith(legacy)) {
            val rest = url.substring(legacy.length)
            // The iOS widget's `todayweather://widget?place=` link has no meaning here.
            if (rest.isEmpty() || rest == "widget" || rest.startsWith("widget?")) return null
            return EntryLink.placeIndex(url)?.let(DeepLinkTarget::LegacyWidgetIndex)
        }
        val match = URL.find(url) ?: return null
        val (scheme, authority, pathAndQuery) = match.destructured
        if (!scheme.equals("https", ignoreCase = true)) return null
        val hostAndPort = authority.substringAfterLast('@')
        // `new URL`: an empty port or one up to 65535; anything else after a colon is no URL.
        val port = PORT.find(hostAndPort)
        if (port != null && port.groupValues[1].isNotEmpty() && port.groupValues[1].toBigInteger() > 65535.toBigInteger()) return null
        if (!(if (port != null) hostAndPort.removeRange(port.range) else hostAndPort).equals(HOST, ignoreCase = true)) return null
        val rawPath = pathAndQuery.substringBefore('?').ifEmpty { "/" }
        val query = Query(if ('?' in pathAndQuery) pathAndQuery.substringAfter('?') else "")
        val path = decodePath(rawPath) ?: return null
        val trimmed = if (path.length > 1 && path.endsWith("/")) path.dropLast(1) else path
        fun pollutant(view: WeatherView) = if (view == WeatherView.AIR) normalizePollutant(query["pollutant"]) else null
        return when {
            path == "/" || trimmed == "/open" ->
                DeepLinkTarget.Open(query["lang"]?.let(::jsTrim)?.lowercase()?.takeIf { LANG.matches(it) })
            // Compared by segment: the link paths are not server paths (RequestSitesTest).
            segments(trimmed) == listOf("nation", "weather") -> DeepLinkTarget.NationWeather
            segments(trimmed) == listOf("nation", "air") -> DeepLinkTarget.NationAir
            segments(trimmed) == listOf("warnings") -> DeepLinkTarget.Warnings
            trimmed.startsWith("/place/") -> trimmed.removePrefix("/place/").takeIf { SLUG.matches(it) }?.let { slug ->
                val view = WeatherView.of(query["view"])
                DeepLinkTarget.Place(slug, view, pollutant(view))
            }
            trimmed.startsWith("/air/") -> trimmed.removePrefix("/air/").takeIf { SLUG.matches(it) }?.let { slug ->
                DeepLinkTarget.Place(slug, WeatherView.AIR, normalizePollutant(query["pollutant"]))
            }
            trimmed == "/loc" -> {
                val lat = coordinate(query["lat"], 90.0) ?: return null
                val lon = coordinate(query["lon"], 180.0) ?: return null
                val view = WeatherView.of(query["view"])
                DeepLinkTarget.Coordinate(lat, lon, sanitizeName(query["name"]), view, pollutant(view))
            }
            else -> null
        }
    }

    /**
     * The link for a shared place (§7): a catalog city ([placeId], else the first within 0.04°) as `/place/{slug}`
     * (`?view=daily`) or `/air/{slug}` (`?pollutant=` unless `aqi`); else valid coordinates as `/loc` rounded to three
     * decimals with the name; else `/open`.
     */
    fun shareUrl(lat: Double?, lon: Double?, name: String?, view: WeatherView, pollutant: String?, placeId: String? = null): String {
        val selected = if (view == WeatherView.AIR) normalizePollutant(pollutant) else null
        val latValid = lat != null && lat.isFinite() && lat >= -90 && lat <= 90
        val lonValid = lon != null && lon.isFinite() && lon >= -180 && lon <= 180
        val slug = placeId?.let(DeepLinkCatalog::find)?.id
            ?: if (latValid && lonValid) DeepLinkCatalog.nearby(lat!!, lon!!)?.id else null
        if (slug != null) {
            return when (view) {
                WeatherView.AIR -> "$ORIGIN/air/$slug" + if (selected != "aqi") "?pollutant=$selected" else ""
                WeatherView.DAILY -> "$ORIGIN/place/$slug?view=daily"
                WeatherView.HOURLY -> "$ORIGIN/place/$slug"
            }
        }
        if (!latValid || !lonValid) return "$ORIGIN/open"
        val parts = mutableListOf("lat=${Js.numberToString(round(lat!!))}", "lon=${Js.numberToString(round(lon!!))}")
        sanitizeName(name)?.let { parts += "name=${encodeComponent(it)}" }
        if (view != WeatherView.HOURLY) parts += "view=${view.wire}"
        if (view == WeatherView.AIR && selected != "aqi") parts += "pollutant=$selected"
        return "$ORIGIN/loc?" + parts.joinToString("&")
    }

    /** A saved place within 0.01° of a link on both axes, compared in millidegrees as the web app does (`nearbySaved`). */
    fun nearSaved(aLat: Double, aLon: Double, bLat: Double, bLon: Double): Boolean {
        fun distance(a: Double, b: Double) = abs(Js.round(a * 1000) - Js.round(b * 1000))
        return distance(aLat, bLat) <= 10 && distance(aLon, bLon) <= 10
    }

    private fun segments(path: String): List<String> = path.removePrefix("/").split('/')

    /** "lat, lon" as JavaScript prints the numbers: the title of a linked place without a name. */
    fun coordinateText(lat: Double, lon: Double): String = Js.numberToString(lat) + ", " + Js.numberToString(lon)

    private fun normalizePollutant(raw: String?): String = raw?.takeIf { it in POLLUTANTS } ?: "aqi"

    /** `Math.round(v * 1000) / 1000` without a negative zero. */
    private fun round(value: Double): Double = (Js.round(value * 1000) / 1000).let { if (it == 0.0) 0.0 else it }

    private fun coordinate(raw: String?, bound: Double): Double? {
        if (raw.isNullOrEmpty()) return null
        val text = jsTrim(raw)
        if (!COORDINATE.matches(text)) return null
        val value = text.toDouble()
        return if (value.isFinite() && value >= -bound && value <= bound) round(value) else null
    }

    /** Control characters removed, trimmed, at most 80 Unicode scalar values; null when nothing is left. */
    private fun sanitizeName(raw: String?): String? {
        if (raw == null) return null
        val cleaned = jsTrim(raw.filterNot { it.code <= 0x1f || it.code == 0x7f })
        if (cleaned.isEmpty()) return null
        val end = if (cleaned.codePointCount(0, cleaned.length) > MAX_NAME) cleaned.offsetByCodePoints(0, MAX_NAME) else cleaned.length
        return cleaned.substring(0, end)
    }

    /** `decodeURIComponent` of the path, refusing malformed escapes, `..`, `\` and NUL. */
    private fun decodePath(raw: String): String? {
        val decoded = percentDecode(raw, strict = true, plusIsSpace = false) ?: return null
        return decoded.takeUnless { ".." in it || '\\' in it || '\u0000' in it }
    }

    /** `URLSearchParams.get`: the first value of a name, `+` as a space, lenient percent-decoding. */
    private class Query(raw: String) {
        private val pairs = raw.split('&').filter { it.isNotEmpty() }.map { part ->
            val name = part.substringBefore('=')
            val value = if ('=' in part) part.substringAfter('=') else ""
            percentDecode(name, strict = false, plusIsSpace = true)!! to percentDecode(value, strict = false, plusIsSpace = true)!!
        }

        operator fun get(name: String): String? = pairs.firstOrNull { it.first == name }?.second
    }

    /**
     * Percent-decoding as UTF-8. [strict] (`decodeURIComponent`): a malformed escape or invalid UTF-8 gives null;
     * otherwise (`URLSearchParams`) a malformed escape stays as it is and invalid UTF-8 becomes U+FFFD.
     */
    private fun percentDecode(s: String, strict: Boolean, plusIsSpace: Boolean): String? {
        val bytes = ByteArrayOutputStream()
        // Unescaped text is encoded a run at a time, so a surrogate pair stays one character (CODEX-3164-8).
        val literal = StringBuilder()
        fun flush() {
            if (literal.isNotEmpty()) bytes.write(literal.toString().toByteArray(Charsets.UTF_8))
            literal.setLength(0)
        }
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '%' && i + 2 < s.length && hex(s[i + 1]) >= 0 && hex(s[i + 2]) >= 0 -> {
                    flush()
                    bytes.write(hex(s[i + 1]) * 16 + hex(s[i + 2]))
                    i += 3
                    continue
                }
                c == '%' && strict -> return null
                c == '+' && plusIsSpace -> literal.append(' ')
                else -> literal.append(c)
            }
            i++
        }
        flush()
        val array = bytes.toByteArray()
        if (!strict) return String(array, Charsets.UTF_8)
        val decoder = Charsets.UTF_8.newDecoder()
        return try {
            decoder.decode(java.nio.ByteBuffer.wrap(array)).toString()
        } catch (e: java.nio.charset.CharacterCodingException) {
            null
        }
    }

    private fun hex(c: Char): Int = Character.digit(c, 16).takeIf { c.code < 128 } ?: -1

    /** `encodeURIComponent`. */
    private fun encodeComponent(s: String): String = buildString {
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val c = (b.toInt() and 0xff).toChar()
            if (c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c in "-_.!~*'()") append(c)
            else append('%').append("0123456789ABCDEF"[(b.toInt() shr 4) and 0xf]).append("0123456789ABCDEF"[b.toInt() and 0xf])
        }
    }

    /** `String.prototype.trim`: JavaScript's white space and line terminators. */
    private fun jsTrim(s: String): String = s.trim { it in JS_SPACE }

    private const val JS_SPACE = "\u0009\u000a\u000b\u000c\u000d          " +
        "        　﻿"
}
