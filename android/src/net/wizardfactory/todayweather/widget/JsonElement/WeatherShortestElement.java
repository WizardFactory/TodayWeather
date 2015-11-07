package net.wizardfactory.todayweather.widget.JsonElement;

import android.util.Log;

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
    private double mx = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double my = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private int pty = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private double rn1 = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private int sky = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private int lgt = WeatherElement.DEFAULT_WEATHER_INT_VAL;

    public Date getDate() {
        return date;
    }

    public String getStrDate() {
        return strDate;
    }

    public String getStrTime() {
        return strTime;
    }

    public double getMx() {
        return mx;
    }

    public double getMy() {
        return my;
    }

    public int getPty() {
        return pty;
    }

    public double getRn1() {
        return rn1;
    }

    public int getSky() {
        return sky;
    }

    public int getLgt() {
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

    public void setMx(double mx) {
        this.mx = mx;
    }

    public void setMy(double my) {
        this.my = my;
    }

    public void setPty(int pty) {
        this.pty = pty;
    }

    public void setRn1(double rn1) {
        this.rn1 = rn1;
    }

    public void setSky(int sky) {
        this.sky = sky;
    }

    public void setLgt(int lgt) {
        this.lgt = lgt;
    }

    public static WeatherShortestElement parsingShortestElementString2Json(String jsonStr){
        WeatherShortestElement retShortestElement = new WeatherShortestElement();

        try {
            JSONObject reader = new JSONObject(jsonStr);
            if(reader != null) {
                retShortestElement.setStrDate(reader.getString("date"));
                retShortestElement.setStrTime(reader.getString("time"));
                retShortestElement.setMx(reader.getDouble("mx"));
                retShortestElement.setMy(reader.getDouble("my"));
                retShortestElement.setPty(reader.getInt("pty"));
                retShortestElement.setRn1(reader.getDouble("rn1"));
                retShortestElement.setSky(reader.getInt("sky"));
                retShortestElement.setLgt(reader.getInt("lgt"));

                Date makeDate = WeatherElement.makeDateFromStrDateAndTime(retShortestElement.getStrDate(), retShortestElement.getStrTime());
                retShortestElement.setDate(makeDate);
            }
            else{
                Log.e("WeatherCurrentElement", "Shortest json string is NULL");
            }
        } catch (JSONException e) {
            e.printStackTrace();
        } catch (Exception e){
            e.printStackTrace();
        }

        return retShortestElement;
    }
}
