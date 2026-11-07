package net.wizardfactory.todayweather

import android.app.Application
import android.content.Context
import android.os.Bundle
import androidx.test.runner.AndroidJUnitRunner
import kotlinx.serialization.json.JsonElement
import net.wizardfactory.todayweather.core.storage.PushRequest

/**
 * Runs device tests with [TestTodayWeatherApp]: the push token comes from the `token` argument and push
 * requests are recorded instead of sent, so no test reaches the production push server.
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
    override fun serverUrl() = "https://push.test.invalid"
    override fun tokenSource() = TokenSource { TestRunner.args.getString("token") }
    override fun pushTransport() = net.wizardfactory.todayweather.core.data.PushTransport { sent += it; 200 }
}

/** Body helper for assertions. */
fun PushRequest.records(): List<JsonElement> = (body as kotlinx.serialization.json.JsonArray).toList()
