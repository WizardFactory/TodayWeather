package net.wizardfactory.todayweather

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/**
 * The backup policy (#2895; README "Backup and device transfer"): cloud backup, device transfer and the API 24–30 rules
 * include the same files, which are the app state and the Cordova sources of the migration, and exclude nothing else
 * explicitly (everything not included stays behind, also the default preference suite with UMP's consent strings). The
 * manifest points at both files.
 */
class BackupRulesTest {
    private val res = File(System.getProperty("tw.projectDir")!!, "src/main/res/xml")
    private val policy = listOf("file:app_state.json", "root:app_webview/Default/Local Storage/", "root:app_webview/Local Storage/",
        "sharedpref:group.net.wizardfactory.todayweather.xml")

    private fun rules(file: String, section: String?): List<String> {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(File(res, file))
        val root = if (section == null) doc.documentElement else doc.getElementsByTagName(section).item(0) as Element
        val nodes = root.childNodes
        return (0 until nodes.length).mapNotNull { nodes.item(it) as? Element }.map { "${it.tagName}:${it.getAttribute("domain")}:${it.getAttribute("path")}" }
    }

    @Test
    fun everyRuleListIncludesThePolicyOnly() {
        val expected = policy.map { "include:$it" }
        assertEquals(expected, rules("data_extraction_rules.xml", "cloud-backup"))
        assertEquals(expected, rules("data_extraction_rules.xml", "device-transfer"))
        assertEquals(expected, rules("backup_rules.xml", null))
    }

    @Test
    fun theManifestUsesTheRules() {
        val manifest = File(System.getProperty("tw.projectDir")!!, "src/main/AndroidManifest.xml").readText()
        for (attr in listOf("android:allowBackup=\"true\"", "android:fullBackupContent=\"@xml/backup_rules\"",
                "android:dataExtractionRules=\"@xml/data_extraction_rules\"")) {
            assertTrue(attr in manifest, attr)
        }
    }
}
