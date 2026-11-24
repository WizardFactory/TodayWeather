# TodayWeather Android native user manual

[Read the PDF](manual.pdf) · [Editable source](manual.json) · [Capture provenance](provenance.json)

The released app shows ads; this manual's screens are captured without them (#3122).
The [forecast advertising supplement](forecast-ads/manual.pdf) shows the Android
native ad cards on Hourly, Daily, Locations and AQI in four device captures from
18 November.
The [editable supplement](forecast-ads/manual.json) and [capture record](forecast-ads/provenance.json)
identify the Android 14 Google Play emulator, sample ads and saved Seoul fixture.

This is the **native Kotlin / Jetpack Compose app**, version 2.0. Its
46 illustrated steps cover first launch and permissions, current location,
hourly/daily charts, air quality and stations, saved places, alarms, units,
startup/refresh settings, themes, nationwide information, privacy, sharing and exit.
The app screens are Korean; the instructions are English with Korean control labels.
The [home-screen widget guide](widgets/README.md) covers configuration, resizing, the five-day visit interval and recovery.
The [older Cordova app manual](../cordova-app/README.md) describes version 1.1.1.

All 45 journey screenshots were captured from the running native app **without ads**: 40 on
23 November 2026 and, after usage analytics became on by default outside the EEA, the United Kingdom and Switzerland
(#3178), the menu, About, ad-privacy and both usage analytics screens on 24 November 2026 (`capture.sh --no-ads`: the test application replaces the consent and
Ads SDK platform; every capture asserts that the Ads SDK did not start, and every
capture of an app screen also asserts that no native ad card is in it — the three
system screens, the location and notification permission dialogs and the share
chooser, are outside the app's view tree), using an owned API36 emulator at 1080×2400 pixels, 420dpi,
font scale 1.0, Korean app/system language and Asia/Seoul time. Saved places are seeded
for later sections. Weather, geocoding, nationwide data and Google Places search use the
configured live services; weather values and warnings are dated examples. Images
are reduced to 720×1600 and a 256-color palette without replacing screen content.
The pull-to-refresh page keeps its 19 November capture with sample Seoul weather.

[Read the header-search supplement](header-search/README.md) for the search button beside the place name and places shown without being saved (#3180): a search result or a shared `link.todayweather.ai` link opens a place with a star in the bell's position, and the star saves it. The screenshots of this main manual were taken before that change and show the earlier header.

[Read the current-temperature supplement](current-temperature/manual.pdf) for the updated fractional reading in the forecast header. Its [editable source](current-temperature/manual.json) uses a Korean Seoul fixture rendered with the native Android Compose screen under Robolectric SDK 34.

## Refresh the selected place

On 시간별날씨 (Hourly), 일별날씨 (Daily) or 대기정보 (Air), scroll to the top.
Pull the page down and release. A circular indicator appears below the header
while the selected place refreshes. If the request fails, use the retry option.
The bottom tabs switch between pages. You can set the automatic refresh interval
under 업데이트 주기 in the menu.

All four tabs use outline icons. On the selected tab, the icon and its label
use the theme’s accent color, with a short line above the icon, on the pages
that show the tab bar (the start, alarm, settings and nationwide pages have none).
The 45 journey screenshots of this edition are full device frames; the
pull-to-refresh example is a capture of the app's own view from a device test,
without the system bars. The earlier cropped captures are in the previous edition
named in the capture record.

## Reader notes

- Location permission is optional if you search for a place. Android 13+ asks
  separately for notification permission. Android versions and device vendors may
  present different system dialogs.
- Usage analytics (이용 통계) is on by default in Korea and other regions outside the EEA,
  the United Kingdom and Switzerland, and can be turned off in the menu; in the EEA, the United Kingdom and Switzerland,
  and when the device region is unknown, it stays off until you allow it. The menu screens show the Korean default (켜짐); the
  opt-in page sets the app's region to Germany (`analyticsOptIn` capture section). The
  capture's test application sends no analytics. Advertising privacy choices depend on
  region and the consent service; they are separate from analytics.
  In Korea no consent form is required, so the 광고 개인정보 선택 page shows the same
  message with or without ads.
- The alarm example edits settings and discards them. Product push requests were
  intercepted by the test application; **real notification delivery was not tested**.
  The inherited noon-picker behavior is called out on its page. Android Back does
  not offer the edited-alarm save question; the page arrow and Cancel do.
- Sharing opens Android's chooser for **plain-text weather and an app link**. No
  recipient was selected or message sent.
- The warning page shows the bulletins returned at capture time. Read each
  announcement time; older or empty responses are not a guarantee of current safety.
- This is not a release certification. Physical-device/API24 checks and actual
  provider availability are separate from the captured API36 journeys. Photos and
  SDK artwork retain their original third-party rights.

## Rebuild and verify

The installed `screenshot-manual` skill supplies the builder and renderer. Use its
isolated Python dependencies (ReportLab 5.0.1, pypdf 6.21.0, PDFium 5.14.0,
Pillow 11.3.0 for this edition) and a font covering Korean. This edition used the
locally installed Arial Unicode TTF; the font file is not distributed here.

From the repository root, with `MANUAL_PYTHON`, `MANUAL_SKILL` and `MANUAL_FONT`
pointing to those local prerequisites:

```sh
"$MANUAL_PYTHON" "$MANUAL_SKILL/scripts/build_manual.py" \
  docs/user/android-app/manual.json /tmp/tw-native-manual-rebuild.pdf \
  --font "$MANUAL_FONT"
"$MANUAL_PYTHON" "$MANUAL_SKILL/scripts/render_pages.py" \
  /tmp/tw-native-manual-rebuild.pdf /tmp/tw-native-manual-pages
"$MANUAL_PYTHON" android/tools/manual/verify.py docs/user/android-app
```

`verify.py` keeps its checks active under Python optimization (`-O`) and checks the retained source/image/PDF hashes, exact page count, each
page's complete instructions/caption/expected result, decoded embedded screenshot pixels,
image dimensions and the
source files used during capture. Rendering and visual review are additional
requirements. A fresh PDF may have different metadata bytes; compare its extracted
page text and rendered pages before intentionally replacing the published edition
and renewing `provenance.json`.

For new live captures use the [native capture runner](../../../android/tools/manual/README.md).
Private build inputs stay outside Git. Keep raw captures, logs and rendered QA
pages in ignored `reports/`; publish only selected, inspected screenshots. The
provenance records all maintained runtime source/assets and the capture harness
with SHA-256 hashes. A source change requires assessing whether the screenshots
and instructions must be renewed; never silently update their hashes to claim a
new capture.

The [parity checklist](../../../android/parity.md) and
[implementation plan](../../../plans/android-native.md#an-18--parity-verification-large-screens-and-the-user-manual-2897)
retain the broader AN-18 verification scope. This manual does not replace the
four-size pixel comparisons or large-screen/font tests.
