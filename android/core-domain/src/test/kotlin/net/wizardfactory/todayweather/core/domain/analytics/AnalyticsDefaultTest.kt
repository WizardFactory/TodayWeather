package net.wizardfactory.todayweather.core.domain.analytics

import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Usage analytics on by default outside the opt-in regions (AK 2026-11-24, specs/analytics-default-on.md): the region
 * list, every two-letter region, unknown regions, and the stored choice winning over the region.
 */
class AnalyticsDefaultTest {
    private val eu = listOf("AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT",
        "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE")

    /** Parts of EU member states with their own ISO code (outermost regions, Saint-Martin, Åland). */
    private val euTerritories = listOf("GF", "GP", "MQ", "RE", "YT", "MF", "AX")

    @Test
    fun theOptInRegionsAreTheEeaTheUnitedKingdomAndSwitzerland() {
        assertEquals(27, eu.toSet().size)
        assertEquals((eu + euTerritories + listOf("IS", "LI", "NO") + listOf("GB", "CH")).toSet(), AnalyticsDefault.OPT_IN_REGIONS)
    }

    @Test
    fun theKnownRegionsAreTheAssignedIsoCodes() {
        assertEquals(Locale.getISOCountries().toSet(), AnalyticsDefault.ASSIGNED_REGIONS)
        assertTrue(AnalyticsDefault.OPT_IN_REGIONS.all { it in AnalyticsDefault.ASSIGNED_REGIONS })
    }

    @Test
    fun everyTwoLetterRegion() {
        var on = 0
        for (a in 'A'..'Z') for (b in 'A'..'Z') {
            val region = "$a$b"
            val expected = region in Locale.getISOCountries() && region !in AnalyticsDefault.OPT_IN_REGIONS
            assertEquals(expected, AnalyticsDefault.onByDefault(region), region)
            assertEquals(expected, AnalyticsDefault.onByDefault(region.lowercase()), region.lowercase())
            if (expected) on++
        }
        assertEquals(249 - 39, on)
        for (region in listOf("KR", "US", "JP", "CN", "TW", "HK", "CA", "AU", "BR", "IN", "TR", "RU", "UA", "RS", "MC", "SM", "VA", "AD",
            "GI", "GG", "JE", "IM", "FO", "GL", "SJ", "BL", "PM", "NC", "PF")) {
            assertTrue(AnalyticsDefault.onByDefault(region), region)
        }
        for (region in eu + euTerritories + listOf("IS", "LI", "NO", "GB", "CH")) assertFalse(AnalyticsDefault.onByDefault(region), region)
    }

    @Test
    fun anUnknownRegionKeepsTheOptIn() {
        for (region in listOf(null, "", " ", "150", "419", "001", "EU", "UK", "EL", "IC", "EA", "XK", "XA", "XB", "ZZ", "AA", "QO", "KOR", "K",
            "K1", "ÄT")) {
            assertFalse(AnalyticsDefault.onByDefault(region), "$region")
        }
    }

    @Test
    fun aStoredChoiceWinsOverTheRegion() {
        for (region in listOf("KR", "US", "DE", "GB", "CH", "", null)) {
            assertTrue(AnalyticsDefault.collects("true", region), "$region")
            assertFalse(AnalyticsDefault.collects("false", region), "$region")
            for (other in listOf("TRUE", "1", "yes", "", "on")) assertFalse(AnalyticsDefault.collects(other, region), "$other $region")
        }
        assertTrue(AnalyticsDefault.collects(null, "KR"))
        assertTrue(AnalyticsDefault.collects(null, "US"))
        assertFalse(AnalyticsDefault.collects(null, "DE"))
        assertFalse(AnalyticsDefault.collects(null, "GB"))
        assertFalse(AnalyticsDefault.collects(null, "CH"))
        assertFalse(AnalyticsDefault.collects(null, ""))
        assertFalse(AnalyticsDefault.collects(null, null))
    }
}
