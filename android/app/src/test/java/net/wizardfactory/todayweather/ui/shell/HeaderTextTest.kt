package net.wizardfactory.todayweather.ui.shell

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextMotion
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import net.wizardfactory.todayweather.core.domain.air.AirMain
import net.wizardfactory.todayweather.core.domain.air.AirWeather
import net.wizardfactory.todayweather.core.domain.forecast.PageImage
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.ui.air.GradeLine
import net.wizardfactory.todayweather.ui.forecast.ForecastColors
import net.wizardfactory.todayweather.ui.forecast.Summary
import net.wizardfactory.todayweather.ui.forecast.Temperature
import net.wizardfactory.todayweather.ui.forecast.glyphStyle
import net.wizardfactory.todayweather.ui.text.CssMetrics
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

    @Test fun photoTemperatureKeepsAbsoluteShadowOffsetsInRtl() {
        rule.setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                Column {
                    Box(Modifier.size(145.dp, 70.dp).testTag("candidate"), contentAlignment = Alignment.Center) {
                        Temperature("-12.7", 48.0, Color.White, Color.Black)
                    }
                    Box(Modifier.size(145.dp, 70.dp).testTag("reference"), contentAlignment = Alignment.Center) {
                        Box {
                            for (dy in listOf(-0.5.dp, 0.5.dp)) for (dx in listOf(-0.5.dp, 0.5.dp)) {
                                Box(Modifier.layout { child, constraints ->
                                    val p = child.measure(constraints)
                                    layout(p.width, p.height) { p.place(dx.roundToPx(), dy.roundToPx()) }
                                }) { Temperature("-12.7", 48.0, Color.Black, null) }
                            }
                            Temperature("-12.7", 48.0, Color.White, null)
                        }
                    }
                }
            }
        }
        assertSameImage("temperature and raised degree with rounded absolute offsets")
    }

    @Test fun airAdviceKeepsFaceAndAccentsAtReducedFontScale() = compareGrade(0.85f)
    @Test fun airAdviceKeepsFaceAndAccentsAtLargerFontScale() = compareGrade(1.3f)

    private fun compareGrade(scale: Float) {
        val main = AirMain("Air", "", "", true, null, "Good", "\ue813", "Breathe easy, enjoy the café.", AirWeather(PageImage(false, ""), "", false))
        rule.setContent {
            val density = Density(LocalDensity.current.density, scale)
            CompositionLocalProvider(LocalDensity provides density) {
                Column {
                    Box(Modifier.size(128.dp, 175.dp).testTag("candidate")) { GradeLine(main, Color.Blue, Color.Black) }
                    Box(Modifier.size(128.dp, 175.dp).testTag("reference")) { originalGradeLine(main, Color.Blue, Color.Black) }
                }
            }
        }
        assertSameImage("inline face and accents at scale $scale")
    }

    private fun assertSameImage(description: String) {
        val actual = rule.onNodeWithTag("candidate").captureToImage().asAndroidBitmap()
        val original = rule.onNodeWithTag("reference").captureToImage().asAndroidBitmap()
        assertTrue(description, original.sameAs(actual))
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

@Composable
private fun originalGradeLine(main: AirMain, color: Color, text: Color) {
    val density = LocalDensity.current
    val face = "face"
    val faceStart = if (main.lead.isNotEmpty()) main.lead.length + 1 else 0
    val annotated = remember(main) {
        buildAnnotatedString {
            if (main.lead.isNotEmpty()) append(main.lead + " ")
            appendInlineContent(face, main.glyph)
            main.advice?.let { append(" $it") }
        }
    }
    // Unhinted advances, as the weather pages' text: the WebView's widths.
    val style = line(21.sp, TextUnit.Unspecified, text).copy(textMotion = TextMotion.Animated)
    val measurer = rememberTextMeasurer()
    val lineHeight = with(density) { 24.sp.roundToPx() }
    val font = remember(density) { CssMetrics.line(AnnotatedString("x"), style, style, density, borrow = true) }
    val baseline = font.ascent + Math.floorDiv(lineHeight - font.ascent - font.descent, 2)
    // The face keeps its 24 dp whatever the font scale, as the shell's glyphs do (dp to sp through the font scale's
    // own, possibly nonlinear, conversion). It stands on the baseline in the text and is moved down to the line's top.
    val size = with(density) { 24.dp.toSp() }
    val placeholder = Placeholder(size, size, PlaceholderVerticalAlign.AboveBaseline)
    val inline = mapOf(face to InlineTextContent(placeholder) {
        Box(Modifier.layout { measurable, constraints ->
            val p = measurable.measure(constraints)
            layout(p.width, p.height) { p.place(0, p.height - baseline) }
        }) { Icon { Text(main.glyph, style = glyphStyle(24.sp, color, Glyphs.materialIcons)) } }
    })
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val width = constraints.maxWidth
        val lines = remember(annotated, style, width, measurer, placeholder) {
            val layout = measurer.measure(annotated, style, constraints = Constraints(maxWidth = width),
                placeholders = listOf(AnnotatedString.Range(placeholder, faceStart, faceStart + main.glyph.length)))
            (0 until layout.lineCount).map { layout.getLineStart(it) to layout.getLineEnd(it, visibleEnd = true) }
        }
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            for ((start, end) in lines) {
                Text(annotated.subSequence(start, end), Modifier.layout { measurable, constraints ->
                    val placeable = measurable.measure(constraints)
                    layout(placeable.width, lineHeight) { placeable.place(0, baseline - placeable[FirstBaseline]) }
                }, style = style, inlineContent = inline, maxLines = 1)
            }
        }
    }
}
