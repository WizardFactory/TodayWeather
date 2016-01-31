package net.wizardfactory.todayweather.widget.JsonElement;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Date;

/**
 * This class is dailyData weather data that result from weather server.
 */
public class WeatherDailyDataElement {
    private Date date = null;
    private String strDate = null;
    private String wfAm = null;
    private String wfPm = null;
    private String reliability = null;
    private double lgt = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double pty = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double reh = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double rn1 = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double sky = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double pop = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double s06 = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double t1d = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double wsd = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double taMax = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double taMin = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;

    public Date getDate() {
        return date;
    }

    public String getStrDate() {
        return strDate;
    }

    public String getWfAm() {
        return wfAm;
    }

    public String getWfPm() {
        return wfPm;
    }

    public String getReliability() {
        return reliability;
    }

    public double getLgt() {
        return lgt;
    }

    public double getPty() {
        return pty;
    }

    public double getReh() {
        return reh;
    }

    public double getRn1() {
        return rn1;
    }

    public double getSky() {
        return sky;
    }

    public double getPop() {
        return pop;
    }

    public double getS06() {
        return s06;
    }

    public double getT1d() {
        return t1d;
    }

    public double getWsd() {
        return wsd;
    }

    public double getTaMax() {
        return taMax;
    }

    public double getTaMin() {
        return taMin;
    }

    public void setDate(Date date) {
        this.date = date;
    }

    public void setStrDate(String strDate) {
        this.strDate = strDate;
    }

    public void setWfAm(String wfAm) {
        this.wfAm = wfAm;
    }

    public void setWfPm(String wfPm) {
        this.wfPm = wfPm;
    }

    public void setReliability(String reliability) {
        this.reliability = reliability;
    }

    public void setLgt(double lgt) {
        this.lgt = lgt;
    }

    public void setPty(double pty) {
        this.pty = pty;
    }

    public void setReh(double reh) {
        this.reh = reh;
    }

    public void setRn1(double rn1) {
        this.rn1 = rn1;
    }

    public void setSky(double sky) {
        this.sky = sky;
    }

    public void setPop(double pop) {
        this.pop = pop;
    }

    public void setS06(double s06) {
        this.s06 = s06;
    }

    public void setT1d(double t1d) {
        this.t1d = t1d;
    }

    public void setWsd(double wsd) {
        this.wsd = wsd;
    }

    public void setTaMax(double taMax) {
        this.taMax = taMax;
    }

    public void setTaMin(double taMin) {
        this.taMin = taMin;
    }

    public static WeatherDailyDataElement[] parsingDailyDataElementString2Json(String jsonStr) {
        WeatherDailyDataElement[] retDailyDataElements = null;

        try {
            JSONArray arrReader = new JSONArray(jsonStr);
            int len = arrReader.length();

            if (arrReader != null && len > 0) {
                retDailyDataElements = new WeatherDailyDataElement[len];

                for (int i =0; i< len; i++ ) {
                    JSONObject reader = arrReader.getJSONObject(i);
                    if (reader != null) {
                        retDailyDataElements[i] = new WeatherDailyDataElement();

                        retDailyDataElements[i].setStrDate(reader.getString("date"));
                        retDailyDataElements[i].setWfAm(reader.getString("wfAm"));
                        retDailyDataElements[i].setWfPm(reader.getString("wfPm"));
                        String reliability = reader.optString("reliability");
                        if (reliability != "") {
                            retDailyDataElements[i].setReliability(reliability);
                        }
                        double lgt = reader.optDouble("lgt");
                        if (lgt != Double.NaN) {
                            retDailyDataElements[i].setLgt(lgt);
                        }
                        double pty = reader.optDouble("pty");
                        if (pty != Double.NaN) {
                            retDailyDataElements[i].setPty(pty);
                        }
                        double reh = reader.optDouble("reh");
                        if (reh != Double.NaN) {
                            retDailyDataElements[i].setReh(reh);
                        }
                        double rn1 = reader.optDouble("rn1");
                        if (rn1 != Double.NaN) {
                            retDailyDataElements[i].setRn1(rn1);
                        }
                        double sky = reader.optDouble("sky");
                        if (sky != Double.NaN) {
                            retDailyDataElements[i].setSky(sky);
                        }
                        double pop = reader.optDouble("pop");
                        if (pop != Double.NaN) {
                            retDailyDataElements[i].setPop(pop);
                        }
                        double s06 = reader.optDouble("s06");
                        if (s06 != Double.NaN) {
                            retDailyDataElements[i].setS06(s06);
                        }
                        double t1d = reader.optDouble("t1d");
                        if (t1d != Double.NaN) {
                            retDailyDataElements[i].setT1d(t1d);
                        }
                        double wsd = reader.optDouble("wsd");
                        if (wsd != Double.NaN) {
                            retDailyDataElements[i].setWsd(wsd);
                        }
                        double taMax = reader.optDouble("taMax");
                        if (taMax != Double.NaN) {
                            retDailyDataElements[i].setTaMax(taMax);
                        }
                        double taMin = reader.optDouble("taMin");
                        if (taMin != Double.NaN) {
                            retDailyDataElements[i].setTaMin(taMin);
                        }

                        Date makeDate = WeatherElement.makeDateFromStrDateAndTime(retDailyDataElements[i].getStrDate(), null);
                        retDailyDataElements[i].setDate(makeDate);
                    }
                    else {
                        Log.e("WeatherDailyDataElement", "DailyData[" + i + "] json string is NULL");
                    }
                }
            }
            else {
                Log.e("WeatherDailyDataElement", "DailyData array json string is NULL");
            }
        } catch (JSONException e) {
            e.printStackTrace();
        } catch (Exception e){
            e.printStackTrace();
        }

        return retDailyDataElements;
    }
}