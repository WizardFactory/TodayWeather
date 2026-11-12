package net.wizardfactory.todayweather.core.domain

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The app runs from API 24 (`minSdk` in app/build.gradle.kts). The code it ships does not use `java.time` (API 26): a
 * class that did failed to load on Android 7.0 and 7.1 (#2914 F1, S05's chart dates). Time uses `java.util`
 * (`Calendar`, `TimeZone`), as `Warnings` and `AirScope` do. Core library desugaring is on since AN-10 because Places 5+
 * requires it, but only the app's libraries rely on it; the JVM modules have no Android lint and no desugaring, so this
 * checks the sources of every module the app ships.
 */
class MinSdkApiTest {
    private val android = File(System.getProperty("tw.projectDir")!!).parentFile

    @Test
    fun theAppStillTargetsApi24() {
        val gradle = File(android, "app/build.gradle.kts").readText()
        assertTrue(Regex("""minSdk\s*=\s*24\b""").containsMatchIn(gradle), "minSdk is 24")
    }

    @Test
    fun shippedCodeUsesNoJavaTime() {
        val modules = listOf("app", "core-domain", "core-data", "core-storage", "core-model")
        val sources = modules.flatMap { m -> File(android, "$m/src/main").walkTopDown().filter { it.isFile && (it.extension == "kt" || it.extension == "java") }.toList() }
        assertTrue(sources.size > 50, "found the sources (${sources.size})")
        val uses = sources.flatMap { f ->
            f.readLines().mapIndexedNotNull { i, line -> if (Regex("""\bjava\.time\b""").containsMatchIn(line)) "${f.relativeTo(android)}:${i + 1}" else null }
        }
        assertEquals(emptyList(), uses, "java.time is API 26")
    }
}
