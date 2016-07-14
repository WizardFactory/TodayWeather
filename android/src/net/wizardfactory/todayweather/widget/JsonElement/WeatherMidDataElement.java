package net.wizardfactory.todayweather.widget.JsonElement;

import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Date;

/**
 * This class is midData weather data that result from weather server.
 */
public class WeatherMidDataElement {
    private String pubDate = null;
    private String province = null;
    private String city = null;
    private String stnId = null;
    private String regId = null;
    private WeatherDailyDataElement[] weatherDailyDatas = null;

    public String getPubDate() {
        return pubDate;
    }

    public String getProvince() {
        return province;
    }

    public String getCity() {
        return city;
    }

    public String getStnId() {
        return stnId;
    }

    public String getRegId() {
        return regId;
    }

    public WeatherDailyDataElement[] getWeatherDailyDatas() {
        return weatherDailyDatas;
    }

    public void setPubDate(String pubDate) {
        this.pubDate = pubDate;
    }

    public void setProvince(String province) {
        this.province = province;
    }

    public void setCity(String city) {
        this.city = city;
    }

    public void setStnId(String stnId) {
        this.stnId = stnId;
    }

    public void setRegId(String regId) {
        this.regId = regId;
    }

    public void setWeatherDailyDatas(WeatherDailyDataElement[] weatherDailyDatas) {
        this.weatherDailyDatas = weatherDailyDatas;
    }

    public static WeatherMidDataElement parsingMidDataElementString2Json(String jsonStr) {
        WeatherMidDataElement retMidDataElement = new WeatherMidDataElement();
        try {
            JSONObject reader = new JSONObject(jsonStr);
            if (reader != null) {
                retMidDataElement.setPubDate(reader.getString("pubDate"));
                retMidDataElement.setProvince(reader.getString("province"));
                retMidDataElement.setCity(reader.getString("city"));
                retMidDataElement.setStnId(reader.getString("stnId"));
                retMidDataElement.setRegId(reader.getString("regId"));

                retMidDataElement.setWeatherDailyDatas(WeatherDailyDataElement.parsingDailyDataElementString2Json(reader.getJSONArray("dailyData").toString()));
            }
            else {
                Log.e("WeatherMidDataElement", "MidData json string is NULL");
            }
        } catch (JSONException e) {
            e.printStackTrace();
        } catch (Exception e){
            e.printStackTrace();
        }

        return retMidDataElement;
    }
}
