package net.wizardfactory.todayweather

import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.test.runner.AndroidJUnitRunner
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import net.wizardfactory.todayweather.core.domain.start.StartGate
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.PushRequest
import net.wizardfactory.todayweather.ui.start.LocationPopupTags
import org.junit.rules.TestRule
import org.junit.runner.Description
import org.junit.runners.model.Statement

/**
 * Runs device tests with [TestTodayWeatherApp]: the push token comes from the `token` argument and push
 * requests are recorded instead of sent, so no test reaches the production push server. With `weather`
 * `production`, weather requests go to the build's server (TW_SERVER_URL). With `transport`
 * `hold`, a recorded request never gets an answer (it stays in flight). With `migration` `hold`, the data
 * migration of the process waits until a test releases it.
 */
class TestRunner : AndroidJUnitRunner() {
    override fun onCreate(arguments: Bundle?) {
        args = arguments ?: Bundle()
        super.onCreate(arguments)
    }

    override fun newApplication(cl: ClassLoader, className: String, context: Context): Application =
        super.newApplication(cl, TestTodayWeatherApp::class.java.name, context)

    companion object {
        @Volatile var args: Bundle = Bundle()
    }
}

class TestTodayWeatherApp : TodayWeatherApp() {
    val sent = java.util.Collections.synchronizedList(mutableListOf<PushRequest>())

    private val migrationGate = CompletableDeferred<Unit>()

    fun releaseMigration() {
        migrationGate.complete(Unit)
    }

    override suspend fun migrate(): AppState {
        if (TestRunner.args.getString("migration") == "hold") migrationGate.await()
        return super.migrate()
    }

    /** Entry intents in the order they were handled, each with whether the migration had finished by then. */
    val handled = java.util.Collections.synchronizedList(mutableListOf<Pair<Intent, Boolean>>())

    override fun onEntryIntent(intent: Intent) {
        handled += intent to migration.isCompleted
        super.onEntryIntent(intent)
    }

    /**
     * The production server only for a test that asks (`weather` `production`: the AN-08 render check, read-only weather
     * requests); push requests are recorded either way.
     */
    override fun serverUrl() = if (TestRunner.args.getString("weather") == "production") BuildConfig.SERVER_URL else "https://push.test.invalid"
    // Exercise five Google-style predictions offline during the window traversal.
    override fun placeSearch(): net.wizardfactory.todayweather.search.PlaceSearch? =
        if (argsForScreenWalk()) net.wizardfactory.todayweather.search.PlaceSearch {
            (1..5).map { net.wizardfactory.todayweather.search.Prediction("Search result $it", 0) }
        } else super.placeSearch()

    private fun argsForScreenWalk() = TestRunner.args.getString("screens") == "true"

    // A manual capture may read the production photo feed; ordinary device checks stay offline.
    override fun weatherPhotosUrl() = if (TestRunner.args.getString("manual") == "true" &&
        TestRunner.args.getString("weather") == "production" && TestRunner.args.getString("photos") == "feed")
        BuildConfig.WEATHER_PHOTOS_URL else ""
    override fun tokenSource() = TokenSource { TestRunner.args.getString("token") }
    override fun pushTransport() = net.wizardfactory.todayweather.core.data.PushTransport {
        sent += it
        if (TestRunner.args.getString("transport") == "hold") kotlinx.coroutines.awaitCancellation()
        200
    }
}

/** Past the start page (AN-10): `startVersion` stored, as on an install that has added a place. */
fun AppState.afterStart(): AppState = copy(cordovaExtras = cordovaExtras + ("startVersion" to StartGate.CLOSED))

/**
 * The saved state a device test of the tabs starts with, written before its activity opens: past the start page, with
 * [seed] applied (a new install shows S01 instead). Put it outside the compose rule (`RuleChain`).
 */
class StateRule(private val seed: (AppState) -> AppState = { it }) : TestRule {
    override fun apply(base: Statement, description: Description) = object : Statement() {
        override fun evaluate() {
            val app = ApplicationProvider.getApplicationContext<TestTodayWeatherApp>()
            runBlocking {
                app.migration.await()
                app.appState.dataStore.updateData { seed(it.afterStart()) }
            }
            base.evaluate()
        }
    }
}

/**
 * Without an enabled place the weather pages ask how to start (O02, AN-10): waits for it, then Android back answers
 * "search" and the Locations tab shows, so a test of the shell goes on without a place. S02 then focuses its search
 * field (AN-11); the keyboard is closed.
 */
fun AndroidComposeTestRule<*, *>.closeStartChoice() {
    waitUntil(30_000) { onAllNodes(hasTestTag(LocationPopupTags.START_CHOICE)).fetchSemanticsNodes().isNotEmpty() }
    Espresso.pressBack()
    waitForIdle()
    Thread.sleep(500)
    Espresso.closeSoftKeyboard()
    waitForIdle()
}

/** Body helper for assertions. */
fun PushRequest.records(): List<JsonElement> = (body as kotlinx.serialization.json.JsonArray).toList()
