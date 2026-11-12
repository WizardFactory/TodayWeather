package net.wizardfactory.todayweather

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.espresso.Espresso
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import net.wizardfactory.todayweather.core.data.*
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.*
import net.wizardfactory.todayweather.ui.forecast.*
import net.wizardfactory.todayweather.ui.shell.*
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Cordova's WebView ends above the native banner: O03/O15 must keep that boundary. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class PopupBoundsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var bannerClicks = 0
    @After fun stop() = scope.cancel()

    @Composable private fun Banner() {
        Box(Modifier.fillMaxWidth().height(50.dp).background(Color.Magenta).clickable { bannerClicks++ })
    }

    private fun checkBannerBoundary() {
        val banner = rule.onNodeWithTag(ShellTags.BANNER)
        val area = banner.getUnclippedBoundsInRoot()
        val popup = rule.onNodeWithTag(PopupTags.POPUP).getUnclippedBoundsInRoot()
        assertEquals("popup centered above banner", area.top.value / 2f, (popup.top.value + popup.bottom.value) / 2f, 0.5f)
        val pixel = banner.captureToImage().asAndroidBitmap().getPixel(10, 10)
        assertEquals("banner not dimmed", android.graphics.Color.MAGENTA, pixel)
        banner.performTouchInput { click(center) }
        assertEquals("banner outside the modal touch blocker", 1, bannerClicks)
    }

    @Test fun exitLeavesBannerOutsideTheModal() {
        rule.setContent {
            TodayWeatherShell(ShellState(Theme.LIGHT, "KR", Tab.HOURLY, "test"), {}, {}, {}, banner = { Banner() })
        }
        Espresso.pressBackUnconditionally()
        rule.onNodeWithTag(PopupTags.POPUP).assertExists()
        checkBannerBoundary()
    }

    @Test fun appRetryLeavesBannerOutsideTheModal() {
        val state = AppState().closeStart()
        val memory = object : StateAccess {
            override fun current() = state
            override fun change(update: (AppState) -> AppState) = Unit
        }
        val repository = WeatherRepository("https://fixture.invalid", null, HttpGet { _, _ -> error("No request expected") }, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        rule.setContent {
            val host = WeatherTabHost(forecastTexts(rule.activity), PhotoLoader(rule.activity), {}, {}, {}, {})
            AppContent(state, emptyMap(), emptySet(), true, session, host, "test", onExit = {}, banner = { Banner() })
        }
        rule.onNodeWithTag(RETRY_DIALOG).assertExists()
        checkBannerBoundary()
    }
}
