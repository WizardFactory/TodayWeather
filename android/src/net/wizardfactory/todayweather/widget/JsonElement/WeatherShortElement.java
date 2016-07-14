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
    private double pty = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double r06 = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double reh = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double s06 = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double sky = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double t3h = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double tmn = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double tmx = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double rn1 = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double lgt = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double wsd = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double vec = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;

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

    public double getPty() {
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

    public double getSky() {
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

    public double getRn1() {
        return rn1;
    }

    public double getLgt() {
        return lgt;
    }

    public double getWsd() {
        return wsd;
    }

    public double getVec() {
        return vec;
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

    public void setPty(double pty) {
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

    public void setSky(double sky) {
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

    public void setRn1(double rn1) {
        this.rn1 = rn1;
    }

    public void setLgt(double lgt) {
        this.lgt = lgt;
    }

    public void setWsd(double wsd) {
        this.wsd = wsd;
    }

    public void setVec(double vec) {
        this.vec = vec;
    }

    public static WeatherShortElement[] parsingShortElementString2Json(String jsonStr) {
        WeatherShortElement[] retShortElements = null;

        try {
            JSONArray arrReader = new JSONArray(jsonStr);
            int len = arrReader.length();

            if (arrReader != null && len > 0) {
                retShortElements = new WeatherShortElement[len];

                for(int i =0; i< len; i++ ) {
                    JSONObject reader = arrReader.getJSONObject(i);
                    if (reader != null) {
                        retShortElements[i] = new WeatherShortElement();

                        retShortElements[i].setStrDate(reader.getString("date"));
                        retShortElements[i].setStrTime(reader.getString("time"));
                        retShortElements[i].setPop(reader.getDouble("pop"));
                        retShortElements[i].setPty(reader.getDouble("pty"));
                        retShortElements[i].setR06(reader.getDouble("r06"));
                        retShortElements[i].setReh(reader.getDouble("reh"));
                        retShortElements[i].setS06(reader.getDouble("s06"));
                        retShortElements[i].setSky(reader.getDouble("sky"));
                        retShortElements[i].setT3h(reader.getDouble("t3h"));
                        retShortElements[i].setTmn(reader.getDouble("tmn"));
                        retShortElements[i].setTmx(reader.getDouble("tmx"));

                        double rn1 = reader.optDouble("rn1");
                        if (rn1 != Double.NaN) {
                            retShortElements[i].setRn1(rn1);
                        }
                        double lgt = reader.optDouble("lgt");
                        if (lgt != Double.NaN) {
                            retShortElements[i].setLgt(lgt);
                        }
                        double wsd = reader.optDouble("wsd");
                        if (wsd != Double.NaN) {
                            retShortElements[i].setWsd(wsd);
                        }
                        double vec = reader.optDouble("vec");
                        if (vec != Double.NaN) {
                            retShortElements[i].setVec(vec);
                        }

                        Date makeDate = WeatherElement.makeDateFromStrDateAndTime(retShortElements[i].getStrDate(), retShortElements[i].getStrTime());
                        retShortElements[i].setDate(makeDate);
                    }
                    else {
                        Log.e("WeatherCurrentElement", "Short[" + i + "] json string is NULL");
                    }
                }
            }
            else {
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
