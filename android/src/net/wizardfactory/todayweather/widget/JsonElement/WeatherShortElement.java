package net.wizardfactory.todayweather.widget.JsonElement;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Date;

/**
 * This class is short weather data that result from weather server
 */
public class WeatherShortElement {
    private Date date = null;
    private String strDate = null;
    private String strTime = null;
    private double pop = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private int pty = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private double r06 = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double reh = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double s06 = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private int sky = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private double t3h = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double tmn = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double tmx = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;

    public Date getDate() {
        return date;
    }

    public String getStrDate() {
        return strDate;
    }

    public String getStrTime() {
        return strTime;
    }

    public double getPop() {
        return pop;
    }

    public int getPty() {
        return pty;
    }

    public double getR06() {
        return r06;
    }

    public double getReh() {
        return reh;
    }

    public double getS06() {
        return s06;
    }

    public int getSky() {
        return sky;
    }

    public double getT3h() {
        return t3h;
    }

    public double getTmn() {
        return tmn;
    }

    public double getTmx() {
        return tmx;
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

    public void setPop(double pop) {
        this.pop = pop;
    }

    public void setPty(int pty) {
        this.pty = pty;
    }

    public void setR06(double r06) {
        this.r06 = r06;
    }

    public void setReh(double reh) {
        this.reh = reh;
    }

    public void setS06(double s06) {
        this.s06 = s06;
    }

    public void setSky(int sky) {
        this.sky = sky;
    }

    public void setT3h(double t3h) {
        this.t3h = t3h;
    }

    public void setTmn(double tmn) {
        this.tmn = tmn;
    }

    public void setTmx(double tmx) {
        this.tmx = tmx;
    }

    public static WeatherShortElement[] parsingShortElementString2Json(String jsonStr){
        WeatherShortElement[] retShortElements = null;

        try {
            JSONArray arrReader = new JSONArray(jsonStr);
            int len = arrReader.length();

            if(arrReader != null && len > 0){
                retShortElements = new WeatherShortElement[len];

                for(int i =0; i< len; i++ ) {
                    JSONObject reader = arrReader.getJSONObject(i);
                    if(reader != null) {
                        retShortElements[i] = new WeatherShortElement();

                        retShortElements[i].setStrDate(reader.getString("date"));
                        retShortElements[i].setStrTime(reader.getString("time"));
                        retShortElements[i].setPop(reader.getDouble("pop"));
                        retShortElements[i].setPty(reader.getInt("pty"));
                        retShortElements[i].setR06(reader.getDouble("r06"));
                        retShortElements[i].setReh(reader.getDouble("reh"));
                        retShortElements[i].setS06(reader.getDouble("s06"));
                        retShortElements[i].setSky(reader.getInt("sky"));
                        retShortElements[i].setT3h(reader.getDouble("t3h"));
                        retShortElements[i].setTmn(reader.getDouble("tmn"));
                        retShortElements[i].setTmx(reader.getDouble("tmx"));

                        Date makeDate = WeatherElement.makeDateFromStrDateAndTime(retShortElements[i].getStrDate(), retShortElements[i].getStrTime());
                        retShortElements[i].setDate(makeDate);
                    }
                    else{
                        Log.e("WeatherCurrentElement", "Short[" + i + "] json string is NULL");
                    }
                }
            }
            else{
                Log.e("WeatherCurrentElement", "Short array json string is NULL");
            }
        } catch (JSONException e) {
            e.printStackTrace();
        } catch (Exception e){
            e.printStackTrace();
        }
        return retShortElements;
    }
}
