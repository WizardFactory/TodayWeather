package net.wizardfactory.todayweather.ui.start

import android.content.Context
import android.content.ContextWrapper
import android.content.res.Configuration
import android.graphics.Rect
import android.view.WindowInsets
import android.view.WindowManager
import android.view.WindowMetrics
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import java.lang.reflect.Proxy
import net.wizardfactory.todayweather.core.domain.start.TownSearch
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** A host may resize without replacing its Context; shortcut selection follows that window. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w800dp-h1280dp-xhdpi")
class StartConfigurationTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun shortcutsRefreshWhenTheSameContextChangesConfiguration() {
        val base = rule.activity
        val density = base.resources.displayMetrics.density
        var bounds = Rect(0, 0, (800 * density).toInt(), (1280 * density).toInt())
        val config = mutableStateOf(Configuration(base.resources.configuration))
        val manager = Proxy.newProxyInstance(WindowManager::class.java.classLoader, arrayOf(WindowManager::class.java)) { _, method, _ ->
            when (method.name) {
                "getCurrentWindowMetrics" -> WindowMetrics(bounds, WindowInsets.Builder().build())
                else -> error("Unexpected window operation: ${method.name}")
            }
        }
        val context = object : ContextWrapper(base) {
            override fun getSystemService(name: String): Any? = if (name == Context.WINDOW_SERVICE) manager else super.getSystemService(name)
        }
        rule.setContent {
            CompositionLocalProvider(LocalContext provides context, LocalConfiguration provides config.value) {
                StartContent(null, { TownSearch(emptyList()) }, {}, { _, _ -> }, {}, {})
            }
        }
        rule.onNodeWithTag(StartTags.chip(25)).assertExists()
        rule.runOnIdle {
            bounds = Rect(0, 0, (800 * density).toInt(), (480 * density).toInt())
            config.value = Configuration(config.value).apply { screenHeightDp = 480 }
        }
        rule.onNodeWithTag(StartTags.chip(5)).assertExists()
        rule.onNodeWithTag(StartTags.chip(6)).assertDoesNotExist()
        rule.runOnIdle {
            bounds = Rect(0, 0, (800 * density).toInt(), (1280 * density).toInt())
            config.value = Configuration(config.value).apply { screenHeightDp = 1280 }
        }
        rule.onNodeWithTag(StartTags.chip(25)).assertExists()
    }
}
