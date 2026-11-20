# Home-screen widgets

[Illustrated guide (PDF)](manual.pdf) · [Editable guide](manual.json)

Add TodayWeather to the home screen from your launcher's Widgets menu. You can add
several copies for different places. Each copy can follow the app's selected place
or stay on one saved place. In widget settings, choose Classic Black, Morning
Paper or Blue Hour independently for each copy. Existing widgets use Classic
Black until you choose a different style.

[Compare automatic and manual clock widgets in three styles on a Galaxy S21+](screenshots/galaxy-comparison.png).

| Widget | Display and settings |
| --- | --- |
| Current weather | Current temperature and sky. Enlarge it for the daily range. Choose yesterday's comparison in settings. |
| Forecast | Choose hourly or daily. The daily view can include yesterday. A wider widget fits more forecast periods. |
| Clock and weather | Time and current conditions. A larger widget adds the chosen forecast. The tallest supported layout displays both forecast types. |
| Air quality | Air-quality grade and available particulate readings. More space allows ozone and the air summary. |

In widget settings, choose automatic or manual weather updates separately for each
widget. Automatic is the default and checks hourly, subject to Android scheduling.
Manual widgets show a refresh control beside the update time. Tap it to request a
reading for that place. Widgets for the same place share cached weather and allow
one widget request per hour, including failed attempts. A recent reading from the
main app also satisfies the widget. A manual widget can therefore show newer
weather after you use the app or another widget updates that place.

Tap the body of the widget to open TodayWeather. After 120 hours since a main-app visit,
the widget asks you to check the weather in the app and pauses its weather
requests. Widget setup and background refresh do not extend this interval. On
first use, open TodayWeather to activate the widget. While Android defers work
during device sleep, the launcher can continue showing its last frame until
Android runs the update. Return to the app to resume all your widgets. A saved
reading remains available offline while the visit is current; check the update
time before using it.

Long-press an installed widget to resize it. Launchers that offer reconfiguration
also show a settings control. If you remove a pinned place, select a new one in
widget settings. When upgrading from a version with legacy Cordova widgets,
add the new widget from your launcher's picker if the old widget is unavailable.

The clock and date follow each widget’s selected city, including daylight-saving
changes. Your phone controls the 12/24-hour format. If a cached overseas reading
lacks a time zone, the clock shows a dash until a weather update provides it.
The update stamp uses the phone’s time zone.

[Seoul and New York at the same instant, rendered in an Android widget host](screenshots/place-clocks.png).

## Capture and verification

Issue [#3048](https://github.com/WizardFactory/TodayWeather/issues/3048), 19 November
2026. The current guide shows a physical Galaxy S21+ running Android 15
(API 35), using a separate comparison install and a Seoul weather fixture. The three-style comparison and guide show bound AppWidgetHostViews on the phone.
The widget picker was captured in Samsung One UI. The manual tap was
exercised against a local Seoul weather fixture. Repeated taps and a process
restart reused the reading. No live weather provider was involved.

Earlier verification used an isolated Android 16 (API 36) emulator at
1080×2400 and 420 dpi with Korean labels. Cached readings for Seoul and Jeju
came from the native conversion corpus. Network access was disabled.

- The picker, configuration, wide daily forecast, compact forecast, expired prompt
  and return to weather show actual Pixel Launcher and app screens. The same
  Jeju widget was resized from five columns at 4×2 (946×588 px) to two columns
  at 2×2 (452×588 px). Weather disappeared after the visit timestamp was moved
  past 120 hours; tapping the centered prompt then reopened the app and the same
  installed widget displayed its forecast again.
- For the standalone current, clock and air-quality frames, a verification host
  bound each installed provider using Android's AppWidgetManager. It captured
  the attached and measured AppWidgetHostView at 172×224, 360×224 and 266×224 dp
  respectively. The 360×320 dp clock was also checked with both forecast rows.
  No user interface was reconstructed for these captures.
- Gallery, configuration, current and air-quality captures used debug APK
  `94409be8e76667abe15695e6601fe3d7bcd29b2d7f948623c264cd702cc64869`.
  The clock, expired prompt and recovered forecast were captured after an
  in-place update to `904cd09e157d54c7fdb1dd80230af000adca075d290a31ac246cf3aad735a2ad`.
  The earlier five-day check on API 36 observed the change on a scheduled
  update while the device remained awake. These tests did not measure a
  sleeping device's delivery delay or exercise an upgrade from a published
  Cordova binary. Images are cropped or resized to keep labels readable.

An earlier Android 7.0 (API 24) Launcher3 check exercised the five-day policy, independent widget settings and navigation before the visual layout update. That check used the debug APK
(SHA-256 `3c5a544ca570c5555199fd790d1241ca152fb261b81b99d432fbeb5469271c9d`).
The OS registered all four providers. On a fresh install, a Jeju air widget showed
the app-open prompt until its first tap opened Jeju in the app. On returning home
the widget displayed cached AQI and particulate readings. The same home screen
also held a Seoul current-weather widget. After restarting the process with the
saved-place fixture reordered, both widgets retained their places. Tapping the
air widget selected Jeju at its new index 1; tapping the weather widget then
selected Seoul at its new index 2. [Two installed widgets in the earlier layout](screenshots/android7-two-locations.png).

Use the [native manual build instructions](../README.md#rebuild-and-verify) with
this directory's JSON and PDF paths to rebuild and render the nine pages.
