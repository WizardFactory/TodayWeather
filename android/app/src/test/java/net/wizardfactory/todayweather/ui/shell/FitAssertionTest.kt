package net.wizardfactory.todayweather.ui.shell

import androidx.activity.ComponentActivity
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Qualifications: a whole text layout can still be cut by its parent. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w320dp-h480dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FitAssertionTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun aTextClippedByItsParentFails() {
        rule.setContent {
            Box(Modifier.fillMaxSize()) {
                Box(Modifier.size(120.dp, 8.dp).clipToBounds()) {
                    Text("Clipped label", Modifier.requiredSize(120.dp, 40.dp))
                }
            }
        }
        rule.waitForIdle()
        val safe = rule.onRoot().fetchSemanticsNode().boundsInRoot
        assertTrue("must detect parent clipping", ShellFit.texts(rule, "fixture", safe).isNotEmpty())
    }

    @Test fun aFixedParentClipInsideVerticalScrollFails() {
        rule.setContent {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Box(Modifier.size(120.dp, 8.dp).clipToBounds()) {
                    Text("Clipped label", Modifier.requiredSize(120.dp, 40.dp))
                }
            }
        }
        rule.waitForIdle()
        assertTrue("scroll ancestor must not hide an inner fixed clip",
            ShellFit.texts(rule, "scroll fixture", rule.onRoot().fetchSemanticsNode().boundsInRoot).isNotEmpty())
    }

    @Test fun aFixedParentClipInsideHorizontalScrollFails() {
        rule.setContent {
            Box(Modifier.fillMaxSize().horizontalScroll(rememberScrollState())) {
                Box(Modifier.size(8.dp, 40.dp).clipToBounds()) {
                    Text("Clipped label", Modifier.requiredSize(120.dp, 40.dp))
                }
            }
        }
        rule.waitForIdle()
        assertTrue("horizontal scroll ancestor must not hide an inner fixed clip",
            ShellFit.texts(rule, "scroll fixture", rule.onRoot().fetchSemanticsNode().boundsInRoot).isNotEmpty())
    }

    @Test fun normalPartialAndOffscreenScrollContentPasses() {
        rule.setContent {
            Column(Modifier.size(120.dp, 30.dp).verticalScroll(rememberScrollState())) {
                Spacer(Modifier.height(20.dp))
                Text("Partial", Modifier.requiredSize(120.dp, 40.dp))
                Text("Offscreen", Modifier.requiredSize(120.dp, 40.dp))
            }
        }
        rule.waitForIdle()
        assertTrue("viewport clipping is expected until the user scrolls",
            ShellFit.texts(rule, "scroll fixture", rule.onRoot().fetchSemanticsNode().boundsInRoot).isEmpty())
    }

    @Test fun disabledVerticalScrollCannotHideClippedOrOffscreenText() {
        rule.setContent {
            Column(Modifier.size(120.dp, 30.dp).verticalScroll(rememberScrollState(), enabled = false)) {
                Spacer(Modifier.height(20.dp))
                Text("Partial", Modifier.requiredSize(120.dp, 40.dp))
                Text("Offscreen", Modifier.requiredSize(120.dp, 40.dp))
            }
        }
        rule.waitForIdle()
        val problems = ShellFit.texts(rule, "disabled", rule.onRoot().fetchSemanticsNode().boundsInRoot)
        org.junit.Assert.assertEquals("both inaccessible labels must fail", 2, problems.size)
    }

    @Test fun disabledHorizontalScrollCannotHideClipping() {
        rule.setContent {
            Box(Modifier.size(8.dp, 40.dp).horizontalScroll(rememberScrollState(), enabled = false)) {
                Text("Clipped label", Modifier.requiredSize(120.dp, 40.dp))
            }
        }
        rule.waitForIdle()
        assertTrue(ShellFit.texts(rule, "disabled", null).isNotEmpty())
    }

    @Test fun disabledScrollDoesNotExemptTheBottomSafeArea() {
        rule.setContent {
            Column(Modifier.size(120.dp, 80.dp).verticalScroll(rememberScrollState(), enabled = false)) {
                Spacer(Modifier.height(40.dp))
                Text("Behind bar", Modifier.requiredSize(120.dp, 40.dp))
            }
        }
        rule.waitForIdle()
        val root = rule.onRoot().fetchSemanticsNode().boundsInRoot
        assertTrue(ShellFit.texts(rule, "disabled", root.copy(bottom = root.top + 60f)).isNotEmpty())
    }

    @Test fun onePixelOfLineBoxRoundingPasses() = lineBoxRounding(1, false)

    @Test fun twoPixelsOfParentClippingFails() = lineBoxRounding(2, true)

    private fun lineBoxRounding(pixels: Int, fails: Boolean) {
        rule.setContent {
            val reduction = with(LocalDensity.current) { pixels.toDp() }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Spacer(Modifier.height(20.dp))
                Box(Modifier.size(120.dp, 40.dp - reduction).clipToBounds()) {
                    Text("Label", Modifier.requiredSize(120.dp, 40.dp))
                }
            }
        }
        rule.waitForIdle()
        val problems = ShellFit.texts(rule, "rounding fixture", rule.onRoot().fetchSemanticsNode().boundsInRoot)
        org.junit.Assert.assertEquals("only one device pixel is tolerated", fails, problems.isNotEmpty())
    }

    @Test fun aWholeTextPasses() {
        rule.setContent { Box(Modifier.fillMaxSize()) { Text("Whole label") } }
        rule.waitForIdle()
        assertTrue(ShellFit.texts(rule, "fixture", rule.onRoot().fetchSemanticsNode().boundsInRoot).isEmpty())
    }
}
