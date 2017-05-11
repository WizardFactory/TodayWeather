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
import android.util.Log;
import android.widget.RemoteViews;
import android.widget.Toast;

import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.Data.Units;
import net.wizardfactory.todayweather.widget.Data.WidgetData;
import net.wizardfactory.todayweather.widget.JsonElement.AddressesElement;
import net.wizardfactory.todayweather.widget.JsonElement.GeoInfo;
import net.wizardfactory.todayweather.widget.JsonElement.WeatherElement;
import net.wizardfactory.todayweather.widget.JsonElement.WorldWeatherElement;
import net.wizardfactory.todayweather.widget.Provider.AirQualityIndex;
import net.wizardfactory.todayweather.widget.Provider.ClockAndCurrentWeather;
import net.wizardfactory.todayweather.widget.Provider.ClockAndThreeDays;
import net.wizardfactory.todayweather.widget.Provider.CurrentWeatherAndThreeDays;
import net.wizardfactory.todayweather.widget.Provider.DailyWeather;
import net.wizardfactory.todayweather.widget.Provider.W1x1CurrentWeather;
import net.wizardfactory.todayweather.widget.Provider.W2x1CurrentWeather;
import net.wizardfactory.todayweather.widget.Provider.W2x1WidgetProvider;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.ExecutionException;

/**
 * this class is widget update service.
 * find current position then request server to get weather data.
 * this result json string is parsed and draw to widget.
 */
public class WidgetUpdateService extends Service {
    // if find not location in this time, service is terminated.
    private final static int LOCATION_TIMEOUT = 30 * 1000; // 20sec
    private final static String mUrl = "https://todayweather.wizardfactory.net";
    private final static String kmaApiUrl = "/v000803/town";
    private final static String worldWeatherApiUrl = "/ww/010000/current/2?gcode=";

    private LocationManager mLocationManager = null;
    private boolean mIsLocationManagerRemoveUpdates = false;
    private int[] mAppWidgetId = new int[0];
    private Context mContext;
    private AppWidgetManager mAppWidgetManager;
    private int mLayoutId;

    private Units mLocalUnits = null;

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
        String jsonCityInfoStr = SettingsActivity.loadCityInfoPref(context, widgetId);
        boolean currentPosition = true;
        JSONObject location = null;
        GeoInfo geoInfo = new GeoInfo();

        if (jsonCityInfoStr == null) {
            Log.i("Service", "cityInfo is null, so this widget is zombi");

//            Intent result = new Intent();
//            result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
//            result.setAction(AppWidgetManager.ACTION_APPWIDGET_DELETED);
//            context.sendBroadcast(result);
            return;
        }

        Units units = SettingsActivity.loadUnitsPref(context);

        try {
            JSONObject jsonCityInfo = new JSONObject(jsonCityInfoStr);
            currentPosition = jsonCityInfo.getBoolean("currentPosition");
            geoInfo.setAddress(jsonCityInfo.get("address").toString());
            if (jsonCityInfo.has("country")) {
                geoInfo.setCountry(jsonCityInfo.get("country").toString());
            }
            else {
                geoInfo.setCountry("KR");
            }
            if (jsonCityInfo.has("location") && !jsonCityInfo.isNull("location")) {
                location = jsonCityInfo.getJSONObject("location");
                geoInfo.setLat(geoInfo.toNormalize(location.getDouble("lat")));
                geoInfo.setLng(geoInfo.toNormalize(location.getDouble("long")));
            }
            if (jsonCityInfo.has("name") && !jsonCityInfo.isNull("name")) {
                geoInfo.setName(jsonCityInfo.getString("name"));
            }

            mLocalUnits = units;
        } catch (JSONException e) {
            Log.e("Service", "JSONException: " + e.getMessage());
            return;
        }

