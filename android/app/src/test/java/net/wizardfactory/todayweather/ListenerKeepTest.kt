package net.wizardfactory.todayweather

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SharedPreferences keeps its change listeners only weakly, so the app holds each one in a field; R8 removes a field the
 * code only writes. The first 2.0.1 release build lost `HandBackWriter.consentListener`: after a garbage collection the
 * analytics choice no longer reached the hand-back suite, and `HandBackConsent` withdrew a grant at the next start. Such a
 * field carries `@field:Keep`, and `tools/release/check_r8.py` (`KEPT_FIELDS`) fails a release whose dex lacks it.
 * PR CI builds no release, so this test checks the sources: the one registration, its kept field and the release check.
 */
class ListenerKeepTest {
    private val appDir = File(System.getProperty("tw.projectDir") ?: "app")
    private val handBack = "src/main/java/net/wizardfactory/todayweather/HandBack.kt"

    @Test
    fun onlyTheHandBackRegistersAPreferenceListener() {
        val call = Regex("""\bregisterOnSharedPreferenceChangeListener\s*\(""")
        val registrations = File(appDir, "src").walkTopDown().filter { it.isFile && it.extension in setOf("kt", "java") }
            .filter { file -> file.relativeTo(appDir).invariantSeparatorsPath.let { it.startsWith("src/main/") || it.startsWith("src/release/") } }
            .associate { it.relativeTo(appDir).invariantSeparatorsPath to call.findAll(it.readText()).count() }
            .filterValues { it > 0 }
        assertEquals("a new preference listener needs a @field:Keep field, an entry in check_r8.py's KEPT_FIELDS and a case here",
            mapOf(handBack to 1), registrations)
    }

    @Test
    fun theHandBackListenerFieldIsKeptAndChecked() {
        val source = File(appDir, handBack).readText()
        assertTrue("HandBackWriter.consentListener needs @field:Keep",
            Regex("""@field:Keep\s+private var consentListener: SharedPreferences\.OnSharedPreferenceChangeListener\?""").containsMatchIn(source))
        assertTrue("HandBack.kt imports androidx.annotation.Keep", source.contains("import androidx.annotation.Keep\n"))
        val check = File(appDir, "../tools/release/check_r8.py").readText()
        assertTrue("check_r8.py's KEPT_FIELDS names HandBackWriter.consentListener",
            check.contains("""("net.wizardfactory.todayweather.HandBackWriter", "consentListener")"""))
    }
}
