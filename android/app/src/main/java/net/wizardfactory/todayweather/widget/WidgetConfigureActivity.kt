package net.wizardfactory.todayweather.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import net.wizardfactory.todayweather.AppLocale
import net.wizardfactory.todayweather.R
import net.wizardfactory.todayweather.TodayWeatherApp
import net.wizardfactory.todayweather.core.storage.AppState

class WidgetConfigureActivity : ComponentActivity() {
    override fun attachBaseContext(newBase: Context) = super.attachBaseContext(AppLocale.wrap(newBase))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        val result = Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
        setResult(RESULT_CANCELED, result)
        val provider = AppWidgetManager.getInstance(this).getAppWidgetInfo(id)?.provider
        val providers = listOf(CurrentReceiver::class.java, ForecastReceiver::class.java, ClockReceiver::class.java, AirReceiver::class.java)
        val receiver = providers.find { ComponentName(this, it) == provider }
        if (receiver == null) {
            finish()
            return
        }
        val app = application as TodayWeatherApp
        val previous = WidgetOptions.read(this, id)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val state by app.appState.state.collectAsState()
                    state?.let {
                        WidgetSettings(it, previous, receiver == ForecastReceiver::class.java || receiver == ClockReceiver::class.java,
                            receiver == CurrentReceiver::class.java, ::finish) { selected ->
                            WidgetOptions.save(this, id, selected)
                            WidgetRefresh.enqueue(this)
                            setResult(RESULT_OK, result)
                            finish()
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WidgetSettings(
    state: AppState, initial: WidgetOptions, forecast: Boolean, current: Boolean,
    cancel: () -> Unit, save: (WidgetOptions) -> Unit,
) {
    var manualRefresh by rememberSaveable { mutableStateOf(initial.manualRefresh) }
    var style by rememberSaveable { mutableStateOf(initial.style) }
    var pinned by rememberSaveable { mutableStateOf(initial.placeKey) }
    var daily by rememberSaveable { mutableStateOf(initial.daily) }
    var yesterday by rememberSaveable { mutableStateOf(initial.yesterday) }
    Column(Modifier.systemBarsPadding().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text(stringResource(R.string.widget_cfg_title), style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.widget_style_title), modifier = Modifier.padding(top = 16.dp))
        WidgetStyle.entries.forEach { option ->
            Choice(stringResource(option.label), style == option) { style = option }
        }
        Text(stringResource(R.string.widget_refresh_mode), modifier = Modifier.padding(top = 16.dp))
        Choice(stringResource(R.string.widget_refresh_auto), !manualRefresh) { manualRefresh = false }
        Choice(stringResource(R.string.widget_refresh_manual), manualRefresh) { manualRefresh = true }
        Text(stringResource(R.string.widget_cfg_place), modifier = Modifier.padding(top = 20.dp))
        Choice(stringResource(R.string.widget_cfg_follow), pinned == null) { pinned = null }
        for (place in state.places.filterNot { it.disable }) {
            val key = WidgetOptions.key(place)
            val name = if (place.currentPosition) stringResource(R.string.widget_cfg_position)
                else place.name?.takeIf { it.isNotBlank() } ?: place.address ?: place.location?.let { "${it.lat}, ${it.long}" }.orEmpty()
            Choice(name, pinned == key) { pinned = key }
        }
        if (pinned != null && WidgetOptions.resolve(state, pinned) == null) Text(stringResource(R.string.widget_cfg_missing))
        if (forecast) {
            Text(stringResource(R.string.widget_cfg_forecast), modifier = Modifier.padding(top = 16.dp))
            Choice(stringResource(R.string.widget_cfg_hourly), !daily) { daily = false }
            Choice(stringResource(R.string.widget_cfg_daily), daily) { daily = true }
        }
        if (current || forecast && daily) {
            Row(Modifier.fillMaxWidth().toggleable(yesterday, role = Role.Checkbox, onValueChange = { yesterday = it })
                .padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(yesterday, onCheckedChange = null)
                Text(stringResource(if (current) R.string.widget_cfg_compare else R.string.widget_cfg_yesterday), Modifier.padding(start = 12.dp))
            }
        }
        Text(stringResource(R.string.widget_cfg_visit), modifier = Modifier.padding(vertical = 12.dp), style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = cancel) { Text(stringResource(android.R.string.cancel)) }
            Button(onClick = { save(WidgetOptions(pinned, daily, yesterday, style, manualRefresh)) },
                enabled = pinned == null || WidgetOptions.resolve(state, pinned) != null) {
                Text(stringResource(R.string.widget_cfg_save))
            }
        }
    }
}

@Composable
private fun Choice(label: String, selected: Boolean, choose: () -> Unit) {
    Row(Modifier.fillMaxWidth().selectable(selected, role = Role.RadioButton, onClick = choose).padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected, onClick = null)
        Text(label, Modifier.padding(start = 12.dp))
    }
}
