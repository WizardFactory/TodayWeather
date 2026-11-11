package net.wizardfactory.todayweather

import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.Test

/**
 * The parity checklist (`android/parity.md`, AC1 of #2897) stays complete and resolvable: every screen, dialog and
 * app-wide element has its row; a row gives native evidence, an accepted difference or the pull request that adds the
 * rest, or is marked not built; its links and anchors resolve; and every test it names exists.
 */
class ParityChecklistTest {
    private val android = File(System.getProperty("tw.projectDir")!!, "..").canonicalFile
    private val checklist = File(android, "parity.md")
    private val text = checklist.readText()

    /** The table rows (not headers or rules), as their cells. */
    private val rows: List<List<String>> = text.lines()
        .filter { it.startsWith("| ") && !it.startsWith("| ---") && !it.startsWith("| ID |") }
        .map { line -> line.trim().removePrefix("|").removeSuffix("|").split(" | ").map { it.trim() } }

    @Test
    fun everyScreenDialogAndElementHasARowThatSaysWhereItsEvidenceIs() {
        val expected = (1..16).map { "S%02d".format(it) } + (1..19).map { "O%02d".format(it) } + (1..11).map { "X$it" }
        assertEquals(expected.sorted(), rows.map { it.first() }.sorted())
        for (row in rows) {
            assertEquals(6, row.size, "${row.first()}: ID, what, Cordova reference, native evidence, accepted differences, status")
            val (id, evidence, status) = Triple(row[0], row[3], row[5])
            val built = status != "Not built"
            assertTrue(status.startsWith("Covered") || STATUS_LATER.matches(status) || !built, "$id: status '$status'")
            if (built) assertTrue(evidence.isNotBlank() && !evidence.startsWith("None"), "$id: no native evidence")
            else assertTrue(evidence.startsWith("None"), "$id: not built, so no evidence")
        }
    }

    @Test
    fun everyLinkResolves() {
        val links = Regex("""\[[^\]]*\]\(([^)\s]+)\)""").findAll(text).map { it.groupValues[1] }.filterNot { it.startsWith("http") }.toList()
        assertTrue(links.size > 50, "the checklist links its references")
        val broken = links.filterNot { target ->
            val path = target.substringBefore('#')
            val anchor = target.substringAfter('#', "").ifEmpty { null }
            val file = if (path.isEmpty()) checklist else File(android, path).canonicalFile
            file.exists() && (anchor == null || anchor in anchors(file))
        }
        assertEquals(emptyList(), broken)
    }

    @Test
    fun everyNamedTestExists() {
        val sources = listOf("app/src/test", "app/src/androidTest", "core-data/src/test", "core-domain/src/test", "core-storage/src/test", "core-model/src/test")
            .flatMap { dir -> File(android, dir).walk().filter { it.extension == "kt" }.toList() }
        val files = sources.flatMap { file -> CLASS.findAll(file.readText()).map { it.groupValues[1] to file }.toList() }.toMap()
        val missing = mutableListOf<String>()
        var named = 0
        fun check(cls: String, method: String?) {
            named++
            val file = files[cls] ?: return run { missing += cls }
            if (method != null && !Regex("""\bfun\s+$method\s*\(""").containsMatchIn(file.readText())) missing += "$cls#$method"
        }
        for (line in text.lines()) {
            var last: String? = null
            for (token in Regex("`([^`]+)`").findAll(line).map { it.groupValues[1] }) {
                val test = TEST.matchEntire(token)
                val method = METHOD.matchEntire(token)
                if (test != null) {
                    last = test.groupValues[1]
                    check(last, test.groupValues[2].ifEmpty { null })
                } else if (method != null && last != null) {
                    check(last, method.groupValues[1])
                }
            }
        }
        assertTrue(named > 200, "the checklist names its tests")
        assertEquals(emptyList(), missing)
    }

    /** The anchors GitHub gives the headings of [file]: lower case, punctuation dropped, spaces as hyphens, repeats numbered. */
    private fun anchors(file: File): Set<String> {
        val seen = mutableMapOf<String, Int>()
        return file.readLines().mapNotNull { HEADING.matchEntire(it)?.groupValues?.get(1) }.map { heading ->
            val slug = heading.lowercase().replace(Regex("""[^\p{L}\p{M}\p{N}\p{Pc} -]"""), "").replace(' ', '-')
            val n = seen.getOrDefault(slug, 0)
            seen[slug] = n + 1
            if (n == 0) slug else "$slug-$n"
        }.toSet()
    }

    private companion object {
        val STATUS_LATER = Regex("""^PR [234]\b.*""")
        val CLASS = Regex("""^(?:(?:abstract|open|internal|private)\s+)*class\s+(\w+)""", RegexOption.MULTILINE)
        val TEST = Regex("""(\w+Test)(?:#(\w+))?""")
        val METHOD = Regex("""#(\w+)""")
        val HEADING = Regex("""^#{1,6}\s+(.*?)\s*$""")
    }
}
