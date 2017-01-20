package net.wizardfactory.todayweather.widget.JsonElement;

import android.util.Log;

import net.wizardfactory.todayweather.widget.Data.WeatherData;
import net.wizardfactory.todayweather.widget.Data.WidgetData;

import org.json.JSONException;
import org.json.JSONObject;

import java.text.DateFormat;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;

/**
 * This is result of weather server.
 * JsongString of result parsing current, shorts, shortest weather data.
 */
public class WeatherElement {
    // default parsing value
    public final static double DEFAULT_WEATHER_DOUBLE_VAL = -9999.99;
    public final static int DEFAULT_WEATHER_INT_VAL = -9999;

    private String regionName = null;
    private String cityName = null;
    private String townName = null;
    private WeatherShortElement[] weatherShorts = null;
    private WeatherShortestElement[] weatherShortests = null;
    private WeatherCurrentElement weatherCurrent = null;
    private WeatherMidDataElement weatherMidData = null;

    public String getRegionName() { return regionName; }

    public String getCityName() {
        return cityName;
    }

    public String getTownName() {
        return townName;
    }

    public WeatherShortElement[] getWeatherShorts() {
        return weatherShorts;
    }

    public WeatherShortestElement[] getWeatherShortest() {
        return weatherShortests;
    }

    public WeatherCurrentElement getWeatherCurrent() {
        return weatherCurrent;
    }

    public WeatherMidDataElement getWeatherMidData() {
        return weatherMidData;
    }

    public void setRegionName(String regionName) {
        this.regionName = regionName;
    }

    public void setCityName(String cityName) {
        this.cityName = cityName;
    }

    public void setTownName(String townName) {
        this.townName = townName;
    }

    public void setWeatherShorts(WeatherShortElement[] weatherShorts) {
        this.weatherShorts = weatherShorts;
    }

    public void setWeatherShortests(WeatherShortestElement[] weatherShortests) {
        this.weatherShortests = weatherShortests;
    }

    public void setWeatherCurrent(WeatherCurrentElement weatherCurrent) {
        this.weatherCurrent = weatherCurrent;
    }

    public void setWeatherMidData(WeatherMidDataElement weatherMidData) {
        this.weatherMidData = weatherMidData;
    }

    // parsing weather data from json string.
    public static WeatherElement parsingWeatherElementString2Json(String jsonStr){
        WeatherElement retElement = new WeatherElement();

        try {
            JSONObject reader = new JSONObject(jsonStr);
            if (reader != null) {
                retElement.setRegionName(reader.optString("regionName", null));
                retElement.setCityName(reader.optString("cityName", null));
                retElement.setTownName(reader.optString("townName", null));
                if (reader.has("short")) {
                    retElement.setWeatherShorts(WeatherShortElement.parsingShortElementString2Json(reader.getJSONArray("short").toString()));
                }
//                if (reader.has("shortest")) {
//                    retElement.setWeatherShortests(WeatherShortestElement.parsingShortestElementString2Json(reader.getJSONArray("shortest").toString()));
//                }
                if (reader.has("current")) {
                    retElement.setWeatherCurrent(WeatherCurrentElement.parsingCurrentElementString2Json(reader.getJSONObject("current").toString(), reader.optString("currentPubDate", null)));
                }
                if (reader.has("midData")) {
                    retElement.setWeatherMidData(WeatherMidDataElement.parsingMidDataElementString2Json(reader.getJSONObject("midData").toString()));
                }
            }
            else {
                Log.e("WeatherElement", "Json string is NULL");
            }
        } catch (JSONException e) {
            Log.e("WeatherElement", "JSONException: " + e.getMessage());
            e.printStackTrace();
        }

        return retElement;
    }

