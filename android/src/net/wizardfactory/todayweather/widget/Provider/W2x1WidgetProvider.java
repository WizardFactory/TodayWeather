package net.wizardfactory.todayweather.widget.Provider;

import android.content.Context;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;

import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.Data.Units;
import net.wizardfactory.todayweather.widget.Data.WeatherData;
import net.wizardfactory.todayweather.widget.Data.WidgetData;
import net.wizardfactory.todayweather.widget.SettingsActivity;

/**
 * Implementation of App Widget functionality.
 */
public class W2x1WidgetProvider extends TwWidgetProvider {

    public W2x1WidgetProvider() {
        TAG = "W2x1WidgetProvider";
        mLayoutId = R.layout.w2x1_widget_layout;
    }

    static public void setWidgetStyle(Context context, int appWidgetId, RemoteViews views) {
        TwWidgetProvider.setWidgetStyle(context, appWidgetId, views);

        int fontColor = SettingsActivity.loadFontColorPref(context, appWidgetId);
        views.setTextColor(R.id.errMsg, fontColor);
        views.setTextColor(R.id.location, fontColor);
        views.setTextColor(R.id.yesterday_temperature, fontColor);
        views.setTextColor(R.id.cmp_yesterday_temperature, fontColor);
        views.setTextColor(R.id.today_text, fontColor);
        views.setTextColor(R.id.today_high_temperature, fontColor);
        views.setTextColor(R.id.today_separator_temperature, fontColor);
        views.setTextColor(R.id.today_low_temperature, fontColor);
        views.setTextColor(R.id.yesterday_text, fontColor);
        views.setTextColor(R.id.yesterday_high_temperature, fontColor);
        views.setTextColor(R.id.yesterday_separator_temperature, fontColor);
        views.setTextColor(R.id.yesterday_low_temperature, fontColor);
    }

    static public void setWidgetData(Context context, RemoteViews views, WidgetData wData, Units localUnits) {
        if (wData == null) {
            Log.e(TAG, "weather data is NULL");
            return;
        }

        if (wData.getLoc() != null) {
            views.setTextViewText(R.id.location, wData.getLoc());
        }

        // process current weather data
        WeatherData currentData = wData.getCurrentWeather();
        double tempMax;
        double tempMin;
        if (currentData != null) {
            String tempStr = localUnits.convertUnitsStr(wData.getUnits().getTemperatureUnit(), currentData.getTemperature());
            tempMax = localUnits.convertUnits(wData.getUnits().getTemperatureUnit(), currentData.getMaxTemperature());
            tempMin = localUnits.convertUnits(wData.getUnits().getTemperatureUnit(), currentData.getMinTemperature());
            views.setTextViewText(R.id.yesterday_temperature, tempStr);
            views.setTextViewText(R.id.today_high_temperature, String.valueOf(Math.round(tempMax)));
            views.setTextViewText(R.id.today_low_temperature, String.valueOf(Math.round(tempMin)));
//                views.setTextViewText(R.id.cmp_yesterday_temperature, currentData.getSummary());
            int skyResourceId = context.getResources().getIdentifier(currentData.getSkyImageName(), "drawable", context.getPackageName());
            if (skyResourceId == -1) {
                skyResourceId = R.drawable.sun;
            }
            views.setImageViewResource(R.id.current_sky, skyResourceId);
        } else {
            Log.e(TAG, "todayElement is NULL");
        }

        // process yesterday that same as current time, weather data
        WeatherData yesterdayData = wData.getBefore24hWeather();
        if (yesterdayData != null) {
            tempMax = localUnits.convertUnits(wData.getUnits().getTemperatureUnit(), yesterdayData.getMaxTemperature());
            tempMin = localUnits.convertUnits(wData.getUnits().getTemperatureUnit(), yesterdayData.getMinTemperature());
            views.setTextViewText(R.id.yesterday_high_temperature, String.valueOf(Math.round(tempMax)));
            views.setTextViewText(R.id.yesterday_low_temperature, String.valueOf(Math.round(tempMin)));
        } else {
            Log.e(TAG, "yesterdayElement is NULL");
        }

        int cmpTemp = 0;
        String cmpYesterdayTemperatureStr = "";
        if (currentData != null && yesterdayData != null) {
            double currentTemp = localUnits.convertUnits(wData.getUnits().getTemperatureUnit(), currentData.getTemperature());
            double before24hTemp = localUnits.convertUnits(wData.getUnits().getTemperatureUnit(), yesterdayData.getTemperature());
            cmpTemp = (int)Math.round(currentTemp - before24hTemp);
            if (cmpTemp == 0) {
                cmpYesterdayTemperatureStr = context.getString(R.string.same_yesterday);
            }
            else {
                String strTemp;
                if (cmpTemp > 0) {
                    strTemp = "+"+String.valueOf(cmpTemp);
                }
                else {
                    strTemp = String.valueOf(cmpTemp);
                }
                cmpYesterdayTemperatureStr = String.format(context.getString(R.string.cmp_yesterday), strTemp);
            }
            views.setTextViewText(R.id.cmp_yesterday_temperature, cmpYesterdayTemperatureStr);
        }

        // weather content is visible
        views.setViewVisibility(R.id.msg_layout, View.GONE);
        views.setViewVisibility(R.id.weather_layout, View.VISIBLE);
    }
}