package net.wizardfactory.todayweather

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.core.domain.share.DeepLink
import org.junit.Test
import org.w3c.dom.Element

/**
 * The App Links of `.MainActivity` (#3096, specs/deeplink.md §3.2): one verified filter, `https` on
 * `link.todayweather.ai` only, whose paths take every link of the golden vectors the app opens; `todayweather.ai` and
 * `app.todayweather.ai` are in no filter, and the widget's `todayweather://` filter stays.
 */
class AppLinksManifestTest {
    private val project = File(System.getProperty("tw.projectDir")!!)
    private val android = "http://schemas.android.com/apk/res/android"

    private val filters: List<Element> by lazy {
        val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder()
            .parse(File(project, "src/main/AndroidManifest.xml"))
        val activities = doc.getElementsByTagName("activity")
        val main = (0 until activities.length).map { activities.item(it) as Element }.single { it.getAttributeNS(android, "name") == ".MainActivity" }
        main.getElementsByTagName("intent-filter").let { list -> (0 until list.length).map { list.item(it) as Element } }
    }

    private fun Element.data(attribute: String): List<String> = getElementsByTagName("data").let { list ->
        (0 until list.length).map { (list.item(it) as Element).getAttributeNS(android, attribute) }.filter { it.isNotEmpty() }
    }

    @Test
    fun onlyTheLinkHostIsVerified() {
        val verified = filters.filter { it.getAttributeNS(android, "autoVerify") == "true" }
        assertEquals(1, verified.size)
        assertEquals(listOf("https"), verified.single().data("scheme"))
        assertEquals(listOf(DeepLink.HOST), verified.single().data("host"))
        val hosts = filters.flatMap { it.data("host") }
        assertEquals(listOf(DeepLink.HOST), hosts, "no other host opens the app")
        assertTrue(filters.any { it.data("scheme") == listOf("todayweather") && it.data("host").isEmpty() }, "the widget links stay")
    }

    @Test
    fun theFilterTakesEveryLinkTheAppOpens() {
        val verified = filters.single { it.getAttributeNS(android, "autoVerify") == "true" }
        val paths = verified.data("path").toSet()
        val prefixes = verified.data("pathPrefix")
        fun taken(path: String) = path in paths || prefixes.any { path.startsWith(it) }
        val golden = Json.parseToJsonElement(File(project, "../../specs/deeplink.golden.json").readText()).jsonObject
        val opened = golden["parseCases"]!!.jsonArray.map { it.jsonObject }
            .filter { it["native"] !is JsonNull && it["url"]!!.jsonPrimitive.content.startsWith("https://") }
        assertTrue(opened.size >= 19, "found the links (${opened.size})")
        for (case in opened) {
            val url = case["url"]!!.jsonPrimitive.content
            val path = url.substringAfter("://").let { rest -> "/" + rest.substringAfter('/', "").substringBefore('?').substringBefore('#') }
            assertTrue(taken(path), "${case["id"]}: $path")
        }
        // Paths the app does not open stay in the browser.
        for (path in listOf("/mobile/privacy.html", "/unknown", "/.well-known/assetlinks.json", "/open.html")) assertTrue(!taken(path), path)
    }
}
