package net.wizardfactory.todayweather.widget;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.preference.ListPreference;
import android.preference.PreferenceActivity;
import android.util.Log;
import android.view.Menu;
import android.view.MenuItem;

import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.Data.Units;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class SettingsActivity extends PreferenceActivity {
    private static final String TAG = "Settings";

    //It needs to sync with cordova-plugin-app-preferences plugin
    private static final String APP_PREFS_NAME = "net.wizardfactory.todayweather_preferences";
    private static final String APP_CITY_LIST_KEY = "cityList";
    private static final String APP_UNITS_KEY = "units";
    private static final String APP_UPDATE_INTERVAL_KEY = "updateInterval";
    private static final String APP_OPACITY_KEY = "widgetOpacity";

    private static final String WIDGET_PREFS_NAME = "net.wizardfactory.todayweather.widget.Provider.WidgetProvider";
    private static final String WIDGET_PREFIX_KEY = "appwidget_";
    private static final String WIDGET_UPDATE_INTERVAL_PREFIX_KEY = "updateInterval_";
    private static final String WIDGET_TRANSPARENCY_PREFIX_KEY = "transparency_";
    private static final String WIDGET_BG_COLOR_PREFIX_KEY = "bgColor_";
    private static final String WIDGET_FONT_COLOR_PREFIX_KEY = "fontColor_";

    private int mAppWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private SettingsFragment settingsFragment;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Display the fragment as the main content.
        settingsFragment = new SettingsFragment();
        getFragmentManager().beginTransaction()
                .replace(android.R.id.content, settingsFragment)
                .commit();

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
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        MenuItem add = menu.add(Menu.NONE, R.id.settings_ok, 0, "OK");
        add.setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM);

        return super.onCreateOptionsMenu(menu);
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == R.id.settings_ok) {
            final Context context = SettingsActivity.this;

            ListPreference location = (ListPreference)settingsFragment.findPreference("location");
            saveCityInfoPref(context, mAppWidgetId, location.getValue());

            ListPreference refreshInterval = (ListPreference)settingsFragment.findPreference("refreshInterval");
            saveUpdateIntervalPref(context, mAppWidgetId, Integer.parseInt(refreshInterval.getValue()));

            ListPreference transparency = (ListPreference)settingsFragment.findPreference("transparency");
            saveTransparencyPref(context, mAppWidgetId, Integer.parseInt(transparency.getValue()));

            com.kizitonwose.colorpreference.ColorPreference backgroundColor = (com.kizitonwose.colorpreference.ColorPreference)settingsFragment.findPreference("backgroundColor");
            saveBgColorPref(context, mAppWidgetId, backgroundColor.getValue());

            com.kizitonwose.colorpreference.ColorPreference fontColor = (com.kizitonwose.colorpreference.ColorPreference)settingsFragment.findPreference("fontColor");
            saveFontColorPref(context, mAppWidgetId, fontColor.getValue());

            // It is the responsibility of the configuration activity to update the app widget
            updateWidget(context);

            // Make sure we pass back the original appWidgetId
            Intent resultValue = new Intent();
            resultValue.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, mAppWidgetId);
            setResult(RESULT_OK, resultValue);
            finish();
        }

        return super.onOptionsItemSelected(item);
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();

        // Home 키 누른 경우 Widget 생성 취소
        Intent result = new Intent();
        result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, mAppWidgetId);
        setResult(RESULT_CANCELED, result);
        finish();
    }

    private void updateWidget(Context context) {
        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        int layoutId = appWidgetManager.getAppWidgetInfo(mAppWidgetId).initialLayout;
        Class<?> widgetProvider = WidgetUpdateService.getWidgetProvider(layoutId);
        ComponentName thisWidget = new ComponentName(context, widgetProvider);
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(thisWidget);

        Intent intent = new Intent(this, widgetProvider);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, appWidgetIds);
        intent.putExtra("ManualUpdate", true);
        sendBroadcast(intent);
    }

    public static JSONArray loadCityListPref(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(APP_PREFS_NAME, 0);

        if (prefs.contains(APP_CITY_LIST_KEY)) {
            String jsonStr = prefs.getAll().get(APP_CITY_LIST_KEY).toString();
            Log.i(TAG, jsonStr);
            try {
                JSONObject result = new JSONObject(jsonStr);
                if (result == null) {
                    Log.e(TAG, "Fail to get cityList");
                    return null;
                }
                return result.getJSONArray(APP_CITY_LIST_KEY);
            }
            catch (JSONException e ) {
                e.printStackTrace();
            }
        }
        else {
            Log.w(TAG, "Fail to get citylist");
        }

        return null;
    }

    public static Units loadUnitsPref(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(APP_PREFS_NAME, 0);

        if (prefs.contains(APP_UNITS_KEY)) {
            String jsonStr = prefs.getAll().get(APP_UNITS_KEY).toString();
            Log.i(TAG, jsonStr);
            try {
                JSONObject result = new JSONObject(jsonStr);
                if (result == null) {
                    Log.e(TAG, "Fail to get units information");
                    return null;
                }
                return new Units(jsonStr);
            }
            catch (JSONException e) {
                e.printStackTrace();
            }
        }
        else {
            Log.w(TAG, "Fail to load units information");
        }

        return new Units();
    }

    public static void deleteWidgetPref(Context context, int appWidgetId) {
        SharedPreferences.Editor prefs = context.getSharedPreferences(WIDGET_PREFS_NAME, 0).edit();
        prefs.remove(WIDGET_PREFIX_KEY + appWidgetId);
        prefs.apply();
    }

    // Read the prefix from the SharedPreferences object for this widget.
    // If there is no preference saved, get the default from a resource
    public static String loadCityInfoPref(Context context, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(WIDGET_PREFS_NAME, 0);
        String cityInfo = prefs.getString(WIDGET_PREFIX_KEY + appWidgetId, null);

        Log.i(TAG, "[widget_" + appWidgetId + "] cityInfo = " + cityInfo);
        return cityInfo;
    }

    // Write the prefix to the SharedPreferences object for this widget
    public static void saveCityInfoPref(Context context, int appWidgetId, String text) {
        SharedPreferences.Editor prefs = context.getSharedPreferences(WIDGET_PREFS_NAME, 0).edit();
        prefs.putString(WIDGET_PREFIX_KEY + appWidgetId, text);
        prefs.apply();
    }

    public static long loadUpdateIntervalPref(Context context, int appWidgetId) {
        SharedPreferences widgetPrefs = context.getSharedPreferences(WIDGET_PREFS_NAME, 0);
        long minInterval = widgetPrefs.getLong(WIDGET_UPDATE_INTERVAL_PREFIX_KEY + appWidgetId, -1);

        if (minInterval == -1) {
            SharedPreferences appPrefs = context.getSharedPreferences(APP_PREFS_NAME, 0);
            minInterval = appPrefs.getInt(APP_UPDATE_INTERVAL_KEY, 0);
            saveUpdateIntervalPref(context, appWidgetId, minInterval);
        }

        Log.i(TAG, "[widget_" + appWidgetId + "] update interval = " + minInterval);
        minInterval = minInterval * 60 * 1000;
        return minInterval;
    }

    public static void saveUpdateIntervalPref(Context context, int appWidgetId, long minInterval) {
        SharedPreferences.Editor prefs = context.getSharedPreferences(WIDGET_PREFS_NAME, 0).edit();
        prefs.putLong(WIDGET_UPDATE_INTERVAL_PREFIX_KEY + appWidgetId, 1);
        prefs.apply();
    }

    public static int loadTransparencyPref(Context context, int appWidgetId) {
        SharedPreferences widgetPrefs = context.getSharedPreferences(WIDGET_PREFS_NAME, 0);
        int opacity = widgetPrefs.getInt(WIDGET_TRANSPARENCY_PREFIX_KEY + appWidgetId, -1);

        if (opacity == -1) {
            SharedPreferences appPrefs = context.getSharedPreferences(APP_PREFS_NAME, 0);
            opacity = 100 - appPrefs.getInt(APP_OPACITY_KEY, 69);
            saveTransparencyPref(context, appWidgetId, opacity);
        }

        Log.i(TAG, "[widget_" + appWidgetId + "] opacity = " + opacity);
        return opacity;
    }

    public static void saveTransparencyPref(Context context, int appWidgetId, int transparency) {
        SharedPreferences.Editor prefs = context.getSharedPreferences(WIDGET_PREFS_NAME, 0).edit();
        prefs.putInt(WIDGET_TRANSPARENCY_PREFIX_KEY + appWidgetId, transparency);
        prefs.apply();
    }

    public static int loadBgColorPref(Context context, int appWidgetId) {
        SharedPreferences widgetPrefs = context.getSharedPreferences(WIDGET_PREFS_NAME, 0);
        int bgColor = widgetPrefs.getInt(WIDGET_BG_COLOR_PREFIX_KEY + appWidgetId, Color.BLACK);

        Log.i(TAG, "[widget_" + appWidgetId + "] bgColor = " + bgColor);
        return bgColor;
    }

    public static void saveBgColorPref(Context context, int appWidgetId, int bgColor) {
        SharedPreferences.Editor prefs = context.getSharedPreferences(WIDGET_PREFS_NAME, 0).edit();
        prefs.putInt(WIDGET_BG_COLOR_PREFIX_KEY + appWidgetId, bgColor);
        prefs.apply();
    }

    public static int loadFontColorPref(Context context, int appWidgetId) {
        SharedPreferences widgetPrefs = context.getSharedPreferences(WIDGET_PREFS_NAME, 0);
        int fontColor = widgetPrefs.getInt(WIDGET_FONT_COLOR_PREFIX_KEY + appWidgetId, Color.WHITE);

        Log.i(TAG, "[widget_" + appWidgetId + "] fontColor = " + fontColor);
        return fontColor;
    }

    public static void saveFontColorPref(Context context, int appWidgetId, int fontColor) {
        SharedPreferences.Editor prefs = context.getSharedPreferences(WIDGET_PREFS_NAME, 0).edit();
        prefs.putInt(WIDGET_FONT_COLOR_PREFIX_KEY + appWidgetId, fontColor);
        prefs.apply();
    }
}