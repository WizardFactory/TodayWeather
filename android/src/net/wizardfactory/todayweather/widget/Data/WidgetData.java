package net.wizardfactory.todayweather.widget.Data;

/**
 * This class used for home screen widget component data that display weather..
 */
public class WidgetData {
    public final static int YESTERDAY_WEATHER_INDEX = 0;
    public final static int TODAY_WEATHER_INDEX = 1;
    public final static int TOMORROW_WEATHER_INDEX = 2;
    public final static int MAX_WEAHTER_INDEX = 6;
    WeatherData currentWeather = null;
    WeatherData before24hWeather = null; //the weather is before 24hours
    WeatherData daysWeather[] = null;
    String Loc = null;
    Units units = null;

    public WidgetData() {
        daysWeather = new WeatherData[MAX_WEAHTER_INDEX+1];
    }

    public void setDayWeather(int index, WeatherData daysWeather) {
        this.daysWeather[index] = daysWeather;
    }

    public WeatherData getDayWeather(int index) {
        return daysWeather[index];
    }

    public WeatherData getCurrentWeather() {
        return currentWeather;
    }

    public WeatherData getBefore24hWeather() {
        return before24hWeather;
    }

    public String getLoc() {
        return Loc;
    }

    public void setCurrentWeather(WeatherData currentWeather) {
        this.currentWeather = currentWeather;
    }

    public void setBefore24hWeather(WeatherData before24hWeather) {
        this.before24hWeather = before24hWeather;
    }

    public void setLoc(String loc) {
        Loc = loc;
    }

    public void setUnits(Units units) {
        this.units = units;
    }

    public Units getUnits() {
        return units;
    }
}
