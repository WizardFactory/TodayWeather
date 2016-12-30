package net.wizardfactory.todayweather.widget.JsonElement;

import android.util.Log;

import net.wizardfactory.todayweather.widget.Data.Units;
import net.wizardfactory.todayweather.widget.Data.WeatherData;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;

/**
 * Created by aleckim on 2016. 12. 26..
 */
public class WorldWeatherElement {

    private static int _convertCloud2Sky(int cloud) {
        if (cloud <= 0) {
            if (cloud <= 20)  {
                return 1;
            }
            else if (cloud <= 50) {
                return 2;
            }
            else if (cloud <= 80) {
                return 3;
            }
            else {
                return 4;
            }
        }
        else {
            return 1;
        }
    }

    // precType 0: 없음 1:비 2:눈 3:비+눈 4:우박
    // pty 0: nothing, 1 rain 2 rain+snow 3 snow
    private static int _convertPrecType2Pty(int precType) {
        if (precType == 3) {
            return 2;
        }
        else if (precType == 2) {
            return 3;
        }
        return precType;
    }

    private static Date _convertString2Date(String pubdateStr) {
        Date pubDate = null;
        if (pubdateStr != null) {
            SimpleDateFormat transFormat = new SimpleDateFormat("yyyy.MM.dd HH:mm");
            try {
                pubDate = transFormat.parse(pubdateStr);
            } catch (ParseException e) {
                e.printStackTrace();
            }
        }
        return pubDate;
    }

    static private JSONObject _getTheDay(JSONArray daily, Date pubDate) {

        for (int i=0; i<daily.length(); i++) {
            try {
                JSONObject dayInfo;
                Date dayDate;
                dayInfo = daily.getJSONObject(i);
                SimpleDateFormat transFormat = new SimpleDateFormat("yyyy.MM.dd HH:mm");
                dayDate = transFormat.parse(dayInfo.getString("date"));
                if (pubDate.getDate() == dayDate.getDate()) {
                    return dayInfo;
                }
            } catch (ParseException e) {
                e.printStackTrace();
            } catch (JSONException e) {
                e.printStackTrace();
            }
        }

        return null;
    }

    static public WeatherData getCurrentWeather(String jsonStr) {
        WeatherData currentWeather = new WeatherData();
        try {
            JSONObject reader = new JSONObject(jsonStr);
            if (reader != null) {
                JSONArray thisTime = reader.getJSONArray("thisTime");
                JSONObject current = thisTime.getJSONObject(1);
                currentWeather.setTemperature(current.getDouble("temp_c"));

                if (current.has("precType")) {
                    currentWeather.setPty(_convertPrecType2Pty(current.getInt("precType")));
                }
                else {
                    currentWeather.setPty(0);
                }
                if (current.has("cloud")) {
                    currentWeather.setSky(_convertCloud2Sky(current.getInt("cloud")));
                }
                else {
                    currentWeather.setSky(0);
                }
                currentWeather.setLgt(0); //not support
                currentWeather.setPubDate(_convertString2Date(current.getString("date")));
                if (current.has("precip")) {
                    currentWeather.setRn1(current.getDouble("precip"));
                }
                else {
                    currentWeather.setRn1(0);
                }

                JSONObject todayInfo = _getTheDay(reader.getJSONArray("daily"), currentWeather.getPubDate());
                if (todayInfo != null) {
                    currentWeather.setMaxTemperature(todayInfo.getDouble("tempMax_c"));
                    currentWeather.setMinTemperature(todayInfo.getDouble("tempMin_c"));
                }
                else {
                    Log.e("WorldWeatherElement", "Fail to find today weather info");
                }
            }
            else {
                Log.e("WorldWeatherElement", "Json string is NULL");
            }
        } catch (JSONException e) {
            Log.e("WorldWeatherElement", "JSONException: " + e.getMessage());
            e.printStackTrace();
        }
        return currentWeather;
    }

    static public WeatherData getBefore24hWeather(String jsonStr) {
        WeatherData before24hWeather = new WeatherData();
        try {
            JSONObject reader = new JSONObject(jsonStr);
            if (reader != null) {
                JSONArray thisTime = reader.getJSONArray("thisTime");
                JSONObject before24h = thisTime.getJSONObject(0);
                before24hWeather.setTemperature(before24h.getDouble("temp_c"));
                before24hWeather.setPubDate(_convertString2Date(before24h.getString("date")));
                JSONObject yesterdayInfo = _getTheDay(reader.getJSONArray("daily"), before24hWeather.getPubDate());
                if (yesterdayInfo != null) {
                    before24hWeather.setMaxTemperature(yesterdayInfo.getDouble("tempMax_c"));
                    before24hWeather.setMinTemperature(yesterdayInfo.getDouble("tempMin_c"));
                }
                else {
                    Log.e("WorldWeatherElement", "Fail to find yesterday weather info");
                }
            }
            else {
                Log.e("WorldWeatherElement", "Json string is NULL");
            }
        } catch (JSONException e) {
            Log.e("WorldWeatherElement", "JSONException: " + e.getMessage());
            e.printStackTrace();
        }
        return before24hWeather;
    }

    static public WeatherData getDayWeatherFromToday(String jsonStr, int fromToday) {
        WeatherData dayWeather = new WeatherData();
        try {
            JSONObject reader = new JSONObject(jsonStr);
            if (reader != null) {
                JSONArray thisTime = reader.getJSONArray("thisTime");
                JSONObject current = thisTime.getJSONObject(1);
                Date theDay = _convertString2Date(current.getString("date"));
                theDay.setDate(theDay.getDate()+fromToday);

                JSONObject dayInfo = _getTheDay(reader.getJSONArray("daily"), theDay);
                if (dayInfo != null) {
                    dayWeather.setDate(_convertString2Date(dayInfo.getString("date")));
                    dayWeather.setMaxTemperature(dayInfo.getDouble("tempMax_c"));
                    dayWeather.setMinTemperature(dayInfo.getDouble("tempMin_c"));
                    if (dayInfo.has("precType")) {
                        dayWeather.setPty(_convertPrecType2Pty(dayInfo.getInt("precType")));
                    }
                    else {
                        dayWeather.setPty(0);
                    }
                    if (dayInfo.has("cloud")) {
                        dayWeather.setSky(_convertCloud2Sky(dayInfo.getInt("cloud")));
                    }
                    else {
                        dayWeather.setSky(0);
                    }
                    dayWeather.setLgt(0); //not support
                    if (dayInfo.has("precip")) {
                        dayWeather.setRn1(dayInfo.getDouble("precip"));
                    }
                    else {
                        dayWeather.setRn1(0);
                    }
                }
                else {
                    Log.e("WorldWeatherElement", "Fail to find yesterday weather info");
                }

            }
            else {
                Log.e("WorldWeatherElement", "Json string is NULL");
            }
        } catch (JSONException e) {
            Log.e("WorldWeatherElement", "JSONException: " + e.getMessage());
            e.printStackTrace();
        }

        return dayWeather;
    }

    static public Units getUnits(String jsonStr) {
        try {
            JSONObject reader = new JSONObject(jsonStr);
            if (reader != null) {
                Units units;
                if (reader.has("units")) {
                    units = new Units(reader.optString("units"));
                }
                else {
                    units = new Units();
                }
                return units;
            }
        } catch (JSONException e) {
            Log.e("WorldWeatherElement", "JSONException: " + e.getMessage());
            e.printStackTrace();
        }

        return null;
    }
}
