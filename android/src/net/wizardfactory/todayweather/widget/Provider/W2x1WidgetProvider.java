package net.wizardfactory.todayweather.widget.Provider;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.widget.RemoteViews;

import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.WidgetMenuActivity;
import net.wizardfactory.todayweather.widget.WidgetProviderConfigureActivity;
import net.wizardfactory.todayweather.widget.WidgetUpdateService;

public class W2x1WidgetProvider extends AppWidgetProvider {

    private static final String TAG = "W2x1Widget";
    private static PendingIntent mSender;
    private static AlarmManager mManager;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        final int N = appWidgetIds.length;

        // Perform this loop procedure for each App Widget that belongs to this provider
        for (int i=0; i<N; i++) {
            int appWidgetId = appWidgetIds[i];

            Log.i(TAG, "appWidgetId="+appWidgetId);

            // Create an Intent to launch menu
            Intent intent = new Intent(context, WidgetMenuActivity.class);
            intent.putExtra("LAYOUT_ID", R.layout.w2x1_widget_layout);
//            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
            PendingIntent pendingIntent = PendingIntent.getActivity(context, appWidgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT);

            // Get the layout for the App Widget and attach an on-click listener
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.w2x1_widget_layout);
            views.setOnClickPendingIntent(R.id.bg_layout, pendingIntent);

            // Tell the AppWidgetManager to perform an update on the current app widget
            appWidgetManager.updateAppWidget(appWidgetId, views);

            // update widget weather data using service
            Intent serviceIntent = new Intent(context, WidgetUpdateService.class);
            serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
            context.startService(serviceIntent);
        }
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        Log.i(TAG, "on deleted");
        // When the user deletes the widget, delete the preference associated with it.
        for (int appWidgetId : appWidgetIds) {
            WidgetProviderConfigureActivity.deleteCityInfoPref(context, appWidgetId);
        }
    }

    @Override
    public void onEnabled(Context context) {
        Log.i(TAG, "Enabled");
    }

    @Override
    public void onDisabled(Context context) {
        Log.i(TAG, "Disabled");
    }

    public void removePreviousAlarm()
    {
        if(mManager != null && mSender != null)
        {
            mSender.cancel();
            mManager.cancel(mSender);
        }
    }

    public void onReceive(Context context, Intent intent) {
        Log.i(TAG, "on receive");
        super.onReceive(context, intent);

        String action = intent.getAction();
        // 위젯 업데이트 인텐트를 수신했을 때
        if(action.equals("android.appwidget.action.APPWIDGET_UPDATE"))
        {
            Log.w(TAG, "android.appwidget.action.APPWIDGET_UPDATE");
            removePreviousAlarm();

            long updateInterval = WidgetProviderConfigureActivity.getWidgetUpdateInterval(context);
            if (updateInterval > 0) {
                Log.i(TAG, "set alarm");

                Intent alarmIntent = new Intent(context, getClass());
                alarmIntent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
                ComponentName thisWidget = new ComponentName(context, getClass());
                AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
                int[] widgetIds = appWidgetManager.getAppWidgetIds(thisWidget);
                alarmIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, widgetIds);

                long updateTime = System.currentTimeMillis() + updateInterval;
                mSender = PendingIntent.getBroadcast(context, 0, alarmIntent, 0);
                mManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
                mManager.set(AlarmManager.RTC, updateTime, mSender);
            }
        }
        // 위젯 제거 인텐트를 수신했을 때
        else if(action.equals("android.appwidget.action.APPWIDGET_DISABLED"))
        {
            Log.w(TAG, "android.appwidget.action.APPWIDGET_DISABLED");
            removePreviousAlarm();
        }
    }

    /**
     * 예약되어있는 알람을 취소합니다.
     */
}