    /**
     *
     * @param date : yyyyMMdd
     * @param time : HHmm
     * @param stnDateTime : yyyy.MM.dd.HH:mm
     * @return
     */
    public static Date makeDateFromStrDateAndTime(String date, String time, String stnDateTime) {
        Date retDate = null;

        if (stnDateTime != null) {
            Log.i("WeatherElement", "stn date time="+stnDateTime);
            SimpleDateFormat transFormat = new SimpleDateFormat("yyyy.MM.dd.HH:mm");
            try {
                retDate = transFormat.parse(stnDateTime);
            } catch (ParseException e) {
                e.printStackTrace();
            }
            return retDate;
        }

        if (time == null) {
            SimpleDateFormat transFormat = new SimpleDateFormat("yyyyMMdd");
            try {
                retDate = transFormat.parse(date);
            } catch (ParseException e) {
                e.printStackTrace();
            }
        } else {
            SimpleDateFormat transFormat = new SimpleDateFormat("yyyyMMddHHmm");
            try {
                retDate = transFormat.parse(date+time);
            } catch (ParseException e) {
                e.printStackTrace();
            }
        }

        return retDate;
    }

    /**
     *
     * @param dashDate yyyy-MM-dd HH:mm
     * @return
     */
    public static Date makeDateFromStrDashDate(String dashDate) {
        Date retDate = null;
        SimpleDateFormat transFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm");
        try {
            retDate = transFormat.parse(dashDate);
        } catch (ParseException e) {
            e.printStackTrace();
        }
        return retDate;
    }

    // make widget data using this class members.
    public WidgetData makeWidgetData() {
        WidgetData retWidgetData =  null;

        if (weatherCurrent != null) {
            retWidgetData = new WidgetData();
            // set location
            if (townName != null && townName.length() > 0) {
                retWidgetData.setLoc(townName);
            }
            else if (cityName != null && cityName.length() > 0) {
                retWidgetData.setLoc(cityName);
            }
            else if (regionName != null && regionName.length() > 0) {
                retWidgetData.setLoc(regionName);
            }

            // get current(today) data
            WeatherData current = new WeatherData();
            current.setDate(weatherCurrent.getDate());
            current.setPubDate(weatherCurrent.getPubDate());
            current.setSky(weatherCurrent.getSky());
            current.setPty(weatherCurrent.getPty());
            current.setLgt(weatherCurrent.getLgt());
            current.setTemperature(weatherCurrent.getT1h());
//            current.setMaxTemperature(findMaxTemperature(true));
//            current.setMinTemperature(findMinTemperature(true));
            current.setSummary(weatherCurrent.getStrSummary());
            current.setAqiPubDate(weatherCurrent.getAqiPubDate());
            current.setAqiGrade(weatherCurrent.getAqiGrade());
            current.setPm10Grade(weatherCurrent.getPm10Grade());
            current.setPm25Grade(weatherCurrent.getPm25Grade());
            current.setAqiStr(weatherCurrent.getAqiStr());
            current.setPm10Str(weatherCurrent.getPm10Str());
            current.setPm25Str(weatherCurrent.getPm25Str());
            current.setRn1(weatherCurrent.getRn1());
            current.setRn1Str(weatherCurrent.getRn1Str());

            // get yesterday data
            WeatherData before24hWeather = new WeatherData();
            before24hWeather.setTemperature(weatherCurrent.getBefore24ht1h());

            String yesterdayDateStr = findYesterdayDateString();
            WeatherDailyDataElement[] weatherDailyData = weatherMidData.getWeatherDailyDatas();
            for (int i = 0; i < weatherDailyData.length; i++) {
                if (weatherDailyData[i].getStrDate().equals(yesterdayDateStr))  {
                    before24hWeather.setMaxTemperature(weatherDailyData[i].getTaMax());
                    before24hWeather.setMinTemperature(weatherDailyData[i].getTaMin());
                }
                if (weatherDailyData[i].getStrDate().equals(weatherCurrent.getStrDate())) {
                    current.setMinTemperature(weatherDailyData[i].getTaMin());
                    current.setMaxTemperature(weatherDailyData[i].getTaMax());
                }
            }

            retWidgetData.setCurrentWeather(current);
            retWidgetData.setBefore24hWeather(before24hWeather);

            for (int i=WidgetData.YESTERDAY_WEATHER_INDEX; i<5; i++) {
                WeatherData dayData = new WeatherData();
                WeatherDailyDataElement todayData = weatherDailyData[i+6];
                dayData.setSky(todayData.getSky());
                dayData.setPty(todayData.getPty());
                dayData.setLgt(todayData.getLgt());
                dayData.setMaxTemperature(todayData.getTaMax());
                dayData.setMinTemperature(todayData.getTaMin());
                dayData.setDate(todayData.getDate());

                retWidgetData.setDayWeather(i, dayData);
            }
        }
        else {
            Log.e("WeatherElement", "CurrentWeather is NULL!!");
        }

        return retWidgetData;
    }

