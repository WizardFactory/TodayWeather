package net.wizardfactory.todayweather.widget.Data;

import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.JsonElement.WeatherElement;

import java.util.Calendar;
import java.util.Date;
import java.util.StringTokenizer;

/**
 * This class consist of weather data for one day . data from JsonElement.
 */
public class WeatherData {
    private int sky = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private int pty = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private int lgt = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private double temperature = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double maxTemperature = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private double minTemperature = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;
    private String summary = null;
    private Date pubDate = null;
    private int aqiGrade = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private int pm10Grade = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private int pm25Grade = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private int aqiValue = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private int pm10Value = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private int pm25Value = WeatherElement.DEFAULT_WEATHER_INT_VAL;
    private String aqiStr = null;
    private String pm10Str = null;
    private String pm25Str = null;
    private Date aqiPubDate = null;
    private Date date = null; //날씨정보 날짜
    private String rn1Str = null;
    private double rn1 = WeatherElement.DEFAULT_WEATHER_DOUBLE_VAL;

    public void setRn1(double rn1) {
        this.rn1 = rn1;
    }

    public double getRn1() {
        return rn1;
    }

    public void setRn1Str(String rn1Str) {
        this.rn1Str = rn1Str;
    }

    public String getRn1Str() {
        return rn1Str;
    }

    public void setDate(Date date) {
        this.date = date;
    }

    public Date getDate() {
        return date;
    }

    public Date getAqiPubDate() {
        return aqiPubDate;
    }

    public void setAqiPubDate(Date aqiPubDate) {
        this.aqiPubDate = aqiPubDate;
    }

    public String getPm25Str() {
        return pm25Str;
    }

    public void setPm25Str(String pm25Str) {
        this.pm25Str = pm25Str;
    }

    public String getPm10Str() {
        return pm10Str;
    }

    public void setPm10Str(String pm10Str) {
        this.pm10Str = pm10Str;
    }

    public String getAqiStr() {
        return aqiStr;
    }

    public void setAqiStr(String aqiStr) {
        this.aqiStr = aqiStr;
    }

    public int getPm25Value() {
        return pm25Value;
    }

    public void setPm25Value(int pm25Value) {
        this.pm25Value = pm25Value;
    }

    public int getPm10Value() {
        return pm10Value;
    }

    public void setPm10Value(int pm10Value) {
        this.pm10Value = pm10Value;
    }

    public int getAqiValue() {
        return aqiValue;
    }

    public void setAqiValue(int aqiValue) {
        this.aqiValue = aqiValue;
    }

    public Date getPubDate() {
        return pubDate;
    }

    public int getAqiGrade() {
        return aqiGrade;
    }

    public int getPm10Grade() {
        return pm10Grade;
    }

    public int getPm25Grade() {
        return pm25Grade;
    }

    public int getSky() {
        return sky;
    }

    public int getLgt() {
        return lgt;
    }

    public int getPty() {
        return pty;
    }

    public double getTemperature() {
        return temperature;
    }

    public double getMaxTemperature() {
        return maxTemperature;
    }

    public double getMinTemperature() {
        return minTemperature;
    }

    public String getSummary() {
        return summary;
    }

    public void setPubDate(Date pubDate) {
        this.pubDate = pubDate;
    }

    public void setAqiGrade(int aqiGrade) {
        this.aqiGrade = aqiGrade;
    }

    public void setPm10Grade(int pm10Grade) {
        this.pm10Grade = pm10Grade;
    }

    public void setPm25Grade(int pm25Grade) {
        this.pm25Grade = pm25Grade;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public void setSky(double sky) {
        this.sky = (int)sky;
    }

    public void setPty(double pty) {
        this.pty = (int)pty;
    }

    public void setLgt(double lgt) {
        this.lgt = (int)lgt;
    }

    public void setTemperature(double temperature) {
        this.temperature = temperature;
    }

    public void setMaxTemperature(double maxTemperature) {
        this.maxTemperature = maxTemperature;
    }

    public void setMinTemperature(double minTemperature) {
        this.minTemperature = minTemperature;
    }

    /**
     *
     * @param {Number} sky 맑음(1) 구름조금(2) 구름많음(3) 흐림(4) , invalid : -1
     * @param {Number} pty 없음(0) 비(1) 비/눈(2) 눈(3), invalid : -1
     * @param {Number} lgt 없음(0) 있음(1), invalid : -1
     * @param {Boolean} isNight
     */
    public String getSkyImageName() {
        Calendar c = Calendar.getInstance();
        int hour = c.get(Calendar.HOUR_OF_DAY);
        boolean isNight = (hour > 7 && hour < 18) ? false : true;

        String strSkyImage = "";
        if (sky == 4) {
            strSkyImage += "cloud";
        }
        else {
            if (isNight)  {
                strSkyImage += "moon";
            }
            else {
                strSkyImage += "sun";
            }
            if (sky == 2) {
                strSkyImage += "_smallcloud";
            }
            else if (sky == 3) {
                strSkyImage += "_bigcloud";
            }
        }
        switch (pty) {
            case 1:
                strSkyImage += "_rain";
                break;
            case 2:
                strSkyImage += "_rain_snow";
                break;
            case 3:
                strSkyImage += "_snow";
                break;
        }
        if (lgt == 1) {
            strSkyImage += "_lightning";
        }

        return strSkyImage;
    }

    /**
     *
     * @param {Number} sky 맑음(1) 구름조금(2) 구름많음(3) 흐림(4) , invalid : -1
     * @param {Number} pty 없음(0) 비(1) 비/눈(2) 눈(3), invalid : -1
     * @param {Number} lgt 없음(0) 있음(1), invalid : -1
     * @param {Boolean} isNight
     */
    public int parseSkyState() {
        int retSkyIconRscId = -1;

        Calendar c = Calendar.getInstance();
        int hour = c.get(Calendar.HOUR_OF_DAY);
        boolean isNight = (hour > 7 && hour < 18) ? false : true;

        switch (pty) {
            case 1:
                if (lgt == 1) {
                    return R.drawable.cloud_lightning;
                }
                return R.drawable.cloud_rain;
            case 2:
                return R.drawable.cloud_rain_snow;//Todo need RainWithSnow icon";
            case 3:
                return R.drawable.cloud_snow;
        }

        if (lgt == 1) {
            return R.drawable.cloud_lightning;
        }

        switch (sky) {
            case 1:
                if (isNight) {
                    retSkyIconRscId = R.drawable.moon;
                } else {
                    retSkyIconRscId = R.drawable.sun;
                }
                break;
            case 2:
                if (isNight) {
                    retSkyIconRscId = R.drawable.moon_bigcloud;
                } else {
                    retSkyIconRscId = R.drawable.sun_bigcloud;
                }
                break;
            case 3:
                retSkyIconRscId = R.drawable.cloud; //Todo need new icon
                break;
            case 4:
                retSkyIconRscId = R.drawable.cloud;
                break;
        }

        return retSkyIconRscId;
    }
}
