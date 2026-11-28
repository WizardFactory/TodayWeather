package net.wizardfactory.todayweather.ui.shell

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextMotion
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.ui.forecast.ForecastColors
import net.wizardfactory.todayweather.ui.forecast.Summary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xxhdpi")
class HeaderTextTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun photoOutlineUsesOneTextLayoutWithTheSameFourRoundedShadows() {
        val title = "서울 Seoul"
        val style = line(21.sp, TextUnit.Unspecified, Color.White)
        rule.setContent {
            Column {
                Box(Modifier.size(180.dp, 45.dp).testTag("candidate"), contentAlignment = Alignment.Center) {
                    OutlinedText(title, style, Color.Black)
                }
                Box(Modifier.size(180.dp, 45.dp).testTag("reference"), contentAlignment = Alignment.Center) {
                    Box {
                        for (dy in listOf(-0.5.dp, 0.5.dp)) for (dx in listOf(-0.5.dp, 0.5.dp)) {
                            LineText(title, style.copy(color = Color.Black), Modifier.offset(dx, dy))
                        }
                        LineText(title, style)
                    }
                }
            }
        }
        val actual = rule.onNodeWithTag("candidate").captureToImage().asAndroidBitmap()
        val original = rule.onNodeWithTag("reference").captureToImage().asAndroidBitmap()
        assertTrue("photo title pixels differ", actual.sameAs(original))
        assertEquals(5, textLayoutCount("reference", title))
        assertEquals(1, textLayoutCount("candidate", title))
    }

    @Test fun iconUsesItsOwnTextLayoutWithoutMeasuringAReference() {
        rule.setContent {
            CompositionLocalProvider(LocalLineMeasurer providesComputed { error("icon requested a reference layout") }) {
                Box(Modifier.testTag("icon")) {
                    Icon { LineText(Glyphs.SEARCH, line(24.sp, TextUnit.Unspecified, Color.White, family = Glyphs.ionicons)) }
                }
            }
        }
        assertEquals(1, textLayoutCount("icon", Glyphs.SEARCH))
    }

    @Test fun wrappedPhotoSummaryMatchesTheOriginalCenteredRowsPixelForPixel() {
        val title = "서울 날씨 공기 좋음, 오늘은 Sunny and clear"
        val colors = ForecastColors.of(Theme.PHOTO, daily = false)
        rule.setContent {
            Column {
                Box(Modifier.size(148.dp, 125.dp).testTag("candidate")) {
                    Summary(title, colors, Modifier)
                }
                BoxWithConstraints(Modifier.size(148.dp, 125.dp).testTag("reference")) {
                    val style = line(21.sp, TextUnit.Unspecified, colors.headerText).copy(textMotion = TextMotion.Animated)
                    val original = rememberTextMeasurer().measure(title, style, constraints = Constraints(maxWidth = constraints.maxWidth))
                    val lineHeight = with(LocalDensity.current) { 24.sp.toDp() }
                    Column(Modifier.size(148.dp, 125.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        for (i in 0 until original.lineCount) {
                            val row = title.substring(original.getLineStart(i), original.getLineEnd(i, visibleEnd = true))
                            FixedLine(lineHeight) {
                                OutlinedText(row, style, colors.headerOutline, Modifier.wrapContentHeight(unbounded = true))
                            }
                        }
                    }
                }
            }
        }
        val actual = rule.onNodeWithTag("candidate").captureToImage().asAndroidBitmap()
        val original = rule.onNodeWithTag("reference").captureToImage().asAndroidBitmap()
        assertTrue("multiline header pixels differ", actual.sameAs(original))
    }

    private fun textLayoutCount(parentTag: String, text: String): Int {
        val matcher = hasText(text) and hasAnyAncestor(hasTestTag(parentTag))
        val nodes = rule.onAllNodes(matcher, useUnmergedTree = true).fetchSemanticsNodes()
        return rule.runOnIdle {
            val results = mutableListOf<TextLayoutResult>()
            for (node in nodes) {
                assertTrue(node.config[SemanticsActions.GetTextLayoutResult].action!!.invoke(results))
            }
            results.size
        }
    }
}
