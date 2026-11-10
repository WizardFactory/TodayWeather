package net.wizardfactory.todayweather

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.Browser
import android.webkit.WebSettings
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.Intents.intended
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction
import androidx.test.espresso.intent.matcher.IntentMatchers.hasCategories
import androidx.test.espresso.intent.matcher.IntentMatchers.hasData
import androidx.test.espresso.intent.matcher.IntentMatchers.hasExtra
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.net.URLEncoder
import net.wizardfactory.todayweather.core.domain.settings.Handoffs
import net.wizardfactory.todayweather.core.storage.DeviceIdentity
import net.wizardfactory.todayweather.ui.shell.MenuRow
import net.wizardfactory.todayweather.ui.shell.PopupTags
import net.wizardfactory.todayweather.ui.shell.ShellTags
import org.hamcrest.Matchers.allOf
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.rules.RuleChain
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The menu's hand-offs and About on an emulator (#2891 AC2), run by tools/emulator/run-settings-handoffs.sh offline:
 * 널스쿨 풍향 opens the browser on the wind map, 의견보내기 the mail app with the Cordova mail, 응원리뷰쓰기 the store on the
 * app's page (required with `-e store present`, on an image with the Play Store), each with the intent the Cordova build
 * sent (InAppBrowser `_system`, the WebView's `mailto:`); About opens over the menu in the app's language. The app the
 * system resolves must come to the front; on an image without one nothing opens and the app stays, as the Cordova build
 * did. The screen is captured to the app's files (ac2/).
 */
@RunWith(AndroidJUnit4::class)
class SettingsHandoffTest {
    val rule = createAndroidComposeRule<MainActivity>()

    // Past the start page without a place: the weather pages ask how to start (O02), and the tests go on from Locations.
    @get:Rule val chain: RuleChain = RuleChain.outerRule(StateRule()).around(rule)

    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val app get() = rule.activity.application as TestTodayWeatherApp
    private val pkg = "net.wizardfactory.todayweather"

    @Before fun record() = Intents.init()
    @Before fun locations() = rule.closeStartChoice()
    @After fun release() = Intents.release()

    private fun menu(row: MenuRow) {
        rule.waitUntil(30_000) { app.appState.current() != null }
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.MENU_BUTTON).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(ShellTags.row(row)).performScrollTo().performClick()
        rule.waitForIdle()
    }

    /**
     * The app the system opens a VIEW of [uri] with ([browsable]: with CATEGORY_BROWSABLE); null without one. Asked as
     * the shell, which sees every package (the app's own query would see only what its manifest declares).
     */
    private fun handler(uri: String, browsable: Boolean = false): String? {
        val category = if (browsable) " -c android.intent.category.BROWSABLE" else ""
        val answer = shell("cmd package resolve-activity --brief -a android.intent.action.VIEW$category -d $uri").trim().lines().last()
        return answer.substringBefore('/').takeIf { '/' in answer }
    }

    /** Waits until an activity of [pkg] is in front (`dumpsys activity activities`), then captures the screen as [name]. */
    private fun front(pkg: String, name: String) {
        val deadline = System.currentTimeMillis() + 20_000
        var resumed = ""
        while (System.currentTimeMillis() < deadline) {
            resumed = shell("dumpsys activity activities").lines().firstOrNull { "ResumedActivity" in it }.orEmpty()
            if (" $pkg/" in resumed) break
            Thread.sleep(500)
        }
        capture(name)
        assertTrue("$pkg in front: $resumed", " $pkg/" in resumed)
    }

    /** The app for a VIEW of [uri], stopped first so that it opens afresh (an earlier run may have left its task). */
    private fun fresh(uri: String, browsable: Boolean = false): String? = handler(uri, browsable)?.also { shell("am force-stop $it") }

    @Test
    fun nullschoolOpensTheBrowserOnTheWindMap() {
        assumeTrue("the row shows in region KR only", AppLocale.region() == "KR")
        val browser = fresh("https://earth.nullschool.net/")
        menu(MenuRow.NULLSCHOOL_WIND)
        intended(allOf(hasAction(Intent.ACTION_VIEW), hasData(Uri.parse(Handoffs.NULLSCHOOL)), hasExtra(Browser.EXTRA_APPLICATION_ID, pkg)))
        front(browser ?: pkg, if (browser != null) "nullschool" else "nullschool-no-browser")
    }

    @Test
    fun feedbackOpensTheMailAppWithTheCordovaMail() {
        assertTrue("the build has the feedback address (TW_MAIL_TO)", BuildConfig.MAIL_TO.isNotEmpty())
        val mailer = fresh("mailto:feedback@example.com", browsable = true)
        menu(MenuRow.SEND_FEEDBACK)
        val context = rule.activity
        val body = "\n====================\nApp Version : ${BuildConfig.VERSION_NAME}\nUUID : ${DeviceIdentity.deviceId(context)}\n" +
            "UA : ${WebSettings.getDefaultUserAgent(context)}\n====================\n"
        val mail = "mailto:${BuildConfig.MAIL_TO}?subject=${context.getString(R.string.LOC_SEND_FEEDBACK)}&body=${Handoffs.encodeUriComponent(body)}"
        assertEquals("encodeURIComponent and URLEncoder agree but for spaces and the marks JavaScript keeps",
            URLEncoder.encode(body, "UTF-8").replace("+", "%20").replace("%21", "!").replace("%27", "'").replace("%28", "(").replace("%29", ")")
                .replace("%7E", "~"), Handoffs.encodeUriComponent(body))
        intended(allOf(hasAction(Intent.ACTION_VIEW), hasCategories(setOf(Intent.CATEGORY_BROWSABLE)), hasData(Uri.parse(mail))))
        front(mailer ?: pkg, if (mailer != null) "feedback" else "feedback-no-mail-app")
    }

    @Test
    fun rateOpensTheStoreOnTheAppsPage() {
        val store = fresh("market://details?id=$pkg")
        menu(MenuRow.RATE)
        intended(allOf(hasAction(Intent.ACTION_VIEW), hasData(Uri.parse(Handoffs.STORE)), hasExtra(Browser.EXTRA_APPLICATION_ID, pkg)))
        if (TestRunner.args.getString("store") != "present") {
            // Without a store for market: links nothing opens, as the Cordova build's InAppBrowser caught it; the app stays.
            assumeTrue("an image without the Play Store: run with -e store present on one that has it", store == null)
            front(pkg, "rate-no-store")
            return
        }
        assertEquals("com.android.vending", store)
        front(store!!, "rate")
    }

    @Test
    fun aboutOpensOverTheMenuInTheAppsLanguage() {
        menu(MenuRow.ABOUT)
        val context = rule.activity
        fun inPopup(text: String) = rule.onNode(hasText(text, substring = true) and hasAnyAncestor(hasTestTag(PopupTags.POPUP)), useUnmergedTree = true)
        inPopup(context.getString(R.string.LOC_TODAYWEATHER)).assertExists()
        inPopup(context.getString(R.string.LOC_WEATHER_INFORMATION) + " : " + context.getString(R.string.LOC_KOREA_METEOROLOGICAL_ADMINISTRATION)).assertExists()
        inPopup(context.getString(R.string.LOC_AQI_INFORMATION) + " : " + context.getString(R.string.LOC_KOREA_ENVIRONMENT_CORPORATION)).assertExists()
        inPopup(context.getString(R.string.LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS)).assertExists()
        capture("about-${AppLocale.catalogLocale().language}")
        rule.onNodeWithTag(PopupTags.BUTTON).performClick()
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithTagCount(PopupTags.POPUP) == 0)
        assertTrue("the menu stays open", rule.onAllNodesWithTagCount(ShellTags.MENU) == 1)
    }

    private fun androidx.compose.ui.test.junit4.AndroidComposeTestRule<*, *>.onAllNodesWithTagCount(tag: String) =
        onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().size

    private fun shell(command: String): String =
        ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(command)).use { it.readBytes().decodeToString() }

    private fun capture(name: String) {
        Thread.sleep(800)
        val shot = instrumentation.uiAutomation.takeScreenshot() ?: return
        val dir = File(rule.activity.getExternalFilesDir(null), "ac2").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { shot.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
