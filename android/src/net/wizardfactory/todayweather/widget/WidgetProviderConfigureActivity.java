package net.wizardfactory.todayweather.widget;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.Provider.W1x1CurrentWeather;

/**
 * The configuration screen for the {@link W1x1CurrentWeather W1x1CurrentWeather} AppWidget.
 */
public class WidgetProviderConfigureActivity extends Activity {

    //It needs to sync with cordova-plugin-app-preferences plugin
    private static final String CITYLIST_PREFS_NAME = "net.wizardfactory.todayweather_preferences";
    private static final String PREFS_NAME = "net.wizardfactory.todayweather.widget.Provider.WidgetProvider";
    private static final String PREF_PREFIX_KEY = "appwidget_";
    int mAppWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    String mAppWidgetCityInfo;
    JSONArray mCityListArray;

    View.OnClickListener mOnCancelClickListener = new View.OnClickListener() {
        public void onClick(View v) {
            Intent intent = new Intent();
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, mAppWidgetId);
            setResult(RESULT_CANCELED, intent);
            finish();
        }
    };

    View.OnClickListener mOnClickListener = new View.OnClickListener() {
        public void onClick(View v) {
            final Context context = WidgetProviderConfigureActivity.this;
            int i = v.getId();
            try {
                mAppWidgetCityInfo = mCityListArray.getJSONObject(i).toString();
            }
            catch (JSONException e) {
                Log.e("widgetConfigure", "JSONException: " + e.getMessage());
                finish();
                return;
            }

           saveCityInfoPref(context, mAppWidgetId, mAppWidgetCityInfo);

            // It is the responsibility of the configuration activity to update the app widget
//            AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
//            W1x1CurrentWeather.updateAppWidget(context, appWidgetManager, mAppWidgetId);

            // update widget weather data using service
            Intent serviceIntent = new Intent(context, WidgetUpdateService.class);
            serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, mAppWidgetId);
            context.startService(serviceIntent);

            // Make sure we pass back the original appWidgetId
            Intent resultValue = new Intent();
            resultValue.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, mAppWidgetId);
            setResult(RESULT_OK, resultValue);
            finish();
        }
    };

    public WidgetProviderConfigureActivity() {
        super();
    }

    // Write the prefix to the SharedPreferences object for this widget
    static void saveCityInfoPref(Context context, int appWidgetId, String text) {
        SharedPreferences.Editor prefs = context.getSharedPreferences(PREFS_NAME, 0).edit();
        prefs.putString(PREF_PREFIX_KEY + appWidgetId, text);
        prefs.apply();
    }

    // Read the prefix from the SharedPreferences object for this widget.
    // If there is no preference saved, get the default from a resource
    public static String loadCityInfoPref(Context context, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, 0);
        String cityInfo = prefs.getString(PREF_PREFIX_KEY + appWidgetId, null);
        if (cityInfo != null) {
            return cityInfo;
        } else {
            return null;
        }
    }

    public static void deleteCityInfoPref(Context context, int appWidgetId) {
        SharedPreferences.Editor prefs = context.getSharedPreferences(PREFS_NAME, 0).edit();
        prefs.remove(PREF_PREFIX_KEY + appWidgetId);
        prefs.apply();
    }

    public static long getWidgetUpdateInterval(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(CITYLIST_PREFS_NAME, 0);
        String key = "updateInterval";
        if (prefs.contains(key)) {
            long minInterval = prefs.getInt(key, -1);
            Log.i("widgetConfigure", "widget update interval " + minInterval);
            minInterval = minInterval * 60 * 1000;
            return minInterval;
        }

        return -1;
    }

    public static int getWidgetOpacity(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(CITYLIST_PREFS_NAME, 0);
        String key = "widgetOpacity";
        if (prefs.contains(key)) {
            int opacity = prefs.getInt(key, 0xb2);
            Log.i("widgetConfigure", "widget opacity " + opacity);
            return opacity;
        }

        return 0xb2;
    }

    private void loadCityListPref(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(CITYLIST_PREFS_NAME, 0);
        String key = "cityList";
        if (prefs.contains(key)) {
            String jsonStr = prefs.getAll().get(key).toString();
            Log.i("widgetConfigure", jsonStr);
            try {
                JSONObject result = new JSONObject(jsonStr);
                if (result == null) {
                    Log.e("widgetConfigure", "Fail to get cityList");
                    return;
                }
                mCityListArray = result.getJSONArray("cityList");
            }
            catch (JSONException e ) {
                e.printStackTrace();
            }
        }
        else {
            Log.w("widgetConfigure", "Fail to get citylist");
        }
    }

    private void drawCityList(Context context, LinearLayout citylist_layout, LinearLayout.LayoutParams buttonParams) {
        if (mCityListArray == null) {

            //show message;
            //add go to app;
            return;
        }

        for (int i =0; i < mCityListArray.length(); i++) {
            String address = null;
            try {
                JSONObject object = mCityListArray.getJSONObject(i);
                boolean currentPosition = object.getBoolean("currentPosition");
                if (currentPosition) {
                    address = context.getString(R.string.current_position);
                }
                else {
                    address = object.get("address").toString();
                }
            }
            catch (JSONException e) {
                Log.e("widgetConfigure", "JSONException: " + e.getMessage());
                continue;
            }
            Button cityButton = new Button(this);
            cityButton.setId(i);
            cityButton.setOnClickListener(mOnClickListener);
            cityButton.setLayoutParams(buttonParams);
            cityButton.setText(address);
            citylist_layout.addView(cityButton);
        }
    }

    @Override
    public void onCreate(Bundle icicle) {
        super.onCreate(icicle);

        // Find the widget id from the intent.
        Intent intent = getIntent();
        Bundle extras = intent.getExtras();
        if (extras != null) {
            mAppWidgetId = extras.getInt(
                    AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        }

        // If this activity was started with an intent without an app widget ID, finish with an error.
        if (mAppWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }

        // Set the result to CANCELED.  This will cause the widget host to cancel
        // out of the widget placement if the user presses the back button.
        // back 로 종료하는 경우에 지우기 위해서는 extra를 추가해야 함. 그러나 여전히 home key를 누르면 zombi가 됨.
        Intent result = new Intent();
        result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, mAppWidgetId);
        setResult(RESULT_CANCELED, result);

        loadCityListPref(WidgetProviderConfigureActivity.this);

        setContentView(R.layout.widget_provider_configure);

        findViewById(R.id.canel_button).setOnClickListener(mOnCancelClickListener);

        LinearLayout citylist_layout = (LinearLayout) findViewById(R.id.citylist_layout);
        LinearLayout.LayoutParams buttonParams  = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);

        drawCityList(WidgetProviderConfigureActivity.this, citylist_layout, buttonParams);

        mAppWidgetCityInfo = loadCityInfoPref(WidgetProviderConfigureActivity.this, mAppWidgetId);
    }
}

