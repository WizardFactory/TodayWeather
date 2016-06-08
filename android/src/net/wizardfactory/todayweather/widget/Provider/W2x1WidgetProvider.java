package net.wizardfactory.todayweather.widget.Provider;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
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

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        final int N = appWidgetIds.length;

        // Perform this loop procedure for each App Widget that belongs to this provider
        for (int i=0; i<N; i++) {
            int appWidgetId = appWidgetIds[i];

            Log.i("W2x1Widget", "appWidgetId="+appWidgetId);

            // Create an Intent to launch menu
            Intent intent = new Intent(context, WidgetMenuActivity.class);
            PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, 0);

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
        Log.i("W2x1Widget", "on deleted");
        // When the user deletes the widget, delete the preference associated with it.
        for (int appWidgetId : appWidgetIds) {
            WidgetProviderConfigureActivity.deleteCityInfoPref(context, appWidgetId);
        }
    }

    @Override
    public void onEnabled(Context context) {
        Log.i("W2x1Widget", "Enabled");
    }

    @Override
    public void onDisabled(Context context) {
        Log.i("W2x1Widget", "Disabled");
    }

    public void onReceive(Context context, Intent intent) {
        Log.i("W2x1Widget", "on receive");
        super.onReceive(context, intent);

    }

    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager,
                                          int appWidgetId, Bundle newOptions) {

        Log.i("W2x1Widget", "on app widget options changed");
    }

}


