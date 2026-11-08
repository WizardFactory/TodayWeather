package net.wizardfactory.todayweather.ui.shell

import androidx.activity.ComponentActivity
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.text.TextLayoutResult
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme

/**
 * Whether the shell fits the window (#2886 AC3), for JVM and device tests (src/sharedTest). On the main screen,
 * with the menu open and scrolled to its last row, and with the exit question: every text is drawn whole, neither
 * ellipsized nor wider (on one line) or taller than the room it got; a text may wrap within its lines. The safe area is the window without the system bars and
 * the display cutout: on the main screen and in the menu every text lies across its width, and the menu button,
 * the tabs, the menu's back button and its last row, scrolled into view, lie inside it.
 */
object ShellFit {
    /** Shows the shell with long menu values, as a JVM test's activity has no app around it. */
    fun show(rule: AndroidComposeTestRule<*, out ComponentActivity>, theme: Theme, region: String) {
        val activity = rule.activity
        val state = ShellState(theme, region, Tab.HOURLY, "1.1.1", mapOf(
            MenuRow.STARTUP_PAGE to activity.getString(R.string.LOC_HOURLY_FORECAST),
            MenuRow.REFRESH_INTERVAL to activity.getString(R.string.LOC_12_HOURS),
            MenuRow.THEME to activity.getString(R.string.LOC_WEATHER_PHOTO_THEME),
            MenuRow.ANALYTICS to activity.getString(R.string.LOC_ANALYTICS_DISABLED),
        ))
        rule.setContent { TodayWeatherShell(state, onRefresh = {}, onMenuRow = {}, onExit = {}) }
        rule.waitForIdle()
    }

    /**
     * Checks the shown shell and returns what does not fit, handing an image of each state to [capture]. Leaves the
     * shell as it found it: on the main screen, the menu closed and no dialog.
     */
    fun check(rule: AndroidComposeTestRule<*, out ComponentActivity>, capture: (String, ImageBitmap) -> Unit): List<String> {
        val activity = rule.activity
        val problems = mutableListOf<String>()
        val safe = safeArea(activity, rule.onRoot().fetchSemanticsNode().boundsInRoot)
        fun inside(where: String, tag: String) {
            val bounds = rule.onNode(hasTestTag(tag)).fetchSemanticsNode().boundsInRoot
            if (!safe.contains(bounds)) problems += "$where: $tag at $bounds outside the safe area $safe"
        }
        problems += texts(rule, "main", safe)
        for (tag in listOf(ShellTags.MENU_BUTTON) + Tab.entries.map(ShellTags::tab)) inside("main", tag)
        capture("main", rule.onRoot().captureToImage())

        rule.onNode(hasTestTag(ShellTags.MENU_BUTTON)).performClick()
        rule.waitForIdle()
        problems += texts(rule, "menu", safe)
        inside("menu", ShellTags.MENU_BACK)
        capture("menu", rule.onRoot().captureToImage())
        val last = ShellTags.row(MenuRow.entries.last())
        rule.onNode(hasTestTag(last)).performScrollTo().assertIsDisplayed()
        rule.waitForIdle()
        problems += texts(rule, "menu end", safe)
        inside("menu end", last)
        capture("menu-end", rule.onRoot().captureToImage())

        rule.onNode(hasTestTag(ShellTags.MENU_BACK)).performClick()
        rule.waitForIdle()
        rule.runOnUiThread { activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        problems += texts(rule, "exit question", null)
        capture("exit", rule.onNode(isDialog()).captureToImage())
        rule.onNode(hasText(activity.getString(R.string.LOC_CANCEL))).performClick()
        rule.waitForIdle()
        return problems
    }

    /** The window without the system bars and the display cutout, in the root's pixels. */
    fun safeArea(activity: ComponentActivity, window: Rect): Rect {
        val insets = ViewCompat.getRootWindowInsets(activity.window.decorView)
            ?.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()) ?: return window
        return Rect(window.left + insets.left, window.top + insets.top, window.right - insets.right, window.bottom - insets.bottom)
    }

    private fun Rect.contains(other: Rect) =
        other.left >= left - 0.5f && other.top >= top - 0.5f && other.right <= right + 0.5f && other.bottom <= bottom + 0.5f

    /** Texts that are cut: ellipsized or overflowing their line, or reaching past the sides of [safe]. */
    fun texts(rule: AndroidComposeTestRule<*, *>, where: String, safe: Rect?): List<String> =
        rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Text), useUnmergedTree = true).fetchSemanticsNodes()
            .mapNotNull { node -> cut(node, safe)?.let { "$where: \"${node.text()}\" $it" } }

    private fun cut(node: SemanticsNode, safe: Rect?): String? {
        val layouts = mutableListOf<TextLayoutResult>()
        node.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(layouts)
        val layout = layouts.firstOrNull() ?: return "has no text layout"
        if ((0 until layout.lineCount).any { layout.isLineEllipsized(it) }) return "is ellipsized"
        // The paragraph's width is the width it may take; a cut single line is wider than the size it got. A text
        // that wraps within its lines is whole.
        val width = layout.multiParagraph.intrinsics.maxIntrinsicWidth
        if (layout.multiParagraph.didExceedMaxLines || layout.didOverflowHeight || (layout.lineCount == 1 && width > layout.size.width + 0.5f)) {
            return "overflows (${width}x${layout.multiParagraph.height} in ${layout.size})"
        }
        // Bounds are clipped to what shows: empty for an empty text or a row scrolled out of view.
        val bounds = node.boundsInRoot
        if (safe != null && !bounds.isEmpty && (bounds.left < safe.left - 0.5f || bounds.right > safe.right + 0.5f)) {
            return "at $bounds reaches past the safe area $safe"
        }
        return null
    }

    private fun SemanticsNode.text() = config[SemanticsProperties.Text].joinToString(" ")
}
