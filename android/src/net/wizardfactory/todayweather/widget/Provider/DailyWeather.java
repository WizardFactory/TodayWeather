package net.wizardfactory.todayweather.widget.Provider;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.util.TypedValue;
import android.widget.RemoteViews;

import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.WidgetProviderConfigureActivity;

/**
 * Implementation of App Widget functionality.
 */
public class DailyWeather extends TwWidgetProvider {
    private static PendingIntent mSender;
    private static AlarmManager mManager;

    public DailyWeather() {
        mLayoutId = R.layout.daily_weather;
        TAG = "W4x1 daily weather";
    }

    @Override
    void resizeWidgetObjects(AppWidgetManager appWidgetManager, int appWidgetId, RemoteViews views) {
        super.resizeWidgetObjects(appWidgetManager, appWidgetId, views);

        if (Build.MANUFACTURER.equals("samsung")) {
            int[] labelIds = {R.id.label_yesterday, R.id.label_today, R.id.label_tomorrow,
                    R.id.label_twodays, R.id.label_threedays};
            int[] tempIds = {R.id.yesterday_temperature, R.id.today_temperature,
                    R.id.tomorrow_temperature, R.id.twodays_temperature, R.id.threedays_temperature};

            views.setTextViewTextSize(R.id.location, TypedValue.COMPLEX_UNIT_DIP, 18);
            views.setTextViewTextSize(R.id.pubdate, TypedValue.COMPLEX_UNIT_DIP, 18);

            for (int i = 0; i < 5; i++) {
                views.setTextViewTextSize(labelIds[i], TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(tempIds[i], TypedValue.COMPLEX_UNIT_DIP, 18);
            }
        }
    }

    public void removePreviousAlarm()
    {
        if(mManager != null && mSender != null)
        {
            Log.i(TAG, "cancel alarm");
            mSender.cancel();
            mManager.cancel(mSender);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        super.onUpdate(context, appWidgetManager, appWidgetIds);

        removePreviousAlarm();

        long updateInterval = WidgetProviderConfigureActivity.getWidgetUpdateInterval(context);
        if (updateInterval > 0) {
            Log.i(TAG, "set alarm");

            Intent intent = new Intent(context, getClass());
            intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            ComponentName thisWidget = new ComponentName(context, getClass());
            int[] widgetIds = appWidgetManager.getAppWidgetIds(thisWidget);
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, widgetIds);

            long updateTime = System.currentTimeMillis() + updateInterval;
            mSender = PendingIntent.getBroadcast(context, 0, intent, 0);
            mManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            mManager.set(AlarmManager.RTC, updateTime, mSender);
        }
    }

    @Override
    public void onDisabled(Context context) {
        super.onDisabled(context);
        removePreviousAlarm();
    }
}

