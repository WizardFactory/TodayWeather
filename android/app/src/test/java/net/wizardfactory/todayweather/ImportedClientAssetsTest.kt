package net.wizardfactory.todayweather

import java.io.File
import java.security.MessageDigest
import javax.xml.parsers.DocumentBuilderFactory
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Guards the assets copied from the Cordova client by tools/import_client_assets.py:
 * every copied or converted file is listed in the provenance record with its current hash,
 * and every locale defines the same strings as the default (English) catalog.
 */
class ImportedClientAssetsTest {
    private val appDir = File(System.getProperty("tw.projectDir") ?: "app")
    private val provenance = File(appDir, "provenance/client-assets.json")

    private fun sha256(file: File): String =
        MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it) }

    private fun stringNames(file: File): Set<String> {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
        val nodes = doc.getElementsByTagName("string")
        return (0 until nodes.length).map { nodes.item(it).attributes.getNamedItem("name").nodeValue }.toSet()
    }

    @Test
    fun everyLocaleHasTheDefaultCatalogKeys() {
        val res = File(appDir, "src/main/res")
        val default = stringNames(File(res, "values/client_strings.xml"))
        assertTrue("default catalog is empty", default.size > 300)
        for (dir in listOf("values-ko", "values-ja", "values-de", "values-zh-rCN", "values-zh-rTW")) {
            assertEquals(dir, default, stringNames(File(res, "$dir/client_strings.xml")))
        }
    }

    @Test
    fun provenanceCoversEveryImportedFileWithItsHash() {
        assertTrue("missing ${provenance.path}", provenance.isFile)
        val files = JSONObject(provenance.readText()).getJSONArray("files")
        val recorded = mutableMapOf<String, String>()
        for (i in 0 until files.length()) {
            val entry = files.getJSONObject(i)
            for (key in listOf("source", "commit", "source_sha256", "output", "output_sha256")) {
                assertTrue("$key missing in $entry", entry.optString(key).isNotEmpty())
            }
            recorded[entry.getString("output")] = entry.getString("output_sha256")
        }
        val imported = File(appDir, "src/main/assets/img").walkTopDown().filter { it.isFile }.toList() +
            File(appDir, "src/main/assets/data/towns.json") +
            File(appDir, "src/main/res").listFiles()!!.map { File(it, "client_strings.xml") }.filter { it.isFile } +
            File(appDir, "src/main/res/font/material_icons.ttf") +
            File(appDir, "src/main/res").listFiles()!!.map { File(it, "ic_launcher.png") }.filter { it.isFile } +
            File(appDir, "src/main/res/drawable-nodpi/splash_icon.png")
        assertEquals(342 + 1 + 6 + 1 + 6 + 1, imported.size)
        for (file in imported) {
            val rel = file.relativeTo(appDir).invariantSeparatorsPath
            assertEquals("hash of $rel", recorded[rel], sha256(file))
        }
        assertEquals(imported.size, recorded.size)
    }

    /**
     * The native-only usage analytics texts (analytics default-on, 2026-11-24) beside the imported catalogs: the same
     * names in every app locale, none of them an imported key, and no file the import tool writes.
     */
    @Test
    fun nativeAnalyticsStringsStayOutsideTheImport() {
        val res = File(appDir, "src/main/res")
        val names = setOf("analytics_label", "analytics_on", "analytics_off", "analytics_detail", "analytics_turn_off", "analytics_turn_on",
            "analytics_consent_detail", "analytics_consent_deny", "analytics_consent_allow")
        val imported = stringNames(File(res, "values/client_strings.xml"))
        for (dir in listOf("values", "values-ko", "values-ja", "values-de", "values-zh-rCN", "values-zh-rTW")) {
            assertEquals(dir, names, stringNames(File(res, "$dir/analytics_strings.xml")))
        }
        assertTrue(names.none { it in imported })
        val files = JSONObject(provenance.readText()).getJSONArray("files")
        for (i in 0 until files.length()) {
            val output = files.getJSONObject(i).getString("output")
            assertTrue(output, !output.endsWith("analytics_strings.xml"))
        }
    }

    /**
     * The opt-in regions' consent popup (AK 2026-11-24): en, ko and ja keep the imported Cordova texts word for word; de,
     * zh-CN and zh-TW, whose imported catalogs show English, have their own translations.
     */
    @Test
    fun theConsentTextsKeepTheCordovaWordingOrTranslateIt() {
        val res = File(appDir, "src/main/res")
        val pairs = mapOf("analytics_consent_detail" to "LOC_ANALYTICS_DETAIL", "analytics_consent_deny" to "LOC_ANALYTICS_DENY",
            "analytics_consent_allow" to "LOC_ANALYTICS_ALLOW")
        val english = stringValues(File(res, "values/client_strings.xml"))
        for (dir in listOf("values", "values-ko", "values-ja", "values-de", "values-zh-rCN", "values-zh-rTW")) {
            val native = stringValues(File(res, "$dir/analytics_strings.xml"))
            val imported = stringValues(File(res, "$dir/client_strings.xml"))
            for ((name, key) in pairs) {
                if (dir in listOf("values", "values-ko", "values-ja")) assertEquals("$dir $name", imported[key], native[name])
                else assertTrue("$dir $name is translated", native[name] != english[key] && !native[name].isNullOrBlank())
            }
        }
    }

    private fun stringValues(file: File): Map<String, String> {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
        val nodes = doc.getElementsByTagName("string")
        return (0 until nodes.length).associate { nodes.item(it).attributes.getNamedItem("name").nodeValue to nodes.item(it).textContent }
    }

    /** The Ionicons font copied from the Cordova build (tools/import_cordova_fonts.py). */
    @Test
    fun cordovaFontsMatchTheirProvenance() {
        val files = JSONObject(File(appDir, "provenance/cordova-fonts.json").readText()).getJSONArray("files")
        assertEquals(1, files.length())
        val entry = files.getJSONObject(0)
        assertEquals("res/font/ionicons.ttf".let { "src/main/$it" }, entry.getString("output"))
        assertEquals(entry.getString("output_sha256"), sha256(File(appDir, entry.getString("output"))))
        assertTrue(entry.getString("license").startsWith("MIT"))
    }
}
