package net.wizardfactory.todayweather.widget;

import android.Manifest;
import android.app.PendingIntent;
import android.app.Service;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.support.v4.app.ActivityCompat;
import android.support.v4.content.ContextCompat;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.Toast;

import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.Data.WeatherData;
import net.wizardfactory.todayweather.widget.Data.WidgetData;
import net.wizardfactory.todayweather.widget.JsonElement.AddressesElement;
import net.wizardfactory.todayweather.widget.JsonElement.WeatherElement;

import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.concurrent.ExecutionException;

/**
 * this class is widget update service.
 * find current position then request server to get weather data.
 * this result json string is parsed and draw to widget.
 */
public class WidgetUpdateService extends Service {
    // if find not location in this time, service is terminated.
    private final static int LOCATION_TIMEOUT = 30 * 1000; // 20sec
    private final static String mUrl = "http://todayweather.wizardfactory.net/v000705/town";

    private LocationManager mLocationManager = null;
    private boolean mIsLocationManagerRemoveUpdates = false;
    private int[] mAppWidgetId = new int[0];
    private Context mContext;
    private AppWidgetManager mAppWidgetManager;
    private int mLayoutId;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {

        // Find the widget id from the intent.
        Bundle extras = intent.getExtras();
        int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
        if (extras != null) {
            widgetId = extras.getInt(
                    AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        }

        // If this activity was started with an intent without an app widget ID, finish with an error.
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            return START_NOT_STICKY;
        }

        startUpdate(widgetId);
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void startUpdate(int widgetId) {
        final Context context = getApplicationContext();
        String jsonCityInfoStr = WidgetProviderConfigureActivity.loadCityInfoPref(context, widgetId);
        boolean currentPosition = true;
        String address = null;

        if (jsonCityInfoStr == null) {
            Log.i("Service", "cityInfo is null, so this widget is zombi");

//            Intent result = new Intent();
//            result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
//            result.setAction(AppWidgetManager.ACTION_APPWIDGET_DELETED);
//            context.sendBroadcast(result);
            return;
        }

        try {
            JSONObject jsonCityInfo = new JSONObject(jsonCityInfoStr);
            currentPosition = jsonCityInfo.getBoolean("currentPosition");
            address = jsonCityInfo.get("address").toString();
        } catch (JSONException e) {
            Log.e("Service", "JSONException: " + e.getMessage());
            return;
        }

        if (currentPosition) {
            Log.i("Service", "Update current postion app widget id=" + widgetId);
            registerLocationUpdates(widgetId);

            // if location do not found in LOCATION_TIMEOUT, this service is stop.
            Runnable myRunnable = new Runnable() {
                public void run() {
                    if (ActivityCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                        // TODO: Consider calling
                        //    ActivityCompat#requestPermissions
                        // here to request the missing permissions, and then overriding
                        //   public void onRequestPermissionsResult(int requestCode, String[] permissions,
                        //                                          int[] grantResults)
                        // to handle the case where the user grants the permission. See the documentation
                        // for ActivityCompat#requestPermissions for more details.
                        return;
                    }
                    mLocationManager.removeUpdates(locationListener);
                    stopSelf();
                }
            };
            Handler myHandler = new Handler();
            myHandler.postDelayed(myRunnable, LOCATION_TIMEOUT);
        } else {
            Log.i("Service", "Update address=" + address + " app widget id=" + widgetId);
            String addr = AddressesElement.makeUrlAddress(address);
            if (addr != null) {
                addr = mUrl + addr;
                String jsonData = getWeatherDataFromServer(addr);
                updateWidget(widgetId, jsonData);
            }
        }
    }

    private void registerLocationUpdates(int widgetId) {
        if (mLocationManager == null) {
            mLocationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        }

        try {
            // once widget update by last location
            Location lastLoc = mLocationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (lastLoc != null) {
                Log.i("Service", "success last location from NETWORK");
                findAddressAndWeatherUpdate(widgetId, lastLoc.getLatitude(), lastLoc.getLongitude());
            } else {
                lastLoc = mLocationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                if (lastLoc != null) {
                    Log.i("Service", "success last location from gps");
                    findAddressAndWeatherUpdate(widgetId, lastLoc.getLatitude(), lastLoc.getLongitude());
                }
            }

            mAppWidgetId = Arrays.copyOf(mAppWidgetId, mAppWidgetId.length + 1);
            mAppWidgetId[mAppWidgetId.length - 1] = widgetId;

            mLocationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 300, 0, locationListener);
            mLocationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, locationListener);
        } catch (SecurityException e) {
            Log.e("Service", e.toString());
            e.printStackTrace();
        }
    }

    private final LocationListener locationListener = new LocationListener() {
        public void onLocationChanged(Location location) {
            double lon = location.getLongitude();
            double lat = location.getLatitude();

            Log.e("Service", "Loc listen lat : " + lat + ", lon: " + lon + " provider " + location.getProvider());

            if (mIsLocationManagerRemoveUpdates == false) {
                // for duplicated call do not occur.
                // flag setting and method call.
                mIsLocationManagerRemoveUpdates = true;

                final Context context = getApplicationContext();
                if (ActivityCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    // TODO: Consider calling
                    //    ActivityCompat#requestPermissions
                    // here to request the missing permissions, and then overriding
                    //   public void onRequestPermissionsResult(int requestCode, String[] permissions,
                    //                                          int[] grantResults)
                    // to handle the case where the user grants the permission. See the documentation
                    // for ActivityCompat#requestPermissions for more details.
                    return;
                }
                mLocationManager.removeUpdates(locationListener);

                for (int i = 0; i < mAppWidgetId.length; i++) {
                    findAddressAndWeatherUpdate(mAppWidgetId[i], lat, lon);
                }
                mAppWidgetId = Arrays.copyOf(mAppWidgetId, 0);
                stopSelf();
            }
        }
        public void onProviderDisabled(String provider) {
        }
        public void onProviderEnabled(String provider) {
        }
        public void onStatusChanged(String provider, int status, Bundle extras) {
        }
    };

    private void findAddressAndWeatherUpdate(int widgetId, double lat, double lon) {
        String addr = location2Address(lat, lon);
        String jsonData = getWeatherDataFromServer(addr);
        updateWidget(widgetId, jsonData);
    }

    private String location2Address(double lat, double lon) {
        String retAddr = null;
        
        Log.i("Service", "lat : " + lat + ", lon " + lon);
        try {
            String geourl = "https://maps.googleapis.com/maps/api/geocode/json?latlng=" +
                    lat + "," + lon + "&sensor=true&language=ko";
            String retJson = new GetHttpsServerAysncTask(geourl).execute().get();

            AddressesElement addrsElement = AddressesElement.parsingAddressJson2String(retJson);
            if (addrsElement == null || addrsElement.getAddrs() == null) {
                Log.e("Service", "Fail to get address of lat : "+ lat + ", lon " + lon);
                Toast.makeText(getApplicationContext(), R.string.fail_to_get_location, Toast.LENGTH_LONG).show();
                return retAddr;
            }

            if (addrsElement != null) {
                retAddr = addrsElement.findDongAddressFromGoogleGeoCodeResults();
                retAddr = addrsElement.makeUrlAddress(retAddr);
            }
            retAddr = mUrl + retAddr;
        } catch (InterruptedException e) {
            Log.e("Service", e.toString());
            e.printStackTrace();
        } catch (ExecutionException e) {
            Log.e("Service", e.toString());
            e.printStackTrace();
        }

        Log.e("Service", retAddr);
        return retAddr;
    }

    private String getWeatherDataFromServer(String loc) {
        String retJsonStr = null;

        if (loc != null) {
            try {
                String jsonStr = new GetHttpsServerAysncTask(loc).execute().get();
                if (jsonStr != null && jsonStr.length() > 0) {
                    retJsonStr = jsonStr;
                }
            } catch (InterruptedException e) {
                Log.e("WidgetUpdateService", "InterruptedException: " + e.getMessage());
                e.printStackTrace();
            } catch (ExecutionException e) {
                Log.e("WidgetUpdateService", "ExecutionException: " + e.getMessage());
                e.printStackTrace();
            }
        }
        else {
            Log.e("WidgetUpdateService", "location is NULL");
        }

        return retJsonStr;
    }

    /**
     * location listener에서 widgetId가 업데이트됨.
     * @param widgetId
     * @param jsonStr
     */
    private void updateWidget(int widgetId, String jsonStr) {
        if (jsonStr == null) {
            Log.e("WidgetUpdateService", "jsonData is NULL");
            return;
        }
        Log.i("Service", "jsonStr: " + jsonStr);

        // parsing json string to weather class
        WeatherElement weatherElement = WeatherElement.parsingWeatherElementString2Json(jsonStr);
        if (weatherElement == null) {
            Log.e("WidgetUpdateService", "weatherElement is NULL");
            return;
        }

        /**
         * context, manager를 member 변수로 변환하면 단순해지지만 동작 확인 필요.
         */
        mContext = getApplicationContext();
        mAppWidgetManager = AppWidgetManager.getInstance(mContext);
        mLayoutId = mAppWidgetManager.getAppWidgetInfo(widgetId).initialLayout;

        // make today, yesterday weather info class
        WidgetData wData = weatherElement.makeWidgetData();

        if (mLayoutId == R.layout.w2x1_widget_layout) {
            set2x1WidgetData(widgetId, wData);
        }
        else if (mLayoutId == R.layout.w1x1_current_weather) {
            set1x1WidgetData(widgetId, wData);
        }
        else if (mLayoutId == R.layout.w2x1_current_weather) {
            set2x1CurrentWeather(widgetId, wData);
        }
        else if (mLayoutId == R.layout.air_quality_index) {
            setAirQualityIndex(widgetId, wData);
        }
        else if (mLayoutId == R.layout.clock_and_current_weather) {
            setClockAndCurrentWeather(widgetId, wData);
        }
        else if (mLayoutId == R.layout.current_weather_and_three_days) {
            setCurrentWeatherAndThreeDays(widgetId, wData);
        }
        else if (mLayoutId == R.layout.daily_weather) {
            setDailyWeather(widgetId, wData);
        }
        else if (mLayoutId == R.layout.clock_and_three_days) {
            setClockAndThreedays(widgetId, wData);
        }
    }

    private void setClockAndThreedays(int widgetId, WidgetData wData) {
        if (wData == null) {
            Log.e("UpdateWidgetService", "weather data is NULL");
            return;
        }

        RemoteViews views = new RemoteViews(mContext.getPackageName(), mLayoutId);

        // setting town
        if (wData.getLoc() != null) {
            views.setTextViewText(R.id.location, wData.getLoc());
        }

        WeatherData currentData = wData.getCurrentWeather();
        if (currentData == null) {
            Log.e("UpdateWidgetService", "currentElement is NULL");
            return;
        }
        if (currentData.getPubDate() != null) {
            SimpleDateFormat transFormat = new SimpleDateFormat("HH:mm");
            views.setTextViewText(R.id.pubdate, transFormat.format(currentData.getPubDate()));
        }

        int[] labelIds = {R.id.label_yesterday, R.id.label_today, R.id.label_tomorrow};
        int[] tempIds = {R.id.yesterday_temperature, R.id.today_temperature, R.id.tomorrow_temperature};
        int[] skyIds = {R.id.yesterday_sky, R.id.today_sky, R.id.tomorrow_sky};

        int skyResourceId;

        for (int i=0; i<3; i++) {
            WeatherData dayData = wData.getDayWeather(i);
            String day_temperature = "";
            if (dayData.getMinTemperature() != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL) {
                day_temperature += (int)dayData.getMinTemperature()+"°";;
            }
            if (dayData.getMaxTemperature() != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL) {
                day_temperature += (int)dayData.getMaxTemperature()+"°";;
            }
            views.setTextViewText(tempIds[i], day_temperature);

            if (dayData.getSky() != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
                skyResourceId = getResources().getIdentifier(dayData.getSkyImageName(), "drawable", getPackageName());
                if (skyResourceId == -1) {
                    skyResourceId = R.drawable.sun;
                }
                views.setImageViewResource(skyIds[i], skyResourceId);
            }
        }

        // Create an Intent to launch menu
        Intent intent = new Intent(mContext, WidgetMenuActivity.class);
        intent.putExtra("LAYOUT_ID", mLayoutId);
        PendingIntent pendingIntent = PendingIntent.getActivity(mContext, widgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.bg_layout, pendingIntent);

        Log.i("UpdateWidgetService", "set 4x1 clock and three days id=" + widgetId);
        mAppWidgetManager.updateAppWidget(widgetId, views);
    }

    private void setDailyWeather(int widgetId, WidgetData wData) {
        if (wData == null) {
            Log.e("UpdateWidgetService", "weather data is NULL");
            return;
        }

        RemoteViews views = new RemoteViews(mContext.getPackageName(), mLayoutId);

        // setting town
        if (wData.getLoc() != null) {
            views.setTextViewText(R.id.location, wData.getLoc());
        }

        WeatherData currentData = wData.getCurrentWeather();
        if (currentData == null) {
            Log.e("UpdateWidgetService", "currentElement is NULL");
            return;
        }
        if (currentData.getPubDate() != null) {
            SimpleDateFormat transFormat = new SimpleDateFormat("HH:mm");
            views.setTextViewText(R.id.pubdate, transFormat.format(currentData.getPubDate()));
        }

        int[] labelIds = {R.id.label_yesterday, R.id.label_today, R.id.label_tomorrow,
                R.id.label_twodays, R.id.label_threedays};
        int[] tempIds = {R.id.yesterday_temperature, R.id.today_temperature,
                R.id.tomorrow_temperature, R.id.twodays_temperature, R.id.threedays_temperature};
        int[] skyIds = {R.id.yesterday_sky, R.id.today_sky,
                R.id.tomorrow_sky, R.id.twodays_sky, R.id.threedays_sky};

        int skyResourceId;

        for (int i=0; i<5; i++) {
            WeatherData dayData = wData.getDayWeather(i);
            String day_temperature = "";
            if (dayData.getMinTemperature() != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL) {
                day_temperature += (int)dayData.getMinTemperature()+"°";;
            }
            if (dayData.getMaxTemperature() != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL) {
                day_temperature += (int)dayData.getMaxTemperature()+"°";;
            }
            views.setTextViewText(tempIds[i], day_temperature);

            if (dayData.getSky() != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
                skyResourceId = getResources().getIdentifier(dayData.getSkyImageName(), "drawable", getPackageName());
                if (skyResourceId == -1) {
                    skyResourceId = R.drawable.sun;
                }
                views.setImageViewResource(skyIds[i], skyResourceId);
            }

            if (i > 2 && dayData.getDate() != null) {
                SimpleDateFormat transFormat = new SimpleDateFormat("dd");
                views.setTextViewText(labelIds[i], transFormat.format(dayData.getDate()));
            }
        }

        // Create an Intent to launch menu
        Intent intent = new Intent(mContext, WidgetMenuActivity.class);
        intent.putExtra("LAYOUT_ID", mLayoutId);
        PendingIntent pendingIntent = PendingIntent.getActivity(mContext, widgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.bg_layout, pendingIntent);

        Log.i("UpdateWidgetService", "set 4x1 daily weather id=" + widgetId);
        mAppWidgetManager.updateAppWidget(widgetId, views);
    }

    private String makeTmnTmxPmPpStr(WeatherData data) {
        String today_tmn_tmx_pm_pp = "";
        if (data.getMinTemperature() != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL)  {
            today_tmn_tmx_pm_pp += String.valueOf((int) data.getMinTemperature())+"°";
        }
        if (data.getMaxTemperature() != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL)  {
            today_tmn_tmx_pm_pp += " ";
            today_tmn_tmx_pm_pp += String.valueOf((int) data.getMaxTemperature())+"°";
        }

        if (data.getRn1() != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL && data.getRn1() != 0 ) {
            today_tmn_tmx_pm_pp += " ";
            if (data.getRn1Str() != null) {
                today_tmn_tmx_pm_pp += data.getRn1Str();
            }
            else {
                today_tmn_tmx_pm_pp += data.getRn1();
            }
        }
        else {
            if (data.getPm10Grade() != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
                today_tmn_tmx_pm_pp += " ";
                if (data.getPm25Grade() != WeatherElement.DEFAULT_WEATHER_INT_VAL
                        && data.getPm25Grade() > data.getPm10Grade()) {
                    today_tmn_tmx_pm_pp += data.getPm25Str();
                } else {
                    today_tmn_tmx_pm_pp += data.getPm10Str();
                }
            } else if (data.getPm25Grade() != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
                today_tmn_tmx_pm_pp += " ";
                today_tmn_tmx_pm_pp += data.getPm25Str();
            }
        }
        return today_tmn_tmx_pm_pp;
    }

    private void setCurrentWeatherAndThreeDays(int widgetId, WidgetData wData) {
        if (wData == null) {
            Log.e("UpdateWidgetService", "weather data is NULL");
            return;
        }

        RemoteViews views = new RemoteViews(mContext.getPackageName(), mLayoutId);

        // setting town
        if (wData.getLoc() != null) {
            views.setTextViewText(R.id.location, wData.getLoc());
        }

        WeatherData currentData = wData.getCurrentWeather();
        if (currentData == null) {
            Log.e("UpdateWidgetService", "currentElement is NULL");
            return;
        }
        if (currentData.getPubDate() != null) {
            SimpleDateFormat transFormat = new SimpleDateFormat("HH:mm");
            views.setTextViewText(R.id.pubdate, transFormat.format(currentData.getPubDate()));
        }

        views.setTextViewText(R.id.current_temperature, String.valueOf((int)currentData.getTemperature()+"°"));

        int skyResourceId = getResources().getIdentifier(currentData.getSkyImageName(), "drawable", getPackageName());
        if (skyResourceId == -1) {
            skyResourceId = R.drawable.sun;
        }
        views.setImageViewResource(R.id.current_sky, skyResourceId);

        views.setTextViewText(R.id.tmn_tmx_pm_pp, makeTmnTmxPmPpStr(currentData));

        int[] labelIds = {R.id.label_yesterday, R.id.label_today, R.id.label_tomorrow};
        int[] tempIds = {R.id.yesterday_temperature, R.id.today_temperature, R.id.tomorrow_temperature};
        int[] skyIds = {R.id.yesterday_sky, R.id.today_sky, R.id.tomorrow_sky};

        for (int i=0; i<3; i++) {
            WeatherData dayData = wData.getDayWeather(i);
            String day_temperature = "";
            if (dayData.getMinTemperature() != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL) {
                day_temperature += (int)dayData.getMinTemperature()+"°";;
            }
            if (dayData.getMaxTemperature() != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL) {
                day_temperature += (int)dayData.getMaxTemperature()+"°";;
            }
            views.setTextViewText(tempIds[i], day_temperature);

            if (dayData.getSky() != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
                skyResourceId = getResources().getIdentifier(dayData.getSkyImageName(), "drawable", getPackageName());
                if (skyResourceId == -1) {
                    skyResourceId = R.drawable.sun;
                }
                views.setImageViewResource(skyIds[i], skyResourceId);
            }
        }

        // Create an Intent to launch menu
        Intent intent = new Intent(mContext, WidgetMenuActivity.class);
        intent.putExtra("LAYOUT_ID", mLayoutId);
        PendingIntent pendingIntent = PendingIntent.getActivity(mContext, widgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.bg_layout, pendingIntent);

        Log.i("UpdateWidgetService", "set 3x1 clock and current weather id=" + widgetId);
        mAppWidgetManager.updateAppWidget(widgetId, views);
    }

    private void setClockAndCurrentWeather(int widgetId, WidgetData wData) {
        if (wData == null) {
            Log.e("UpdateWidgetService", "weather data is NULL");
            return;
        }

        RemoteViews views = new RemoteViews(mContext.getPackageName(), mLayoutId);

        // setting town
        if (wData.getLoc() != null) {
            views.setTextViewText(R.id.location, wData.getLoc());
        }

        WeatherData currentData = wData.getCurrentWeather();
        if (currentData == null) {
            Log.e("UpdateWidgetService", "currentElement is NULL");
            return;
        }
        if (currentData.getPubDate() != null) {
            SimpleDateFormat transFormat = new SimpleDateFormat("HH:mm");
            views.setTextViewText(R.id.pubdate, transFormat.format(currentData.getPubDate()));
        }

        views.setTextViewText(R.id.current_temperature, String.valueOf((int)currentData.getTemperature()+"°"));

        int skyResourceId = getResources().getIdentifier(currentData.getSkyImageName(), "drawable", getPackageName());
        if (skyResourceId == -1) {
            skyResourceId = R.drawable.sun;
        }
        views.setImageViewResource(R.id.current_sky, skyResourceId);

        views.setTextViewText(R.id.tmn_tmx_pm_pp, makeTmnTmxPmPpStr(currentData));

        // Create an Intent to launch menu
        Intent intent = new Intent(mContext, WidgetMenuActivity.class);
        intent.putExtra("LAYOUT_ID", mLayoutId);
        PendingIntent pendingIntent = PendingIntent.getActivity(mContext, widgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.bg_layout, pendingIntent);

        Log.i("UpdateWidgetService", "set 3x1 clock and current weather id=" + widgetId);
        mAppWidgetManager.updateAppWidget(widgetId, views);
    }

    /**
     *
     * @param grade
     * @return
     */
    private int getDrawableFaceEmoji(int grade) {
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

    private void setAirQualityIndex(int widgetId, WidgetData wData) {
        if (wData == null) {
            Log.e("UpdateWidgetService", "weather data is NULL");
            return;
        }

        RemoteViews views = new RemoteViews(mContext.getPackageName(), mLayoutId);

        // setting town
        if (wData.getLoc() != null) {
            views.setTextViewText(R.id.location, wData.getLoc());
        }

        WeatherData currentData = wData.getCurrentWeather();
        if (currentData == null) {
            Log.e("UpdateWidgetService", "currentElement is NULL");
            return;
        }

        if (currentData.getAqiPubDate() != null) {
            SimpleDateFormat transFormat = new SimpleDateFormat("HH:mm");
            views.setTextViewText(R.id.pubdate, transFormat.format(currentData.getAqiPubDate()));
        }

        if (currentData.getAqiGrade() != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
            views.setImageViewResource(R.id.current_aqi_emoji, getDrawableFaceEmoji(currentData.getAqiGrade()));
            views.setImageViewResource(R.id.current_pm10_emoji, getDrawableFaceEmoji(currentData.getPm10Grade()));
            views.setImageViewResource(R.id.current_pm25_emoji, getDrawableFaceEmoji(currentData.getPm25Grade()));
        }

        if (currentData.getAqiStr() != null) {
            views.setTextViewText(R.id.aqi_str, currentData.getAqiStr());
        }
        if (currentData.getPm10Str() != null) {
            views.setTextViewText(R.id.pm10_str, currentData.getPm10Str());
        }
        if (currentData.getPm25Str() != null) {
            views.setTextViewText(R.id.pm25_str, currentData.getPm25Str());
        }

        // Create an Intent to launch menu
        Intent intent = new Intent(mContext, WidgetMenuActivity.class);
        intent.putExtra("LAYOUT_ID", mLayoutId);
        PendingIntent pendingIntent = PendingIntent.getActivity(mContext, widgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.bg_layout, pendingIntent);

        Log.i("UpdateWidgetService", "set air quality index id=" + widgetId);
        mAppWidgetManager.updateAppWidget(widgetId, views);
    }

    private void set2x1CurrentWeather(int widgetId, WidgetData wData) {
        if (wData == null) {
            Log.e("UpdateWidgetService", "weather data is NULL");
            return;
        }

        RemoteViews views = new RemoteViews(mContext.getPackageName(), mLayoutId);

        // setting town
        if (wData.getLoc() != null) {
            views.setTextViewText(R.id.location, wData.getLoc());
        }

        WeatherData currentData = wData.getCurrentWeather();
        if (currentData == null) {
            Log.e("UpdateWidgetService", "currentElement is NULL");
            return;
        }
        if (currentData.getPubDate() != null) {
            SimpleDateFormat transFormat = new SimpleDateFormat("HH:mm");
            views.setTextViewText(R.id.pubdate, transFormat.format(currentData.getPubDate()));
        }

        views.setTextViewText(R.id.current_temperature, String.valueOf((int)currentData.getTemperature()+"°"));

        int skyResourceId = getResources().getIdentifier(currentData.getSkyImageName(), "drawable", getPackageName());
        if (skyResourceId == -1) {
            skyResourceId = R.drawable.sun;
        }
        views.setImageViewResource(R.id.current_sky, skyResourceId);

        if (currentData.getRn1() != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL && currentData.getRn1() != 0 ) {

            if (currentData.getRn1Str() != null) {
                views.setTextViewText(R.id.current_pm, currentData.getRn1Str());
            }
            else {
                views.setTextViewText(R.id.current_pm, String.valueOf(currentData.getRn1()));
            }
        }
        else {
            if (currentData.getPm10Grade() != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
                if (currentData.getPm25Grade() != WeatherElement.DEFAULT_WEATHER_INT_VAL
                        && currentData.getPm25Grade() > currentData.getPm10Grade()) {
                    views.setTextViewText(R.id.current_pm, "::: "+currentData.getPm25Str());
                }
                else {
                    views.setTextViewText(R.id.current_pm, "::: "+currentData.getPm10Str());
                }
            }
            else if (currentData.getPm25Grade() != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
                views.setTextViewText(R.id.current_pm, "::: "+currentData.getPm25Str());
            }
        }

        String today_temperature = "";
        if (currentData.getMinTemperature() != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL)  {
            today_temperature += String.valueOf((int) currentData.getMinTemperature())+"°";
        }
        if (currentData.getMaxTemperature() != WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL)  {
            today_temperature += " ";
            today_temperature += String.valueOf((int) currentData.getMaxTemperature())+"°";
        }
        views.setTextViewText(R.id.today_temperature, today_temperature);

        // Create an Intent to launch menu
        Intent intent = new Intent(mContext, WidgetMenuActivity.class);
        intent.putExtra("LAYOUT_ID", mLayoutId);
        PendingIntent pendingIntent = PendingIntent.getActivity(mContext, widgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.bg_layout, pendingIntent);

        Log.i("UpdateWidgetService", "set 2x1 current weather id=" + widgetId);
        mAppWidgetManager.updateAppWidget(widgetId, views);
    }

    private int getColorAqiGrade(int grade) {
        switch (grade) {
            case 1:
                return ContextCompat.getColor(mContext, android.R.color.holo_blue_dark);
            case 2:
                return ContextCompat.getColor(mContext, android.R.color.holo_green_dark);
            case 3:
                return ContextCompat.getColor(mContext, android.R.color.holo_orange_dark);
            case 4:
                return ContextCompat.getColor(mContext, android.R.color.holo_red_dark);
        }
        return ContextCompat.getColor(mContext, android.R.color.primary_text_dark);
    }

    private void set1x1WidgetData(int widgetId, WidgetData wData) {
        if (wData == null) {
            Log.e("UpdateWidgetService", "weather data is NULL");
            return;
        }

        RemoteViews views = new RemoteViews(mContext.getPackageName(), R.layout.w1x1_current_weather);

        // setting town
        if (wData.getLoc() != null) {
            views.setTextViewText(R.id.location, wData.getLoc());
        }

        WeatherData currentData = wData.getCurrentWeather();
        if (currentData == null) {
            Log.e("UpdateWidgetService", "currentElement is NULL");
            return;
        }

        views.setTextViewText(R.id.current_temperature, String.valueOf((int)currentData.getTemperature()+"°"));

        int skyResourceId = getResources().getIdentifier(currentData.getSkyImageName(), "drawable", getPackageName());
        if (skyResourceId == -1) {
            skyResourceId = R.drawable.sun;
        }
        views.setImageViewResource(R.id.current_sky, skyResourceId);

        if (currentData.getPm10Grade() != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
            if (currentData.getPm25Grade() != WeatherElement.DEFAULT_WEATHER_INT_VAL
                    && currentData.getPm25Grade() > currentData.getPm10Grade()) {
                views.setTextColor(R.id.current_pm, getColorAqiGrade(currentData.getPm25Grade()));
            }
            else {
                views.setTextColor(R.id.current_pm, getColorAqiGrade(currentData.getPm10Grade()));
            }
        }
        else if (currentData.getPm25Grade() != WeatherElement.DEFAULT_WEATHER_INT_VAL) {
            views.setTextColor(R.id.current_pm, getColorAqiGrade(currentData.getPm25Grade()));
        }

        // Create an Intent to launch menu
        Intent intent = new Intent(mContext, WidgetMenuActivity.class);
        intent.putExtra("LAYOUT_ID", mLayoutId);
        PendingIntent pendingIntent = PendingIntent.getActivity(mContext, widgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.bg_layout, pendingIntent);

        Log.i("UpdateWidgetService", "set 1x1WidgetData id=" + widgetId);
        mAppWidgetManager.updateAppWidget(widgetId, views);
    }

    private void set2x1WidgetData(int widgetId, WidgetData wData) {
        Context context = getApplicationContext();
        // input weather content to widget layout

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.w2x1_widget_layout);

        if (wData != null) {
            // setting town
            if (wData.getLoc() != null) {
                views.setTextViewText(R.id.location, wData.getLoc());
            }

            // process current weather data
            WeatherData currentData = wData.getCurrentWeather();
            if (currentData != null) {
                views.setTextViewText(R.id.yesterday_temperature, String.valueOf((int)currentData.getTemperature()));
                views.setTextViewText(R.id.today_high_temperature, String.valueOf((int) currentData.getMaxTemperature()));
                views.setTextViewText(R.id.today_low_temperature, String.valueOf((int) currentData.getMinTemperature()));
//                views.setTextViewText(R.id.cmp_yesterday_temperature, currentData.getSummary());
                int skyResourceId = getResources().getIdentifier(currentData.getSkyImageName(), "drawable", getPackageName());
                if (skyResourceId == -1) {
                    skyResourceId = R.drawable.sun;
                }
                views.setImageViewResource(R.id.current_sky, skyResourceId);
            } else {
                Log.e("UpdateWidgetService", "todayElement is NULL");
            }

            // process yesterday that same as current time, weather data
            WeatherData yesterdayData = wData.getBefore24hWeather();
            if (yesterdayData != null) {
                views.setTextViewText(R.id.yesterday_high_temperature, String.valueOf((int) yesterdayData.getMaxTemperature()));
                views.setTextViewText(R.id.yesterday_low_temperature, String.valueOf((int) yesterdayData.getMinTemperature()));
            } else {
                Log.e("UpdateWidgetService", "yesterdayElement is NULL");
            }

            double cmpTemp = 0;
            String cmpYesterdayTemperatureStr = "";
            if (currentData != null && yesterdayData != null) {
                cmpTemp = currentData.getTemperature() - yesterdayData.getTemperature();
                if (cmpTemp == 0) {
                    cmpYesterdayTemperatureStr = context.getString(R.string.same_yesterday);
                }
                else if (cmpTemp > 0) {
                    cmpYesterdayTemperatureStr = context.getString(R.string.cmp_yesterday) + " "
                            + String.valueOf(Math.round(cmpTemp)) + context.getString(R.string.degree) + " "
                            + context.getString(R.string.high);
                }
                else {
                    cmpYesterdayTemperatureStr = context.getString(R.string.cmp_yesterday) + " "
                            + String.valueOf(Math.round(Math.abs(cmpTemp))) + context.getString(R.string.degree) + " "
                            + context.getString(R.string.low);
                }
                views.setTextViewText(R.id.cmp_yesterday_temperature, cmpYesterdayTemperatureStr);
            }

            // Create an Intent to launch menu
            Intent intent = new Intent(context, WidgetMenuActivity.class);
            intent.putExtra("LAYOUT_ID", mLayoutId);
//            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
            PendingIntent pendingIntent = PendingIntent.getActivity(context, widgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT);
            views.setOnClickPendingIntent(R.id.bg_layout, pendingIntent);

            // weather content is visible
            views.setViewVisibility(R.id.msg_layout, View.GONE);
            views.setViewVisibility(R.id.weather_layout, View.VISIBLE);

            Log.i("UpdateWidgetService", "set2x1WidgetData id=" + widgetId);
            AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
            appWidgetManager.updateAppWidget(widgetId, views);
        }
    }
}// class end
