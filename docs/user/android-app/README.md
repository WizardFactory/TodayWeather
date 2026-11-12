# TodayWeather Android native user manual

[Read the PDF](manual.pdf) · [Editable source](manual.json) · [Capture provenance](provenance.json)

This is the **native Kotlin / Jetpack Compose app**, version 2.0.0 preview. Its
44 illustrated steps cover first launch and permissions, current location,
hourly/daily charts, air quality and stations, saved places, alarms, units,
startup/refresh settings, themes, nationwide information, privacy, sharing and exit.
The app screens are Korean; the instructions are English with Korean control labels.
The [older Cordova app manual](../cordova-app/README.md) describes version 1.1.1.

The screenshots were captured from the running native app on 13 November 2026,
using an owned API36 emulator at 1080×2400 pixels, 420dpi, font scale 1.0,
Korean app/system language and Asia/Seoul time. Saved places are seeded for later
sections. Weather, geocoding, nationwide data and Google Places search use the
configured live services; weather values and warnings are dated examples. Images
are reduced to 720×1600 and a 256-color palette without replacing screen content.
Debug banners are Google's test ads; their availability and contents vary.

## Reader notes

- Location permission is optional if you search for a place. Android 13+ asks
  separately for notification permission. Android versions and device vendors may
  present different system dialogs.
- Optional usage analytics stays off throughout this manual. Advertising privacy
  choices depend on region and the consent service; they are separate from analytics.
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

`verify.py` checks the retained source/image/PDF hashes, exact page count, each
page's complete instructions/caption/expected result, image dimensions and the
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
