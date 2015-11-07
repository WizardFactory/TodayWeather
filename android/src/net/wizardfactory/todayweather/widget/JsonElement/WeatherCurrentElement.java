package net.wizardfactory.todayweather.widget.JsonElement;

import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Date;

/**
 * This class is current weather data that result from weather server.
 */
public class WeatherCurrentElement {
    private Date date = null;
    private String strDate = null;
    private String strTime = null;
    private double mx = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double my = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double t1h = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double rn1 = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private int sky = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private double uuu = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double vvv = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double reh = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private int pty = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private int lgt = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private double vec = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double wsd = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;

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

    public double getT1h() {
        return t1h;
    }

    public double getRn1() {
        return rn1;
    }

    public int getSky() {
        return sky;
    }

    public double getUuu() {
        return uuu;
    }

    public double getVvv() {
        return vvv;
    }

    public double getReh() {
        return reh;
    }

    public int getPty() {
        return pty;
    }

    public int getLgt() {
        return lgt;
    }

    public double getVec() {
        return vec;
    }

    public double getWsd() {
        return wsd;
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

    public void setT1h(double t1h) {
        this.t1h = t1h;
    }

    public void setRn1(double rn1) {
        this.rn1 = rn1;
    }

    public void setSky(int sky) {
        this.sky = sky;
    }

    public void setUuu(double uuu) {
        this.uuu = uuu;
    }

    public void setVvv(double vvv) {
        this.vvv = vvv;
    }

    public void setReh(double reh) {
        this.reh = reh;
    }

    public void setPty(int pty) {
        this.pty = pty;
    }

    public void setLgt(int lgt) {
        this.lgt = lgt;
    }

    public void setVec(double vec) {
        this.vec = vec;
    }

    public void setWsd(double wsd) {
        this.wsd = wsd;
    }

    public static WeatherCurrentElement parsingCurrentElementString2Json(String jsonStr){
        WeatherCurrentElement retCurrentElement = new WeatherCurrentElement();
        try {
            JSONObject reader = new JSONObject(jsonStr);
            if(reader != null) {
                retCurrentElement.setStrDate(reader.getString("date"));
                retCurrentElement.setStrTime(reader.getString("time"));
                retCurrentElement.setMx(reader.getDouble("mx"));
                retCurrentElement.setMy(reader.getDouble("my"));
                retCurrentElement.setT1h(reader.getDouble("t1h"));
                retCurrentElement.setRn1(reader.getDouble("rn1"));
                retCurrentElement.setSky(reader.getInt("sky"));
                retCurrentElement.setUuu(reader.getDouble("uuu"));
                retCurrentElement.setVvv(reader.getDouble("vvv"));
                retCurrentElement.setReh(reader.getDouble("reh"));
                retCurrentElement.setPty(reader.getInt("pty"));
                retCurrentElement.setLgt(reader.getInt("lgt"));
                retCurrentElement.setVec(reader.getDouble("vec"));
                retCurrentElement.setWsd(reader.getDouble("wsd"));

                Date makeDate = WeatherElement.makeDateFromStrDateAndTime(retCurrentElement.getStrDate(), retCurrentElement.getStrTime());
                retCurrentElement.setDate(makeDate);
            }
            else{
                Log.e("WeatherCurrentElement", "Current json string is NULL");
            }
        } catch (JSONException e) {
            e.printStackTrace();
        } catch (Exception e){
            e.printStackTrace();
        }

        return retCurrentElement;
    }
}
