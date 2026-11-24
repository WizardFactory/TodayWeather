# TodayWeather iOS native user manual

[Read the PDF](manual.pdf) · [Editable source](manual.json) · [Capture provenance](provenance.json)

This is the **native Swift / SwiftUI app** for iPhone and iPad, version 2.0 (#2948). Its 42 illustrated
steps follow the sections of the [Cordova app manual](../cordova-app/README.md): first launch and the current
location, hourly and daily charts, air quality and stations, saved places, alarms, units, startup and refresh
settings, themes, nationwide information, about, privacy and sharing. The app screens are Korean; the instructions
are English with the Korean control labels. The [Android native manual](../android-app/README.md) describes the
Android app.

A UI test captured the 41 screenshots on 22 November 2026 (Korea time) **without ads** (#3122): the capture build
has no ad units, so the app requests no consent and no ads, and the test fails any screenshot that shows a native ad
(except over the system share sheet, where querying the app stalls the run).
The released app shows ads (see [Ads in weather and saved places](#ads-in-weather-and-saved-places)). The test used an
iPhone 17 Pro Max simulator (iOS 26.5, 440×956 pt at scale 3), Korean app language, default text size, a simulated
position at Seoul City Hall and the status bar fixed at 9:41. Weather, geocoding, nationwide data and warnings are
read-only requests to the legacy weather server; place search uses Google Places. Values and warnings are those of
the capture time. Images are reduced to 720 pixels wide and a 256-color palette without replacing screen content.

The [iPad supplement](ipad/manual.pdf) shows the main screens on an iPad Pro 13-inch simulator from the same
ad-free capture; its [editable source](ipad/manual.json) lists the steps.

The [usage analytics guide](usage-analytics/manual.pdf) shows the 이용 통계 row and its popup with the Region set to Korea (on by default) and to Germany (off until you agree). Its [editable source](usage-analytics/manual.json) lists the steps.

The [tracking settings guide](tracking-settings/manual.pdf) shows where to read the tracking choice and open iOS Settings from the menu or the weather pages. Its [editable source](tracking-settings/manual.json) uses Korean controls on an iPhone 12 Pro Max.

The [four main tabs](main-tabs/manual.pdf) supplement shows each tab with Seoul saved. Look for the short line above the selected tab. The line, outline icon and label share the theme’s accent color. The [editable source](main-tabs/manual.json) includes full-screen captures from an iPhone 16 simulator.

The pull-to-refresh page uses a Korean hourly forecast from an offline test fixture (18 November 2026). Its screenshot predates the tab accent line.

## Ads in weather and saved places

Each weather tab shows its forecast or air information first. An available native ad appears in the scrolling content. Saved Places shows a larger card after the list and hides it during search and editing. The main manual's screenshots are taken without ads; the [four placement examples](forecast-ads/manual.pdf) · [Editable guide](forecast-ads/manual.json) · [Capture details](forecast-ads/provenance.json)

The first Hourly and first Daily visit each day open immediately. After reading beyond a chart, tapping the other forecast tab on a repeat visit has a 10% chance of showing a ready full-screen ad. The two tabs share a limit of one display per local day across saved places. Dismissing the ad opens the tab you selected.

## Search from the header and unsaved places

A magnifier after the place name on 시간별날씨, 일별날씨 and 대기정보 opens the 즐겨찾기 search. A result, or a shared `link.todayweather.ai` link, opens the place without saving it: an outline star stands in the bell's position, and tapping it saves the place with the short message 즐겨찾기에 추가했습니다. One unsaved place is kept while you move between places, until the app starts again. For the current position, the location icon now stands before the name. The main manual's screenshots predate this header. [Read the guide](header-search/manual.pdf) · [Editable source](header-search/manual.json)

## Read the current temperature

On the Hourly and Daily tabs, the decimal point and the digits after it appear at 70% of the whole-number size.
The illustrated example shows −0.1° in the Hourly header. [Read the guide](current-temperature/manual.pdf) · [Editable source](current-temperature/manual.json)

## Refresh the selected place

Open 시간별날씨 (Hourly), 일별날씨 (Daily) or 대기정보 (Air). Scroll to the top, pull the page down and lift
your finger. The app requests the latest data for the selected place and keeps the current tab open. If the request fails, the retry dialog lets you try again or close it. The bottom tabs
switch between pages. To set an automatic refresh interval, open 업데이트 주기 in the menu.

## Home Screen widgets

The [Home Screen widget guide](widgets/manual.pdf) covers small and medium widgets, place and forecast settings, and reopening the app after five days. Its [editable source](widgets/manual.json) includes the Korean instructions.

## Reader notes

- Location is optional if you search for a place. iOS asks once for location while using the app; this capture
  granted it beforehand, so the system dialog is not shown.
- The alarm example opens the settings and leaves without saving, and the build has no Firebase configuration, so
  **no alarm was registered and no notification was delivered**. The 12:00 AM picker behaviour inherited from the
  Cordova app is called out on its page.
- iOS has no back button: there is no exit confirmation (the Cordova manual's last page is Android-only).
- Optional usage statistics stays off throughout. Advertising privacy choices depend on your region and Google's
  consent service; they are separate from usage statistics. Since 24 November 2026 the row is named 이용 통계 (Usage
  analytics) and shows 켜짐 or 꺼짐; outside the EEA, the United Kingdom and Switzerland analytics is on until you turn it
  off. The analytics page of this manual (39) predates that change; see the [usage analytics guide](usage-analytics/manual.pdf).
- The photo theme shows weather photos from a feed that this capture build did not have, so its page shows no photo.
- Sharing opens iOS's share sheet with the weather text and the app link. No message was sent. In the
  22 November capture the share sheet did not appear on the iPhone 17 Pro Max and iPad simulators within two minutes
  of the tap (the 17 November capture on an iPhone 16 simulator showed it), so the last page shows the share button.
  This is reported for a device check (#3122).
- The warning page shows the bulletins of the capture time. Read each announcement time; an older or empty answer
  is not a guarantee of current safety.
- This is not a release certification. Larger text sizes and the comparison with the Cordova app are checked
  separately ([parity checklist](../../../ios/parity.md)).

## Rebuild and verify

The installed `screenshot-manual` skill supplies the builder and renderer. Use its isolated Python dependencies
(ReportLab 5.0.1, pypdf 6.21.0, PDFium 5.14.0, Pillow 11.3.0) and a font covering Korean; this edition used the
locally installed Arial Unicode TTF, which is not distributed here. From the repository root, with `MANUAL_PYTHON`,
`MANUAL_SKILL` and `MANUAL_FONT` pointing to those local prerequisites:

```sh
RL_useA85=0 "$MANUAL_PYTHON" "$MANUAL_SKILL/scripts/build_manual.py" docs/user/ios-app/manual.json /tmp/tw-ios-manual.pdf \
  --font "$MANUAL_FONT"
"$MANUAL_PYTHON" "$MANUAL_SKILL/scripts/render_pages.py" /tmp/tw-ios-manual.pdf /tmp/tw-ios-manual-pages
"$MANUAL_PYTHON" ios/tools/manual/verify.py docs/user/ios-app
"$MANUAL_PYTHON" ios/tools/manual/verify.py docs/user/ios-app/ipad
"$MANUAL_PYTHON" ios/tools/manual/test_verify.py
```

`verify.py` checks the source, image and PDF hashes, the page count, each page's title, instruction, caption and
expected result, the decoded embedded screenshot pixels, the image sizes and the capture sources; its checks stay on
under Python's `-O`. Rendering and a visual review of every page are additional requirements. A fresh PDF may have
different metadata bytes; compare its text and rendered pages before replacing the published edition and renewing
`provenance.json`.

For new captures run `ios/tools/manual/run-manual-capture.sh --no-ads <out-dir> <tw* iPhone or iPad simulator udid>`
(this edition; without `--no-ads` the build keeps Google's test ad units; `--no-ads --store` takes the five App Store
images instead, the last one after adding two widgets on the Home Screen; see
[`ios/README.md`](../../../ios/README.md#user-manual-in-18)). It needs the private `ios/Private.xcconfig` (server URL
and Places key), which stays outside Git; it removes the private values from every saved log and fails if one remains.
Keep raw captures, logs and rendered pages in the ignored `reports/`; publish only inspected screenshots. A change of
the app or the capture harness requires assessing whether the screenshots and instructions must be renewed; never
update the provenance hashes without a new capture.
