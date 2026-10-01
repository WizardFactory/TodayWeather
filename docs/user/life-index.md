# Life indices in TodayWeather

Open a saved Korean location, then scroll to **Weather details**. TodayWeather shows the UV index and any pollen risk grades currently supplied for that location and date. The screenshot below is an actual browser run with a weather response fixture: weeds pollen is grade 0 (Low), while oak and pine were absent and therefore did not appear.

![Weather details showing UV and a low weeds pollen grade](images/life-index-pollen.png)

## Reading the values

The UV value is a number. Pollen grades are **Low (0)**, **Moderate (1)**, **High (2)** and **Very high (3)**. A zero grade means low risk; it does not mean missing data. TodayWeather shows oak and pine pollen during their spring publication season and weeds pollen during the late summer/autumn season, when the provider supplies a valid value. An absent item means that no usable value was supplied for the selected place and day.

These are provider indices, not a personal medical assessment. Check the weather update time before relying on a stored view. Activity suitability, food poisoning and the retired health indices are not currently offered.

The data comes from the Korea Meteorological Administration through the data.go.kr UV V5 and pollen risk V3 APIs. See [source and timing details](../rewrite/external-providers.md).
