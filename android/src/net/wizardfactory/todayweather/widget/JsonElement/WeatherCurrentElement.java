package net.wizardfactory.todayweather.widget.JsonElement;

import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;

/**
 * This class is current weather data that result from weather server.
 */
public class WeatherCurrentElement {
    private Date date = null;           //stnDateTime이 존재하면 pubdate, date, stnDataTime은 동일
    private String strDate = null;
    private String strTime = null;
    private double t1h = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double rn1 = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double sky = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double uuu = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double vvv = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double reh = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double pty = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double lgt = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double vec = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double wsd = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private Date pubDate = null;
    private String strPubDate = null;
    private String stnDateTime = null; //aws에서 가지고 오는 live time
    private String strSummary = null;
    private String aqiStationName = null;
    private int aqiValue = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private int pm10Value = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private int pm25Value = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private int aqiGrade = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private int pm10Grade = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private int pm25Grade = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private String aqiStr = null;
    private String pm10Str = null;
    private String pm25Str = null;
    private String strAqiPubDate = null;
    private Date aqiPubDate = null;
    private double before24ht1h = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private String rn1Str = null;

    public Date getPubDate() {
        return pubDate;
    }

    public void setPubDate(Date pubDate) {
        this.pubDate = pubDate;
    }

    public String getStrPubDate() {
        return strPubDate;
    }

    public void setStrPubDate(String strPubDate) {
        this.strPubDate = strPubDate;
    }

    public String getRn1Str() {
        return rn1Str;
    }

    public void setRn1Str(String rn1Str) {
        this.rn1Str = rn1Str;
    }

    public double getBefore24ht1h() {
        return before24ht1h;
    }

    public void setBefore24ht1h(double before24ht1h) {
        this.before24ht1h = before24ht1h;
    }

    public Date getAqiPubDate() {
        return aqiPubDate;
    }

    public void setAqiPubDate(Date aqiPubDate) {
        this.aqiPubDate = aqiPubDate;
    }

    public String getStrAqiPubDate() {
        return strAqiPubDate;
    }

    public void setStrAqiPubDate(String strAqiPubDate) {
        this.strAqiPubDate = strAqiPubDate;
    }

    public String getAqiStationName() {
        return aqiStationName;
    }

    public void setAqiStationName(String aqiStationName) {
        this.aqiStationName = aqiStationName;
    }

    public int getAqiValue() {
        return aqiValue;
    }

    public void setAqiValue(int aqiValue) {
        this.aqiValue = aqiValue;
    }

    public int getPm10Value() {
        return pm10Value;
    }

    public void setPm10Value(int pm10Value) {
        this.pm10Value = pm10Value;
    }

    public int getPm25Value() {
        return pm25Value;
    }

    public void setPm25Value(int pm25Value) {
        this.pm25Value = pm25Value;
    }

    public String getAqiStr() {
        return aqiStr;
    }

    public void setAqiStr(String aqiStr) {
        this.aqiStr = aqiStr;
    }

    public String getPm10Str() {
        return pm10Str;
    }

    public void setPm10Str(String pm10Str) {
        this.pm10Str = pm10Str;
    }

    public String getPm25Str() {
        return pm25Str;
    }

    public void setPm25Str(String pm25Str) {
        this.pm25Str = pm25Str;
    }

    public void setAqiGrade(int aqiGrade) {
        this.aqiGrade = aqiGrade;
    }

    public int getAqiGrade() {
        return aqiGrade;
    }

    public void setPm25Grade(int pm25Grade) {
        this.pm25Grade = pm25Grade;
    }

    public int getPm25Grade() {
        return pm25Grade;
    }

    public void setPm10Grade(int pm10Grade) {
        this.pm10Grade = pm10Grade;
    }

    public int getPm10Grade() {
        return pm10Grade;
    }

    public Date getDate() {
        return date;
    }

    public String getStrDate() {
        return strDate;
    }

    public String getStrTime() {
        return strTime;
    }

    public String getStrSummary() {
        return strSummary;
    }

    public double getT1h() {
        return t1h;
    }

    public double getRn1() {
        return rn1;
    }

