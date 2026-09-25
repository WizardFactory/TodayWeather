# Screen element bindings

This reference lists each visible element of S02 (TodayWeather and TodayAir rows), S03 hourly, S04 daily, S05/S16 air and S15 TodayAir weather. For each element it gives the template expression, the normalized field behind it, the exact visibility rule, the tap action and the localization keys. Every row is **observed source** at baseline `bd6640f2` (re-baselined 2026-09-25; `client/` is identical to `ff7acf3996ccb66c912d2ed4710cf300197d6966`, where the rows were first traced, so every client line anchor is unchanged). Each row traces to a line in `client/www/templates/` and to the controller that fills the scope. Runtime behavior is stated as **synthetic execution** only where a capture ([gallery](screenshots/index.html), [manifest notes](screenshots/README.md)) or a recorded probe ([start popup](../../reports/rewrite-verification/probes/start-popup-choice.json), [unit conversion](../../reports/rewrite-verification/probes/server-unit-conversion.json)) shows it. Everything else, including every anomaly below, is source-level and was not reproduced. The captures show only the first viewport, so rows for cards below the fold come from source. For screen purpose and flows, see [screen specifications](screen-specifications.md). For wire fields and normalization, see [client data contracts](client-data-contracts.md). For refresh and event semantics, see [client state and behavior](client-state-and-behavior.md).

## Reading the tables

Template cells use these abbreviations and link to the exact line:

