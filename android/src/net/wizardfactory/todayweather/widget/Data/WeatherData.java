package net.wizardfactory.todayweather.widget.Data;

import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.JsonElement.WeatherElement;

import java.util.Calendar;

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
    public int parseSkyState() {
        int retSkyIconRscId = -1;

        Calendar c = Calendar.getInstance();
        int hour = c.get(Calendar.HOUR_OF_DAY);
        boolean isNight = (hour > 7 && hour < 18) ? false : true;

        switch (pty) {
            case 1:
                if (lgt == 1) {
                    return R.drawable.rain_lightning;
                }
                return R.drawable.rain;
            case 2:
                return R.drawable.rain_snow;//Todo need RainWithSnow icon";
            case 3:
                return R.drawable.snow;
        }

        if (lgt == 1) {
            return R.drawable.lightning;
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
                    retSkyIconRscId = R.drawable.moon_cloud;
                } else {
                    retSkyIconRscId = R.drawable.sun_cloud;
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
