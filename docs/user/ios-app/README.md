# TodayWeather iOS native user manual

[Read the PDF](manual.pdf) · [Editable source](manual.json) · [Capture provenance](provenance.json)

This is the **native Swift / SwiftUI app** for iPhone and iPad, version 2.0.0 preview (#2948). Its 42 illustrated
steps follow the sections of the [Cordova app manual](../cordova-app/README.md): first launch and the current
location, hourly and daily charts, air quality and stations, saved places, alarms, units, startup and refresh
settings, themes, nationwide information, about, privacy and sharing. The app screens are Korean; the instructions
are English with the Korean control labels. The [Android native manual](../android-app/README.md) describes the
Android app.

A UI test captured the original 41 screenshots on 17 November 2026 (Korea time). It captured four menu screens
again that evening after the privacy rows moved below About. The test used an iPhone 16 simulator (iOS 26.5,
393×852 pt at scale 3), Korean app language, default text size, a simulated position at Seoul City Hall and
the status bar fixed at 9:41. Weather, geocoding, nationwide data and warnings are
read-only requests to the legacy weather server; place search uses Google Places. Values and warnings are those of
the capture time. Images are reduced to 720 pixels wide and a 256-color palette without replacing screen content. The
banners are Google's test ads of a Debug build; whether one loaded varies between pages.

The pull-to-refresh page uses a Korean hourly forecast from an offline test fixture. Its screenshot shows the
updated tab bar. Earlier weather screenshots retain the reload icon used by the November 17 build.

## Read the current temperature

On the Hourly and Daily tabs, the decimal point and the digits after it appear at 70% of the whole-number size.
The illustrated example shows −0.1° in the Hourly header. [Read the guide](current-temperature/manual.pdf) · [Editable source](current-temperature/manual.json)

## Refresh the selected place

Open 시간별날씨 (Hourly), 일별날씨 (Daily) or 대기정보 (Air). Scroll to the top, pull the page down and lift
your finger. The app requests the latest data for the selected place and keeps the current tab open. If the request fails, the retry dialog lets you try again or close it. The bottom tabs
switch between pages. To set an automatic refresh interval, open 업데이트 주기 in the menu.

## Reader notes

- Location is optional if you search for a place. iOS asks once for location while using the app; this capture
  granted it beforehand, so the system dialog is not shown.
- The alarm example opens the settings and leaves without saving, and the build has no Firebase configuration, so
  **no alarm was registered and no notification was delivered**. The 12:00 AM picker behaviour inherited from the
  Cordova app is called out on its page.
- iOS has no back button: there is no exit confirmation (the Cordova manual's last page is Android-only).
- Optional usage statistics stays off throughout. Advertising privacy choices depend on your region and Google's
  consent service; they are separate from usage statistics.
- The photo theme shows weather photos from a feed that this capture build did not have, so its page shows no photo.
- Sharing opens iOS's share sheet with the weather text and the app link. No message was sent.
- The warning page shows the bulletins of the capture time. Read each announcement time; an older or empty answer
  is not a guarantee of current safety.
- This is not a release certification. iPad layouts, larger text sizes and the comparison with the Cordova app are
  checked separately ([parity checklist](../../../ios/parity.md)).

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
"$MANUAL_PYTHON" ios/tools/manual/test_verify.py
```

`verify.py` checks the source, image and PDF hashes, the page count, each page's title, instruction, caption and
expected result, the decoded embedded screenshot pixels, the image sizes and the capture sources; its checks stay on
under Python's `-O`. Rendering and a visual review of every page are additional requirements. A fresh PDF may have
different metadata bytes; compare its text and rendered pages before replacing the published edition and renewing
`provenance.json`.

For new captures run `ios/tools/manual/run-manual-capture.sh <out-dir> <tw* iPhone simulator udid>` (see
[`ios/README.md`](../../../ios/README.md#user-manual-in-18)). It needs the private `ios/Private.xcconfig` (server URL
and Places key), which stays outside Git; it removes the private values from every saved log and fails if one remains.
Keep raw captures, logs and rendered pages in the ignored `reports/`; publish only inspected screenshots. A change of
the app or the capture harness requires assessing whether the screenshots and instructions must be renewed; never
update the provenance hashes without a new capture.
