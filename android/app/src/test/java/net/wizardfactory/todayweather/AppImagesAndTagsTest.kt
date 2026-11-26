package net.wizardfactory.todayweather

import androidx.activity.ComponentActivity
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.semantics.SemanticsPropertiesAndroid
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.closeStart
import net.wizardfactory.todayweather.ui.chart.ForecastChartImages
import net.wizardfactory.todayweather.ui.chart.LocalForecastChartImages
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.shell.ShellState
import net.wizardfactory.todayweather.ui.shell.ShellTags
import net.wizardfactory.todayweather.ui.shell.TodayWeatherShell
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** #3224: AppContent shares one decoded-image cache with everything in the shell, and the journeys can find test tags. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class AppImagesAndTagsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    @After fun stop() = scope.cancel()

    /** The banner slot sits under the tab bar, outside every tab: what it sees, Air, Locations and the national pages see. */
    @Test fun appContentProvidesItsImageCacheToTheWholeShell() {
        val state = AppState().closeStart()
        val memory = object : StateAccess {
            override fun current() = state
            override fun change(update: (AppState) -> AppState) = Unit
        }
        val repository = WeatherRepository("https://fixture.invalid", null, HttpGet { _, _ -> error("No request expected") }, io = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        var seen: ForecastChartImages? = null
        rule.setContent {
            val host = WeatherTabHost(forecastTexts(rule.activity), PhotoLoader(rule.activity), {}, {}, {}, {})
            AppContent(state, emptyMap(), emptySet(), false, session, host, "test", onExit = {}, banner = { seen = LocalForecastChartImages.current })
        }
        rule.waitForIdle()
        assertNotNull("the shell sees no shared image cache", seen)
    }

    /** The baseline profile journeys find the tabs by their test tags: the shell exposes them as resource IDs. */
    @OptIn(ExperimentalComposeUiApi::class)
    @Test fun theShellExposesTestTagsAsResourceIds() {
        rule.setContent { TodayWeatherShell(ShellState(Theme.LIGHT, "KR", Tab.HOURLY, "test"), {}, {}, {}) }
        rule.onNodeWithTag(ShellTags.tab(Tab.DAILY)).assertExists()
        rule.onRoot(useUnmergedTree = true).assert(SemanticsMatcher("a node exposes test tags as resource IDs") { node ->
            generateSequence(listOf(node)) { level -> level.flatMap { it.children }.takeIf { it.isNotEmpty() } }.flatten()
                .any { it.config.getOrElseNullable(SemanticsPropertiesAndroid.TestTagsAsResourceId) { null } == true }
        })
    }
}
