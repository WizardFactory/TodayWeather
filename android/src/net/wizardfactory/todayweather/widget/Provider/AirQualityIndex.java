package net.wizardfactory.todayweather.widget.Provider;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.os.Build;
import android.util.Log;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.Data.WeatherData;
import net.wizardfactory.todayweather.widget.Data.WidgetData;
import net.wizardfactory.todayweather.widget.JsonElement.WeatherElement;
import net.wizardfactory.todayweather.widget.SettingsActivity;

import java.text.SimpleDateFormat;

/**
 * Implementation of App Widget functionality.
 */
public class AirQualityIndex extends TwWidgetProvider {

    public AirQualityIndex() {
        TAG = "W2x1 AirQualityIndex";
        mLayoutId = R.layout.air_quality_index;
    }

    @Override
    protected void setWidgetStyle(AppWidgetManager appWidgetManager, int appWidgetId, RemoteViews views) {
        super.setWidgetStyle(appWidgetManager, appWidgetId, views);

        if (Build.MANUFACTURER.equals("samsung")) {
            if (Build.VERSION.SDK_INT >= 16) {
                views.setTextViewTextSize(R.id.location, TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(R.id.pubdate, TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(R.id.label_aqi, TypedValue.COMPLEX_UNIT_DIP, 18);
                views.setTextViewTextSize(R.id.label_pm10, TypedValue.COMPLEX_UNIT_DIP, 18);
                views.setTextViewTextSize(R.id.label_pm25, TypedValue.COMPLEX_UNIT_DIP, 18);
                views.setTextViewTextSize(R.id.aqi_str, TypedValue.COMPLEX_UNIT_DIP, 12);
                views.setTextViewTextSize(R.id.pm10_str, TypedValue.COMPLEX_UNIT_DIP, 12);
                views.setTextViewTextSize(R.id.pm25_str, TypedValue.COMPLEX_UNIT_DIP, 12);
            }
        }
    }

    static public void setWidgetStyle(Context context, int appWidgetId, RemoteViews views) {
        TwWidgetProvider.setWidgetStyle(context, appWidgetId, views);

        if (Build.MANUFACTURER.equals("samsung")) {
            if (Build.VERSION.SDK_INT >= 16) {
                views.setTextViewTextSize(R.id.location, TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(R.id.pubdate, TypedValue.COMPLEX_UNIT_DIP, 16);
                views.setTextViewTextSize(R.id.label_aqi, TypedValue.COMPLEX_UNIT_DIP, 18);
                views.setTextViewTextSize(R.id.label_pm10, TypedValue.COMPLEX_UNIT_DIP, 18);
                views.setTextViewTextSize(R.id.label_pm25, TypedValue.COMPLEX_UNIT_DIP, 18);
                views.setTextViewTextSize(R.id.aqi_str, TypedValue.COMPLEX_UNIT_DIP, 12);
                views.setTextViewTextSize(R.id.pm10_str, TypedValue.COMPLEX_UNIT_DIP, 12);
                views.setTextViewTextSize(R.id.pm25_str, TypedValue.COMPLEX_UNIT_DIP, 12);
            }
        }

        int fontColor = SettingsActivity.loadFontColorPref(context, appWidgetId);
        views.setTextColor(R.id.location, fontColor);
        views.setTextColor(R.id.pubdate, fontColor);
        views.setTextColor(R.id.errMsg, fontColor);
        views.setTextColor(R.id.label_aqi, fontColor);
        views.setTextColor(R.id.label_pm10, fontColor);
        views.setTextColor(R.id.label_pm25, fontColor);
        views.setTextColor(R.id.aqi_str, fontColor);
        views.setTextColor(R.id.pm10_str, fontColor);
        views.setTextColor(R.id.pm25_str, fontColor);
    }

    static public void setWidgetData(Context context, RemoteViews views, WidgetData wData) {
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

        if (currentData.getAqiPubDate() != null) {
            SimpleDateFormat transFormat = new SimpleDateFormat("HH:mm");
            views.setTextViewText(R.id.pubdate, context.getString(R.string.update)+" "+transFormat.format(currentData.getAqiPubDate()));
        }
        else {
            Log.i(TAG, "Fail to get aqi pub date");
            views.setTextViewText(R.id.errMsg, context.getString(R.string.this_location_is_not_supported));
            views.setViewVisibility(R.id.errMsg, View.VISIBLE);
            return;
        }

        int aqiGrade = currentData.getAqiGrade();
        int pm10Grade = currentData.getPm10Grade();
        int pm25Grade = currentData.getPm25Grade();
        if (aqiGrade != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
            views.setImageViewResource(R.id.current_aqi_emoji, getDrawableFaceEmoji(aqiGrade));
            views.setImageViewResource(R.id.current_pm10_emoji, getDrawableFaceEmoji(pm10Grade));
            views.setImageViewResource(R.id.current_pm25_emoji, getDrawableFaceEmoji(pm25Grade));
        }

        views.setTextViewText(R.id.label_aqi, context.getString(R.string.aqi));
        views.setTextViewText(R.id.label_pm10, context.getString(R.string.pm10));
        views.setTextViewText(R.id.label_pm25, context.getString(R.string.pm25));

        if (aqiGrade != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
            views.setTextViewText(R.id.aqi_str, convertGradeToStr(context, aqiGrade));
        }
        if (pm10Grade != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
            views.setTextViewText(R.id.pm10_str, convertGradeToStr(context, pm10Grade));
        }
        if (pm25Grade != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
            views.setTextViewText(R.id.pm25_str, convertGradeToStr(context, pm25Grade));
        }
    }

    static private int getDrawableFaceEmoji(int grade) {
        switch (grade) {
            case 1:
                return R.drawable.ic_sentiment_satisfied_white_48dp;
            case 2:
                return R.drawable.ic_sentiment_neutral_white_48dp;
            case 3:
                return R.drawable.ic_sentiment_dissatisfied_white_48dp;
            case 4:
                return R.drawable.ic_sentiment_very_dissatisfied_white_48dp;
        }
        return R.drawable.ic_sentiment_very_dissatisfied_white_48dp;
    }
}

