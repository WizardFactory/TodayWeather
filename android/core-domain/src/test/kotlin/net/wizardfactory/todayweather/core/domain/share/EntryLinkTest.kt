package net.wizardfactory.todayweather.core.domain.share

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * `todayweather://N` as `branchInit` reads it (A20): the first `todayweather://` removed, an empty rest ignored, then
 * JavaScript's `parseInt`, NaN ignored.
 */
class EntryLinkTest {
    @Test
    fun theIndexIsReadAsParseIntReadsIt() {
        val cases = mapOf("todayweather://0" to 0.0, "todayweather://2" to 2.0, "todayweather://3/" to 3.0, "todayweather://12abc" to 12.0,
            "todayweather:// 4" to 4.0, "todayweather://-1" to -1.0, "todayweather://+5" to 5.0, "todayweather://0x10" to 16.0,
            "todayweather://007" to 7.0, "todayweather://99999999999999999999" to 1e20)
        for ((link, index) in cases) assertEquals(index, EntryLink.placeIndex(link), link)
    }

    @Test
    fun emptyOrNonNumericLinksSelectNothing() {
        for (link in listOf("todayweather://", "todayweather://abc", "todayweather://-", "todayweather://0x", "todayair://3", "todayweather:// "))
            assertNull(EntryLink.placeIndex(link), link)
    }
}
