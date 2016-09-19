package net.wizardfactory.todayweather.widget;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;

import net.wizardfactory.todayweather.MainActivity;
import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.Provider.AirQualityIndex;
import net.wizardfactory.todayweather.widget.Provider.ClockAndCurrentWeather;
import net.wizardfactory.todayweather.widget.Provider.ClockAndThreeDays;
import net.wizardfactory.todayweather.widget.Provider.CurrentWeatherAndThreeDays;
import net.wizardfactory.todayweather.widget.Provider.DailyWeather;
import net.wizardfactory.todayweather.widget.Provider.W1x1CurrentWeather;
import net.wizardfactory.todayweather.widget.Provider.W2x1CurrentWeather;
import net.wizardfactory.todayweather.widget.Provider.W2x1WidgetProvider;

import org.apache.cordova.CordovaActivity;

/**
 * This class is menu of widget
 * used common all widget.
 */
public class WidgetMenuActivity extends CordovaActivity {
    private Context mContxt = null;
    int mAppWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    int mLayoutId = -1;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        mContxt = getApplicationContext();

        // Find the widget id from the intent.
        Intent intent = getIntent();
        Bundle extras = intent.getExtras();
        if (extras != null) {
//            mAppWidgetId = extras.getInt(
//                    AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
            mLayoutId = extras.getInt("LAYOUT_ID", -1);
        }

        Log.i("WidgetMenu", "app widget id="+mAppWidgetId);
        setContentView(R.layout.widget_menu);
    }

    @Override
    protected void onResume() {
        super.onResume();

        LinearLayout mainLayout = (LinearLayout)findViewById(R.id.menu_layout);
        mainLayout.setOnClickListener(new View.OnClickListener() {
            public void onClick(View arg0) {
                finish();
            }
        });

        // update widget button
        Button updateBtn = (Button)findViewById(R.id.update_button);
        updateBtn.setOnClickListener(new View.OnClickListener() {
            public void onClick(View arg0) {
                updateWidget();
            }
        });

        // move main page button
        Button moveMainBtn = (Button)findViewById(R.id.move_main_button);
        moveMainBtn.setOnClickListener(new View.OnClickListener() {
            public void onClick(View arg0) {
                moveMain();
            }
        });
    }

    private void updateWidget() {
        Class<?> WidgetProvider = null;

        if (mLayoutId == R.layout.w2x1_widget_layout) {
            WidgetProvider = W2x1WidgetProvider.class;
        }
        else if (mLayoutId == R.layout.w1x1_current_weather) {
            WidgetProvider = W1x1CurrentWeather.class;
        }
        else if (mLayoutId == R.layout.w2x1_current_weather) {
            WidgetProvider = W2x1CurrentWeather.class;
        }
        else if (mLayoutId == R.layout.air_quality_index) {
            WidgetProvider = AirQualityIndex.class;
        }
        else if (mLayoutId == R.layout.clock_and_current_weather) {
            WidgetProvider = ClockAndCurrentWeather.class;
        }
        else if (mLayoutId == R.layout.current_weather_and_three_days) {
            WidgetProvider = CurrentWeatherAndThreeDays.class;
        }
        else if (mLayoutId == R.layout.daily_weather) {
            WidgetProvider = DailyWeather.class;
        }
        else if (mLayoutId == R.layout.clock_and_three_days) {
            WidgetProvider = ClockAndThreeDays.class;
        }

        Intent intent = new Intent(this, WidgetProvider);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        ComponentName thisWidget = new ComponentName(mContxt, WidgetProvider);
        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(mContxt);
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(thisWidget);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, appWidgetIds);
        intent.putExtra("ManualUpdate", true);
        sendBroadcast(intent);

        // update widget weather data using service
//        Intent serviceIntent = new Intent(mContxt, WidgetUpdateService.class);
//        serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, mAppWidgetId);
//        mContxt.startService(serviceIntent);

        finish();
    }

    private void moveMain() {
        Intent intent = new Intent(mContxt, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        mContxt.startActivity(intent);
        finish();
    }
}
