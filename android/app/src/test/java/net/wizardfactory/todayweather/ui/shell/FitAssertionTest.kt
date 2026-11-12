package net.wizardfactory.todayweather.ui.shell

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
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

    @Test fun aWholeTextPasses() {
        rule.setContent { Box(Modifier.fillMaxSize()) { Text("Whole label") } }
        rule.waitForIdle()
        assertTrue(ShellFit.texts(rule, "fixture", rule.onRoot().fetchSemanticsNode().boundsInRoot).isEmpty())
    }
}
