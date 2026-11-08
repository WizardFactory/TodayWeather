package net.wizardfactory.todayweather

import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider

/** Entry point. AN-07 replaces this empty screen with the app shell. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ViewModelProvider(this)[OpenedModel::class.java]
        setContent {
            MaterialTheme {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(stringResource(R.string.app_name))
                }
            }
        }
    }
}

/**
 * Created once per app open, like the Cordova app's web page: kept across configuration changes, new after the
 * activity finished or the process ended.
 */
class OpenedModel(app: Application) : AndroidViewModel(app) {
    init {
        (app as TodayWeatherApp).onOpened()
    }
}
