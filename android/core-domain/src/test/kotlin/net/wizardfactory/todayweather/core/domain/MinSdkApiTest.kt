package net.wizardfactory.todayweather.core.domain

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The app runs from API 24 (`minSdk` in app/build.gradle.kts) without core library desugaring, so the code it ships
 * must not use `java.time` (API 26): a class that does fails to load on Android 7.0 and 7.1 (#2914 F1, S05's chart
 * dates). Time uses `java.util` (`Calendar`, `TimeZone`), as `Warnings` and `AirScope` do. The JVM modules have no
 * Android lint, so this checks the sources of every module the app ships.
 */
class MinSdkApiTest {
    private val android = File(System.getProperty("tw.projectDir")!!).parentFile

    @Test
    fun theAppStillTargetsApi24WithoutDesugaring() {
        val gradle = File(android, "app/build.gradle.kts").readText()
        assertTrue(Regex("""minSdk\s*=\s*24\b""").containsMatchIn(gradle), "minSdk is 24")
        assertTrue("coreLibraryDesugaring" !in gradle, "no desugaring: java.time stays unavailable below API 26")
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
