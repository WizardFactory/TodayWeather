package net.wizardfactory.todayweather

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import net.wizardfactory.todayweather.ui.chart.CHART_KEYS
import net.wizardfactory.todayweather.ui.forecast.forecastKeys
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The release build shrinks resources (app/build.gradle.kts), and the shrinker removes a string that only
 * getIdentifier names: R8 dropped LOC_HOUR and most of the catalog the charts and pages read by key. The release source
 * set's res/raw/keep.xml keeps them; this test checks that its patterns cover every key the app looks up by name, and
 * that getIdentifier is called once in each of the two catalog loaders and nowhere else.
 */
class ResourceKeepTest {
    private val appDir = File(System.getProperty("tw.projectDir") ?: "app")

    private fun keepPatterns(): List<Regex> {
        val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        val root = factory.newDocumentBuilder().parse(File(appDir, "src/release/res/raw/keep.xml")).documentElement
        val keep = root.getAttributeNS("http://schemas.android.com/tools", "keep")
        return keep.split(',').map { it.trim() }.filter { it.isNotEmpty() }
            .map { Regex(Regex.escape(it).replace("*", "\\E.*\\Q")) }
    }

    @Test
    fun keepRulesCoverEveryStringLookedUpByName() {
        val patterns = keepPatterns()
        val keys = (CHART_KEYS + forecastKeys()).distinct()
        assertTrue("no keys", keys.size > 100)
        val uncovered = keys.filter { key -> patterns.none { it.matches("@string/$key") } }
        assertEquals("strings looked up by name without a keep rule in src/release/res/raw/keep.xml", emptyList<String>(), uncovered)
    }

    @Test
    fun onlyTheCatalogLoadersLookUpResourcesByName() {
        val call = Regex("""\bgetIdentifier\s*\(""")
        val lookups = File(appDir, "src").walkTopDown().filter { it.isFile && it.extension in setOf("kt", "java") }
            .filter { file -> file.relativeTo(appDir).invariantSeparatorsPath.let { it.startsWith("src/main/") || it.startsWith("src/release/") } }
            .associate { it.name to call.findAll(it.readText()).count() }.filterValues { it > 0 }
        assertEquals("a new lookup by name needs a keep rule in src/release/res/raw/keep.xml and a case here",
            mapOf("ChartStrings.kt" to 1, "ForecastStrings.kt" to 1), lookups)
    }
}
