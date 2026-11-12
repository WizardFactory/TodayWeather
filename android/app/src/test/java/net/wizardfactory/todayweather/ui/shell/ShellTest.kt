package net.wizardfactory.todayweather.ui.shell

import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.espresso.Espresso
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Shell behavior (#2886 AC1): tabs, startup page, menu rows, back on a dialog and the exit confirmation. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class ShellTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val refreshed = mutableListOf<Tab>()
    private var exits = 0

    private fun show(startup: Tab = Tab.HOURLY, region: String = "KR", values: Map<MenuRow, String> = emptyMap()) {
        rule.setContent {
            TodayWeatherShell(ShellState(Theme.LIGHT, region, startup, "2.0.0", values), onRefresh = { refreshed += it }, onMenuRow = {}, onExit = { exits++ })
        }
        rule.waitForIdle()
    }

    private fun back() {
        Espresso.pressBackUnconditionally()
        rule.waitForIdle()
    }

    @Test
    fun tabsSwitchAndTheSelectedWeatherTabRefreshes() {
        show()
        rule.onNodeWithTag(ShellTags.page(Tab.HOURLY)).assertExists()
        for (tab in listOf(Tab.DAILY, Tab.AIR, Tab.LOCATIONS, Tab.HOURLY)) {
            rule.onNodeWithTag(ShellTags.tab(tab)).performClick()
            rule.waitForIdle()
            rule.onNodeWithTag(ShellTags.page(tab)).assertExists()
        }
        assertEquals(emptyList<Tab>(), refreshed)
        Thread.sleep(750)
        rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).performClick()
        rule.onNodeWithTag(ShellTags.tab(Tab.HOURLY)).performClick() // within 700 ms: ignored
        rule.waitForIdle()
        assertEquals(listOf(Tab.HOURLY), refreshed)
    }

    @Test
    fun theStartupPageSelectsTheFirstTab() {
        show(startup = Tab.DAILY)
        rule.onNodeWithTag(ShellTags.page(Tab.DAILY)).assertExists()
        rule.onNodeWithTag(ShellTags.page(Tab.HOURLY)).assertDoesNotExist()
    }

    @Test
    fun theMenuOpensAndClosesWithItsArrowAndBack() {
        show()
        rule.onNodeWithTag(ShellTags.MENU).assertDoesNotExist()
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.MENU).assertIsDisplayed()
        rule.onNodeWithTag(ShellTags.row(MenuRow.SPECIAL_WEATHER)).assertExists()
        rule.onNodeWithTag(ShellTags.MENU_BACK).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.MENU).assertDoesNotExist()
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.waitForIdle()
        back()
        rule.onNodeWithTag(ShellTags.MENU).assertDoesNotExist()
        assertEquals(0, exits)
    }

    @Test
    fun koreaOnlyRowsNeedRegionKr() {
        show(region = "US")
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.row(MenuRow.SPECIAL_WEATHER)).assertDoesNotExist()
        rule.onNodeWithTag(ShellTags.row(MenuRow.UNITS)).assertExists()
    }

    @Test
    fun menuRowsShowTheirValuesAndKoreaOnlyRowsTheirChevrons() {
        show(values = mapOf(MenuRow.THEME to "밝은 테마", MenuRow.ANALYTICS to "꺼짐"))
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.waitForIdle()
        val chevrons = rule.onAllNodes(hasText(Glyphs.CHEVRON_RIGHT), useUnmergedTree = true)
        chevrons.assertCountEquals(4)
        for (row in listOf(MenuRow.SPECIAL_WEATHER, MenuRow.NATIONAL_WEATHER, MenuRow.NATIONAL_AIR, MenuRow.NULLSCHOOL_WIND)) {
            rule.onNode(hasText(Glyphs.CHEVRON_RIGHT) and hasAnyAncestor(hasTestTag(ShellTags.row(row))), useUnmergedTree = true).assertExists()
        }
        rule.onNode(hasText("밝은 테마") and hasAnyAncestor(hasTestTag(ShellTags.row(MenuRow.THEME))), useUnmergedTree = true).assertExists()
        rule.onNode(hasText("선택적 이용 통계 · 꺼짐") and hasAnyAncestor(hasTestTag(ShellTags.row(MenuRow.ANALYTICS))), useUnmergedTree = true).assertExists()
        rule.onNode(hasText("2.0.0") and hasAnyAncestor(hasTestTag(ShellTags.row(MenuRow.VERSION))), useUnmergedTree = true).assertExists()
    }

    @Test
    fun backOnAMainTabAsksAndBackOnTheDialogOnlyClosesIt() {
        show()
        back()
        rule.onNodeWithText("종료하시겠습니까?").assertIsDisplayed()
        back() // closes the dialog without an answer
        rule.onNodeWithText("종료하시겠습니까?").assertDoesNotExist()
        assertEquals(0, exits)
        back()
        rule.onNodeWithText("취소").performClick()
        rule.waitForIdle()
        assertEquals(0, exits)
        back()
        rule.onNodeWithText("확인").performClick()
        rule.waitForIdle()
        assertEquals(1, exits)
        assertTrue(refreshed.isEmpty())
    }

    /** The Cordova status bar (config.xml `StatusBarBackgroundColor` #111111): drawn edge to edge, light icons, the shell's #111111 behind them. */
    @Test
    fun theStatusBarIsDarkWithLightIcons() {
        rule.runOnUiThread { rule.activity.enableShellSystemBars() }
        show()
        val window = rule.activity.window
        assertEquals(android.graphics.Color.TRANSPARENT, window.statusBarColor)
        assertFalse("light icons", WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars)
        rule.runOnUiThread {
            ViewCompat.dispatchApplyWindowInsets(rule.activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0),
                WindowInsetsCompat.Builder().setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, 48, 0, 0)).build())
        }
        rule.waitForIdle()
        val image = rule.onRoot().captureToImage().asAndroidBitmap()
        for (y in listOf(0, 47)) assertEquals("row $y", 0xFF111111.toInt(), image.getPixel(image.width / 2, y))
        assertNotEquals("the header starts under it", 0xFF111111.toInt(), image.getPixel(image.width / 2, 48))
    }
}
