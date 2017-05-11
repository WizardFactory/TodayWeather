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
public class ClockAndCurrentWeather extends TwWidgetProvider {

    public ClockAndCurrentWeather() {
        TAG = "W3x1 ClockAndCurrentWeather";
        mLayoutId = R.layout.clock_and_current_weather;
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
                views.setTextViewTextSize(R.id.tmn_tmx_pm_pp, TypedValue.COMPLEX_UNIT_DIP, 18);
                views.setTextViewTextSize(R.id.current_temperature, TypedValue.COMPLEX_UNIT_DIP, 46);
            }
        }

        if (Build.VERSION.SDK_INT >= 17) {
            views.setViewVisibility(R.id.time, View.VISIBLE);
            views.setViewVisibility(R.id.date, View.VISIBLE);
            views.setViewVisibility(R.id.am_pm, View.VISIBLE);
        } else {
            views.setViewVisibility(R.id.analogClock, View.VISIBLE);
        }
    }

    static public void setWidgetStyle(Context context, int appWidgetId, RemoteViews views) {
        TwWidgetProvider.setWidgetStyle(context, appWidgetId, views);

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

        int fontColor = SettingsActivity.loadFontColorPref(context, appWidgetId);
        views.setTextColor(R.id.location, fontColor);
        views.setTextColor(R.id.pubdate, fontColor);
        views.setTextColor(R.id.tmn_tmx_pm_pp, fontColor);
        views.setTextColor(R.id.current_temperature, fontColor);
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

        String tempStr = localUnits.convertUnitsStr(wData.getUnits().getTemperatureUnit(), currentData.getTemperature());
        views.setTextViewText(R.id.current_temperature, tempStr+"°");

        int skyResourceId = context.getResources().getIdentifier(currentData.getSkyImageName(), "drawable", context.getPackageName());
        if (skyResourceId == -1) {
            skyResourceId = R.drawable.sun;
        }
        views.setImageViewResource(R.id.current_sky, skyResourceId);
        views.setTextViewText(R.id.tmn_tmx_pm_pp, makeTmnTmxPmPpStr(context, wData, localUnits));
    }

    static protected String makeTmnTmxPmPpStr(Context context, WidgetData wData, Units localUnits) {
        WeatherData data = wData.getCurrentWeather();

        double minTemperature = data.getMinTemperature();
        double maxTemperature = data.getMaxTemperature();
        double temp;
        String today_tmn_tmx_pm_pp = "";
        if (minTemperature != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL)  {
            temp = localUnits.convertUnits(wData.getUnits().getTemperatureUnit(), minTemperature);
            today_tmn_tmx_pm_pp += String.valueOf(Math.round(temp))+"°";
        }
        if (maxTemperature != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL)  {
            today_tmn_tmx_pm_pp += " ";
            temp = localUnits.convertUnits(wData.getUnits().getTemperatureUnit(), maxTemperature);
            today_tmn_tmx_pm_pp += String.valueOf(Math.round(temp))+"°";
        }

        double rn1 = data.getRn1();
        if (rn1 != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL && rn1 != 0 ) {
            today_tmn_tmx_pm_pp += " ";
            String precipStr = localUnits.convertUnitsStr(wData.getUnits().getPrecipitationUnit(), rn1);
            today_tmn_tmx_pm_pp += precipStr+localUnits.getPrecipitationUnit();
        }
        else {
            int pm10Grade = data.getPm10Grade();
            int pm25Grade = data.getPm25Grade();
            if (pm10Grade != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
                today_tmn_tmx_pm_pp += " ";
                if (pm25Grade != WeatherElement.DEFAULT_WEATHER_INT_VAL && pm25Grade > pm10Grade) {
                    today_tmn_tmx_pm_pp += convertGradeToStr(context, pm25Grade);
                } else {
                    today_tmn_tmx_pm_pp += convertGradeToStr(context, pm10Grade);
                }
            } else if (pm25Grade != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
                today_tmn_tmx_pm_pp += " ";
                today_tmn_tmx_pm_pp += convertGradeToStr(context, pm25Grade);
            }
        }
        return today_tmn_tmx_pm_pp;
    }
}

