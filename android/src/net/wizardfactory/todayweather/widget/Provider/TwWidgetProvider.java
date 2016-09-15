package net.wizardfactory.todayweather.widget.Provider;

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

/**
 * Created by aleckim on 2016. 9. 11..
 */
public class TwWidgetProvider extends AppWidgetProvider {
    String TAG;
    int mLayoutId;

    public TwWidgetProvider() {
        mLayoutId = -1;
        TAG = "TwWidget";
    }

    void resizeWidgetObjects(AppWidgetManager appWidgetManager, int appWidgetId, RemoteViews views) {
    }

    void updateAppWidget(Context context, AppWidgetManager appWidgetManager,
                                int appWidgetId) {

        Log.i(TAG, "appWidgetId="+appWidgetId);

        // Create an Intent to launch menu
        Intent intent = new Intent(context, WidgetMenuActivity.class);
//        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        intent.putExtra("LAYOUT_ID", mLayoutId);
        PendingIntent pendingIntent = PendingIntent.getActivity(context, appWidgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT);


        // Get the layout for the App Widget and attach an on-click listener
        RemoteViews views = new RemoteViews(context.getPackageName(), mLayoutId);


        int opacity = WidgetProviderConfigureActivity.getWidgetOpacity(context);
        if (opacity > -1) {
            int color = (255*opacity/100) << 24 + 0x231f20;
            views.setInt(R.id.bg_layout, "setBackgroundColor", color);
        }

        resizeWidgetObjects(appWidgetManager, appWidgetId, views);

        views.setOnClickPendingIntent(R.id.bg_layout, pendingIntent);

        // Tell the AppWidgetManager to perform an update on the current app widget
        appWidgetManager.updateAppWidget(appWidgetId, views);

        // update widget weather data using service
        Intent serviceIntent = new Intent(context, WidgetUpdateService.class);
        serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        context.startService(serviceIntent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        // There may be multiple widgets active, so update all of them
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onEnabled(Context context) {
        // Enter relevant functionality for when the first widget is created
    }

    @Override
    public void onDisabled(Context context) {
        // Enter relevant functionality for when the last widget is disabled
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        Log.i(TAG, "on deleted");
        // When the user deletes the widget, delete the preference associated with it.
        for (int appWidgetId : appWidgetIds) {
            WidgetProviderConfigureActivity.deleteCityInfoPref(context, appWidgetId);
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
}
