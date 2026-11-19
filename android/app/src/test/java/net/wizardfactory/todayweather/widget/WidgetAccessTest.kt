package net.wizardfactory.todayweather.widget

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetAccessTest {
    private val opened = 1_800_000_000_000L
    private val fiveDays = 120 * 60 * 60 * 1000L

    @Test fun expiresAtExactlyFiveDaysAndAnotherVisitRenewsAccess() {
        assertTrue(WidgetAccess.allowedAt(opened, opened + fiveDays - 1))
        assertFalse(WidgetAccess.allowedAt(opened, opened + fiveDays))
        assertFalse(WidgetAccess.allowedAt(opened, opened + fiveDays + 1))
        assertTrue(WidgetAccess.allowedAt(opened + fiveDays + 1, opened + fiveDays + 1))
    }

    @Test fun missingAndFutureTimestampsRequireOpeningApp() {
        assertFalse(WidgetAccess.allowedAt(0, opened))
        assertFalse(WidgetAccess.allowedAt(opened, opened - 1))
    }
}
