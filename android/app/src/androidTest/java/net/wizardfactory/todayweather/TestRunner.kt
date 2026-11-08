package net.wizardfactory.todayweather

import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.test.runner.AndroidJUnitRunner
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.JsonElement
import net.wizardfactory.todayweather.core.storage.AppState
import net.wizardfactory.todayweather.core.storage.PushRequest

/**
 * Runs device tests with [TestTodayWeatherApp]: the push token comes from the `token` argument and push
 * requests are recorded instead of sent, so no test reaches the production push server. With `transport`
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
    }

    override fun serverUrl() = "https://push.test.invalid"
    override fun weatherPhotosUrl() = "" // no photo feed request from device tests
    override fun tokenSource() = TokenSource { TestRunner.args.getString("token") }
    override fun pushTransport() = net.wizardfactory.todayweather.core.data.PushTransport {
        sent += it
        if (TestRunner.args.getString("transport") == "hold") kotlinx.coroutines.awaitCancellation()
        200
    }
}

/** Body helper for assertions. */
fun PushRequest.records(): List<JsonElement> = (body as kotlinx.serialization.json.JsonArray).toList()
