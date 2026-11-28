package net.wizardfactory.todayweather.ui.shell

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import net.wizardfactory.todayweather.AnalyticsChoiceController
import net.wizardfactory.todayweather.AppContent
import net.wizardfactory.todayweather.MenuHandoffs
import net.wizardfactory.todayweather.PrivacyActions
import net.wizardfactory.todayweather.analytics.Analytics
import net.wizardfactory.todayweather.core.data.HttpGet
import net.wizardfactory.todayweather.core.data.StateAccess
import net.wizardfactory.todayweather.core.data.WeatherRepository
import net.wizardfactory.todayweather.core.data.WeatherSession
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.Location
import net.wizardfactory.todayweather.core.storage.Place
import net.wizardfactory.todayweather.core.storage.UnitSettings
import net.wizardfactory.todayweather.ui.forecast.PhotoLoader
import net.wizardfactory.todayweather.ui.forecast.WeatherTabHost
import net.wizardfactory.todayweather.ui.forecast.forecastTexts
import net.wizardfactory.todayweather.ui.settings.SettingsTags
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The menu's privacy rows and the screens reported (#2894, manual page 37): 이용 통계 shows 켜짐 or 꺼짐 and opens its
 * popup over the open menu (analytics default-on, 2026-11-24: 끄기 and 켜기 where it is on by default; the consent
 * question with 거부 / 철회 and 동의 in the opt-in regions; back changes nothing); a failed save shows the TodayWeather alert;
 * 광고 개인정보 선택 shows the form or the cannot-open message; the policy and terms open the page of the app's
 * language; `screen_view` gets the Cordova state names; with a banner, the menu and popups end at its top edge.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "ko-rKR-w384dp-h832dp-xhdpi")
class PrivacyMenuTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val project = File(System.getProperty("tw.projectDir")!!)
    private val seoulBody = File(project, "../core-domain/src/test/resources/corpus/inputs/kma-seoul.json").readText()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val seoul = Place(false, false, "회현동", "대한민국 서울특별시 중구 회현동", "KR", Location(37.56, 126.98))

    private class Memory(initial: AppState) : StateAccess {
        val flow = MutableStateFlow(initial)
        val state: StateFlow<AppState> = flow
        override fun current() = flow.value
        override fun change(update: (AppState) -> AppState) { flow.value = update(flow.value) }
    }

    @After fun stop() = scope.cancel()

    private val choice = MutableStateFlow(false)
    private var saves = true
    private val chosen = mutableListOf<Boolean>()
    private var formShows = false
    private val opened = mutableListOf<String>()
    private val screens = mutableListOf<String>()

    private fun controllerPrivacy(
        optIn: Boolean = false,
        saveScope: CoroutineScope = scope,
        commit: suspend (Boolean, Long) -> Analytics.ChoiceOutcome,
    ): PrivacyActions {
        var nextId = 0L
        val controller = AnalyticsChoiceController(
            beginChoice = { ++nextId },
            commitChoice = commit,
            scope = saveScope,
            writer = Dispatchers.Main.immediate,
        )
        return PrivacyActions(
            choice = choice,
            setAnalytics = controller::submit,
            optIn = optIn,
            saveFailure = controller.saveFailure,
            consumeFailure = controller::consumeFailure,
            onPopupOpened = controller::onPopupOpened,
            savingWithdrawal = controller.savingWithdrawal,
        ) { onUnavailable ->
            if (!formShows) onUnavailable()
        }
    }

    private fun show(
        banner: Boolean = false,
        optIn: Boolean = false,
        waitForSave: suspend () -> Unit = {},
        saveScope: CoroutineScope = scope,
    ) {
        val memory = Memory(AppState(places = listOf(seoul), placeIndex = 0, units = UnitSettings.defaults("KR")))
        val repository = WeatherRepository("https://server.test.invalid", null, HttpGet { _, _ -> seoulBody }, io = Dispatchers.Unconfined, compute = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        val privacy = controllerPrivacy(optIn = optIn, saveScope = saveScope) { value, _ ->
            chosen += value
            waitForSave()
            if (saves) {
                choice.value = value
                Analytics.ChoiceOutcome.APPLIED
            } else {
                Analytics.ChoiceOutcome.FAILED
            }
        }
        rule.setContent {
            val state by memory.state.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            AppContent(state, entries, loading, retry, session, host, "test", onExit = {}, handoffs = MenuHandoffs(openSystem = { opened += it }),
                privacy = privacy, onScreen = { screens += it },
                banner = if (banner) ({ Box(Modifier.fillMaxWidth().height(60.dp).testTag(FAKE_BANNER)) }) else null)
        }
        rule.waitForIdle()
    }

    private fun openMenu() {
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.waitForIdle()
    }

    private fun tapRow(row: MenuRow) {
        rule.onNodeWithTag(ShellTags.row(row)).performScrollTo().performClick()
        rule.waitForIdle()
    }

    private fun inRow(row: MenuRow, text: String) = rule.onNode(hasText(text) and hasAnyAncestor(hasTestTag(ShellTags.row(row))), useUnmergedTree = true)
    private fun popupShown() = rule.onAllNodes(hasTestTag(PopupTags.POPUP)).fetchSemanticsNodes().isNotEmpty()
    private fun menuOpen() = rule.onAllNodes(hasTestTag(ShellTags.MENU)).fetchSemanticsNodes().isNotEmpty()
    private fun back() = rule.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }.also { rule.waitForIdle() }
    private fun inPopup(text: String) = rule.onNode(hasText(text) and hasAnyAncestor(hasTestTag(PopupTags.POPUP)), useUnmergedTree = true)

    @Test
    fun theAnalyticsRowShowsTheChoiceAndItsPopupChangesIt() {
        show()
        openMenu()
        inRow(MenuRow.ANALYTICS, "이용 통계 · 꺼짐").assertExists()
        tapRow(MenuRow.ANALYTICS)
        assertTrue(menuOpen(), "the popup opens over the open menu")
        inPopup("이용 통계").assertExists()
        rule.onNodeWithText("이용 통계는 이 메뉴에서 끄지 않는 한 켜져 있으며", substring = true).assertExists()
        inPopup("끄기").assertExists()
        inPopup("켜기").performClick()
        rule.waitForIdle()
        assertEquals(listOf(true), chosen)
        assertFalse(popupShown())
        assertTrue(menuOpen())
        inRow(MenuRow.ANALYTICS, "이용 통계 · 켜짐").assertExists()
        tapRow(MenuRow.ANALYTICS)
        inPopup("끄기").performClick()
        rule.waitForIdle()
        assertEquals(listOf(true, false), chosen)
        inRow(MenuRow.ANALYTICS, "이용 통계 · 꺼짐").assertExists()
    }

    @Test
    fun inAnOptInRegionThePopupAsksForConsent() {
        show(optIn = true)
        openMenu()
        inRow(MenuRow.ANALYTICS, "이용 통계 · 꺼짐").assertExists()
        tapRow(MenuRow.ANALYTICS)
        inPopup("이용 통계").assertExists()
        rule.onNodeWithText("앱 개선을 위해 Google Firebase Analytics로", substring = true).assertExists()
        rule.onNodeWithText("동의하시겠습니까?", substring = true).assertExists()
        inPopup("거부 / 철회").assertExists()
        inPopup("동의").performClick()
        rule.waitForIdle()
        assertEquals(listOf(true), chosen)
        inRow(MenuRow.ANALYTICS, "이용 통계 · 켜짐").assertExists()
        tapRow(MenuRow.ANALYTICS)
        inPopup("거부 / 철회").performClick()
        rule.waitForIdle()
        assertEquals(listOf(true, false), chosen)
        inRow(MenuRow.ANALYTICS, "이용 통계 · 꺼짐").assertExists()
    }

    /** The consent popup in German and Chinese has no English text (AK 2026-11-24). */
    @Config(qualifiers = "de-rDE-w384dp-h832dp-xhdpi")
    @Test
    fun theConsentPopupInGerman() {
        show(optIn = true)
        openMenu()
        inRow(MenuRow.ANALYTICS, "Nutzungsanalyse · Aus").assertExists()
        tapRow(MenuRow.ANALYTICS)
        rule.onNodeWithText("Dürfen wir zur Verbesserung der App", substring = true).assertExists()
        inPopup("Ablehnen / Widerrufen").assertExists()
        inPopup("Zustimmen").performClick()
        rule.waitForIdle()
        assertEquals(listOf(true), chosen)
        inRow(MenuRow.ANALYTICS, "Nutzungsanalyse · An").assertExists()
    }

    @Config(qualifiers = "zh-rCN-w384dp-h832dp-xhdpi")
    @Test
    fun theConsentPopupInSimplifiedChinese() {
        show(optIn = true)
        openMenu()
        tapRow(MenuRow.ANALYTICS)
        rule.onNodeWithText("是否允许 Google Firebase Analytics", substring = true).assertExists()
        inPopup("拒绝 / 撤回").assertExists()
        inPopup("同意").assertExists()
    }

    @Config(qualifiers = "zh-rTW-w384dp-h832dp-xhdpi")
    @Test
    fun theConsentPopupInTraditionalChinese() {
        show(optIn = true)
        openMenu()
        tapRow(MenuRow.ANALYTICS)
        rule.onNodeWithText("是否允許 Google Firebase Analytics", substring = true).assertExists()
        inPopup("拒絕 / 撤回").assertExists()
        inPopup("同意").assertExists()
    }

    @Config(qualifiers = "en-rUS-w384dp-h832dp-xhdpi")
    @Test
    fun theRowAndPopupInEnglish() {
        show()
        openMenu()
        inRow(MenuRow.ANALYTICS, "Usage analytics · Off").assertExists()
        tapRow(MenuRow.ANALYTICS)
        rule.onNodeWithText("Usage analytics is on unless you turn it off in this menu", substring = true).assertExists()
        inPopup("Turn off").assertExists()
        inPopup("Turn on").performClick()
        rule.waitForIdle()
        inRow(MenuRow.ANALYTICS, "Usage analytics · On").assertExists()
    }

    @Test
    fun backClosesThePopupWithoutAChoice() {
        show()
        openMenu()
        tapRow(MenuRow.ANALYTICS)
        back()
        assertFalse(popupShown())
        assertTrue(menuOpen(), "Ionic's popup takes the back button before the menu")
        assertTrue(chosen.isEmpty())
    }

    @Test
    fun aFailedSaveShowsTheAlert() {
        saves = false
        show()
        openMenu()
        tapRow(MenuRow.ANALYTICS)
        inPopup("켜기").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("개인정보 설정을 완전히 적용하지 못했습니다. 다시 시도해 주세요.").assertExists()
        inPopup("TodayWeather").assertExists()
        inRow(MenuRow.ANALYTICS, "이용 통계 · 꺼짐").assertExists()
        inPopup("확인").performClick()
        rule.waitForIdle()
        assertFalse(popupShown())
    }

    @Test
    fun aWithdrawalShowsProgressUntilTheChoiceIsSaved() {
        val release = CompletableDeferred<Unit>()
        choice.value = true
        show(waitForSave = { release.await() })
        openMenu()
        tapRow(MenuRow.ANALYTICS)
        inPopup("끄기").performClick()
        rule.waitForIdle()

        val progress = rule.onNode(
            SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo) and
                hasAnyAncestor(hasTestTag(PopupTags.POPUP)),
            useUnmergedTree = true,
        )
        progress.assertExists()
        back()
        progress.assertExists()
        assertEquals(listOf(false), chosen)

        release.complete(Unit)
        rule.waitForIdle()
        progress.assertDoesNotExist()
        assertFalse(popupShown())
        inRow(MenuRow.ANALYTICS, "이용 통계 · 꺼짐").assertExists()
    }

    @Test
    fun aWithdrawalWriteExceptionClosesProgressAndShowsTheFailure() {
        val release = CompletableDeferred<Unit>()
        val uncaught = mutableListOf<Throwable>()
        choice.value = true
        show(
            waitForSave = { release.await(); error("preference editor failed") },
            saveScope = CoroutineScope(scope.coroutineContext + CoroutineExceptionHandler { _, failure -> uncaught += failure }),
        )
        openMenu()
        tapRow(MenuRow.ANALYTICS)
        inPopup("끄기").performClick()
        rule.waitForIdle()
        assertTrue(popupShown())

        release.complete(Unit)
        rule.waitForIdle()
        inPopup("TodayWeather").assertExists()
        rule.onNodeWithText("개인정보 설정을 완전히 적용하지 못했습니다. 다시 시도해 주세요.").assertExists()
        assertTrue(uncaught.isEmpty())
        inPopup("확인").performClick()
        rule.waitForIdle()
        assertFalse(popupShown())
    }

    /** #3238 AC2: popup closes while async setAnalytics runs off-main, then shows LOC_PRIVACY_SAVE_FAILED on false. */
    @Test
    fun anAsyncFailedSaveClosesThePopupAndShowsTheAlertWhenItSettles() {
        val pending = CompletableDeferred<Analytics.ChoiceOutcome>()
        val memory = Memory(AppState(places = listOf(seoul), placeIndex = 0, units = UnitSettings.defaults("KR")))
        val repository = WeatherRepository("https://server.test.invalid", null, HttpGet { _, _ -> seoulBody }, io = Dispatchers.Unconfined, compute = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        val privacy = controllerPrivacy(optIn = false) { value, _ -> chosen += value; pending.await() }
        rule.setContent {
            val state by memory.state.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            AppContent(state, entries, loading, retry, session, host, "test", onExit = {}, privacy = privacy)
        }
        rule.waitForIdle()
        openMenu()
        tapRow(MenuRow.ANALYTICS)
        inPopup("켜기").performClick()
        rule.waitForIdle()
        assertFalse(popupShown(), "popup closes immediately while save runs off-main")
        assertEquals(listOf(true), chosen)

        pending.complete(Analytics.ChoiceOutcome.FAILED)
        rule.waitForIdle()
        rule.onNodeWithText("개인정보 설정을 완전히 적용하지 못했습니다. 다시 시도해 주세요.").assertExists()
        inPopup("TodayWeather").assertExists()
    }

    /** #3238 CODEX-4: recreating AppContent while a failing analytics save is in flight still shows LOC_PRIVACY_SAVE_FAILED once. */
    @Test
    fun aFailedSaveShowsTheAlertAfterContentRecreation() {
        val pending = CompletableDeferred<Analytics.ChoiceOutcome>()
        val memory = Memory(AppState(places = listOf(seoul), placeIndex = 0, units = UnitSettings.defaults("KR")))
        val repository = WeatherRepository("https://server.test.invalid", null, HttpGet { _, _ -> seoulBody }, io = Dispatchers.Unconfined, compute = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        val privacy = controllerPrivacy(optIn = false) { value, _ -> chosen += value; pending.await() }
        val generation = MutableStateFlow(0)
        rule.setContent {
            val gen by generation.collectAsState()
            androidx.compose.runtime.key(gen) {
                val state by memory.state.collectAsState()
                val entries by repository.weather.collectAsState()
                val loading by repository.loading.collectAsState()
                val retry by session.retry.collectAsState()
                val context = LocalContext.current
                val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
                AppContent(state, entries, loading, retry, session, host, "test", onExit = {}, privacy = privacy)
            }
        }
        rule.waitForIdle()
        openMenu()
        tapRow(MenuRow.ANALYTICS)
        inPopup("켜기").performClick()
        rule.waitForIdle()
        assertFalse(popupShown())

        // Simulate Activity recreation while the save is still pending.
        generation.value = 1
        rule.waitForIdle()

        pending.complete(Analytics.ChoiceOutcome.FAILED)
        rule.waitForIdle()
        rule.onNodeWithText("개인정보 설정을 완전히 적용하지 못했습니다. 다시 시도해 주세요.").assertExists()
        inPopup("확인").performClick()
        rule.waitForIdle()
        assertFalse(popupShown())

        // Consumed failure must not reappear on another recreation.
        generation.value = 2
        rule.waitForIdle()
        rule.onNodeWithText("개인정보 설정을 완전히 적용하지 못했습니다. 다시 시도해 주세요.").assertDoesNotExist()
    }

    /** #3238 CODEX-4: reopening AnalyticsPopup while an earlier failing save is in flight suppresses the stale alert; a later failing choice still alerts. */
    @Test
    fun reopeningAnalyticsPopupSuppressesStaleInFlightFailure() {
        val firstSave = CompletableDeferred<Analytics.ChoiceOutcome>()
        val secondSave = CompletableDeferred<Analytics.ChoiceOutcome>()
        val memory = Memory(AppState(places = listOf(seoul), placeIndex = 0, units = UnitSettings.defaults("KR")))
        val repository = WeatherRepository("https://server.test.invalid", null, HttpGet { _, _ -> seoulBody }, io = Dispatchers.Unconfined, compute = Dispatchers.Unconfined)
        val session = WeatherSession(repository, scope, memory, { listOf("ko-KR") }, { null })
        var call = 0
        val privacy = controllerPrivacy(optIn = false) { value, _ ->
            chosen += value
            if (++call == 1) firstSave.await() else secondSave.await()
        }
        rule.setContent {
            val state by memory.state.collectAsState()
            val entries by repository.weather.collectAsState()
            val loading by repository.loading.collectAsState()
            val retry by session.retry.collectAsState()
            val context = LocalContext.current
            val host = WeatherTabHost(forecastTexts(context), PhotoLoader(context), { repository.cached(it) }, session::previous, session::next, {})
            AppContent(state, entries, loading, retry, session, host, "test", onExit = {}, privacy = privacy)
        }
        rule.waitForIdle()
        openMenu()
        tapRow(MenuRow.ANALYTICS)
        inPopup("켜기").performClick()
        rule.waitForIdle()
        // Reopen the analytics popup while save 1 is still pending.
        tapRow(MenuRow.ANALYTICS)
        firstSave.complete(Analytics.ChoiceOutcome.FAILED)
        rule.waitForIdle()
        rule.onNodeWithText("개인정보 설정을 완전히 적용하지 못했습니다. 다시 시도해 주세요.").assertDoesNotExist()
        inPopup("이용 통계").assertExists()

        // Choosing again (save 2) and failing must show LOC_PRIVACY_SAVE_FAILED.
        inPopup("켜기").performClick()
        rule.waitForIdle()
        secondSave.complete(Analytics.ChoiceOutcome.FAILED)
        rule.waitForIdle()
        rule.onNodeWithText("개인정보 설정을 완전히 적용하지 못했습니다. 다시 시도해 주세요.").assertExists()
    }

    @Test
    fun adPrivacyShowsTheFormOrTheMessage() {
        show()
        openMenu()
        tapRow(MenuRow.AD_PRIVACY)
        rule.onNodeWithText("광고 개인정보 선택 화면을 열 수 없습니다.", substring = true).assertExists()
        inPopup("확인").performClick()
        rule.waitForIdle()
        formShows = true
        tapRow(MenuRow.AD_PRIVACY)
        assertFalse(popupShown())
        assertTrue(menuOpen())
    }

    @Test
    fun thePolicyAndTermsOpenTheKoreanPages() {
        show()
        openMenu()
        tapRow(MenuRow.PRIVACY_POLICY)
        tapRow(MenuRow.TERMS)
        assertEquals(listOf("https://todayweather.ai/mobile/privacy.html", "https://todayweather.ai/mobile/terms.html"), opened)
        assertTrue(menuOpen(), "the rows leave the menu open")
    }

    @Config(qualifiers = "en-rUS-w384dp-h832dp-xhdpi")
    @Test
    fun otherLanguagesOpenTheEnglishPages() {
        show()
        openMenu()
        tapRow(MenuRow.PRIVACY_POLICY)
        assertEquals(listOf("https://todayweather.ai/mobile/privacy.en.html"), opened)
    }

    @Test
    fun screensCarryTheCordovaStateNames() {
        show()
        rule.onNodeWithTag(ShellTags.tab(net.wizardfactory.todayweather.core.domain.shell.Tab.DAILY)).performClick()
        rule.waitForIdle()
        openMenu()
        tapRow(MenuRow.UNITS)
        rule.onNodeWithTag(SettingsTags.row(0)).performClick()
        rule.waitForIdle()
        back()
        back()
        assertEquals(listOf("tab.forecast", "tab.dailyforecast", "units", "setting-radio", "units", "tab.dailyforecast"), screens)
    }

    @Test
    fun withABannerTheMenuAndPopupsEndAtItsTop() {
        show(banner = true)
        val banner = rule.onNodeWithTag(FAKE_BANNER).getBoundsInRoot()
        val tabBar = rule.onNodeWithTag(ShellTags.tab(net.wizardfactory.todayweather.core.domain.shell.Tab.HOURLY)).getBoundsInRoot()
        assertEquals(tabBar.bottom, banner.top, "the banner sits under the tab bar")
        openMenu()
        assertEquals(banner.top, rule.onNodeWithTag(ShellTags.MENU).getBoundsInRoot().bottom)
        tapRow(MenuRow.ANALYTICS)
        val popup = rule.onNodeWithTag(PopupTags.POPUP).getBoundsInRoot()
        assertEquals((banner.top.value - (popup.bottom.value - popup.top.value)) / 2, popup.top.value, 0.6f, "centered in the area above the banner")
    }

    private companion object {
        const val FAKE_BANNER = "test-banner"
    }
}
