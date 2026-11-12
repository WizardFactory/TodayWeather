# Four-size reference comparisons

AN-18c compares the Kotlin/Jetpack Compose app with captures of the existing
Cordova app at **384×832, 360×780, 412×892 and 320×694 dp**, density 2, in Korean
and English. The native app does not load Ionic, Cordova or these capture scripts.
The older reference directories and all their existing tests remain in place.

`coverage.json` declares the representative comparisons at each size and language:

| Set | Screens / states | Native test |
| --- | --- | --- |
| start | S01 and O01 access notice | `StartScreenshotTest` |
| places | S02 saved places, search, editing, location and dark theme | `PlacesScreenshotTest` |
| forecast | S03/S04, Seoul and London blocks | `ForecastScreenshotTest` |
| air | S05, domestic/world/no-data and light/dark/old/photo | `AirScreenshotTest` |
| settings | S07/S08, O10 and S03/S04 dark/old/photo blocks | `SettingsScreenshotTest` |
| nation | S10/S11/S12, including S11 dark/old | `NationScreenshotTest` |
| privacy | S06 analytics states and X3 choice | `PrivacyScreenshotTest` |
| push | S09, dark theme and picker/confirmation/permission/notification popups | `AlarmsScreenshotTest` |
| shell | Header, tabs and menu in all four themes; partial/full photo scroll gradient | `ShellScreenshotKoTest`, `ShellScreenshotEnTest` |
| dialog | Weather retry, both air sources, pollen and exit confirmation | `DialogScreenshotTest` |
| chart | Hourly/daily chart opening position and both scroll ends | `ChartScreenshotTest` |

The ten existing fit suites additionally traverse their states at all four display
sizes and both languages, including states omitted from representative pixel
comparisons. Their previous tablet, foldable, narrow-window and large-font cases
remain. Scroll-axis, enabled-scroll and permanent-parent-clipping qualification
from AN-18b is retained.

## Capture

Build the existing rollback Cordova APK from matching `client/` sources first.
Use only a task-owned `tw_*` emulator, with no other process using its DevTools
forward. The runner takes the device offline before installing the old app,
uninstalls it before restoring connectivity, and restores its previous display,
font scale, rotation and location setting on exit.

```sh
ANDROID_SERIAL=emulator-5574 sh android/tools/parity-reference/capture.sh /path/to/cordova-debug.apk start
```

Replace `start` with a set in the table. Each set installs a fresh app for each
size and language. `TW_PARITY_SIZES` and `TW_PARITY_LANGS` can restrict a diagnostic
run; the coverage checker still requires the complete matrix for delivery.
Do not edit a runner or driver while it is executing.

The physical display stays at the nominal size. `viewport.json` records the actual
WebView extent and origin; the runner does not distort the display to force the
historical 762 dp WebView height. It rejects an incorrect size, density or viewport
outside the display. New captures go to
`app/src/test/resources/parity-reference/<size>/<set>/<language>/`.

English forecast, air, chart, settings and nationwide captures use **en-KR** while
being stored under the English label `en-US`. This changes UI text while retaining
KR units, air standard and Korea-only menu entries. Fixture-supplied place names,
weather descriptions and air-grade labels retain the server fixture's language.
Other sets use en-US. The measured viewport records the actual locale.

Each set's provenance identifies the APK and tracked Cordova sources and hashes
its captured files. Source verification requires `client/`; matrix integrity and
native builds/tests do not. Images are actual emulator captures (chart clips use
the WebView's screenshot API). The synthetic weather-photo fixture already used
by the settings reference remains explicitly synthetic.

## Comparison and qualification

Native tests render real Compose screens/components with the same fixtures.
Each case checks image width and absolute height difference as well as the
existing `ImageDiff` blurred strong-difference fraction and unblurred mean.
Per-case tolerances explain measured renderer differences and retain small margins;
new tolerances do not replace the independent geometry, text and fit checks.
Generated native images and overlays stay in ignored `app/build/*-compare/`.

The dialog component comparison places the captured weather background behind the
native popup to isolate its translucent surface. That background is test input,
not a native weather-screen result; weather screens are compared independently.
The photo header comparison similarly isolates the header over its captured
underlying pixels at scroll offsets 88 and 176 dp. Capture drives the real scroll
event/gradient handler after opening the photo page; it does not claim a physical
swipe. The native header uses those same measured offsets and composites the gradient twice,
matching the Android active/cached bar surfaces. Edge-color assertions independently
check the gradient opacity, so aggregate image tolerance cannot hide its absence.
The dialog test also checks popup bounds, the whole semantic body and scrolling
to the pollen source. Exit/cancel/retry callbacks remain covered by behavior tests. Integrated source/pollen
tests require the modal layer to cover the whole window, including header and tabs.
Notification popups render over the native Hourly screen after loading the same offline
fixture (including the English capture's US unit defaults). Alarm descriptions are also
checked against captured lines at all four widths; Latin slash words stay together.
Pollen uses fractional glyph advances like the existing popup body, preserving
Chrome's line breaks without embedding a web runtime.

```sh
node --test android/tools/emulator/reference-view.test.mjs android/tools/parity-reference/check.test.mjs
node android/tools/parity-reference/check.mjs
python3 android/tools/parity-reference/test_check_results.py
node android/tools/emulator/check-sources.mjs
cd android
./gradlew :app:testDebugUnitTest --tests '*Screenshot*Test' --tests '*Fit*Test.parity*'
python3 tools/parity-reference/check-results.py
```

`check.mjs` verifies every declared image and tolerance, captured-file hashes,
viewport/locale records and one common APK digest. Negative fixtures check missing
images, modified captures, absent tolerances, wrong nominal metadata and escaping
paths. CI runs these before the native build and tests. After the tests,
`check-results.py` requires every declared comparison in successful JUnit reports
from its named comparator class; a missing execution, failed/skipped test or
undeclared comparison fails the gate. Its negative fixtures include a passing
class that omitted its comparison. Pixel comparisons do not
establish production-server behavior, API24 device coverage or a release.

## Native functional smoke

After `./gradlew assembleDebug assembleDebugAndroidTest`, run:

```sh
ANDROID_SERIAL=emulator-5574 sh android/tools/parity-reference/run-native-smoke.sh /tmp/tw-parity-smoke
```

The runner uses a task-owned emulator offline, restores display/font/rotation and
connectivity, and uninstalls the app before restoring the network. The real
`MainActivity` reads an offline weather-cache fixture with pollen, opens/closes
source and pollen popups, saves dark/old/photo/light through settings, scrolls
hourly/daily charts, handles a failed refresh and cancels exit. It records actual
display screenshots in Korean at 320×694 and English at 412×892. The fixture adds
pollen fields in test code; it does not call a live provider. This supplements
pixel/fit checks, not a release or physical-device test.

Dialog captures close initial popups through their buttons and keep Ionic's reusable backdrop attached. Each captured popup records and requires an active, visible, full-viewport backdrop at 40% black. Independent corner-surface samples check the expected compositing in both reference and native images, separately from average image tolerance. Exit and retry share the shell's WebView-area modal layer; banner-present tests verify centering, unchanged banner pixels and touch delivery.
