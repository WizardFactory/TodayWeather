package net.wizardfactory.todayweather.widget.Provider;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.util.Log;
import android.widget.RemoteViews;

import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.SettingsActivity;
import net.wizardfactory.todayweather.widget.WidgetMenuActivity;
import net.wizardfactory.todayweather.widget.WidgetUpdateService;

/**
 * Created by aleckim on 2016. 9. 11..
 */
public class TwWidgetProvider extends AppWidgetProvider {
    protected static String TAG;
    protected int mLayoutId;

    private static AlarmManager mAlarmManager;

    public TwWidgetProvider() {
        TAG = "TwWidgetProvider";
        mLayoutId = -1;
    }

    protected void setWidgetStyle(AppWidgetManager appWidgetManager, int appWidgetId, RemoteViews views) {
    }

    static public void setWidgetStyle(Context context, int appWidgetId, RemoteViews views) {
        int fransparency = SettingsActivity.loadTransparencyPref(context, appWidgetId);
        int bgColor = SettingsActivity.loadBgColorPref(context, appWidgetId);
        int color = Color.argb(255*(100-fransparency)/100, Color.red(bgColor), Color.green(bgColor), Color.blue(bgColor));

        views.setInt(R.id.bg_layout, "setBackgroundColor", color);
    }

    public void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        Log.i(TAG, "appWidgetId="+appWidgetId);

        // Create an Intent to launch menu
        Intent intent = new Intent(context, WidgetMenuActivity.class);
//        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        intent.putExtra("LAYOUT_ID", mLayoutId);
        PendingIntent pendingIntent = PendingIntent.getActivity(context, appWidgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT);

        // Get the layout for the App Widget and attach an on-click listener
        RemoteViews views = new RemoteViews(context.getPackageName(), mLayoutId);

        setWidgetStyle(appWidgetManager, appWidgetId, views);

        views.setOnClickPendingIntent(R.id.bg_layout, pendingIntent);

        // Tell the AppWidgetManager to perform an update on the current app widget
        appWidgetManager.updateAppWidget(appWidgetId, views);

        // update widget weather data using service
        Intent serviceIntent = new Intent(context, WidgetUpdateService.class);
        serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        context.startService(serviceIntent);
    }

    private PendingIntent getAlarmIntent(Context context, int appWidgetId) {
        Intent intent = new Intent(context, getClass());
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, new int[] {appWidgetId});

        PendingIntent pendingIntent = PendingIntent.getBroadcast(context, 0, intent, 0);
        return pendingIntent;
    }

    private void cancelAlarmManager(Context context, int appWidgetId) {
        if (mAlarmManager == null) {
            mAlarmManager = (AlarmManager)context.getSystemService(Context.ALARM_SERVICE);
        }

        PendingIntent pendingIntent = getAlarmIntent(context, appWidgetId);
        if (pendingIntent != null) {
            Log.i(TAG, "cancel alarm");
            pendingIntent.cancel();
            mAlarmManager.cancel(pendingIntent);
        }
    }

    private void setAlarmManager(Context context, int appWidgetId) {
        if (mAlarmManager == null) {
            mAlarmManager = (AlarmManager)context.getSystemService(Context.ALARM_SERVICE);
        }

        PendingIntent pendingIntent = getAlarmIntent(context, appWidgetId);
        if (pendingIntent != null) {
            long updateInterval = SettingsActivity.loadUpdateIntervalPref(context, appWidgetId);
            if (updateInterval > 0) {
                Log.i(TAG, "set alarm");
                long updateTime = System.currentTimeMillis() + updateInterval;
                mAlarmManager.set(AlarmManager.RTC, updateTime, pendingIntent);
            }
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        // There may be multiple widgets active, so update all of them
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
            cancelAlarmManager(context, appWidgetId);
            setAlarmManager(context, appWidgetId);
        }
    }

    @Override
    public void onEnabled(Context context) {
        // Enter relevant functionality for when the first widget is created
    }

    @Override
    public void onDisabled(Context context) {
        // Enter relevant functionality for when the last widget is disabled
        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, getClass());
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(provider);
        for (int appWidgetId : appWidgetIds) {
            cancelAlarmManager(context, appWidgetId);
        }
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        Log.i(TAG, "on deleted");
        // When the user deletes the widget, delete the preference associated with it.
        for (int appWidgetId : appWidgetIds) {
            cancelAlarmManager(context, appWidgetId);
            SettingsActivity.deleteWidgetPref(context, appWidgetId);
        }
    }

    /**
     * 추가될때, update 한 번 해서 사이즈 맞추어야 함
     * @param context
     * @param appWidgetManager
     * @param appWidgetId
     * @param newOptions
     */
    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager, int appWidgetId, Bundle newOptions) {
        super.onAppWidgetOptionsChanged(context, appWidgetManager, appWidgetId, newOptions);
        updateAppWidget(context, appWidgetManager, appWidgetId);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        Log.i(TAG, action);
    }

    static protected String convertGradeToStr(Context context, int grade) {
        switch (grade) {
            case 1:
                return context.getString(R.string.good);
            case 2:
                return context.getString(R.string.moderate);
            case 3:
                return context.getString(R.string.unhealthy);
            case 4:
                return context.getString(R.string.very_unhealthy);
            case 5:
                return context.getString(R.string.hazardous);
            default:
                Log.e(TAG, "Unknown grade="+grade);
        }
        return "";
    }
}
