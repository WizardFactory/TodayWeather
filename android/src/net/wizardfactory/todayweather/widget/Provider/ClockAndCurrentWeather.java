package net.wizardfactory.todayweather.widget.Provider;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.WidgetProviderConfigureActivity;

/**
 * Implementation of App Widget functionality.
 */
public class ClockAndCurrentWeather extends TwWidgetProvider {
    private static PendingIntent mSender;
    private static AlarmManager mManager;

    public ClockAndCurrentWeather() {
        mLayoutId = R.layout.clock_and_current_weather;
        TAG = "W3x1 clock and current weather";
    }

    @Override
    void resizeWidgetObjects(AppWidgetManager appWidgetManager, int appWidgetId, RemoteViews views) {
        super.resizeWidgetObjects(appWidgetManager, appWidgetId, views);

        if (Build.MANUFACTURER.equals("samsung")) {
            if (Build.VERSION.SDK_INT >= 16) {
                views.setTextViewTextSize(R.id.location, TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(R.id.pubdate, TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(R.id.date, TypedValue.COMPLEX_UNIT_DIP, 18);
                views.setTextViewTextSize(R.id.time, TypedValue.COMPLEX_UNIT_DIP, 46);
                views.setTextViewTextSize(R.id.am_pm, TypedValue.COMPLEX_UNIT_DIP, 14);
                views.setTextViewTextSize(R.id.tmn_tmx_pm_pp, TypedValue.COMPLEX_UNIT_DIP, 18);
                views.setTextViewTextSize(R.id.current_temperature, TypedValue.COMPLEX_UNIT_DIP, 46);
            }
        }

        if (Build.VERSION.SDK_INT >= 17) {
            views.setViewVisibility(R.id.time, View.VISIBLE);
            views.setViewVisibility(R.id.date, View.VISIBLE);
            views.setViewVisibility(R.id.am_pm, View.VISIBLE);
        }
        else {
            views.setViewVisibility(R.id.analogClock, View.VISIBLE);
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

