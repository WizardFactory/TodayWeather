package net.wizardfactory.todayweather.widget.JsonElement;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Date;

/**
 * This class is shortest weather data that result from weather server
 */
public class WeatherShortestElement {
    private Date date = null;
    private String strDate = null;
    private String strTime = null;
    private double pty = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double rn1 = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double sky = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double lgt = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;

    public Date getDate() {
        return date;
    }

    public String getStrDate() {
        return strDate;
    }

    public String getStrTime() {
        return strTime;
    }

    public double getPty() {
        return pty;
    }

    public double getRn1() {
        return rn1;
    }

    public double getSky() {
        return sky;
    }

    public double getLgt() {
        return lgt;
    }

    public void setDate(Date date) {
        this.date = date;
    }

    public void setStrDate(String strDate) {
        this.strDate = strDate;
    }

    public void setStrTime(String strTime) {
        this.strTime = strTime;
    }

    public void setPty(double pty) {
        this.pty = pty;
    }

    public void setRn1(double rn1) {
        this.rn1 = rn1;
    }

    public void setSky(double sky) {
        this.sky = sky;
    }

    public void setLgt(double lgt) {
        this.lgt = lgt;
    }

    public static WeatherShortestElement[] parsingShortestElementString2Json(String jsonStr) {
        WeatherShortestElement[] retShortestElements = null;

        try {
            JSONArray arrReader = new JSONArray(jsonStr);
            int len = arrReader.length();

            if (arrReader != null && len > 0) {
                retShortestElements = new WeatherShortestElement[len];

                for (int i =0; i< len; i++ ) {
                    JSONObject reader = arrReader.getJSONObject(i);
                    if (reader != null) {
                        retShortestElements[i] = new WeatherShortestElement();

                        retShortestElements[i].setStrDate(reader.getString("date"));
                        retShortestElements[i].setStrTime(reader.getString("time"));
                        retShortestElements[i].setPty(reader.getDouble("pty"));
                        retShortestElements[i].setRn1(reader.getDouble("rn1"));
                        retShortestElements[i].setSky(reader.getDouble("sky"));
                        retShortestElements[i].setLgt(reader.getDouble("lgt"));

                        Date makeDate = WeatherElement.makeDateFromStrDateAndTime(retShortestElements[i].getStrDate(), retShortestElements[i].getStrTime());
                        retShortestElements[i].setDate(makeDate);
                    }
                    else {
                        Log.e("WeatherShortestElement", "Shortest[" + i + "] json string is NULL");
                    }
                }
            }
            else {
                Log.e("WeatherShortestElement", "Short array json string is NULL");
            }
        } catch (JSONException e) {
            e.printStackTrace();
        } catch (Exception e){
            e.printStackTrace();
        }

        return retShortestElements;
    }
}
