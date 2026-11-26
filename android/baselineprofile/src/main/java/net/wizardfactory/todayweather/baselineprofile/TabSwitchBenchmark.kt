package net.wizardfactory.todayweather.baselineprofile

import androidx.benchmark.macro.BaselineProfileMode
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Frame timing of tab switches (#3224) without ahead-of-time compilation and with the app's baseline profile, on the
 * benchmark build. Run with `./gradlew :baselineprofile:connectedBenchmarkReleaseAndroidTest` (android/README.md).
 */
@RunWith(AndroidJUnit4::class)
class TabSwitchBenchmark {
    @get:Rule val rule = MacrobenchmarkRule()

    @Test fun withoutCompilation() = switchTabs(CompilationMode.None())

    @Test fun withBaselineProfile() = switchTabs(CompilationMode.Partial(BaselineProfileMode.Require))

    private fun switchTabs(mode: CompilationMode) = rule.measureRepeated(
        packageName = PACKAGE,
        metrics = listOf(FrameTimingMetric()),
        compilationMode = mode,
        iterations = 5,
        setupBlock = { startOnForecast() },
    ) {
        visitTabs(rounds = 1)
    }
}
