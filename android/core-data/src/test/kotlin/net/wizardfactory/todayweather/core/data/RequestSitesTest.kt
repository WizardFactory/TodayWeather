package net.wizardfactory.todayweather.core.data

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Keeps [RequestPathsTest] complete (AC3 of #2897). The main sources of the app and the core modules send HTTP
 * requests only through the transports of the clients that test runs, write server paths only in their request
 * builders, and reach other hosts only as the register's E3 and E4 (`server-routes/exceptions.json`). A new request
 * site, path, SDK or library fails here until its requests are enumerated there and it is listed here.
 */
class RequestSitesTest {
    private val modules = listOf("app", "core-data", "core-storage", "core-domain", "core-model")
    private val register = Json.parseToJsonElement(File(javaClass.getResource("/server-routes/exceptions.json")!!.toURI()).readText())
        .jsonObject["exceptions"]!!.jsonArray.map { it.jsonObject }

    /** The main Kotlin and Java sources by path under `android/`, without their comment lines. */
    private val sources: Map<String, String> = modules.flatMap { module ->
        File("../$module/src/main").walk().filter { it.isFile && it.extension in setOf("kt", "java") }.map { file ->
            "$module/${file.relativeTo(File("../$module")).invariantSeparatorsPath}" to
                file.readLines().filterNot { line -> line.trimStart().let { it.startsWith("//") || it.startsWith("*") || it.startsWith("/*") } }
                    .joinToString("\n")
        }.toList()
    }.toMap()

    /** The sources where [pattern] occurs in code, or anywhere including strings with [inStrings]. */
    private fun filesMatching(pattern: Regex, inStrings: Boolean = false) =
        sources.filterValues { pattern.containsMatchIn(if (inStrings) it else it.replace(STRING, "\"\"")) }.keys.sorted()

    private fun entry(id: String) = register.single { it.text("id") == id }

    @Test
    fun httpRequestsGoThroughTheKnownTransports() {
        assertEquals(
            listOf(
                "app/src/main/java/net/wizardfactory/todayweather/ui/forecast/PhotoLoader.kt",
                "core-data/src/main/kotlin/net/wizardfactory/todayweather/core/data/Http.kt",
                "core-data/src/main/kotlin/net/wizardfactory/todayweather/core/data/PushTransport.kt",
            ),
            filesMatching(NETWORK),
            "the sources using a network API",
        )
        assertEquals(entry("E3")["sites"]!!.jsonArray.map { it.jsonPrimitive.content }, filesMatching(NETWORK).filter { it.startsWith("app/") },
            "E3: the feed's photos are the app's only own request outside the transports")
        assertEquals(
            listOf(
                "app/src/main/java/net/wizardfactory/todayweather/TodayWeatherApp.kt",
                "core-data/src/main/kotlin/net/wizardfactory/todayweather/core/data/GeocodeClient.kt",
                "core-data/src/main/kotlin/net/wizardfactory/todayweather/core/data/Http.kt",
                "core-data/src/main/kotlin/net/wizardfactory/todayweather/core/data/NationSource.kt",
                "core-data/src/main/kotlin/net/wizardfactory/todayweather/core/data/PushSync.kt",
                "core-data/src/main/kotlin/net/wizardfactory/todayweather/core/data/PushTransport.kt",
                "core-data/src/main/kotlin/net/wizardfactory/todayweather/core/data/WeatherPhotoFeed.kt",
                "core-data/src/main/kotlin/net/wizardfactory/todayweather/core/data/WeatherRepository.kt",
            ),
            filesMatching(TRANSPORTS),
            "the sources using the transports: the clients RequestPathsTest runs, and the app's wiring",
        )
    }

    @Test
    fun serverPathsAreWrittenOnlyInTheRequestBuilders() {
        assertEquals(
            listOf(
                "core-data/src/main/kotlin/net/wizardfactory/todayweather/core/data/GeocodeClient.kt",
                "core-data/src/main/kotlin/net/wizardfactory/todayweather/core/data/NationSource.kt",
                "core-data/src/main/kotlin/net/wizardfactory/todayweather/core/data/WeatherRequests.kt",
                "core-storage/src/main/kotlin/net/wizardfactory/todayweather/core/storage/PushRegistration.kt",
            ),
            filesMatching(SERVER_PATH, inStrings = true),
        )
    }

    @Test
    fun sdksAreUsedWhereTheRegisterSays() {
        assertEquals(
            listOf(
                "app/src/main/java/net/wizardfactory/todayweather/MessagingService.kt",
                "app/src/main/java/net/wizardfactory/todayweather/Push.kt",
                "app/src/main/java/net/wizardfactory/todayweather/TodayWeatherApp.kt",
                "app/src/main/java/net/wizardfactory/todayweather/ads/AdMobBanner.kt",
                "app/src/main/java/net/wizardfactory/todayweather/ads/AdsConsent.kt",
                "app/src/main/java/net/wizardfactory/todayweather/analytics/Analytics.kt",
                "app/src/main/java/net/wizardfactory/todayweather/analytics/RemoteBannerConfig.kt",
                "app/src/main/java/net/wizardfactory/todayweather/location/AndroidLocationAccess.kt",
                "app/src/main/java/net/wizardfactory/todayweather/notify/Notifications.kt",
                "app/src/main/java/net/wizardfactory/todayweather/search/PlaceSearch.kt",
            ),
            filesMatching(SDK),
            "the sources using an E4 SDK",
        )
    }

    /** Every library of the main code is reviewed: it sends no request, it is OkHttp (the transports), or it is an E4 SDK. */
    @Test
    fun everyLibraryIsReviewed() {
        val catalog = File("../gradle/libs.versions.toml").readLines().mapNotNull { CATALOG.find(it) }
            .associate { it.groupValues[1].replace('-', '.').replace('_', '.') to it.groupValues[2] }
        val libraries = modules.flatMap { module ->
            File("../$module/build.gradle.kts").readLines().mapNotNull { line ->
                val dependency = DEPENDENCY.find(line) ?: return@mapNotNull null
                val notation = dependency.groupValues[1]
                when {
                    notation.startsWith("project(") -> null
                    else -> LIBRARY.find(notation)?.let { catalog[it.groupValues[1]] ?: error("$module: ${it.groupValues[1]} is not in the catalog") }
                        ?: COORDINATE.find(notation)?.let { "${it.groupValues[1]}:${it.groupValues[2]}" }
                        ?: error("$module: cannot read the dependency $notation")
                }
            }
        }.toSortedSet()
        val sdks = entry("E4")["sdks"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertEquals((NO_REQUESTS.keys + "com.squareup.okhttp3:okhttp" + sdks).toSortedSet(), libraries)
    }

    private fun JsonObject.text(key: String) = this[key]?.jsonPrimitive?.contentOrNull

    private companion object {
        /** APIs that can send a request: OkHttp, `java.net` and `javax.net` connections, WebView, DownloadManager, other HTTP libraries. */
        val NETWORK = Regex(
            """\b(?:okhttp3\.|java\.net\.(?!URLEncoder\b|URLDecoder\b|URI\b)|javax\.net\.|android\.net\.http\.|android\.webkit\.WebView\b|""" +
                """android\.app\.DownloadManager\b|retrofit2\.|io\.ktor\.|com\.android\.volley\.|coil3?\.|com\.bumptech\.glide\.|com\.squareup\.picasso\.)""",
        )

        /** The transports of [RequestPathsTest]'s clients. */
        val TRANSPORTS = Regex("""\b(?:OkHttpGet|HttpGet|HttpPushTransport|PushTransport|firstSettled)\b""")

        /** A server path or the API version written in a string. */
        val SERVER_PATH = Regex(""""[^"\n]*(?:v0\d{5}|VERSION\}|/(?:weather|geocode|kma|nation|push)\b)[^"\n]*"""")

        /** The SDKs of E4. */
        val SDK = Regex("""\bcom\.google\.(?:firebase|android\.gms|android\.libraries\.places|android\.ump)\.""")

        val STRING = Regex(""""(?:[^"\\\n]|\\.)*"""")

        val CATALOG = Regex("""^([A-Za-z0-9_-]+)\s*=\s*\{\s*module\s*=\s*"([^"]+)"""")
        val DEPENDENCY = Regex("""^\s*(?:implementation|api|runtimeOnly|compileOnly|coreLibraryDesugaring|debugImplementation|releaseImplementation)\((.*)\)\s*$""")
        val LIBRARY = Regex("""^(?:platform\()?libs\.([A-Za-z0-9.]+)\)?$""")
        val COORDINATE = Regex(""""([^":]+):([^":]+)(?::[^"]*)?"""")

        /** The libraries that send no request themselves, with what they are for. */
        val NO_REQUESTS = mapOf(
            "androidx.activity:activity-compose" to "the activity's Compose content",
            "androidx.compose.material3:material3" to "UI",
            "androidx.compose.ui:ui" to "UI",
            "androidx.compose.ui:ui-test-manifest" to "the Compose test activity of debug builds",
            "androidx.compose.ui:ui-tooling-preview" to "previews",
            "androidx.compose:compose-bom" to "versions",
            "androidx.core:core-splashscreen" to "the splash screen",
            "androidx.datastore:datastore" to "the saved state",
            "androidx.work:work-runtime" to "background work",
            "com.android.tools:desugar_jdk_libs" to "Java APIs on old Android versions",
            "org.jetbrains.kotlinx:kotlinx-coroutines-android" to "coroutines",
            "org.jetbrains.kotlinx:kotlinx-coroutines-play-services" to "coroutine adapters for the SDKs' tasks",
            "org.jetbrains.kotlinx:kotlinx-serialization-json" to "JSON",
        )
    }
}
