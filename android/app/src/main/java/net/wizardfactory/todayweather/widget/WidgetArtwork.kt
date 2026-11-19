package net.wizardfactory.todayweather.widget

import net.wizardfactory.todayweather.R

// Original WizardFactory Android widget artwork. License in assets/licenses/legacy-android-widget-MIT.txt.
internal fun skyArtwork(key: String?): Int? = when (key?.replace("rainsnow", "rain_snow")?.removeSuffix("_fog")) {
    "cloud" -> R.drawable.widget_cloud
    "cloud_lightning" -> R.drawable.widget_cloud_lightning
    "cloud_rain" -> R.drawable.widget_cloud_rain
    "cloud_rain_lightning" -> R.drawable.widget_cloud_rain_lightning
    "cloud_rain_snow" -> R.drawable.widget_cloud_rain_snow
    "cloud_rain_snow_lightning" -> R.drawable.widget_cloud_rain_snow_lightning
    "cloud_snow" -> R.drawable.widget_cloud_snow
    "cloud_snow_lightning" -> R.drawable.widget_cloud_snow_lightning
    "lightning" -> R.drawable.widget_lightning
    "moon" -> R.drawable.widget_moon
    "moon_bigcloud" -> R.drawable.widget_moon_bigcloud
    "moon_bigcloud_lightning" -> R.drawable.widget_moon_bigcloud_lightning
    "moon_bigcloud_rain" -> R.drawable.widget_moon_bigcloud_rain
    "moon_bigcloud_rain_lightning" -> R.drawable.widget_moon_bigcloud_rain_lightning
    "moon_bigcloud_rain_snow" -> R.drawable.widget_moon_bigcloud_rain_snow
    "moon_bigcloud_rain_snow_lightning" -> R.drawable.widget_moon_bigcloud_rain_snow_lightning
    "moon_bigcloud_snow" -> R.drawable.widget_moon_bigcloud_snow
    "moon_bigcloud_snow_lightning" -> R.drawable.widget_moon_bigcloud_snow_lightning
    "moon_cloud" -> R.drawable.widget_moon_cloud
    "moon_lightning" -> R.drawable.widget_moon_lightning
    "moon_rain" -> R.drawable.widget_moon_rain
    "moon_rain_lightning" -> R.drawable.widget_moon_rain_lightning
    "moon_rain_snow" -> R.drawable.widget_moon_rain_snow
    "moon_rain_snow_lightning" -> R.drawable.widget_moon_rain_snow_lightning
    "moon_smallcloud" -> R.drawable.widget_moon_smallcloud
    "moon_smallcloud_lightning" -> R.drawable.widget_moon_smallcloud_lightning
    "moon_smallcloud_rain" -> R.drawable.widget_moon_smallcloud_rain
    "moon_smallcloud_rain_lightning" -> R.drawable.widget_moon_smallcloud_rain_lightning
    "moon_smallcloud_rain_snow" -> R.drawable.widget_moon_smallcloud_rain_snow
    "moon_smallcloud_rain_snow_lightning" -> R.drawable.widget_moon_smallcloud_rain_snow_lightning
    "moon_smallcloud_snow" -> R.drawable.widget_moon_smallcloud_snow
    "moon_smallcloud_snow_lightning" -> R.drawable.widget_moon_smallcloud_snow_lightning
    "moon_snow" -> R.drawable.widget_moon_snow
    "moon_snow_lightning" -> R.drawable.widget_moon_snow_lightning
    "rain" -> R.drawable.widget_rain
    "rain_lightning" -> R.drawable.widget_rain_lightning
    "rain_snow" -> R.drawable.widget_rain_snow
    "snow" -> R.drawable.widget_snow
    "snow_lightning" -> R.drawable.widget_snow_lightning
    "sun" -> R.drawable.widget_sun
    "sun_bigcloud" -> R.drawable.widget_sun_bigcloud
    "sun_bigcloud_lightning" -> R.drawable.widget_sun_bigcloud_lightning
    "sun_bigcloud_rain" -> R.drawable.widget_sun_bigcloud_rain
    "sun_bigcloud_rain_lightning" -> R.drawable.widget_sun_bigcloud_rain_lightning
    "sun_bigcloud_rain_snow" -> R.drawable.widget_sun_bigcloud_rain_snow
    "sun_bigcloud_rain_snow_lightning" -> R.drawable.widget_sun_bigcloud_rain_snow_lightning
    "sun_bigcloud_snow" -> R.drawable.widget_sun_bigcloud_snow
    "sun_bigcloud_snow_lightning" -> R.drawable.widget_sun_bigcloud_snow_lightning
    "sun_cloud" -> R.drawable.widget_sun_cloud
    "sun_lightning" -> R.drawable.widget_sun_lightning
    "sun_rain" -> R.drawable.widget_sun_rain
    "sun_rain_lightning" -> R.drawable.widget_sun_rain_lightning
    "sun_rain_snow" -> R.drawable.widget_sun_rain_snow
    "sun_rain_snow_lightning" -> R.drawable.widget_sun_rain_snow_lightning
    "sun_smallcloud" -> R.drawable.widget_sun_smallcloud
    "sun_smallcloud_lightning" -> R.drawable.widget_sun_smallcloud_lightning
    "sun_smallcloud_rain" -> R.drawable.widget_sun_smallcloud_rain
    "sun_smallcloud_rain_lightning" -> R.drawable.widget_sun_smallcloud_rain_lightning
    "sun_smallcloud_rain_snow" -> R.drawable.widget_sun_smallcloud_rain_snow
    "sun_smallcloud_rain_snow_lightning" -> R.drawable.widget_sun_smallcloud_rain_snow_lightning
    "sun_smallcloud_snow" -> R.drawable.widget_sun_smallcloud_snow
    "sun_smallcloud_snow_lightning" -> R.drawable.widget_sun_smallcloud_snow_lightning
    "sun_snow" -> R.drawable.widget_sun_snow
    "sun_snow_lightning" -> R.drawable.widget_sun_snow_lightning
    "wind_cloud" -> R.drawable.widget_wind_cloud
    else -> null
}