        if (currentPosition) {
            Log.i("Service", "Update current position app widget id=" + widgetId);
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
            Log.i("Service", "Update address=" + geoInfo.getAddress() + " app widget id=" + widgetId);
            //check country
            if (geoInfo.getCountry() == null || geoInfo.getCountry().equals("KR")) {
                String addr = AddressesElement.makeUrlAddress(geoInfo.getAddress());
                if (addr != null) {
                    addr = mUrl + kmaApiUrl + addr;
                    String jsonData = getWeatherDataFromServer(addr);
                    updateWidget(widgetId, jsonData, geoInfo.getName());
                }
            }
            else {
                String addr = mUrl + worldWeatherApiUrl + geoInfo.getLat() + "," + geoInfo.getLng();
                Log.i("Service", "url="+addr);
                String jsonData = getWeatherDataFromServer(addr);
                updateWorldWeatherWidget(widgetId, jsonData, geoInfo.getName());
                //make world weather url
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
        GeoInfo geoInfo = location2GeoInfo(lat, lon);
        String url = null;
        String jsonData = null;

        if (geoInfo == null) {
            Log.e("Service", "Fail to get geo info");
            Toast.makeText(getApplicationContext(), R.string.fail_to_get_geoinfo, Toast.LENGTH_LONG).show();
            return;
        }

        //if ( geoInfo.getCountry().equals("KR") && geoInfo.getSource().equals("KMA") )
        if (geoInfo.getCountry().equals("KR")) {
            //convert address to korean and url
            //use pure lat, lon for finding correct address
            url = location2Address(lat, lon);
            if (url != null) {
                jsonData = getWeatherDataFromServer(url);
                updateWidget(widgetId, jsonData, geoInfo.getName());
            }
        }
        else {
            //device loaction을 사용할 경우 아래 url사용
            //url = mUrl + worldWeatherApiUrl + geoInfo.getLat() + "," + geoInfo.getLng();

            GeoInfo address2geoInfo = address2GeoInfo(geoInfo.getAddress());
            if (address2geoInfo != null) {
                url = mUrl + worldWeatherApiUrl + address2geoInfo.getLat() + "," + address2geoInfo.getLng();
            }
            else {
                Log.e("Service", "Fail to get geoinfo from address");
                Toast.makeText(getApplicationContext(), R.string.fail_to_get_geoinfo, Toast.LENGTH_LONG).show();
                return;
            }
            jsonData = getWeatherDataFromServer(url);
            updateWorldWeatherWidget(widgetId, jsonData, geoInfo.getName());
        }
    }

    private GeoInfo address2GeoInfo(String address) {
        GeoInfo geoInfo = null;

        try {
            String url = "https://maps.googleapis.com/maps/api/geocode/json?address=" + URLEncoder.encode(address, "utf-8");
            String retJson = new GetHttpsServerAysncTask(url).execute().get();
            JSONObject reader = new JSONObject(retJson);

            if (reader == null) {
                Log.e("Service", "Fail to get geo info from address="+address);
                return geoInfo;
            }

            String status = reader.getString("status");
            if (!status.equals("OK")) {
                Log.e("Service", "status=" + status);
                return geoInfo;
            }

            JSONArray results = reader.getJSONArray("results");
            if (results.length() == 0) {
                Log.e("Service", "results length=0");
                return geoInfo;
            }

            JSONObject result = results.getJSONObject(0);
            if (!result.has("geometry")) {
                Log.e("Service", "Fail to get geometry in result");
                return geoInfo;
            }
            JSONObject geometry = result.getJSONObject("geometry");
            if (!geometry.has("location")) {
                Log.e("Service", "Fail to get location in result");
                return geoInfo;
            }
            JSONObject location = geometry.getJSONObject("location");
            geoInfo = new GeoInfo();
            geoInfo.setLat(geoInfo.toNormalize(location.getDouble("lat")));
            geoInfo.setLng(geoInfo.toNormalize(location.getDouble("lng")));

            String country_name = null;
            JSONArray addressComponents = result.getJSONArray("address_components");

            for (int j=0; j<addressComponents.length(); j++) {
                JSONObject addressComponent = addressComponents.getJSONObject(j);
                JSONArray types = addressComponent.getJSONArray("types");
                if (types.getString(0).equals("country")) {
                    country_name = addressComponent.getString("short_name");
                    break;
                }
            }

            geoInfo.setCountry(country_name);
            geoInfo.setAddress(address);

            Log.i("Service", "lat="+geoInfo.getLat()+" lng="+geoInfo.getLng());

        } catch (InterruptedException e) {
            Log.e("Service", e.toString());
            e.printStackTrace();
        } catch (ExecutionException e) {
            Log.e("Service", e.toString());
            e.printStackTrace();
        } catch (JSONException e) {
            e.printStackTrace();
        } catch (UnsupportedEncodingException e) {
            e.printStackTrace();
        }

        return geoInfo;
    }

    /**
     *
     // Tokyo 35.6894875,139.6917064
     // position = {coords: {latitude: 35.6894875, longitude: 139.6917064}};
     // Shanghai 31.227797,121.475194
     //position = {coords: {latitude: 31.227797, longitude: 121.475194}};
     // NY 40.663527,-73.960852
     //position = {coords: {latitude: 40.663527, longitude: -73.960852}};
     // Berlin 52.516407,13.403322
     //position = {coords: {latitude: 52.516407, longitude: 13.403322}};
     // Hochinminh 10.779001,106.662796
     //position = {coords: {latitude: 10.779001, longitude: 106.662796}};
     * @param lat
     * @param lon
     * @return
     */
    private GeoInfo location2GeoInfo(double lat, double lon) {
        GeoInfo geoInfo = null;

        //Log.i("Service", "lat : " + lat + ", lon " + lon);
        try {
            String lang = Locale.getDefault().getLanguage();
            String geourl = "https://maps.googleapis.com/maps/api/geocode/json?latlng=" +
                    lat + "," + lon + "&language="+lang;

            //Log.i("Service", "url="+geourl);
            String retJson = new GetHttpsServerAysncTask(geourl).execute().get();

            JSONObject reader = new JSONObject(retJson);
            if (reader != null) {
                String status = reader.getString("status");
                if (!status.equals("OK")) {
                    Log.e("Service", "status=" + status);
                    return geoInfo;
                }

                String sub_level2_types[] = { "political", "sublocality", "sublocality_level_2" };
                String sub_level1_types[] = { "political", "sublocality", "sublocality_level_1" };
                String local_types[] = { "locality", "political" };
                String country_types[] = { "country" };
                String sub_level2_name = null;
                String sub_level1_name = null;
                String local_name = null;
                String country_name = null;

                JSONArray results = reader.getJSONArray("results");
                JSONObject result  = null;

                int i;
                for (i=0; i<results.length(); i++) {
                    result = results.getJSONObject(i);
                    JSONArray addressComponents = result.getJSONArray("address_components");
                    for (int j=0; j<addressComponents.length(); j++) {
                        JSONObject addressComponent = addressComponents.getJSONObject(j);
                        JSONArray types = addressComponent.getJSONArray("types");
                        if (types.getString(0).equals(sub_level2_types[0])
                                && types.getString(1).equals(sub_level2_types[1])
                                && types.getString(2).equals(sub_level2_types[2]) ) {
                           sub_level2_name = addressComponent.getString("short_name");
                        }

                        if (types.getString(0).equals(sub_level1_types[0])
                                && types.getString(1).equals(sub_level1_types[1])
                                && types.getString(2).equals(sub_level1_types[2]) ) {
                           sub_level1_name = addressComponent.getString("short_name");
                        }

                        if (types.getString(0).equals(local_types[0])
                                && types.getString(1).equals(local_types[1]) ) {
                            local_name = addressComponent.getString("short_name");
                        }

                        if (types.getString(0).equals(country_types[0]) ) {
                            country_name = addressComponent.getString("short_name");
                        }

                        if (sub_level2_name != null && sub_level1_name != null
                                && local_name != null && country_name != null) {
                            break;
                        }
                    }

                    if (sub_level2_name != null && sub_level1_name != null
                            && local_name != null && country_name != null) {
                        break;
                    }
                }

                String name = null;
                String address = "";
                //국내는 동단위까지 표기해야 함.
                if (country_name != null && country_name.equals("KR")) {
                    if (sub_level2_name != null) {
                        address += sub_level2_name;
                        name = sub_level2_name;
                    }
                }
                if (sub_level1_name != null) {
                    address += " " + sub_level1_name;
                    if (name == null) {
                        name = sub_level1_name;
                    }
                }
                if (local_name != null) {
                    address += " " + local_name;
                    if (name == null) {
                        name = local_name;
                    }
                }
                if (country_name != null) {
                    address += " " + country_name;
                    if (name == null) {
                        name = country_name;
                    }
                }

                if (name == null || name.equals(country_name)) {
                    Log.e("service", "Fail to find location address");
                }

                geoInfo = new GeoInfo();
                geoInfo.setLat(geoInfo.toNormalize(lat));
                geoInfo.setLng(geoInfo.toNormalize(lon));
                geoInfo.setAddress(address);
                geoInfo.setName(name);
                geoInfo.setCountry(country_name);

                Log.i("Service", geoInfo.getAddress());
            }
            else {
                Log.e("Service", "Fail to get address info");
                return geoInfo;
            }
        } catch (InterruptedException e) {
            Log.e("Service", e.toString());
            e.printStackTrace();
        } catch (ExecutionException e) {
            Log.e("Service", e.toString());
            e.printStackTrace();
        } catch (JSONException e) {
            e.printStackTrace();
        }

        return geoInfo;
    }

    private String location2Address(double lat, double lon) {
        String retAddr = null;
        
        Log.i("Service", "lat : " + lat + ", lon " + lon);
        try {
            String geourl = "https://maps.googleapis.com/maps/api/geocode/json?latlng=" +
                    lat + "," + lon + "&language=ko";
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
            retAddr = mUrl + kmaApiUrl + retAddr;
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

    private void updateWorldWeatherWidget(int widgetId, String jsonStr, String locationName) {
        if (jsonStr == null) {
            Log.e("WidgetUpdateService", "jsonData is NULL");
            Toast.makeText(getApplicationContext(), "Fail to get world weather data", Toast.LENGTH_LONG).show();
            return;
        }

        /**
         * context, manager를 member 변수로 변환하면 단순해지지만 동작 확인 필요.
         */
        try {
            mContext = getApplicationContext();
            mAppWidgetManager = AppWidgetManager.getInstance(mContext);
            mLayoutId = mAppWidgetManager.getAppWidgetInfo(widgetId).initialLayout;
        } catch (Exception e) {
            Log.e("Service", "Exception: " + e.getMessage());
            return;
        }

        Context context = getApplicationContext();
        // input weather content to widget layout

        RemoteViews views = new RemoteViews(context.getPackageName(), mLayoutId);

        WidgetData wData = new WidgetData();
        if (locationName != null) {
            wData.setLoc(locationName);
        }
        wData.setUnits(WorldWeatherElement.getUnits(jsonStr));

        if (mLayoutId == R.layout.w2x1_widget_layout) {
            wData.setCurrentWeather(WorldWeatherElement.getCurrentWeather(jsonStr));
            wData.setBefore24hWeather(WorldWeatherElement.getBefore24hWeather(jsonStr));
            W2x1WidgetProvider.setWidgetStyle(context, widgetId, views);
            W2x1WidgetProvider.setWidgetData(context, views, wData, mLocalUnits);
            Log.i("UpdateWorldWeather", "set2x1WidgetData id=" + widgetId);
        }
        else if (mLayoutId == R.layout.w1x1_current_weather) {
            wData.setCurrentWeather(WorldWeatherElement.getCurrentWeather(jsonStr));
            W1x1CurrentWeather.setWidgetStyle(context, widgetId, views);
            W1x1CurrentWeather.setWidgetData(context, views, wData, mLocalUnits);
            Log.i("UpdateWorldWeather", "set 1x1WidgetData id=" + widgetId);
        }
        else if (mLayoutId == R.layout.w2x1_current_weather) {
            wData.setCurrentWeather(WorldWeatherElement.getCurrentWeather(jsonStr));
            W2x1CurrentWeather.setWidgetStyle(context, widgetId, views);
            W2x1CurrentWeather.setWidgetData(context, views, wData, mLocalUnits);
            Log.i("UpdateWorldWeather", "set 2x1 current weather id=" + widgetId);
        }
        else if (mLayoutId == R.layout.air_quality_index) {
            wData.setCurrentWeather(WorldWeatherElement.getCurrentWeather(jsonStr));
            AirQualityIndex.setWidgetStyle(context, widgetId, views);
            AirQualityIndex.setWidgetData(context, views, wData);
            Log.i("UpdateWorldWeather", "set air quality index id=" + widgetId);
        }
        else if (mLayoutId == R.layout.clock_and_current_weather) {
            wData.setCurrentWeather(WorldWeatherElement.getCurrentWeather(jsonStr));
            ClockAndCurrentWeather.setWidgetStyle(context, widgetId, views);
            ClockAndCurrentWeather.setWidgetData(context, views, wData, mLocalUnits);
            Log.i("UpdateWorldWeather", "set 3x1 clock and current weather id=" + widgetId);
        }
        else if (mLayoutId == R.layout.current_weather_and_three_days) {
            wData.setCurrentWeather(WorldWeatherElement.getCurrentWeather(jsonStr));
            wData.setDayWeather(0, WorldWeatherElement.getDayWeatherFromToday(jsonStr, -1));
            wData.setDayWeather(1, WorldWeatherElement.getDayWeatherFromToday(jsonStr, 0));
            wData.setDayWeather(2, WorldWeatherElement.getDayWeatherFromToday(jsonStr, 1));
            CurrentWeatherAndThreeDays.setWidgetStyle(context, widgetId, views);
            CurrentWeatherAndThreeDays.setWidgetData(context, views, wData, mLocalUnits);
            Log.i("UpdateWorldWeather", "set 3x1 clock and current weather id=" + widgetId);
        }
        else if (mLayoutId == R.layout.daily_weather) {
            wData.setCurrentWeather(WorldWeatherElement.getCurrentWeather(jsonStr));
            wData.setDayWeather(0, WorldWeatherElement.getDayWeatherFromToday(jsonStr, -1));
            for (int i=0; i<5; i++) {
                wData.setDayWeather(i, WorldWeatherElement.getDayWeatherFromToday(jsonStr, i-1));
            }
            DailyWeather.setWidgetStyle(context, widgetId, views);
            DailyWeather.setWidgetData(context, views, wData, mLocalUnits);
            Log.i("UpdateWorldWeather", "set 4x1 daily weather id=" + widgetId);
        }
        else if (mLayoutId == R.layout.clock_and_three_days) {
            wData.setCurrentWeather(WorldWeatherElement.getCurrentWeather(jsonStr));
            wData.setDayWeather(0, WorldWeatherElement.getDayWeatherFromToday(jsonStr, -1));
            wData.setDayWeather(1, WorldWeatherElement.getDayWeatherFromToday(jsonStr, 0));
            wData.setDayWeather(2, WorldWeatherElement.getDayWeatherFromToday(jsonStr, 1));
            ClockAndThreeDays.setWidgetStyle(context, widgetId, views);
            ClockAndThreeDays.setWidgetData(context, views, wData, mLocalUnits);
            Log.i("UpdateWorldWeather", "set 4x1 clock and three days id=" + widgetId);
        }

        // Create an Intent to launch menu
        Intent intent = new Intent(context, WidgetMenuActivity.class);
        intent.putExtra("LAYOUT_ID", mLayoutId);
        // intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        PendingIntent pendingIntent = PendingIntent.getActivity(context, widgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.bg_layout, pendingIntent);

        mAppWidgetManager.updateAppWidget(widgetId, views);
    }

    /**
     * location listener에서 widgetId가 업데이트됨.
     * @param widgetId
     * @param jsonStr
     */
    private void updateWidget(int widgetId, String jsonStr, String locationName) {
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
        try {
            mContext = getApplicationContext();
            mAppWidgetManager = AppWidgetManager.getInstance(mContext);
            mLayoutId = mAppWidgetManager.getAppWidgetInfo(widgetId).initialLayout;
        } catch (Exception e) {
            Log.e("Service", "Exception: " + e.getMessage());
            return;
        }

        // make today, yesterday weather info class
        WidgetData wData = weatherElement.makeWidgetData();
        if (locationName != null) {
            wData.setLoc(locationName);
        }
        Context context = getApplicationContext();
        // input weather content to widget layout

        RemoteViews views = new RemoteViews(context.getPackageName(), mLayoutId);

        if (mLayoutId == R.layout.w2x1_widget_layout) {
            W2x1WidgetProvider.setWidgetStyle(context, widgetId, views);
            W2x1WidgetProvider.setWidgetData(context, views, wData, mLocalUnits);
            Log.i("UpdateWidgetService", "set2x1WidgetData id=" + widgetId);
        }
        else if (mLayoutId == R.layout.w1x1_current_weather) {
            W1x1CurrentWeather.setWidgetStyle(context, widgetId, views);
            W1x1CurrentWeather.setWidgetData(context, views, wData, mLocalUnits);
            Log.i("UpdateWidgetService", "set 1x1WidgetData id=" + widgetId);
        }
        else if (mLayoutId == R.layout.w2x1_current_weather) {
            W2x1CurrentWeather.setWidgetStyle(context, widgetId, views);
            W2x1CurrentWeather.setWidgetData(context, views, wData, mLocalUnits);
            Log.i("UpdateWidgetService", "set 2x1 current weather id=" + widgetId);
        }
        else if (mLayoutId == R.layout.air_quality_index) {
            AirQualityIndex.setWidgetStyle(context, widgetId, views);
            AirQualityIndex.setWidgetData(context, views, wData);
            Log.i("UpdateWidgetService", "set air quality index id=" + widgetId);
        }
        else if (mLayoutId == R.layout.clock_and_current_weather) {
            ClockAndCurrentWeather.setWidgetStyle(context, widgetId, views);
            ClockAndCurrentWeather.setWidgetData(context, views, wData, mLocalUnits);
            Log.i("UpdateWidgetService", "set 3x1 clock and current weather id=" + widgetId);
        }
        else if (mLayoutId == R.layout.current_weather_and_three_days) {
            CurrentWeatherAndThreeDays.setWidgetStyle(context, widgetId, views);
            CurrentWeatherAndThreeDays.setWidgetData(context, views, wData, mLocalUnits);
            Log.i("UpdateWidgetService", "set 3x1 clock and current weather id=" + widgetId);
        }
        else if (mLayoutId == R.layout.daily_weather) {
            DailyWeather.setWidgetStyle(context, widgetId, views);
            DailyWeather.setWidgetData(context, views, wData, mLocalUnits);
            Log.i("UpdateWidgetService", "set 4x1 daily weather id=" + widgetId);
        }
        else if (mLayoutId == R.layout.clock_and_three_days) {
            ClockAndThreeDays.setWidgetStyle(context, widgetId, views);
            ClockAndThreeDays.setWidgetData(context, views, wData, mLocalUnits);
            Log.i("UpdateWidgetService", "set 4x1 clock and three days id=" + widgetId);
        }

        // Create an Intent to launch menu
        Intent intent = new Intent(context, WidgetMenuActivity.class);
        intent.putExtra("LAYOUT_ID", mLayoutId);
//            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        PendingIntent pendingIntent = PendingIntent.getActivity(context, widgetId, intent, PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.bg_layout, pendingIntent);

        mAppWidgetManager.updateAppWidget(widgetId, views);
    }

    static public Class<?> getWidgetProvider(int layoutId) {
        if (layoutId == R.layout.w2x1_widget_layout) {
            return W2x1WidgetProvider.class;
        } else if (layoutId == R.layout.w1x1_current_weather) {
            return W1x1CurrentWeather.class;
        } else if (layoutId == R.layout.w2x1_current_weather) {
            return W2x1CurrentWeather.class;
        } else if (layoutId == R.layout.air_quality_index) {
            return AirQualityIndex.class;
        } else if (layoutId == R.layout.clock_and_current_weather) {
            return ClockAndCurrentWeather.class;
        } else if (layoutId == R.layout.current_weather_and_three_days) {
            return CurrentWeatherAndThreeDays.class;
        } else if (layoutId == R.layout.daily_weather) {
            return DailyWeather.class;
        } else if (layoutId == R.layout.clock_and_three_days) {
            return ClockAndThreeDays.class;
        }

        return null;
    }
}// class end
