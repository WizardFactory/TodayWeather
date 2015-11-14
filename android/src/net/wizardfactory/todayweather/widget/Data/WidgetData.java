package net.wizardfactory.todayweather.widget.Data;

/**
 * This class used for home screen widget component data that display weather..
 */
public class WidgetData {
    WeatherData currentWeather = null;
    WeatherData yesterdayWeather = null;
    String Loc = null;

    public WeatherData getCurrentWeather() {
        return currentWeather;
    }

    public WeatherData getYesterdayWeather() {
        return yesterdayWeather;
    }

    public String getLoc() {
        return Loc;
    }

    public void setCurrentWeather(WeatherData currentWeather) {
        this.currentWeather = currentWeather;
    }

    public void setYesterdayWeather(WeatherData yesterdayWeather) {
        this.yesterdayWeather = yesterdayWeather;
    }

    public void setLoc(String loc) {
        Loc = loc;
    }
}
