package net.wizardfactory.todayweather.ui.settings

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.core.data.WeatherEntry
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.cityRecord
import net.wizardfactory.todayweather.core.domain.WeatherConverter
import net.wizardfactory.todayweather.core.domain.YesterdayText
import net.wizardfactory.todayweather.core.domain.chart.ChartMetrics
import net.wizardfactory.todayweather.core.domain.chart.DailyChart
import net.wizardfactory.todayweather.core.domain.chart.HourlyChart
import net.wizardfactory.todayweather.core.domain.forecast.ForecastPage
import net.wizardfactory.todayweather.core.domain.forecast.ForecastScope
import net.wizardfactory.todayweather.core.domain.forecast.ForecastType
import net.wizardfactory.todayweather.core.domain.forecast.PageUnits
import net.wizardfactory.todayweather.core.domain.settings.About
import net.wizardfactory.todayweather.core.domain.shell.Tab
import net.wizardfactory.todayweather.core.domain.shell.Theme
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.Settings
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.chart.ImageDiff
import net.wizardfactory.todayweather.ui.chart.Pixels
import net.wizardfactory.todayweather.ui.forecast.ForecastTags
import net.wizardfactory.todayweather.ui.forecast.WeatherPage
import net.wizardfactory.todayweather.ui.forecast.WeatherPageContent
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.shell.BarButton
import net.wizardfactory.todayweather.ui.shell.Glyphs
import net.wizardfactory.todayweather.ui.shell.HeaderBar
import net.wizardfactory.todayweather.ui.shell.IonicAlert
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.shell.ShellColors
import net.wizardfactory.todayweather.ui.shell.ShellState
import net.wizardfactory.todayweather.ui.shell.ShellTags
import net.wizardfactory.todayweather.ui.shell.SideMenu
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The native settings pages and the pages they change against the Cordova build (#2891 AC3), captured by
 * tools/settings-reference/capture.sh at 384×832 dp and density 2 in settings-reference/<lang>: S07 (manual page 25)
 * in each theme and after 온도단위 F, every S08 list (pages 26, 28 and 29) and the theme list in each theme, S03 after the
 * unit change and in the dark and photo themes (pages 27, 30 and 31, every block), and the About popup over the menu
 * scrolled to its end (page 36); S07 and About in English. Each comparison passes within the tolerance recorded for it in
 * settings-reference/tolerances.json. Renders and overlays go to build/settings-compare/.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
class SettingsScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private var matrixSize: String? = null
    private var matrixLang = "ko-KR"
    private val dimensions get() = matrixSize?.split('x')?.map(String::toDouble) ?: listOf(384.0, 832.0)
    private val references get() = File(project, matrixSize?.let { "src/test/resources/parity-reference/$it/settings" }
        ?: "src/test/resources/settings-reference")
    private fun bodySize(lang: String): Pair<Float, Float> {
        if (matrixSize == null) return 384f to 762f
        val view = Json.parseToJsonElement(File(references, "$lang/viewport.json").readText()).jsonObject["webView"]!!.jsonObject
        return view.num("width").toFloat() to view.num("height").toFloat()
    }
    private val inputs = File(project, "../core-domain/src/test/resources/corpus/inputs")
    private val tolerances get() = Json.parseToJsonElement(File(references, "tolerances.json").takeIf { it.isFile }?.readText() ?: "{}").jsonObject
    private val out = File(project, "build/settings-compare").apply { mkdirs() }
    private val kr = UnitSettings.defaults("KR")

    @Test fun units() = checked { page("units", SettingsRoutes.UNITS) }
    @Test fun unitsFahrenheit() = checked { page("units-f", SettingsRoutes.UNITS, units = kr.copy(temperatureUnit = "F")) }
    @Test fun unitsDark() = checked { page("units-dark", SettingsRoutes.UNITS, theme = "dark") }
    @Test fun unitsPhoto() = checked { page("units-photo", SettingsRoutes.UNITS, theme = "photo") }
    @Test fun unitsOld() = checked { page("units-old", SettingsRoutes.UNITS, theme = "old") }
    @Test fun unitLists() = checked { listOf("temperatureUnit", "windSpeedUnit", "pressureUnit", "distanceUnit", "precipitationUnit", "airUnit")
        .forEach { page("radio-$it", SettingsRoutes.list(it)) } }
    @Test fun temperatureFahrenheit() = checked { page("radio-temperatureUnit-f", SettingsRoutes.list("temperatureUnit"), units = kr.copy(temperatureUnit = "F")) }
    @Test fun settingLists() = checked { listOf("startupPage", "refreshInterval", "theme").forEach { page("radio-$it", SettingsRoutes.list(it)) } }
    @Test fun themeLists() = checked { listOf("dark", "photo", "old").forEach { page("radio-theme-$it", SettingsRoutes.list("theme"), theme = it) } }
    @Test fun about() = checked { about("ko-KR", "KR") }
    @Test fun hourlyFahrenheit() = checked { weather("hourly-f", "kma-seoul-f", Theme.LIGHT, fahrenheit = true) }
    @Test fun hourlyDark() = checked { weather("hourly-dark", "kma-seoul", Theme.DARK) }
    @Test fun hourlyPhoto() = checked { weather("hourly-photo", "kma-seoul", Theme.PHOTO) }

    @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    @Test fun unitsEnglish() = checked { page("units", SettingsRoutes.UNITS, units = UnitSettings.defaults("US"), lang = "en-US") }

    @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    @Test fun aboutEnglish() = checked { about("en-US", "US") }

    private fun matrix(size: String, lang: String, kind: String, theme: Theme = Theme.LIGHT, type: ForecastType = ForecastType.SHORT) = checked {
        matrixSize = size
        matrixLang = lang
        when (kind) {
            "pages" -> {
                page("units", SettingsRoutes.UNITS, lang = lang)
                page("radio-temperatureUnit", SettingsRoutes.list("temperatureUnit"), lang = lang)
                listOf("dark", "photo", "old").forEach { page("units-$it", SettingsRoutes.UNITS, theme = it, lang = lang) }
            }
            "about" -> about(lang, "KR")
            "weather" -> weather("${if (type == ForecastType.SHORT) "hourly" else "daily"}-${theme.name.lowercase()}",
                "kma-seoul", theme, type = type, lang = lang)
        }
    }

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384KoreanPages() = matrix("384x832", "ko-KR", "pages")

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384KoreanAbout() = matrix("384x832", "ko-KR", "about")

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384KoreanDarkShort() = matrix("384x832", "ko-KR", "weather", Theme.DARK, ForecastType.SHORT)

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384KoreanDarkMid() = matrix("384x832", "ko-KR", "weather", Theme.DARK, ForecastType.MID)

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384KoreanPhotoShort() = matrix("384x832", "ko-KR", "weather", Theme.PHOTO, ForecastType.SHORT)

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384KoreanPhotoMid() = matrix("384x832", "ko-KR", "weather", Theme.PHOTO, ForecastType.MID)

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384KoreanOldShort() = matrix("384x832", "ko-KR", "weather", Theme.OLD, ForecastType.SHORT)

    @Test @Config(qualifiers = "ko-rKR-w384dp-h2600dp-xhdpi")
    fun nominal384KoreanOldMid() = matrix("384x832", "ko-KR", "weather", Theme.OLD, ForecastType.MID)

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384EnglishPages() = matrix("384x832", "en-US", "pages")

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384EnglishAbout() = matrix("384x832", "en-US", "about")

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384EnglishDarkShort() = matrix("384x832", "en-US", "weather", Theme.DARK, ForecastType.SHORT)

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384EnglishDarkMid() = matrix("384x832", "en-US", "weather", Theme.DARK, ForecastType.MID)

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384EnglishPhotoShort() = matrix("384x832", "en-US", "weather", Theme.PHOTO, ForecastType.SHORT)

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384EnglishPhotoMid() = matrix("384x832", "en-US", "weather", Theme.PHOTO, ForecastType.MID)

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384EnglishOldShort() = matrix("384x832", "en-US", "weather", Theme.OLD, ForecastType.SHORT)

    @Test @Config(qualifiers = "en-rUS-w384dp-h2600dp-xhdpi")
    fun nominal384EnglishOldMid() = matrix("384x832", "en-US", "weather", Theme.OLD, ForecastType.MID)

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360KoreanPages() = matrix("360x780", "ko-KR", "pages")

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360KoreanAbout() = matrix("360x780", "ko-KR", "about")

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360KoreanDarkShort() = matrix("360x780", "ko-KR", "weather", Theme.DARK, ForecastType.SHORT)

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360KoreanDarkMid() = matrix("360x780", "ko-KR", "weather", Theme.DARK, ForecastType.MID)

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360KoreanPhotoShort() = matrix("360x780", "ko-KR", "weather", Theme.PHOTO, ForecastType.SHORT)

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360KoreanPhotoMid() = matrix("360x780", "ko-KR", "weather", Theme.PHOTO, ForecastType.MID)

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360KoreanOldShort() = matrix("360x780", "ko-KR", "weather", Theme.OLD, ForecastType.SHORT)

    @Test @Config(qualifiers = "ko-rKR-w360dp-h2600dp-xhdpi")
    fun nominal360KoreanOldMid() = matrix("360x780", "ko-KR", "weather", Theme.OLD, ForecastType.MID)

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360EnglishPages() = matrix("360x780", "en-US", "pages")

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360EnglishAbout() = matrix("360x780", "en-US", "about")

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360EnglishDarkShort() = matrix("360x780", "en-US", "weather", Theme.DARK, ForecastType.SHORT)

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360EnglishDarkMid() = matrix("360x780", "en-US", "weather", Theme.DARK, ForecastType.MID)

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360EnglishPhotoShort() = matrix("360x780", "en-US", "weather", Theme.PHOTO, ForecastType.SHORT)

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360EnglishPhotoMid() = matrix("360x780", "en-US", "weather", Theme.PHOTO, ForecastType.MID)

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360EnglishOldShort() = matrix("360x780", "en-US", "weather", Theme.OLD, ForecastType.SHORT)

    @Test @Config(qualifiers = "en-rUS-w360dp-h2600dp-xhdpi")
    fun nominal360EnglishOldMid() = matrix("360x780", "en-US", "weather", Theme.OLD, ForecastType.MID)

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412KoreanPages() = matrix("412x892", "ko-KR", "pages")

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412KoreanAbout() = matrix("412x892", "ko-KR", "about")

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412KoreanDarkShort() = matrix("412x892", "ko-KR", "weather", Theme.DARK, ForecastType.SHORT)

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412KoreanDarkMid() = matrix("412x892", "ko-KR", "weather", Theme.DARK, ForecastType.MID)

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412KoreanPhotoShort() = matrix("412x892", "ko-KR", "weather", Theme.PHOTO, ForecastType.SHORT)

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412KoreanPhotoMid() = matrix("412x892", "ko-KR", "weather", Theme.PHOTO, ForecastType.MID)

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412KoreanOldShort() = matrix("412x892", "ko-KR", "weather", Theme.OLD, ForecastType.SHORT)

    @Test @Config(qualifiers = "ko-rKR-w412dp-h2600dp-xhdpi")
    fun nominal412KoreanOldMid() = matrix("412x892", "ko-KR", "weather", Theme.OLD, ForecastType.MID)

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412EnglishPages() = matrix("412x892", "en-US", "pages")

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412EnglishAbout() = matrix("412x892", "en-US", "about")

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412EnglishDarkShort() = matrix("412x892", "en-US", "weather", Theme.DARK, ForecastType.SHORT)

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412EnglishDarkMid() = matrix("412x892", "en-US", "weather", Theme.DARK, ForecastType.MID)

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412EnglishPhotoShort() = matrix("412x892", "en-US", "weather", Theme.PHOTO, ForecastType.SHORT)

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412EnglishPhotoMid() = matrix("412x892", "en-US", "weather", Theme.PHOTO, ForecastType.MID)

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412EnglishOldShort() = matrix("412x892", "en-US", "weather", Theme.OLD, ForecastType.SHORT)

    @Test @Config(qualifiers = "en-rUS-w412dp-h2600dp-xhdpi")
    fun nominal412EnglishOldMid() = matrix("412x892", "en-US", "weather", Theme.OLD, ForecastType.MID)

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320KoreanPages() = matrix("320x694", "ko-KR", "pages")

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320KoreanAbout() = matrix("320x694", "ko-KR", "about")

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320KoreanDarkShort() = matrix("320x694", "ko-KR", "weather", Theme.DARK, ForecastType.SHORT)

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320KoreanDarkMid() = matrix("320x694", "ko-KR", "weather", Theme.DARK, ForecastType.MID)

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320KoreanPhotoShort() = matrix("320x694", "ko-KR", "weather", Theme.PHOTO, ForecastType.SHORT)

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320KoreanPhotoMid() = matrix("320x694", "ko-KR", "weather", Theme.PHOTO, ForecastType.MID)

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320KoreanOldShort() = matrix("320x694", "ko-KR", "weather", Theme.OLD, ForecastType.SHORT)

    @Test @Config(qualifiers = "ko-rKR-w320dp-h2600dp-xhdpi")
    fun nominal320KoreanOldMid() = matrix("320x694", "ko-KR", "weather", Theme.OLD, ForecastType.MID)

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320EnglishPages() = matrix("320x694", "en-US", "pages")

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320EnglishAbout() = matrix("320x694", "en-US", "about")

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320EnglishDarkShort() = matrix("320x694", "en-US", "weather", Theme.DARK, ForecastType.SHORT)

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320EnglishDarkMid() = matrix("320x694", "en-US", "weather", Theme.DARK, ForecastType.MID)

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320EnglishPhotoShort() = matrix("320x694", "en-US", "weather", Theme.PHOTO, ForecastType.SHORT)

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320EnglishPhotoMid() = matrix("320x694", "en-US", "weather", Theme.PHOTO, ForecastType.MID)

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320EnglishOldShort() = matrix("320x694", "en-US", "weather", Theme.OLD, ForecastType.SHORT)

    @Test @Config(qualifiers = "en-rUS-w320dp-h2600dp-xhdpi")
    fun nominal320EnglishOldMid() = matrix("320x694", "en-US", "weather", Theme.OLD, ForecastType.MID)

    private var state by mutableStateOf(AppState())
    private var route by mutableStateOf("")

    /** A settings page from its top to 20 dp under its list, as captured. */
    private fun page(name: String, to: String, units: UnitSettings = kr, theme: String = "light", lang: String = "ko-KR") {
        state = AppState(units = units, settings = Settings(theme = theme))
        if (route == "") {
            route = to
            rule.setContent {
                val texts = forecastTexts(LocalContext.current)
                Box(Modifier.size(bodySize(lang).first.dp, bodySize(lang).second.dp).testTag(ROOT)) {
                    SettingsScreen(route, state, Theme.of(state.settings.theme), texts, onBack = {}, onUnit = {}, onChoose = { _, _ -> })
                }
            }
        } else {
            route = to
        }
        rule.waitForIdle()
        compare("$lang/$name", "$lang/$name.png", rule.onNodeWithTag(ROOT).captureToImage().asAndroidBitmap().toPixels(), crop = true)
    }

    /** The About popup over the menu scrolled to its end, whole (the WebView's 384×762 dp). */
    private fun about(lang: String, region: String) {
        var open by mutableStateOf(false)
        rule.setContent {
            val texts = forecastTexts(LocalContext.current)
            Box(Modifier.size(bodySize(lang).first.dp, bodySize(lang).second.dp).testTag(ROOT)) {
                SideMenu(ShellState(Theme.LIGHT, region, Tab.HOURLY, "1.1.1", mapOf(MenuRow.STARTUP_PAGE to texts["LOC_HOURLY_FORECAST"],
                    MenuRow.REFRESH_INTERVAL to texts["LOC_MANUAL"], MenuRow.THEME to texts["LOC_LIGHT_THEME"],
                    MenuRow.ANALYTICS to LocalContext.current.getString(R.string.LOC_ANALYTICS_DISABLED)))) {}
                if (open) About { texts[it] }.let { a -> IonicAlert(a.title, a.lines, a.ok, onClose = {}) }
            }
        }
        rule.onNodeWithTag(ShellTags.row(MenuRow.ABOUT)).performScrollTo()
        open = true
        rule.waitForIdle()
        compare("$lang/about", "$lang/about.png", rule.onNodeWithTag(ROOT).captureToImage().asAndroidBitmap().toPixels(), crop = false)
    }

    /** Every block of S03 after the settings change, with the shell's bar over the header block, as captured. */
    private fun weather(name: String, fixture: String, theme: Theme, fahrenheit: Boolean = false,
        type: ForecastType = ForecastType.SHORT, lang: String = "ko-KR") {
        val page = if (type == ForecastType.SHORT) "hourly" else "daily"
        val record = Json.parseToJsonElement(File(references, "$lang/$name/$page.json").readText()).jsonObject
        val photo = BitmapFactory.decodeFile(File(project, "src/test/resources/settings-reference/photo.png").path).asImageBitmap()
        rule.setContent {
            val texts = forecastTexts(LocalContext.current)
            val metrics = ChartMetrics(dimensions[0], dimensions[1])
            val scope = ForecastScope(type, metrics, fahrenheit, theme == Theme.PHOTO,
                YesterdayText(texts["LOC_SAME_AS_YESTERDAY"], texts["LOC_THAN_YESTERDAY"]), expandShortChart = false)
            scope.open(city(fixture, photo = theme == Theme.PHOTO), 1, hasPush = true)
            val model = ForecastPage(scope, PageUnits(if (fahrenheit) "F" else "C", "m/s", "hPa", "km", "mm", "airkorea"), texts)
            val content = WeatherPageContent(type, model, metrics,
                if (type == ForecastType.SHORT) HourlyChart.build(scope.chartPlace!!, metrics, texts, "mm", "m/s") else null,
                if (type == ForecastType.MID) DailyChart.build(scope.chartPlace!!, metrics, texts, "mm") else null)
            Box(Modifier.size(dimensions[0].toFloat().dp, 2600.dp)) {
                WeatherPage(content, theme, photo = if (theme == Theme.PHOTO) photo else null, photoGradient = theme == Theme.PHOTO, expanded = false,
                    onToggleExpanded = {}, onPrevious = {}, onNext = {}, onAction = {})
                val colors = ShellColors.of(theme, if (type == ForecastType.SHORT) Tab.HOURLY else Tab.DAILY)
                HeaderBar(colors, model.title, onMenu = {}) {
                    BarButton(Glyphs.NOTIFICATIONS, colors, {}, padding = 4.dp)
                    BarButton(Glyphs.SHARE, colors, {}, Modifier.padding(end = 4.dp), padding = 4.dp)
                }
            }
        }
        rule.waitForIdle()
        for (block in record["blocks"]!!.jsonArray.map { it.jsonObject }) {
            val i = block["index"]!!.jsonPrimitive.content.toInt()
            val native = rule.onNodeWithTag(ForecastTags.block(i)).captureToImage().asAndroidBitmap().toPixels()
            compare("$lang/$name-$i", "$lang/$name/$page-$i.png", native, crop = block["hidden"] != null)
        }
    }

    private val failures = mutableListOf<String>()

    /** [native] against the capture [file]; [crop] cuts the native image to the capture's height (a page's list, `hidden`). */
    private fun compare(name: String, file: String, native: Pixels, crop: Boolean) {
        val cordova = ImageIO.read(File(references, file)).toPixels()
        val shown = if (crop) native.crop(0, 0, native.width, minOf(native.height, cordova.height)) else native
        val diff = ImageDiff.of(shown, cordova)
        val base = (matrixSize?.let { "$it-" } ?: "") + name.replace('/', '-')
        ImageIO.write(shown.toBufferedImage(), "png", File(out, "$base-native.png"))
        ImageIO.write(ImageDiff.overlay(shown, cordova).toBufferedImage(), "png", File(out, "$base-diff.png"))
        println("settings-compare ${matrixSize ?: "historical"}/$name native=${shown.width}x${shown.height} cordova=${cordova.width}x${cordova.height} $diff")
        val limit = tolerances["cases"]?.jsonObject?.get(name)?.jsonObject
        val margin = tolerances["margin"]?.jsonObject
        if (limit == null || margin == null) {
            failures += "$name: no recorded tolerance, $diff"
        } else if (shown.width != cordova.width || diff.heightDifference > limit.num("heightDifference") + margin.num("heightDifference") ||
            diff.strong > limit.num("strong") + margin.num("strong") || diff.mean > limit.num("mean") + margin.num("mean")) {
            failures += "$name: $diff, recorded $limit"
        }
    }

    /** Runs [comparisons], then fails with every comparison over its tolerance. */
    private fun checked(comparisons: () -> Unit) {
        comparisons()
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    /** 회현동 (kma-seoul) as the capture added it, with the feed's photo in the photo theme (photo.png as a data URL there). */
    private fun city(fixture: String, photo: Boolean): JsonObject {
        val converted = WeatherConverter.convert(Json.parseToJsonElement(File(inputs, "$fixture.json").readText()))!!
        val saved = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98), photo = if (photo) "photo.png" else null)
        return cityRecord(saved, WeatherEntry(WeatherRepository.merge(null, converted), 0))
    }

    private fun JsonObject.num(k: String) = this[k]!!.jsonPrimitive.double
    private fun Bitmap.toPixels() = Pixels(width, height, IntArray(width * height).also { getPixels(it, 0, width, 0, 0, width, height) })
    private fun BufferedImage.toPixels() = Pixels(width, height, getRGB(0, 0, width, height, null, 0, width))
    private fun Pixels.toBufferedImage() = BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB).apply { setRGB(0, 0, width, height, argb, 0, width) }

    private companion object {
        const val ROOT = "settings-compare-root"
    }
}