    private double findMaxTemperature(boolean isToday){
        double retMaxTemperature = DEFAULT_WEATHER_DOUBLE_VAL;
        String cmpDateStr = null;

        if (isToday) {
            cmpDateStr = weatherCurrent.getStrDate();
        }
        else {
            cmpDateStr = findYesterdayDateString();
        }

        if (cmpDateStr != null) {
            if (weatherMidData != null) {
                WeatherDailyDataElement[] weatherDailyDatas = weatherMidData.getWeatherDailyDatas();
                if (weatherDailyDatas != null && weatherDailyDatas.length > 0) {
                    for (int i = 0; i < weatherDailyDatas.length; i++) {
                        if (weatherDailyDatas[i].getStrDate().equals(cmpDateStr)) {
                            return weatherDailyDatas[i].getTaMax();
                        }
                    }
                }
                if (retMaxTemperature == DEFAULT_WEATHER_DOUBLE_VAL) {
                    retMaxTemperature = 0;
                }
            }
        }

        return retMaxTemperature;
    }

    private double findMinTemperature(boolean isToday) {
        double retMinTemperature = -DEFAULT_WEATHER_DOUBLE_VAL;
        String cmpDateStr = null;

        if (isToday) {
            cmpDateStr = weatherCurrent.getStrDate();
        }
        else {
            cmpDateStr = findYesterdayDateString();
        }

        if (cmpDateStr != null) {
            if (weatherMidData != null) {
                WeatherDailyDataElement[] weatherDailyDatas = weatherMidData.getWeatherDailyDatas();
                if (weatherDailyDatas != null && weatherDailyDatas.length > 0) {
                    for (int i = 0; i < weatherDailyDatas.length; i++) {
                        if (weatherDailyDatas[i].getStrDate().equals(cmpDateStr)) {
                            return weatherDailyDatas[i].getTaMin();
                        }
                    }
                }
                if (retMinTemperature == DEFAULT_WEATHER_DOUBLE_VAL) {
                    retMinTemperature = 0;
                }
            }
        }

        return retMinTemperature;
    }

    // Find yesterday weather base on current time.
    private WeatherShortElement getYesterdayWeatherFromCurrentTime() {
        WeatherShortElement retShortElement = null;

        if (weatherCurrent == null || weatherShorts == null || weatherShorts.length == 0) {
            Log.e("WeatherElement", "cur or shorts element is NULL");
        }
        else {
            Date shortestDate = weatherCurrent.getDate();
            if (shortestDate != null) {
                // compare base time
                String yesterdayCmpStrDate = findYesterdayDateString();
                Date cmpDate = WeatherElement.makeDateFromStrDateAndTime(yesterdayCmpStrDate, weatherCurrent.getStrTime(), weatherCurrent.getStnDateTime());

                int nearnestIdx = -1;
                long minInterval = 999999999;
                for (int i =0; i < weatherShorts.length; i++) {
                    if (weatherShorts[i] != null) {
                        long term = Math.abs(cmpDate.getTime() - weatherShorts[i].getDate().getTime());
                        if (minInterval > term) {
                            nearnestIdx = i;
                            minInterval = term;
                        }
                        else {
                            // do nothing
                        }
                    }
                    else {
                        Log.e("WeatherElement", "short["+ i + "] element is NULL");
                    }
                }

                if (nearnestIdx != -1) {
                    retShortElement = weatherShorts[nearnestIdx];
                }
            } else {
                Log.e("WeatherElement", "shortestDate Date is NULL");
            }
        }

        return retShortElement;
    }

    // find yesterday string base on current weather date.
    private String findYesterdayDateString() {
        String retYesterdayString = null;

        if (weatherCurrent != null && weatherCurrent.getDate() != null) {
            // today time - 1day
            Date yesterdayDate = new Date(weatherCurrent.getDate().getTime() - (1000 * 60 * 60 * 24));
            DateFormat sdFormat = new SimpleDateFormat("yyyyMMdd");

            // compare base time
            retYesterdayString = sdFormat.format(yesterdayDate);
        }

        return retYesterdayString;
    }
}
