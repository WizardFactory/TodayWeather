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