| Abbreviation | Template | Controller |
| --- | --- | --- |
| F | [tab-forecast.html](../../client/www/templates/tab-forecast.html) | [ForecastCtrl](../../client/www/js/controller.forecastctrl.js) (FC), `forecastType="short"` |
| D | [tab-dailyforecast.html](../../client/www/templates/tab-dailyforecast.html) | ForecastCtrl, `forecastType="mid"` |
| W | [ta-tab-weather.html](../../client/www/templates/ta-tab-weather.html) | ForecastCtrl, `forecastType="weather"` ([FC:7-15](../../client/www/js/controller.forecastctrl.js#L7-L15)) |
| A | [tab-air.html](../../client/www/templates/tab-air.html) | [AirCtrl](../../client/www/js/controller.air.js) (AC) |
| S | [tab-search.html](../../client/www/templates/tab-search.html) | [SearchCtrl](../../client/www/js/controller.searchctrl.js) (SC) |
| St | [start.html](../../client/www/templates/start.html) | [StartCtrl](../../client/www/js/controller.start.js) |

Visibility vocabulary:

| Rule | Hides | Keeps |
| --- | --- | --- |
| truthy | `undefined`, `null`, `0`, `''`, `NaN`, `false` | non-zero numbers, non-empty strings, any object/array |
| `!= undefined` (loose) | `undefined`, `null` | `0`, `-1`, `''` |
| `> 0` | missing, `0`, negatives | positive numbers |
| `-1` sentinel | only where the template tests `!= -1` explicitly | — |
| always | nothing; a missing value renders as empty text | — |

Shared scope rules:

- **Where the scope comes from.** Header and hero helpers live on the parent [TabCtrl](../../client/www/js/controller.tabctrl.js) (TC) scope. These are `goPushPage`, `doTabShare`, `onSwipeLeft/Right`, `goAirInfoPage`, `goUnitsPage`, `popUpAirForecastInfo`, `getSentimentIcon`, `grade2Color`, `showLoadingIndicator` and the day-label helpers. Page data comes from FC, AC or SC.
- **Controllers re-run on entry.** Every tab state is `cache: false` ([app.js:1899-1956](../../client/www/js/app.js#L1899-L1956)), so the controller re-runs `init()` each time the page is entered.
- **Color and face by grade.** `grade2Color(grade, default)` returns `aqiStandard[grade-1].color` for the selected air unit. It clamps grades above the scale and returns `''` or the given default for a missing grade ([TC:710-730](../../client/www/js/controller.tabctrl.js#L710-L730)). `getSentimentIcon(grade)` returns a Material Icons code point from a 4-grade table (airkorea, airkorea_who) or a 6-grade table (airnow, aqicn). It starts from `&#xE814;`, the most negative face, and keeps it for an unknown or missing grade ([TC:656-702](../../client/www/js/controller.tabctrl.js#L656-L702)).
- **Day labels** ([TC:602-641](../../client/www/js/controller.tabctrl.js#L602-L641)):
  - `getDayString(fromToday)` maps -3..+3 to `LOC_A_COUPLE_OF_DAYS_AGO`, `LOC_THE_DAY_BEFORE_YESTERDAY`, `LOC_YESTERDAY`, `LOC_TODAY`, `LOC_TOMORROW`, `LOC_THE_DAY_AFTER_TOMORROW` and `LOC_TWO_DAYS_AFTER_TOMORROW`. Any other value gives `LOC_FROM_TODAY`.
  - `dayToString` gives `LOC_SUN`…`LOC_SAT`. `dayToFullString` gives `LOC_SUNDAY`…`LOC_SATURDAY`.
  - `convertDD` and `convertMMDD` take fixed substrings of date strings.
- **Unit suffixes are not translated.** `getWindSpdUnit()`, `getPressUnit()`, `getDistanceUnit()` and `getPrecipUnit()` print the stored unit value as is, for example `m/s`, `bft`, `hPa`, `km` or `mm` ([FC:620-638](../../client/www/js/controller.forecastctrl.js#L620-L638)).
- **Analytics.** Every route change sends `Util.ga.trackView(toState.name)` from `$stateChangeStart` ([app.js:295-326](../../client/www/js/app.js#L295-L326)). The Action column lists only the extra `trackEvent` calls that a handler makes.

## Shared weather header — S03, S04, S15, S05/S16

The same bindings appear at F:2-32, D:2-32, W:2-32 and A:2-32; only the title `p` class differs. Captures: [iOS header](screenshots/tw-hourly.png), [Android-mode glyphs](screenshots/tw-android-mode-hourly.png) (Ionic Android mode inside the iOS WKWebView, no plugins; see [product and platform differences](screen-specifications.md#product-and-platform-differences)), [spinner, light theme](screenshots/tw-loading-header-spinner-light.png) and [spinner, dark theme](screenshots/tw-loading-header-spinner-dark.png).

| Element | Template and expression | Normalized source | Visibility | Action | LOC key(s) |
| --- | --- | --- | --- | --- | --- |
| Menu | [F:3](../../client/www/templates/tab-forecast.html#L3) `menu-toggle="left"` | — | always | Opens the side menu (S06) | — |
| Title | [F:7](../../client/www/templates/tab-forecast.html#L7) `{{address}}` | `city.name`, else `WeatherUtil.getShortenAddress(city.address)`, a comma-joined short region/town string ([FC:354-357](../../client/www/js/controller.forecastctrl.js#L354-L357), [AC:206](../../client/www/js/controller.air.js#L206), [getShortenAddress](../../client/www/js/service.weatherutil.js#L735-L772)) | always; empty until the first apply | none | — |
| Location glyph | [F:8-9](../../client/www/templates/tab-forecast.html#L8-L9) `isLocationEnabled()?'&#xE0C8;':'&#xE0C7;'` (location on/off) | `city.currentPosition`; `Util.isLocationEnabled()`, which returns true when the diagnostic plugin is absent ([service.util.js:223-243](../../client/www/js/service.util.js#L223-L243)) | `currentPosition && showLoadingIndicator != true` (the spinner takes its place) | **ForecastCtrl only** (S03/S04/S15): `switchToLocationSettings()` always logs `action/click/toggleLocationEnable`. It acts only when location is off: on Android it opens location settings, on iOS app settings, then it calls `WeatherInfo.reloadCity` ([FC:658-674](../../client/www/js/controller.forecastctrl.js#L658-L674)). **S05/S16**: neither AirCtrl nor TabCtrl defines the handler, so the tap does nothing | — |
| Loading spinner | [F:10](../../client/www/templates/tab-forecast.html#L10) `ion-spinner icon="bubbles"` | TabCtrl `showLoadingIndicator`, set while `loadWeatherData` fetches. For a current-position city it stays on until the position update finishes ([TC:926-1025](../../client/www/js/controller.tabctrl.js#L926-L1025)) | truthy | none | — |
| Notification bell | [F:14-23](../../client/www/templates/tab-forecast.html#L14-L23): `ion-ios-bell` / `-outline` when `!isAndroid()`, `ion-android-notifications` / `-none` when `isAndroid()` | `hasPush = Push.hasPushInfo(cityIndex)`, true when an enabled push entry exists for the index ([FC:351](../../client/www/js/controller.forecastctrl.js#L351), [AC:233](../../client/www/js/controller.air.js#L233), [service.push.js:713-724](../../client/www/js/service.push.js#L713-L724)) | always; filled when `hasPush` | `goPushPage()` goes to `/setting-push?fav=<current index>` ([TC:302-310](../../client/www/js/controller.tabctrl.js#L302-L310)) | — |
| Share | [F:24-31](../../client/www/templates/tab-forecast.html#L24-L31): `ion-ios-upload-outline` / `ion-android-share-alt` | City name or short address. TW adds `currentWeather.t1h`, a `skyIcon` emoji, `today.tmx/tmn`, and `summaryWeather` (+`summaryAir`) or `summary`. TA adds `summaryAir`, `weather` and `t1h` ([TC:167-287](../../client/www/js/controller.tabctrl.js#L167-L287)) | always; glyph set by platform | `doTabShare()` returns silently without the socialsharing plugin, and calls `startPopup()` when the city or its location is missing; logs `action/tab/share` | `LOC_CURRENT`, `LOC_HIGHEST`, `LOC_LOWEST`, `LOC_WEATHER`, `LOC_TODAYWEATHER`/`LOC_TODAYAIR` |

Evidence notes:

- **Light-theme spinner is invisible (synthetic execution, [capture](screenshots/tw-loading-header-spinner-light.png)).** `.body-content .bar p svg` forces a white fill and stroke ([ionic.app.scss:170-182](../../client/scss/ionic.app.scss#L170-L182)) on the white light-theme header.
- **No enabled cities.** With zero enabled cities, `ForecastCtrl.init` calls `startPopup()` and binds nothing ([FC:168-172](../../client/www/js/controller.forecastctrl.js#L168-L172)). The popup's labels and actions are swapped ([probe](../../reports/rewrite-verification/probes/start-popup-choice.json), synthetic execution). AirCtrl returns without any prompt ([AC:362-365](../../client/www/js/controller.air.js#L362-L365)).

## Shared weather hero — S03, S04, S15

The same markup appears at F:35-59, D:35-59 and W:35-59. The S15 photo box is the only difference (see [S15](#s15--todayair-combined-weather)).

| Element | Template and expression | Normalized source | Visibility | Action | LOC key(s) |
| --- | --- | --- | --- | --- | --- |
| Swipe area | [F:36](../../client/www/templates/tab-forecast.html#L36) `md-page-header on-swipe-left="onSwipeLeft()" on-swipe-right="onSwipeRight()"` | enabled city list | always | A left swipe calls `setNextCityIndex` and a right swipe `setPrevCityIndex`. Both then call `TabCtrl.loadWeatherData()`, which broadcasts `applyEvent` and fetches when `canLoadCity`. No-op with one enabled city. Logs `action/click/swipeleft` or `swiperight` ([TC:748-768](../../client/www/js/controller.tabctrl.js#L748-L768)) | — |
| Photo background | [F:38](../../client/www/templates/tab-forecast.html#L38) `photo-url="photo"` (D:38) | `city.photo`, copied to scope only when `settingsInfo.theme=='photo'` ([FC:362-364](../../client/www/js/controller.forecastctrl.js#L362-L364), [FC:686-707](../../client/www/js/controller.forecastctrl.js#L686-L707)) | The directive does nothing until `photo` is defined. It then preloads the image and applies a gradient over it; a load error falls back to `img/bg.png` ([app.js:1796-1819](../../client/www/js/app.js#L1796-L1819)) | none | — ([photo-theme capture](screenshots/tw-theme-photo-hourly.png), synthetic feed; see [theme variants](screen-specifications.md#theme-variants)) |
| Previous-city arrow | [F:39-41](../../client/www/templates/tab-forecast.html#L39-L41) `ng-click="onSwipeRight()"` | `cityCount = WeatherInfo.getEnabledCityCount()`, set in `init()` ([FC:173](../../client/www/js/controller.forecastctrl.js#L173)) | `cityCount > 1` | Same as a right swipe | — |
| Next-city arrow | [F:56-58](../../client/www/templates/tab-forecast.html#L56-L58) `ng-click="onSwipeLeft()"` | same | `cityCount > 1` | Same as a left swipe | — |
| Main box | [F:42](../../client/www/templates/tab-forecast.html#L42) `ng-if="currentWeather"` | `city.currentWeather` (KMA `current` or world `thisTime[1]`; `{}` when KMA current is missing) | truthy; an empty object still renders | — | — |
| Temperature | [F:44-46](../../client/www/templates/tab-forecast.html#L44-L46) `getTemp(currentWeather.t1h)` + `˚` | `t1h` in the requested unit | always. `getTemp` returns `''` for `undefined`/`null`, rounds in F and returns the raw value in C ([FC:645-656](../../client/www/js/controller.forecastctrl.js#L645-L656)). In F the KMA value arrives already floored by the server and the world value with one decimal, so 0.5 °C shows 32 on KMA and 33 on world; -0.5 °F shows 0 (synthetic execution, [unit-conversion probe](../../reports/rewrite-verification/probes/server-unit-conversion.json); [conversion rules](client-data-contracts.md#missing-values-time-and-units-are-compatibility-rules)) | — | — |
| Weather icon | [F:48](../../client/www/templates/tab-forecast.html#L48) `{{::weatherImgPath}}/{{currentWeather.skyIcon}}.png` | `skyIcon`; the theme weather directory is bound once | always | — | — |
| Summary | [F:52](../../client/www/templates/tab-forecast.html#L52) `{{summary}}` | `summaryWeather` when truthy, else `summary` ([FC:460-465](../../client/www/js/controller.forecastctrl.js#L460-L465)) | always | — | — |
| Air summary | [F:52-53](../../client/www/templates/tab-forecast.html#L52-L53) `{{summaryAir}}` | `currentWeather.summaryAir`, removed from scope when falsy ([FC:466-471](../../client/www/js/controller.forecastctrl.js#L466-L471)) | truthy | `goAirInfoPage('aqi')` goes to `/tab/air?code=aqi`, with no `fav` ([TC:289-296](../../client/www/js/controller.tabctrl.js#L289-L296)) | — |

`applyWeatherData` returns before binding anything when the selected city is null, its `address === null`, or `dayChart[0]` is missing ([FC:340-349](../../client/www/js/controller.forecastctrl.js#L340-L349)). It sets `showDetailWeather = true` only near its end ([FC:459](../../client/www/js/controller.forecastctrl.js#L459)). If anything throws before that line, every `showDetailWeather` card stays hidden.

## S03 — Hourly weather

Template F, TodayWeather only. Captures: [large](screenshots/tw-hourly.png), [compact](screenshots/tw-hourly-compact.png), [dark](screenshots/tw-theme-dark-hourly.png), [old](screenshots/tw-theme-old-hourly.png), [photo](screenshots/tw-theme-photo-hourly.png).

### Chart region

| Element | Template and expression | Normalized source | Visibility | Action | LOC key(s) |
| --- | --- | --- | --- | --- | --- |
| Scroll region | [F:60-62](../../client/www/templates/tab-forecast.html#L60-L62) `ng-if="timeWidth"`, width `timeWidth` | `timeWidth = colWidth × timeTable.length`, where `colWidth = min(bodyWidth/7, 60)` ([FC:148](../../client/www/js/controller.forecastctrl.js#L148), [FC:368](../../client/www/js/controller.forecastctrl.js#L368)) | truthy; 0 for an empty `timeTable` | Horizontal scroll. After 300 ms, `scrollLeft` is set to `colWidth × max(currentIndex-1, 0)` ([FC:489-532](../../client/www/js/controller.forecastctrl.js#L489-L532)) | — |
| Day titles | [F:66-70](../../client/www/templates/tab-forecast.html#L66-L70) `getDayString(value.fromToday)` + `date.substr(4,2) + '.' + date.substr(6,2)` | `timeTable[].fromToday`, `.date` (`YYYYMMDD`), `.time` | `$index < timeTable.length-2 && isNextDay(value,$index)`. `isNextDay` returns false for `time == 24` at index 0, and true when `date` differs from the previous call ([FC:93-123](../../client/www/js/controller.forecastctrl.js#L93-L123)) | — | `getDayString` keys |
| Hour labels | [F:72-76](../../client/www/templates/tab-forecast.html#L72-L76) `{{value.time+strHour}}` | `timeTable[].time`, which can be `24` | `ng-if="timeTable"` ([F:63](../../client/www/templates/tab-forecast.html#L63)) | — | `LOC_HOUR` (fallback `h`) |
| Temperature lines, icons, precipitation | [F:78](../../client/www/templates/tab-forecast.html#L78) `ng-short-chart` | `timeChart[0/1].values[].value.t3h`, `.skyIcon`, `.pop`, `.rn1`/`.s06`/`.r06`, `.time`; `timeChart[1].currentIndex/displayItemCount` ([app.js:447-943](../../client/www/js/app.js#L447-L943)) | always drawn | — | — |
| Temperature legend | [F:79-82](../../client/www/templates/tab-forecast.html#L79-L82) | — | `ng-if="timeChart"` | — | `LOC_THIS_DAY_TEMP`, `LOC_PREVIOUS_DAY_TEMP` |
| Wind/humidity detail chart | [F:84](../../client/www/templates/tab-forecast.html#L84) `ng-short-detail-chart` | `timeChart[1].values[].value.vec` (rotation of the wind-direction arrow), `.wsd` + wind unit, `.reh` (humidity icon bucket and `%`) ([app.js:1056-1111](../../client/www/js/app.js#L1056-L1111)) | `ng-if="expand"` | — | — |
| Expander | [F:86-91](../../client/www/templates/tab-forecast.html#L86-L91) `clickExpander()`; `expand_less`/`expand_more` ligatures | `expand = TwStorage.get("expandShortChart")`, default `false` ([FC:151-154](../../client/www/js/controller.forecastctrl.js#L151-L154)) | always | Toggles `expand` and **persists** `expandShortChart` ([FC:676-679](../../client/www/js/controller.forecastctrl.js#L676-L679)); no analytics | — |

How the short chart draws each column:

- **Precipitation probability** is printed with no guard. The capture shows `0%` columns (synthetic execution).
- **Precipitation amount** uses the first truthy value of `rn1`, `s06` or `r06`, rounded when it is 10 or more. Otherwise the cell is blank.
- **Column 0.** The icon and precipitation group for column 0 is removed ([app.js:696-698](../../client/www/js/app.js#L696-L698)).

### Air cards above the detail card

| Element | Template and expression | Normalized source | Visibility | Action | LOC key(s) |
| --- | --- | --- | --- | --- | --- |
| Hourly AQI forecast card | [F:96-97](../../client/www/templates/tab-forecast.html#L96-L97) | `hourlyAqiForecast`: `airInfoList[0].pollutants.aqi.hourly` filtered to `date >= (last or currentWeather.arpltn).dataTime`, first 4 entries. It is set only when `pollutants.aqi` exists ([FC:378-395](../../client/www/js/controller.forecastctrl.js#L378-L395)) | `showDetailWeather && showHourlyAqiForecast()`, which requires `length > 1` ([FC:324-329](../../client/www/js/controller.forecastctrl.js#L324-L329)) | Tapping the table calls `goAirInfoPage('aqi')` | `LOC_HOURLY_AQI_FORECAST` + literal ` (beta)` |
| Forecast cell hour | [F:101](../../client/www/templates/tab-forecast.html#L101) `obj.date.substr(11,2)` | `date` `YYYY-MM-DD HH:mm` | per item | — | `LOC_HOUR` |
| Forecast cell face/text | [F:102-103](../../client/www/templates/tab-forecast.html#L102-L103) `getSentimentIcon(obj.grade)`, `obj.str == undefined ? "-" : obj.str` | `grade`, `str` | always; a missing `str` shows `-` | — | — |
| Current-air fallback card | [F:108](../../client/www/templates/tab-forecast.html#L108) (no title) | `currentWeather.arpltn` | `showDetailWeather && !showHourlyAqiForecast() && arpltn && arpltn.dataTime` | — | — |
| PM2.5 tile | [F:111-116](../../client/www/templates/tab-forecast.html#L111-L116) `pm25Str`, `pm25Value.toFixed(0)` ㎍/㎥ | `arpltn.pm25Value/Grade/Str` | `pm25Value` **truthy**, so a true 0 hides the tile | `goAirInfoPage('pm25')` | `LOC_PM25` |
| PM10 tile | [F:117-122](../../client/www/templates/tab-forecast.html#L117-L122) | `arpltn.pm10*` | `pm10Value` truthy | `goAirInfoPage('pm10')` | `LOC_PM10` |
| AQI tile | [F:123-128](../../client/www/templates/tab-forecast.html#L123-L128) `aqiStr`, `aqiValue.toFixed(0)` | `arpltn.aqiValue/Grade/Str` | `aqiValue` truthy | `goAirInfoPage('aqi')` | `LOC_AQI` |

### Detail weather card

The card is `ng-if="showDetailWeather"` with title `LOC_DETAIL_WEATHER` ([F:132-133](../../client/www/templates/tab-forecast.html#L132-L133)). Every field comes from `city.currentWeather`. `today` is the daily row with `fromToday == 0` plus its `index`. No row has a tap action.

| Row | Template and expression | Normalized source | Visibility | LOC key(s) |
| --- | --- | --- | --- | --- |
| Weather | [F:135-140](../../client/www/templates/tab-forecast.html#L135-L140) icon `skyIcon`, text `weather` | `weatherType`, `skyIcon`, `weather` | `weatherType != undefined` | `LOC_WEATHER` |
| Yesterday difference | [F:141-146](../../client/www/templates/tab-forecast.html#L141-L146) `{{diffTempStr}}` | `t1h`, `yesterday.t1h` ([FC:583-618](../../client/www/js/controller.forecastctrl.js#L583-L618)) | always; the text is empty when either value is `undefined` | `LOC_SAME_AS_YESTERDAY` for a zero difference, else `LOC_THAN_YESTERDAY` with a signed value (rounded in F, one decimal in C) |
| Humidity | [F:147-152](../../client/www/templates/tab-forecast.html#L147-L152) icon `humidity_{reh - reh%10}`, or `humidity_00` when `reh` is falsy | `reh` | always | `LOC_HUMIDITY` |
| Wind | [F:153-158](../../client/www/templates/tab-forecast.html#L153-L158) `wdd wsd` + unit | `wdd`, `wsd` | always | `LOC_WIND` |
| Visibility | [F:159-164](../../client/www/templates/tab-forecast.html#L159-L164) | `visibility` | `> 0` | `LOC_VISIBILITY` |
| Pressure | [F:165-170](../../client/www/templates/tab-forecast.html#L165-L170) | `hPa` | truthy | `LOC_PRESSURE` |
| Discomfort index | [F:171-178](../../client/www/templates/tab-forecast.html#L171-L178) `dsplsStr (dspls)` | `dspls`, `dsplsStr` | truthy and `> 60` | `LOC_DISCOMFORT_INDEX` |
| Feels like | [F:179-184](../../client/www/templates/tab-forecast.html#L179-L184) `getTemp(sensorytem)˚` | `sensorytem` | truthy, so a feels-like of 0° is hidden | `LOC_FEELS_LIKE` |
| Hourly precipitation | [F:185-190](../../client/www/templates/tab-forecast.html#L185-L190) | `rn1` | truthy | `LOC_HOURLY_PRECIPITATION` |
| UV | [F:191-198](../../client/www/templates/tab-forecast.html#L191-L198) `ultrvStr (ultrv)` | `today.ultrvGrade/ultrvStr/ultrv` | `today.ultrvGrade != undefined`, so grade 0 (low) is shown | `LOC_UV` |
| Food poisoning | [F:199-204](../../client/www/templates/tab-forecast.html#L199-L204) | `today.fsnGrade/fsnStr` | `today.fsnGrade != undefined` | `LOC_FOOD_POISONING` |
| Sunrise / sunset | [F:205-216](../../client/www/templates/tab-forecast.html#L205-L216) `split(' ')[1]` | `today.sunrise`, `today.sunset` | truthy | `LOC_SUNRISE`, `LOC_SUNSET` |
| Update time | [F:217-222](../../client/www/templates/tab-forecast.html#L217-L222) `{{updateTime}}` | `stnDateTime`, else `date` formatted as `YYYY-MM-DD` + ` ` + `time` + `:00`, or `Date.toDateString()`. On an exception it is `''` and `weather/error` is logged ([FC:406-437](../../client/www/js/controller.forecastctrl.js#L406-L437)) | always | — |

### Detail AQI card

The card is gated by `showDetailWeather && currentWeather.arpltn && currentWeather.arpltn.dataTime`, with title `LOC_DETAIL_AQI` ([F:225-226](../../client/www/templates/tab-forecast.html#L225-L226)).

| Row | Template and expression | Normalized source | Visibility | Action | LOC key(s) |
| --- | --- | --- | --- | --- | --- |
| PM2.5 | [F:228-238](../../client/www/templates/tab-forecast.html#L228-L238) `pm25Str (pm25Value.toFixed(0)㎍/㎥ [pm25StationName])` | `arpltn.pm25*` | `pm25Value != undefined`, so 0 is shown | — | `LOC_PM25` |
| PM10 | [F:239-249](../../client/www/templates/tab-forecast.html#L239-L249) | `arpltn.pm10*` | `!= undefined` | — | `LOC_PM10` |
| O3, NO2, CO, SO2 | [F:250-293](../../client/www/templates/tab-forecast.html#L250-L293) `<code>Str (<code>Value.toFixed(3)ppm [<code>StationName])` | `arpltn.o3*`, `no2*`, `co*`, `so2*` | `<code>Value != undefined` | — | `LOC_O3`, `LOC_NO2`, `LOC_CO`, `LOC_SO2` |
| AQI (KHAI) | [F:294-304](../../client/www/templates/tab-forecast.html#L294-L304) `khaiStr` + `(khaiValue.toFixed(0))` | `arpltn.khaiValue/Grade/Str` | The row needs `khaiValue != undefined`. The number needs `khaiValue && khaiValue != -1`, so both `0` and the `-1` sentinel hide it | — | `LOC_AQI` |
| Station | [F:305-313](../../client/www/templates/tab-forecast.html#L305-L313) | `arpltn.stationName` | truthy | — | `LOC_STATION` |
| Published | [F:314-322](../../client/www/templates/tab-forecast.html#L314-L322) | `arpltn.dataTime` | truthy | — | `LOC_PUBLIC` |
| Air standard | [F:323-331](../../client/www/templates/tab-forecast.html#L323-L331) `getCurrentAirUnitStr()` | `Units` `airUnit`, mapped to a LOC key ([controller.units.js:148-154](../../client/www/js/controller.units.js#L148-L154)) | always | Tapping the row calls `goUnitsPage()`, which goes to `/units` | `LOC_AIR_QUALITY_INDEX_UNIT`; `LOC_AIR_QUALITY_INDEX_KR`, `_KR_WHO`, `_US`, `_CN` |
| Forecast published | [F:332-340](../../client/www/templates/tab-forecast.html#L332-L340) | `airForecastPubdate` ← `airInfoList[0].forecastPubDate`. It is set only when `pollutants.aqi` exists and is reset on every apply ([FC:373-389](../../client/www/js/controller.forecastctrl.js#L373-L389)) | truthy | **none** (display only) | `LOC_FORECAST` |
| Forecast source | [F:341-349](../../client/www/templates/tab-forecast.html#L341-L349) `airForecastSource.toUpperCase()` | `airInfoList[0].forecastSource` | truthy | `popUpAirForecastInfo(source)`: `kaq` shows `LOC_KAQ_DESCRIPTION`, `airkorea` shows `LOC_AIRKOREA_DESCRIPTION`, any other value shows no popup; one Close button ([TC:1324-1350](../../client/www/js/controller.tabctrl.js#L1324-L1350), [capture](screenshots/tw-overlay-air-source-info.png)) | `LOC_AIR_FORECAST_SOURCE`, `LOC_CLOSE` |

The fallback tile and the detail row both use the label `LOC_AQI`, but they read different fields: `aqiValue` in the fallback tile, `khaiValue` in the detail card.

### Attribution

| Element | Template | Normalized source | Visibility | Action |
| --- | --- | --- | --- | --- |
| Powered by Dark Sky | [F:352-354](../../client/www/templates/tab-forecast.html#L352-L354) `img/poweredby_darksky.png` | `city.source`. It is `"DSF"` only when the world response `pubDate` has a `DSF` key ([service.weatherutil.js:624-628](../../client/www/js/service.weatherutil.js#L624-L628)); domestic responses give `"KMA"` ([service.weatherutil.js:472](../../client/www/js/service.weatherutil.js#L472)) | `showDetailWeather && source == 'DSF'` | `openUrl('https://darksky.net/poweredby')`: with the InAppBrowser plugin it opens with target `_system` and logs `action/click/open weather source`; otherwise it calls `window.open(..., "_blank")` ([FC:125-138](../../client/www/js/controller.forecastctrl.js#L125-L138)) |

The same light-background image is used in every theme; the checked-in `img/poweredby_darksky_darkbackground.png` is not referenced by any template.

## S04 — Daily weather

Template D, TodayWeather only. The header and hero have the same bindings as S03 (D:2-59). Captures: [large](screenshots/tw-daily.png), [compact](screenshots/tw-daily-compact.png).

### Daily chart

| Element | Template and expression | Normalized source | Visibility | Action | LOC key(s) |
| --- | --- | --- | --- | --- | --- |
| Scroll region | [D:60-61](../../client/www/templates/tab-dailyforecast.html#L60-L61) width `dayWidth` | `dayWidth = max(bodyWidth, colWidth × days)` ([FC:369](../../client/www/js/controller.forecastctrl.js#L369)) | always | Initial `scrollLeft` is `colWidth × max(today.index-2, 0)`, or 0 when the body is 640 px or wider ([FC:533-573](../../client/www/js/controller.forecastctrl.js#L533-L573)) | — |
| Weekday row | [D:62-67](../../client/www/templates/tab-dailyforecast.html#L62-L67) `dayToString(value.dayOfWeek)` | `dayChart[0].values[].dayOfWeek` | `ng-if="dayChart[0].values"` | — | `LOC_SUN`…`LOC_SAT` |
| Day-of-month row | [D:68-72](../../client/www/templates/tab-dailyforecast.html#L68-L72) `value.date.substr(6,2)` | `date` `YYYYMMDD` | same | — | — |
| Icons, rain, min/max bars | [D:74](../../client/www/templates/tab-dailyforecast.html#L74) `ng-mid-chart` | `values[]`: `skyAm/skyPm`, `pop`, `rn1`/`s06`/`r06`, `tmn/tmx`; the current marker uses `dayChart[0].temp` ([app.js:1145-1551](../../client/www/js/app.js#L1145-L1551)) | always drawn | — | — |

How the daily chart draws each column:

- **Weather icons.** One icon is drawn when `skyAm == skyPm` or `skyPm` is undefined.
- **Precipitation probability** is drawn when `fromToday >= 0` and `pop` is truthy.
- **Precipitation amount** uses the first truthy value of `rn1`, `s06` or `r06`.
- **Min/max labels** show `Math.round(tmx)˚` and `Math.round(tmn)˚`.
- **Current marker** sits in the column where `fromToday === 0`.

### Daily AQI card

| Element | Template and expression | Normalized source | Visibility | Action | LOC key(s) |
| --- | --- | --- | --- | --- | --- |
| Card | [D:78-79](../../client/www/templates/tab-dailyforecast.html#L78-L79) | `hasDustForecast()` is true when `dailyAqiForecast` is truthy. Otherwise it is true when the last `fromToday == 0` row has its own `dustForecast` ([FC:18-34](../../client/www/js/controller.forecastctrl.js#L18-L34)) | `hasDustForecast()` | — | `LOC_DAILY_AQI_FORECAST` |
| Forecast table | [D:80](../../client/www/templates/tab-dailyforecast.html#L80) | `dailyAqiForecast` ← `airInfoList[0].pollutants.aqi.daily`, first 4 entries when `bodyWidth < 360` ([FC:396-403](../../client/www/js/controller.forecastctrl.js#L396-L403)) | `dailyAqiForecast && dailyAqiForecast.length` | Tapping the table calls `goAirInfoPage('aqi')` | — |
| Forecast cell | [D:82-86](../../client/www/templates/tab-dailyforecast.html#L82-L86) `convertDD(day.date)` + `getDayString` for today, else `dayToString(dayOfWeek)`; face; `day.str` | `date`, `fromToday`, `dayOfWeek`, `grade`, `str` | per item | — | `LOC_TODAY`, `LOC_SUN`…`LOC_SAT` |
| Legacy dust table | [D:89](../../client/www/templates/tab-dailyforecast.html#L89) | `dayChart[0].values[].dustForecast` | `dailyAqiForecast == undefined && dayChart[0].values` | — | — |
| Legacy dust row | [D:90-97](../../client/www/templates/tab-dailyforecast.html#L90-L97) `dayToFullString(dayOfWeek)`, `date.substr(6,2)`, `getDayString(fromToday)` | `values[7]`, `values[8]` | Only `$index == 7` or `$index == 8`, with a truthy `day.dustForecast`. The indexes are fixed and not derived from `today.index`; a `bd6640f2` KMA response with a missing daily date shifts which days they name (D51) | — | `LOC_SUNDAY`…, `getDayString` keys |
| Legacy PM2.5 / PM10 | [D:98-107](../../client/www/templates/tab-dailyforecast.html#L98-L107) | `dustForecast.pm25Grade/Str`, `pm10Grade/Str` | always inside a visible row | `goAirInfoPage('pm25')` / `('pm10')` | `LOC_PM25`, `LOC_PM10` |
| Legacy O3 | [D:108-112](../../client/www/templates/tab-dailyforecast.html#L108-L112) | `dustForecast.o3Grade/Str` | `o3Grade != undefined` | `goAirInfoPage('o3')` | `LOC_O3` |

### Detail weather card (three days)

The card is `ng-if="dayChart"`, so unlike S03 it is **not** gated by `showDetailWeather`. Its title is `LOC_DETAIL_WEATHER` and it scrolls horizontally ([D:116-118](../../client/www/templates/tab-dailyforecast.html#L116-L118)). A day cell exists only when `checkDailyDetailWeather(day)` is true, which means `fromToday` is -1, 0 or 1 ([D:121](../../client/www/templates/tab-dailyforecast.html#L121), [FC:36-39](../../client/www/js/controller.forecastctrl.js#L36-L39)). `hasPropertyInThreeDays(list)` is true when any listed field is **truthy** on yesterday, today or tomorrow around `today.index`. It returns false when `today.index` is undefined ([FC:47-90](../../client/www/js/controller.forecastctrl.js#L47-L90)). No row has a tap action.

| Row | Template and expression | Normalized source | Visibility | LOC key(s) |
| --- | --- | --- | --- | --- |
| Date | [D:123](../../client/www/templates/tab-dailyforecast.html#L123) `convertMMDD(day.dateObj)` + `getDayString` for today, else weekday | `dateObj` (`YYYY.MM.DD HH:mm`, characters 5-6 and 8-9) | always | `LOC_TODAY`, `LOC_SUN`… |
| Humidity | [D:125-131](../../client/www/templates/tab-dailyforecast.html#L125-L131) | `day.reh` | truthy per day | `LOC_HUMIDITY` |
| Wind | [D:132-138](../../client/www/templates/tab-dailyforecast.html#L132-L138) | `day.wsd` | truthy per day, so a calm 0 is hidden | `LOC_WIND` |
| Precipitation probability | [D:139-145](../../client/www/templates/tab-dailyforecast.html#L139-L145) `day.pop%` | `pop` | `hasPropertyInThreeDays(['pop'])`; a day without `pop` then shows only `%` | `LOC_PROBABILITY_OF_PRECIPITATION` |
| UV | [D:146-152](../../client/www/templates/tab-dailyforecast.html#L146-L152) `ultrvStr (ultrv)` | `ultrvGrade/ultrvStr/ultrv` | `hasPropertyInThreeDays(['ultrvGrade'])`, which is truthy-based. Grade 0 means low ([lifeIndexKmaController.js:75-91](../../server/controllers/lifeIndexKmaController.js#L75-L91)), so the row is hidden when all three days are 0, unlike S03 | `LOC_UV` |
| Food poisoning | [D:153-159](../../client/www/templates/tab-dailyforecast.html#L153-L159) | `fsnGrade/fsnStr` | per day `fsnGrade != undefined` | `LOC_FOOD_POISONING` |
| Precipitation | [D:160-167](../../client/www/templates/tab-dailyforecast.html#L160-L167) `getRainSnowFall(day)` + unit | `pty`, `rn1`, `r06`, `s06` | `hasPropertyInThreeDays(['pty','rn1','r06','s06'])`. The value is the first positive of `rn1`, `s06`, `r06` (rounded when 10 or more), else `"0"` ([FC:188-258](../../client/www/js/controller.forecastctrl.js#L188-L258)) | `LOC_DAILY_SNOWFALL` when `rn1 > 0` with `pty == 3`, or when `rn1` is not positive and `s06 > 0`; otherwise `LOC_DAILY_PRECIPITATION` |

### Attribution

| Element | Template | Visibility | Action |
| --- | --- | --- | --- |
| Powered by Dark Sky | [D:173-175](../../client/www/templates/tab-dailyforecast.html#L173-L175) | `source == 'DSF'` **only**, with no `showDetailWeather` gate, unlike S03 and S15 | `openUrl('https://darksky.net/poweredby')` |

## S15 — TodayAir combined weather

Template W, ForecastCtrl with `forecastType="weather"`, so both the hourly and the daily helpers exist ([FC:10-12](../../client/www/js/controller.forecastctrl.js#L10-L12), [FC:17](../../client/www/js/controller.forecastctrl.js#L17), [FC:93](../../client/www/js/controller.forecastctrl.js#L93)). Capture: [TodayAir weather](screenshots/ta-weather.png).

| Region | Template | Same bindings as | Differences |
| --- | --- | --- | --- |
| Header | [W:2-32](../../client/www/templates/ta-tab-weather.html#L2-L32) | Shared header | none |
| Hero | [W:35-59](../../client/www/templates/ta-tab-weather.html#L35-L59) | Shared hero | The photo box is inline: `ng-class="photo?'photo':'no-photo'"` and `ng-style` with `url('+photo+')` ([W:37-38](../../client/www/templates/ta-tab-weather.html#L37-L38)). It does not use the `photo-url` directive, so there is no preload and no `bg.png` fallback. TodayAir does not offer the photo theme, so `photo` stays unset |
| Hourly chart | [W:60-93](../../client/www/templates/ta-tab-weather.html#L60-L93) | S03 chart region | Expander: see [Expander state](#expander-state-todayweather-versus-todayair) |
| Daily chart | [W:95-113](../../client/www/templates/ta-tab-weather.html#L95-L113) | S04 daily chart | The card has no `ng-if`. There is no daily AQI card and no three-day detail card |
| Detail weather card | [W:114-206](../../client/www/templates/ta-tab-weather.html#L114-L206) | S03 detail weather card | Identical rows and rules, from weather ([W:117](../../client/www/templates/ta-tab-weather.html#L117)) to update time ([W:199-204](../../client/www/templates/ta-tab-weather.html#L199-L204)) |
| Air cards | — | — | None. S15 has no hourly AQI card, no fallback tiles and no detail AQI card; air data lives on S16 |
| Powered by Dark Sky | [W:207-209](../../client/www/templates/ta-tab-weather.html#L207-L209) | S03 attribution | Same gate as S03: `showDetailWeather && source == 'DSF'` |

## Expander state: TodayWeather versus TodayAir

| Product | Template | State | Persistence |
| --- | --- | --- | --- |
| TodayWeather S03 | [F:84-91](../../client/www/templates/tab-forecast.html#L84-L91) | ForecastCtrl boolean `expand`; the detail chart shows when it is truthy | Read from `TwStorage` key `expandShortChart` at `init` (default `false`) and written on every `clickExpander()` ([FC:151-154](../../client/www/js/controller.forecastctrl.js#L151-L154), [FC:676-679](../../client/www/js/controller.forecastctrl.js#L676-L679)) |
| TodayAir S15 | [W:84-88](../../client/www/templates/ta-tab-weather.html#L84-L88) | String `expand` created by `ng-init="expand='expand_more'"` and toggled inline; the detail chart shows when it equals `expand_less`. The `ng-init` runs in the child scope of `ng-if="timeWidth"` ([W:60](../../client/www/templates/ta-tab-weather.html#L60)), which shadows ForecastCtrl's stored boolean | **Not persisted.** The chart starts collapsed on every entry, because the state is `cache: false`, and `expandShortChart` is never written. ForecastCtrl still reads the key |

## S05/S16 — Air detail

Template A with AirCtrl, used by both products. S16 is TodayAir's primary tab ([ta-tabs.html:9](../../client/www/templates/ta-tabs.html#L9)). Captures: [TodayWeather air](screenshots/tw-air.png), [TodayAir air](screenshots/ta-air.png), [TodayAir dark](screenshots/ta-theme-dark-air.png).

**Route parameters.** The route is `/tab/air?fav&code`. `code` picks the main pollutant and defaults to `aqi` ([AC:354-360](../../client/www/js/controller.air.js#L354-L360)).

**Data selection** ([AC:209-235](../../client/www/js/controller.air.js#L209-L235)):

- `airInfo` is `airInfoList[stnIndex]`, else the city's `airInfo`, else `{}`.
- The scope's `airInfo` holds that record's `last`, else `currentWeather.arpltn`.
- The code switches to the first pollutant with a non-null `<code>Value` (order pm25, pm10, o3, no2, co, so2, aqi) only when the current code's `<code>Value` key is present but holds `null`/`undefined` **and** the record has a `pollutants` property without `pollutants[code]` ([AC:221-229](../../client/www/js/controller.air.js#L221-L229)).

The header uses the shared bindings, with `hasPush` from AirCtrl and an inert location glyph (see the shared header).

### Hero and standard ruler

| Element | Template and expression | Normalized source | Visibility | Action | LOC key(s) |
| --- | --- | --- | --- | --- | --- |
| City arrows | [A:38-40](../../client/www/templates/tab-air.html#L38-L40), [A:62-64](../../client/www/templates/tab-air.html#L62-L64) | `cityCount`, recomputed on every apply ([AC:255](../../client/www/js/controller.air.js#L255)) | `cityCount > 1` | Same as the shared hero arrows | — |
| Main box | [A:41](../../client/www/templates/tab-air.html#L41) | scope `airInfo` (latest observation) | truthy | — | — |
| Title | [A:42-44](../../client/www/templates/tab-air.html#L42-L44) `{{mainName}}` | `aqiCode` ([AC:182-192](../../client/www/js/controller.air.js#L182-L192)) | always | — | `LOC_AIR_STATUS` for `aqi`, else `LOC_PM25`, `LOC_PM10`, `LOC_O3`, `LOC_NO2`, `LOC_CO` or `LOC_SO2` |
| Main value | [A:45-47](../../client/www/templates/tab-air.html#L45-L47) `mainInfo` + `getAirCodeUnit(aqiCode)`, color `grade2Color(airCodeGrade)` | For `aqi`: `aqiStr`, else `-`. For other codes: `<code>Value`, or `-` only when it is `== undefined`, so 0 is shown ([AC:236-250](../../client/www/js/controller.air.js#L236-L250)). The unit is ㎍/㎥ for PM, ppm for gases and none for `aqi` ([AC:52-70](../../client/www/js/controller.air.js#L52-L70)) | always | — | — |
| Grade line | [A:48-52](../../client/www/templates/tab-air.html#L48-L52) `airCodeStr`, face, `airCodeActionGuide` | `<code>Str`, which is cleared to `''` for `aqi` because it is already the main value; `<code>ActionGuide` | The guide shows when truthy | — | — |
| Weather shortcut | [A:53-60](../../client/www/templates/tab-air.html#L53-L60) icon `skyIcon`, `weather`, `t1h˚` | `currentWeather.skyIcon/weather/t1h`. `t1h` is shown raw, without `getTemp` rounding | always; `˚` needs `currentWeather` | `goWeather()` opens `/tab/forecast` (TW) or `/tab/weather` (TA) ([AC:72-79](../../client/www/js/controller.air.js#L72-L79)) | — |
| Ruler value label | [A:67-74](../../client/www/templates/tab-air.html#L67-L74) `{{airCodeValue}}`, border `grade2Color(grade,'white')` | `airCodeValue`, `airCodeGrade`. `getLabelPosition` interpolates within the grade band, clamps to the ruler width, and returns 0 on error ([AC:9-50](../../client/www/js/controller.air.js#L9-L50)) | always | — | — |
| Ruler bands | [A:75-81](../../client/www/templates/tab-air.html#L75-L81) `obj.str`, `~ obj.value[aqiCode]` | `aqiStandard` list built by `setAirUnit()` from `WeatherUtil.aqiStandard[airUnit]`, with each band's upper bound ([TC:1218-1249](../../client/www/js/controller.tabctrl.js#L1218-L1249)) | `ng-if="obj.value"` is always true | — | `LOC_GOOD`, `LOC_MODERATE`, `LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS`, `LOC_UNHEALTHY`, `LOC_VERY_UNHEALTHY`, `LOC_HAZARDOUS` (4 bands for the Korean standards, 6 for airnow/aqicn) |

### Forecast, selector, info and station cards

| Element | Template and expression | Normalized source | Visibility | Action | LOC key(s) |
| --- | --- | --- | --- | --- | --- |
| Hourly chart card | [A:84-89](../../client/www/templates/tab-air.html#L84-L89) `ng-air-chart` | `airChart.data`: 24 points `hourly[index-12 … index+11]` around the first `date >= last.dataTime`; missing points become date-only objects. It is built only when `pollutants[aqiCode]` exists ([AC:266-302](../../client/www/js/controller.air.js#L266-L302)). Bars use `val` (none when undefined), `grade` color and `date` hour labels ([app.js:1552-1705](../../client/www/js/app.js#L1552-L1705)) | `airChart && airChart.data && airChart.data.length > 1` | — | `LOC_HOURLY_AQI_INFORMATION` when the matched row is the last hourly row, else `LOC_HOURLY_AQI_FORECAST`; plus ` (beta)` and `LOC_HOUR` |
| Daily forecast card | [A:90-101](../../client/www/templates/tab-air.html#L90-L101) | `dayForecast` ← `pollutants[aqiCode].daily` (array), first 4 when `bodyWidth < 360` ([AC:307-314](../../client/www/js/controller.air.js#L307-L314)). Colors use `grade2Color(day.grade,'white')` | `dayForecast && dayForecast.length` | none | `LOC_DAILY_AQI_FORECAST`, `LOC_TODAY`, `LOC_SUN`… |
| Pollutant selector | [A:102-116](../../client/www/templates/tab-air.html#L102-L116) `obj.name`, face, `obj.value` (not rounded); selected when `obj.name===airCodeName` | `_getAQIList` in the order aqi, pm25, pm10, o3, no2, co, so2. A pollutant is included when `last` has its own `<code>Value` key, which shows the raw value including 0 or null. Otherwise it is included when `pollutants` has the code, with value `-` ([AC:155-180](../../client/www/js/controller.air.js#L155-L180)) | `aqiList.length > 1` (card and table) | `setMainAqiCode(code)` re-applies and scrolls to the top without changing the URL. Logs `air/action/setMainAqiCodeByUser` and `air/setMainAqiCode/<code>` ([AC:370-375](../../client/www/js/controller.air.js#L370-L375)) | Card title `LOC_DETAIL_AQI` ([A:103](../../client/www/templates/tab-air.html#L103)); cells `LOC_AQI`, `LOC_PM25`… |
| Info card | [A:117](../../client/www/templates/tab-air.html#L117) | scope `airInfo` | `airInfo && airInfo.dataTime` | — | — |
| Station row | [A:119-127](../../client/www/templates/tab-air.html#L119-L127) | scope `airInfo.stationName` (`last`, else `arpltn`) | truthy | — | `LOC_STATION` |
| Published row | [A:128-136](../../client/www/templates/tab-air.html#L128-L136) | scope `airInfo.dataTime` | truthy | — | `LOC_PUBLIC` |
| Air standard row | [A:137-145](../../client/www/templates/tab-air.html#L137-L145) | `Units` `airUnit` | always | `goUnitsPage()` | `LOC_AIR_QUALITY_INDEX_UNIT`, `LOC_AIR_QUALITY_INDEX_*` |
| Forecast published row | [A:146-154](../../client/www/templates/tab-air.html#L146-L154) | `forecastPubdate` ← the station record's `forecastPubDate`, not `last`. It is set only when the city has its own `airInfo` or `airInfoList` ([AC:261-263](../../client/www/js/controller.air.js#L261-L263)) | truthy | **none** (display only) | `LOC_FORECAST` |
| Forecast source row | [A:155-163](../../client/www/templates/tab-air.html#L155-L163) `forecastSource.toUpperCase()` | the station record's `forecastSource` | truthy | `popUpAirForecastInfo(source)`, as on S03 | `LOC_AIR_FORECAST_SOURCE` |
| Station card | [A:166-180](../../client/www/templates/tab-air.html#L166-L180) `last.stationName`, face, `aqiCode==='aqi' ? str : value` | `stnList`, built only when the city has `airInfoList`. `value` is `last[<code>Value]`, or `-` when that is **falsy**, so 0 shows as `-` ([AC:318-325](../../client/www/js/controller.air.js#L318-L325)) | `ng-if="stnList"`; the selected cell is `$index===stnIndex` | `setStation($index)` re-applies and scrolls to the top. Logs `air/action/setStnIndexByUser` and `air/setStation`. `applyEvent` resets the station to 0 ([AC:377-388](../../client/www/js/controller.air.js#L377-L388)) | `LOC_STATION` + `airCodeName` |

The failure path when no hourly row matches `dataTime` is described in [client data contracts](client-data-contracts.md#air-contract-and-station-selection).

## S02 — Saved locations and search

Template S with SearchCtrl. The header has only the menu button, the search field and the mode button: no bell, share or location glyph. Captures: [favorites](screenshots/tw-favorites.png), [search](screenshots/tw-favorites-search.png) (bundled towns only, Places predictions stubbed empty), [editing](screenshots/tw-favorites-editing.png), [TodayAir favorites](screenshots/ta-favorites.png), [full-screen loading](screenshots/tw-loading-overlay-search.png). For the state machine and side effects, see [S02 in screen specifications](screen-specifications.md#s02--saved-locations-and-search).

### Header and search mode

| Element | Template and expression | Normalized source | Visibility | Action | LOC key(s) |
| --- | --- | --- | --- | --- | --- |
| Search field | [S:9-10](../../client/www/templates/tab-search.html#L9-L10) `ng-model="search.word"` | — | always | `ng-focus` → `OnFocusInput()` sets `isSearching=true` and `isEditing=false`. `ng-change` → `OnChangeSearchWord()` leaves edit mode and clears results for an empty word. Otherwise it restarts town paging and, when the Places service has loaded, requests predictions with `types ['(regions)']` ([SC:196-229](../../client/www/js/controller.searchctrl.js#L196-L229)) | `LOC_ENTER_CITY` (placeholder) |
| Mode button | [S:12-13](../../client/www/templates/tab-search.html#L12-L13) `isEditing ? 'LOC_OK' : isSearching ? 'LOC_CANCEL' : 'LOC_EDIT'` | `isEditing`, `isSearching` | always | `OnEdit()`. OK leaves edit mode. Cancel leaves search mode and closes the keyboard. Edit enters edit mode. Cancel and Edit also clear the word and results ([SC:268-286](../../client/www/js/controller.searchctrl.js#L268-L286)) | `LOC_OK`, `LOC_CANCEL`, `LOC_EDIT` |
| Find by location | [S:18-22](../../client/www/templates/tab-search.html#L18-L22) | — | `isSearching===true` | `OnSearchCurrentPosition()` shows full-screen loading, locates the device and places the geocoded result in `searchResults2` with `description = address`. On a failure with a message it shows the retry confirm (type `search`); a `null` rejection re-runs the search through `searchCurrentPositionEvent`. Logs `position/get/OnSearch` ([SC:241-266](../../client/www/js/controller.searchctrl.js#L241-L266)) | `LOC_FIND_BY_LOCATION` |
| Result list | [S:23](../../client/www/templates/tab-search.html#L23) | — | `isSearching===true` and either result list is non-empty | — | — |
| Bundled town rows | [S:25-31](../../client/www/templates/tab-search.html#L25-L31) `result.first second third` | `window.towns` ([data/town.js](../../client/www/data/town.js)), matched by substring on any of the three names. Matches are appended 10 at a time as the list scrolls ([SC:288-303](../../client/www/js/controller.searchctrl.js#L288-L303)) | per match | `OnSelectResult(result)` (below) | — |
| TodayWeather attribution | [S:32-34](../../client/www/templates/tab-search.html#L32-L34) literal `powered by TodayWeather` | — | `searchResults.length > 0` | none | none (hard-coded, not localized) |
| Google rows | [S:35-42](../../client/www/templates/tab-search.html#L35-L42) `result.description` | Places predictions, or the device-location geoInfo | per entry | `OnSelectResult(result)` | — |
| Google attribution | [S:43-45](../../client/www/templates/tab-search.html#L43-L45) `img/powered_by_google_on_white.png` | — | `searchResults2.length > 0` | none | — |

`OnSelectResult(result)` behaves as follows ([SC:355-508](../../client/www/js/controller.searchctrl.js#L355-L508)):

1. **Keyboard.** If the keyboard is visible, the first tap only closes it.
2. **Build the location.** The handler shows the loading overlay and builds `geoInfo` from the result:
   - Bundled town: a KR address, with the name taken from the most specific of third, second and first.
   - Places prediction: the name comes from the term that matched. The location is geocoded from the ordered terms.
   - Anything else: the result is used as `geoInfo` directly.
3. **Fetch weather** for that location.
4. **Handle the outcome:**
   - Duplicate city: alert `LOC_ERROR` / `LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED`.
   - Weather failure: alert `LOC_FAIL_TO_GET_WEATHER_INFO`.
   - Places geocode failure: no alert.
   - Success: add the city, select the last index and call `goPage()`.

`goPage()` maps `startupPage` `"0"`, `"1"`, `"3"` and `"4"` to forecast, daily, air and weather. Any other value goes to the product default. It then broadcasts `reloadEvent 'search'` ([SC:67-95](../../client/www/js/controller.searchctrl.js#L67-L95)).

### TodayWeather rows

The list is shown when `isSearching===false && package === 'todayWeather'` ([S:47](../../client/www/templates/tab-search.html#L47); `$rootScope.package` is set at [app.js:64](../../client/www/js/app.js#L64)). Rows are built in `SearchCtrl.init` ([SC:97-178](../../client/www/js/controller.searchctrl.js#L97-L178)) and refreshed per city by `loadWeatherData` ([SC:828-880](../../client/www/js/controller.searchctrl.js#L828-L880)).

| Element | Template and expression | Normalized source | Visibility | Action | LOC key(s) |
| --- | --- | --- | --- | --- | --- |
| Row | [S:48](../../client/www/templates/tab-search.html#L48) | `WeatherInfo` city at the same index | `ng-hide="city.disable && !isEditing"`. The row is hidden, not removed, so `$index` stays equal to the WeatherInfo index | — | — |
| Name | [S:50-53](../../client/www/templates/tab-search.html#L50-L53) glyph `&#xE0C8;` when `currentPosition`; `address[0]`, then `address[1]` on a new line | `[city.name]`, else `getShortenAddress(address).split(",")`, else `[""]`. A current-position city with `address === null` shows `LOC_CURRENT` + `LOC_LOCATION`. The two words are joined without a space when the language contains `ko`, `ja`, `zh-CN` or `zh-TU`, and with a space otherwise ([SC:105-127](../../client/www/js/controller.searchctrl.js#L105-L127)) | always | `OnSelectCity($index)` is ignored while editing, closes the keyboard if it is visible, and otherwise selects the city and calls `goPage()` ([SC:510-524](../../client/www/js/controller.searchctrl.js#L510-L524)) | `LOC_CURRENT`, `LOC_LOCATION` |
| Weather icon | [S:54-56](../../client/www/templates/tab-search.html#L54-L56) | `currentWeather.skyIcon`; init writes `'sun'` when it is missing | `city.t1h != '-'` | `OnSelectCity` | — |
| Temperatures | [S:57-60](../../client/www/templates/tab-search.html#L57-L60) `t1h.toFixed(0)˚`, `tmn.toFixed(0)˚/tmx.toFixed(0)˚` | `currentWeather.t1h`, `currentWeather.today.tmn/tmx` | `city.t1h != '-'`; a numeric 0 is shown | `OnSelectCity` | — |
| Notification bell | [S:61-63](../../client/www/templates/tab-search.html#L61-L63) `ion-android-notifications` / `-none` on both platforms | `Push.hasPushInfo(index)` | `ng-show="!isEditing"` | `OnOpenSettingPush($index)` goes to `/setting-push?fav=<index>` ([SC:618-625](../../client/www/js/controller.searchctrl.js#L618-L625)) | — |
| Enable toggle | [S:64-71](../../client/www/templates/tab-search.html#L64-L71) checkbox `ng-model="city.disable"`, `ng-true-value="false"` (checked means enabled) | `city.disable` | `ng-show="isEditing && city.currentPosition"` | `OnDisableCity()` always acts on `cityList[0]`. It calls `WeatherInfo.disableCity`, removes the push list when disabling a row that has push, and loads weather on the first enable (`t1h === '-'`). Logs `city/disable` ([SC:584-598](../../client/www/js/controller.searchctrl.js#L584-L598)) | — |
| Delete | [S:72-74](../../client/www/templates/tab-search.html#L72-L74) | — | `ng-show="isEditing && !city.currentPosition"` | `OnDeleteCity($index)`: no confirmation. It removes the push list if `hasPush`, splices the row and calls `WeatherInfo.removeCity`. Logs `city/delete` ([SC:606-616](../../client/www/js/controller.searchctrl.js#L606-L616)) | — |

**Placeholders written into the shared model** ([SC:128-141](../../client/www/js/controller.searchctrl.js#L128-L141)). `SearchCtrl.init` writes `{}`, `skyIcon 'sun'` and `t1h '-'` into the shared WeatherInfo city object when those values are missing. The editing capture shows the icon and temperature cells hidden for a `t1h '-'` row (synthetic execution). The `today` fallback is an array, `[{tmn:'-', tmx:'-'}]`, so reading `tmn`/`tmx` from it gives `undefined`.

### TodayAir rows

The list is shown when `isSearching===false && package === 'todayAir'` ([S:78](../../client/www/templates/tab-search.html#L78)). The row's `airInfo` is `airInfoList[0].last`, else `airInfo.last`, else `currentWeather.arpltn`, else `{}` ([SC:143-152](../../client/www/js/controller.searchctrl.js#L143-L152)).

| Element | Template and expression | Normalized source | Visibility | Action | LOC key(s) |
| --- | --- | --- | --- | --- | --- |
| Name | [S:81-87](../../client/www/templates/tab-search.html#L81-L87) | Same rule as the TodayWeather rows | always | `OnSelectCity($index)` | `LOC_CURRENT`, `LOC_LOCATION` |
| Air face | [S:88-90](../../client/www/templates/tab-search.html#L88-L90) `getSentimentIcon(city.airInfo.aqiGrade)` | `airInfo.aqiGrade` | always | `OnOpenSettingPush($index)`: opens **push settings**, not the city | — |
| Air status | [S:91-94](../../client/www/templates/tab-search.html#L91-L94) `aqiStr` + `(aqiValue.toFixed(0))` | `airInfo.aqiStr`, `aqiValue` | always; no guard, so a missing value shows no number | `OnSelectCity($index)` | `LOC_AIR_STATUS` |
| Bell, toggle, delete | [S:95-108](../../client/www/templates/tab-search.html#L95-L108) | Same as the TodayWeather rows | Same as the TodayWeather rows | Same as the TodayWeather rows | — |

## Attribution summary

| Attribution | Template | Visibility | Tap |
| --- | --- | --- | --- |
| Powered by Dark Sky, S03 | [F:352-354](../../client/www/templates/tab-forecast.html#L352-L354) | `showDetailWeather && source == 'DSF'` | `openUrl` |
| Powered by Dark Sky, S04 | [D:173-175](../../client/www/templates/tab-dailyforecast.html#L173-L175) | `source == 'DSF'` | `openUrl` |
| Powered by Dark Sky, S15 | [W:207-209](../../client/www/templates/ta-tab-weather.html#L207-L209) | `showDetailWeather && source == 'DSF'` | `openUrl` |
| Powered by Google, S02 | [S:43-45](../../client/www/templates/tab-search.html#L43-L45) | `searchResults2.length > 0` | none |
| Powered by Google, S01 | [St:30-32](../../client/www/templates/start.html#L30-L32) | `searchResults2.length > 0`. The city chips and the current-location button show only while `searchResults2` is undefined or empty ([St:16](../../client/www/templates/start.html#L16), [St:35](../../client/www/templates/start.html#L35)) | none |
| Powered by TodayWeather, S02 | [S:32-34](../../client/www/templates/tab-search.html#L32-L34) | `searchResults.length > 0` | none |

S01 has no TodayWeather divider because `StartCtrl` queries only Places ([start.js:95-122](../../client/www/js/controller.start.js#L95-L122)). On S05/S16, the only attribution is the forecast-source row.

## Zero, missing and sentinel handling

| Value | Where | Rule | True 0 or sentinel result |
| --- | --- | --- | --- |
| Current-air fallback tiles `pm25Value`, `pm10Value`, `aqiValue` | [F:111](../../client/www/templates/tab-forecast.html#L111), [F:117](../../client/www/templates/tab-forecast.html#L117), [F:123](../../client/www/templates/tab-forecast.html#L123) | truthy | 0 hides the tile |
| Detail AQI rows `<code>Value` | [F:228-293](../../client/www/templates/tab-forecast.html#L228-L293) | `!= undefined` | 0 is shown |
| KHAI number | [F:301](../../client/www/templates/tab-forecast.html#L301) | truthy and `!= -1` | 0 and -1 hide the number; the row stays |
| UV grade | [F:191](../../client/www/templates/tab-forecast.html#L191), [W:173](../../client/www/templates/ta-tab-weather.html#L173) vs [D:146](../../client/www/templates/tab-dailyforecast.html#L146) | `!= undefined` vs three-day truthy | Grade 0 is shown on S03/S15 and hidden on S04 when all three days are 0 |
| Feels like, hourly precipitation, pressure | [F:165](../../client/www/templates/tab-forecast.html#L165), [F:179](../../client/www/templates/tab-forecast.html#L179), [F:185](../../client/www/templates/tab-forecast.html#L185) | truthy | 0 hides the row |
| Visibility / discomfort | [F:159](../../client/www/templates/tab-forecast.html#L159), [F:171](../../client/www/templates/tab-forecast.html#L171) | `> 0` / `> 60` | hidden |
| Humidity icon | [F:149](../../client/www/templates/tab-forecast.html#L149) | `reh` truthy, else `'00'` | The row always shows; 0 uses `humidity_00` |
| Daily humidity / wind | [D:125](../../client/www/templates/tab-dailyforecast.html#L125), [D:132](../../client/www/templates/tab-dailyforecast.html#L132) | truthy per day | 0 is hidden for that day |
| Daily precipitation value | [D:163](../../client/www/templates/tab-dailyforecast.html#L163) | first positive value | shows `"0"` |
| Hourly chart probability | [app.js:653-655](../../client/www/js/app.js#L653-L655) | none | `0%` is drawn (capture) |
| Daily chart probability | [app.js:1336-1337](../../client/www/js/app.js#L1336-L1337) | `fromToday >= 0` and truthy | 0 is not drawn |
| Hourly AQI forecast text | [F:103](../../client/www/templates/tab-forecast.html#L103) | `== undefined` → `-` | — |
| Air main value | [AC:237-242](../../client/www/js/controller.air.js#L237-L242) | `== undefined` → `-` | 0 is shown |
| Air selector value | [AC:160-167](../../client/www/js/controller.air.js#L160-L167) | own-property test | 0 is shown; `null` shows empty |
| Station list value | [AC:322](../../client/www/js/controller.air.js#L322) | falsy → `-` | 0 shows as `-` |
| S02 temperatures | [S:54-57](../../client/www/templates/tab-search.html#L54-L57) | `t1h != '-'` | a numeric 0 is shown |
| `-1` sentinels after a non-default unit | Server conversion before any template rule | The value is no longer `-1` | -1 mm → `-0` in (JSON `0`, reads as no rain); -1 m/s → -2.2 mph or Beaufort 0; -1 hPa → `-0` inHg; -1 km → -0.6 mi (synthetic execution, [unit-conversion probe](../../reports/rewrite-verification/probes/server-unit-conversion.json)). KMA `-50` temperatures are skipped. Since `bd6640f2`, on short rows recovered from ASOS history (only with `ASOS_HISTORY_READ_ENABLED=true`) the server's final projection omits `rn1`/`r06`/`s06` sentinels in mm, but in inches `rn1` and `r06` still arrive as `0` (the probe's `additional_observation`; A50) |

## Source anomalies noted here

These are candidates for characterization tests or decisions, not confirmed production defects. Unless a capture is cited, each one is source-level and was not reproduced.

1. **Location glyph does nothing on S05/S16.** `tab-air.html` binds `switchToLocationSettings()` ([A:8-9](../../client/www/templates/tab-air.html#L8-L9)), but only ForecastCtrl defines it ([FC:658](../../client/www/js/controller.forecastctrl.js#L658)).
2. **Dark Sky badge can go stale within a visit.** ForecastCtrl assigns `$scope.source` only when `cityData.source` is truthy ([FC:359-361](../../client/www/js/controller.forecastctrl.js#L359-L361)). A world city whose response lacks `pubDate.DSF` has no `source`, so swiping to it from a DSF city keeps the badge.
3. **Forecast rows can go stale on S05/S16.** AirCtrl does not clear `forecastPubdate`/`forecastSource` for a city without `airInfo`/`airInfoList` ([AC:261-263](../../client/www/js/controller.air.js#L261-L263)).
4. **Single-station air forecast never shows on weather pages.** ForecastCtrl's `airInfo` fallback repeats the `airInfoList` condition ([FC:379-384](../../client/www/js/controller.forecastctrl.js#L379-L384)), so a city with only a single `airInfo` never shows the hourly/daily AQI forecast or the forecast pubdate/source rows. See [client data contracts](client-data-contracts.md#air-contract-and-station-selection).
5. **Legacy daily dust rows use fixed positions.** They use `dayChart` indexes 7 and 8 ([D:90](../../client/www/templates/tab-dailyforecast.html#L90)), while the card gate checks the `fromToday == 0` row.
6. **Same UV data, different visibility.** UV grade 0 (low) is hidden on S04 and shown on S03/S15.
7. **Two fields share the `LOC_AQI` label.** The fallback tile reads `aqiValue`; the detail card reads `khaiValue`.
8. **Google attribution under a non-Google result.** On S02 the attribution also appears under the device-location result, because that result is pushed into `searchResults2` ([SC:249-253](../../client/www/js/controller.searchctrl.js#L249-L253)).
9. **Tapping the TodayAir row face opens push settings** ([S:88](../../client/www/templates/tab-search.html#L88)).
10. **Unused temperature placeholders.** The S02 `today` fallback is an array, so its `'-'` values are never used ([SC:138-141](../../client/www/js/controller.searchctrl.js#L138-L141)).
11. **Language typo.** The no-space language test checks `zh-TU` ([SC:120](../../client/www/js/controller.searchctrl.js#L120)).
12. **Town address overwritten.** For a `…도` + `… …구` town result, the address is assigned twice and loses the country and province ([SC:379-385](../../client/www/js/controller.searchctrl.js#L379-L385)).
13. **Out-of-order airnow SO2 bound.** The second airnow `so2` bound is `0.75`, between `0.035` and `0.185` ([service.weatherutil.js:1073](../../client/www/js/service.weatherutil.js#L1073)). The commented ppb row gives `75`. S05 prints it on the ruler band.
14. **Unreachable pollutant fallback.** The fallback's `find` callback tests `airInfo.pollutants[aqiCode]` instead of the candidate code. The outer condition already requires that entry to be missing, so only a non-null `<code>Value` can select a fallback ([AC:224-227](../../client/www/js/controller.air.js#L224-L227)).
15. **Chart-scroll shortcut never applies.** `getTodayPosition('short')` compares `timeChart[1].length`, but `timeChart[1]` is an object. The comparison is always false, so the narrow-chart shortcut never applies ([FC:518](../../client/www/js/controller.forecastctrl.js#L518)).
16. **Day titles depend on digest history.** `isNextDay` keeps `preDayInHourlyTable` across calls and digests, so day-title visibility depends on the order of evaluation ([FC:94-108](../../client/www/js/controller.forecastctrl.js#L94-L108)).
17. **Dead helpers in AirCtrl.** `_getDustForecast` and `_getHourlyForecast` are defined but never called ([AC:81-133](../../client/www/js/controller.air.js#L81-L133)).
18. **Invisible spinner in the light theme (synthetic execution, [capture](screenshots/tw-loading-header-spinner-light.png)).** The header spinner is white on white.
19. **Empty `url()` on S15.** The inline photo style concatenates `photo` into `url(...)` ([W:38](../../client/www/templates/ta-tab-weather.html#L38)). AngularJS expression `+` drops an `undefined` operand (`plusFn` in AngularJS 1.5.3, bundled with the pinned Ionic 1.3.5, [bower.json](../../client/bower.json); checked-in copy [ionic.bundle.js](../../ta.ios/www/lib/ionic/js/ionic.bundle.js#L27440-L27444)), so with `photo` unset the style ends in an empty `url()` layer rather than `url(undefined)`.