    public double getSky() {
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

    public double getPty() {
        return pty;
    }

    public double getLgt() {
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

    public void setStrSummary(String strSummary) {
        this.strSummary = strSummary;
    }

    public void setT1h(double t1h) {
        this.t1h = t1h;
    }

    public void setRn1(double rn1) {
        this.rn1 = rn1;
    }

    public void setSky(double sky) {
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

    public void setPty(double pty) {
        this.pty = pty;
    }

    public void setLgt(double lgt) {
        this.lgt = lgt;
    }

    public void setVec(double vec) {
        this.vec = vec;
    }

    public void setWsd(double wsd) {
        this.wsd = wsd;
    }

    public String getStnDateTime() {
        return stnDateTime;
    }

    public void setStnDateTime(String stnDateTime) {
        this.stnDateTime = stnDateTime;
    }

    public static WeatherCurrentElement parsingCurrentElementString2Json(String jsonStr, String currentPubDate) {
        WeatherCurrentElement retCurrentElement = new WeatherCurrentElement();
        try {
            JSONObject reader = new JSONObject(jsonStr);
            if (reader != null) {
                retCurrentElement.setStrDate(reader.optString("date", null));
                retCurrentElement.setStrTime(reader.optString("time", null));
                retCurrentElement.setStrSummary(reader.optString("summary", null));
                retCurrentElement.setT1h(reader.optDouble("t1h", WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL));
                retCurrentElement.setRn1(reader.optDouble("rn1", WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL));
                retCurrentElement.setSky(reader.optDouble("sky", WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL));
                retCurrentElement.setUuu(reader.optDouble("uuu", WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL));
                retCurrentElement.setVvv(reader.optDouble("vvv", WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL));
                retCurrentElement.setReh(reader.optDouble("reh", WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL));
                retCurrentElement.setPty(reader.optDouble("pty", WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL));
                retCurrentElement.setLgt(reader.optDouble("lgt", WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL));
                retCurrentElement.setVec(reader.optDouble("vec", WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL));
                retCurrentElement.setWsd(reader.optDouble("wsd", WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL));
                retCurrentElement.setRn1Str(reader.optString("rn1Str", null));
                retCurrentElement.setStnDateTime(reader.optString("stnDateTime", null));

                if (currentPubDate != null) {
                    retCurrentElement.setStrPubDate(currentPubDate);
                }
                Date pubDate = null;
                if (retCurrentElement.getStnDateTime() != null) {
                    SimpleDateFormat transFormat = new SimpleDateFormat("yyyy.MM.dd.HH:mm");
                    try {
                        pubDate = transFormat.parse(retCurrentElement.getStnDateTime());
                    } catch (ParseException e) {
                        e.printStackTrace();
                    }
                }
                else if (retCurrentElement.getStrPubDate() != null) {
                    SimpleDateFormat transFormat = new SimpleDateFormat("yyyyMMdd");
                    try {
                        pubDate = transFormat.parse(retCurrentElement.getStrPubDate());
                    } catch (ParseException e) {
                        e.printStackTrace();
                    }
                }
                else {
                    pubDate = new Date(0);
                }
                retCurrentElement.setPubDate(pubDate);

                //parsing aqi
                if (reader.has("arpltn") && !reader.isNull("arpltn")) {
                    JSONObject arpltn = reader.getJSONObject("arpltn");
                    retCurrentElement.setAqiStationName(arpltn.optString("stationName", null));
                    retCurrentElement.setAqiStr(arpltn.optString("khaiStr", null));
                    retCurrentElement.setPm10Str(arpltn.optString("pm10Str", null));
                    retCurrentElement.setPm25Str(arpltn.optString("pm25Str", null));
                    retCurrentElement.setAqiValue(arpltn.optInt("khaiValue", WeatherElement.DEFAULT_WEATHER_INT_VAL));
                    retCurrentElement.setPm10Value(arpltn.optInt("pm10Value", WeatherElement.DEFAULT_WEATHER_INT_VAL));
                    retCurrentElement.setPm25Value(arpltn.optInt("pm25Value", WeatherElement.DEFAULT_WEATHER_INT_VAL));
                    retCurrentElement.setAqiGrade(arpltn.optInt("khaiGrade", WeatherElement.DEFAULT_WEATHER_INT_VAL));
                    retCurrentElement.setPm10Grade(arpltn.optInt("pm10Grade", WeatherElement.DEFAULT_WEATHER_INT_VAL));
                    retCurrentElement.setPm25Grade(arpltn.optInt("pm25Grade", WeatherElement.DEFAULT_WEATHER_INT_VAL));
                    retCurrentElement.setStrAqiPubDate(arpltn.optString("dataTime", null));
                    retCurrentElement.setAqiPubDate(WeatherElement.makeDateFromStrDashDate(retCurrentElement.getStrAqiPubDate()));
                }
                if (reader.has("yesterday") && !reader.isNull("yesterday")) {
                    JSONObject yesterday = reader.getJSONObject("yesterday");
                    retCurrentElement.setBefore24ht1h(yesterday.optDouble("t1h", WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL));
                }

                Date makeDate = WeatherElement.makeDateFromStrDateAndTime(retCurrentElement.getStrDate(), retCurrentElement.getStrTime(), retCurrentElement.getStnDateTime());
                retCurrentElement.setDate(makeDate);
            }
            else {
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
