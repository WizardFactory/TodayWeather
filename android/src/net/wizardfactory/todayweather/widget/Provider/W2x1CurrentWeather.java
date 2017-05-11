package net.wizardfactory.todayweather.widget.Provider;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.os.Build;
import android.util.Log;
import android.util.TypedValue;
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
public class W2x1CurrentWeather extends TwWidgetProvider {

    public W2x1CurrentWeather() {
        TAG = "W1x1 CurrentWeather";
        mLayoutId = R.layout.w2x1_current_weather;
    }

    @Override
    protected void setWidgetStyle(AppWidgetManager appWidgetManager, int appWidgetId, RemoteViews views) {
        super.setWidgetStyle(appWidgetManager, appWidgetId, views);

        if (Build.MANUFACTURER.equals("samsung")) {
            if (Build.VERSION.SDK_INT >= 16) {
                views.setTextViewTextSize(R.id.location, TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(R.id.pubdate, TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(R.id.today_temperature, TypedValue.COMPLEX_UNIT_DIP, 20);
                views.setTextViewTextSize(R.id.current_pm, TypedValue.COMPLEX_UNIT_DIP, 20);
                views.setTextViewTextSize(R.id.current_temperature, TypedValue.COMPLEX_UNIT_DIP, 48);
            }
        }
    }

    static public void setWidgetStyle(Context context, int appWidgetId, RemoteViews views) {
        TwWidgetProvider.setWidgetStyle(context, appWidgetId, views);

        if (Build.MANUFACTURER.equals("samsung")) {
            if (Build.VERSION.SDK_INT >= 16) {
                views.setTextViewTextSize(R.id.location, TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(R.id.pubdate, TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(R.id.today_temperature, TypedValue.COMPLEX_UNIT_DIP, 20);
                views.setTextViewTextSize(R.id.current_pm, TypedValue.COMPLEX_UNIT_DIP, 20);
                views.setTextViewTextSize(R.id.current_temperature, TypedValue.COMPLEX_UNIT_DIP, 48);
            }
        }

        int fontColor = SettingsActivity.loadFontColorPref(context, appWidgetId);
        views.setTextColor(R.id.location, fontColor);
        views.setTextColor(R.id.today_temperature, fontColor);
        views.setTextColor(R.id.current_temperature, fontColor);
        views.setTextColor(R.id.pubdate, fontColor);
        views.setTextColor(R.id.current_pm, fontColor);
    }

    static public void setWidgetData(Context context, RemoteViews views, WidgetData wData, Units localUnits) {
        if (wData == null) {
            Log.e(TAG, "weather data is NULL");
            return;
        }

        if (wData.getLoc() != null) {
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
                pubDate.setTime(pubDate.getTime() + offset);
            }
            views.setTextViewText(R.id.pubdate, context.getString(R.string.update) + " " + transFormat.format(pubDate));
        }

        String tempStr = localUnits.convertUnitsStr(wData.getUnits().getTemperatureUnit(), currentData.getTemperature());
        views.setTextViewText(R.id.current_temperature, tempStr+"°");

        int skyResourceId = context.getResources().getIdentifier(currentData.getSkyImageName(), "drawable", context.getPackageName());
        if (skyResourceId == -1) {
            skyResourceId = R.drawable.sun;
        }
        views.setImageViewResource(R.id.current_sky, skyResourceId);

        double rn1 = currentData.getRn1();
        if (rn1 != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL && rn1 != 0 ) {
            String precipStr = localUnits.convertUnitsStr(wData.getUnits().getPrecipitationUnit(), rn1);
            views.setTextViewText(R.id.current_pm, precipStr + localUnits.getPrecipitationUnit());
        }
        else {
            int pm10Grade = currentData.getPm10Grade();
            int pm25Grade = currentData.getPm25Grade();
            if (pm10Grade != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
                if (pm25Grade != WeatherElement.DEFAULT_WEATHER_INT_VAL && pm25Grade > pm10Grade) {
                    views.setTextViewText(R.id.current_pm, "::: "+convertGradeToStr(context, pm25Grade));
                }
                else {
                    views.setTextViewText(R.id.current_pm, "::: "+convertGradeToStr(context, pm10Grade));
                }
            }
            else if (pm25Grade != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
                views.setTextViewText(R.id.current_pm, "::: "+convertGradeToStr(context, pm25Grade));
            }
        }

        double minTemperature = currentData.getMinTemperature();
        double maxTemperature = currentData.getMaxTemperature();
        double temp;
        String today_temperature = "";
        if (minTemperature != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL)  {
            temp = localUnits.convertUnits(wData.getUnits().getTemperatureUnit(), minTemperature);
            today_temperature += String.valueOf(Math.round(temp))+"°";
        }
        if (maxTemperature != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL)  {
            today_temperature += " ";
            temp = localUnits.convertUnits(wData.getUnits().getTemperatureUnit(), maxTemperature);
            today_temperature += String.valueOf(Math.round(temp))+"°";
        }
        views.setTextViewText(R.id.today_temperature, today_temperature);
    }
}

