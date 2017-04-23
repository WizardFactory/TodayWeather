package net.wizardfactory.todayweather.widget.Provider;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.os.Build;
import android.util.Log;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.Data.Units;
import net.wizardfactory.todayweather.widget.Data.WeatherData;
import net.wizardfactory.todayweather.widget.Data.WidgetData;
import net.wizardfactory.todayweather.widget.JsonElement.WeatherElement;
import net.wizardfactory.todayweather.widget.SettingsActivity;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.TimeZone;

/**
 * Implementation of App Widget functionality.
 */
public class ClockAndThreeDays extends TwWidgetProvider {

    public ClockAndThreeDays() {
        TAG = "W3x1 ClockAndThreeDays";
        mLayoutId = R.layout.clock_and_three_days;
    }

    @Override
    protected void setWidgetStyle(AppWidgetManager appWidgetManager, int appWidgetId, RemoteViews views) {
        super.setWidgetStyle(appWidgetManager, appWidgetId, views);

        if (Build.MANUFACTURER.equals("samsung")) {
            if (Build.VERSION.SDK_INT >= 16) {
                views.setTextViewTextSize(R.id.location, TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(R.id.pubdate, TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(R.id.date, TypedValue.COMPLEX_UNIT_DIP, 18);
                views.setTextViewTextSize(R.id.time, TypedValue.COMPLEX_UNIT_DIP, 46);
                views.setTextViewTextSize(R.id.am_pm, TypedValue.COMPLEX_UNIT_DIP, 14);

                int[] labelIds = {R.id.label_yesterday, R.id.label_today, R.id.label_tomorrow};
                int[] tempIds = {R.id.yesterday_temperature, R.id.today_temperature, R.id.tomorrow_temperature};

                for (int i = 0; i < 3; i++) {
                    views.setTextViewTextSize(labelIds[i], TypedValue.COMPLEX_UNIT_DIP, 16);
                    views.setTextViewTextSize(tempIds[i], TypedValue.COMPLEX_UNIT_DIP, 18);
                }
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

    static public void setWidgetStyle(Context context, int appWidgetId, RemoteViews views) {
        TwWidgetProvider.setWidgetStyle(context, appWidgetId, views);

        int[] labelIds = {R.id.label_yesterday, R.id.label_today, R.id.label_tomorrow};
        int[] tempIds = {R.id.yesterday_temperature, R.id.today_temperature, R.id.tomorrow_temperature};

        if (Build.MANUFACTURER.equals("samsung")) {
            if (Build.VERSION.SDK_INT >= 16) {
                views.setTextViewTextSize(R.id.location, TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(R.id.pubdate, TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(R.id.date, TypedValue.COMPLEX_UNIT_DIP, 18);
                views.setTextViewTextSize(R.id.time, TypedValue.COMPLEX_UNIT_DIP, 46);
                views.setTextViewTextSize(R.id.am_pm, TypedValue.COMPLEX_UNIT_DIP, 14);

                for (int i = 0; i < 3; i++) {
                    views.setTextViewTextSize(labelIds[i], TypedValue.COMPLEX_UNIT_DIP, 16);
                    views.setTextViewTextSize(tempIds[i], TypedValue.COMPLEX_UNIT_DIP, 18);
                }
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

        int fontColor = SettingsActivity.loadFontColorPref(context, appWidgetId);
        views.setTextColor(R.id.location, fontColor);
        views.setTextColor(R.id.pubdate, fontColor);
        for (int i = 0; i < 3; i++) {
            views.setTextColor(labelIds[i], fontColor);
            views.setTextColor(tempIds[i], fontColor);
        }
        if (Build.VERSION.SDK_INT >= 17) {
            views.setTextColor(R.id.date, fontColor);
            views.setTextColor(R.id.time, fontColor);
            views.setTextColor(R.id.am_pm, fontColor);
        }
    }

    static public void setWidgetData(Context context, RemoteViews views, WidgetData wData, Units localUnits) {
        if (wData == null) {
            Log.e(TAG, "weather data is NULL");
            return;
        }

        if (wData.getLoc() != null) {
            // setting town
            views.setTextViewText(R.id.location, wData.getLoc());
        }

        WeatherData currentData = wData.getCurrentWeather();
        if (currentData == null) {
            Log.e(TAG, "currentElement is NULL");
            return;
        }

        Date pubDate = currentData.getPubDate();
        if (pubDate != null) {
            SimpleDateFormat transFormat = new SimpleDateFormat("HH:mm");
            if (currentData.getTimeZoneOffsetMS() != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
                TimeZone tz = TimeZone.getDefault();
                int offset = tz.getRawOffset() - currentData.getTimeZoneOffsetMS();
                pubDate.setTime(pubDate.getTime()+offset);
            }
            views.setTextViewText(R.id.pubdate, context.getString(R.string.update)+" "+transFormat.format(pubDate));
        }
        if (Build.VERSION.SDK_INT >= 17) {
            if (currentData.getTimeZoneOffsetMS() != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
                String zoneIds[] = TimeZone.getAvailableIDs(currentData.getTimeZoneOffsetMS());
                if (zoneIds.length > 0) {
                    views.setString(R.id.time, "setTimeZone", zoneIds[0]);
                    views.setString(R.id.date, "setTimeZone", zoneIds[0]);
                    views.setString(R.id.am_pm, "setTimeZone", zoneIds[0]);
                } else {
                    Log.e(TAG, "Fail to find time zone ids");
                }
            }
        }

        int[] labelIds = {R.id.label_yesterday, R.id.label_today, R.id.label_tomorrow};
        int[] tempIds = {R.id.yesterday_temperature, R.id.today_temperature, R.id.tomorrow_temperature};
        int[] skyIds = {R.id.yesterday_sky, R.id.today_sky, R.id.tomorrow_sky};

        int skyResourceId;

        views.setTextViewText(R.id.label_yesterday, context.getString(R.string.yesterday));
        views.setTextViewText(R.id.label_today, context.getString(R.string.today));
        views.setTextViewText(R.id.label_tomorrow, context.getString(R.string.tomorrow));

        double temp;
        for (int i=0; i<3; i++) {
            WeatherData dayData = wData.getDayWeather(i);
            double minTemperature = dayData.getMinTemperature();
            double maxTemperature = dayData.getMaxTemperature();
            String day_temperature = "";
            if (minTemperature != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL) {
                temp = localUnits.convertUnits(wData.getUnits().getTemperatureUnit(), minTemperature);
                day_temperature += Math.round(temp)+"°";;
            }
            if (maxTemperature != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL) {
                day_temperature += " ";
                temp = localUnits.convertUnits(wData.getUnits().getTemperatureUnit(), maxTemperature);
                day_temperature += Math.round(temp)+"°";;
            }
            views.setTextViewText(tempIds[i], day_temperature);

            if (dayData.getSky() != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
                skyResourceId = context.getResources().getIdentifier(dayData.getSkyImageName(), "drawable", context.getPackageName());
                if (skyResourceId == -1) {
                    skyResourceId = R.drawable.sun;
                }
                views.setImageViewResource(skyIds[i], skyResourceId);
            }
        }
    }
}

