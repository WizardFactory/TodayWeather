# Chart references (AN-05, #2884)

The native hourly and daily charts are compared with the Cordova charts drawn by the Cordova debug build itself. The references live in [`core-domain/src/test/resources/chart-reference/`](../../core-domain/src/test/resources/chart-reference):

| File | Contents |
| --- | --- |
| `<WxH>/<fixture>.json` | For the hourly and the daily tab: the SVG of each chart directive (every element with its class, attributes, text and `tspan`), the rects and texts of the header labels, legend, separators and expander, computed styles, and the scroll offsets |
| `<WxH>/kma-seoul/<chart>-<position>.png` | Captures of the chart wrapper at density 2 at the opening position (`opening`) and both scroll ends (`start`, `end`), with the wrapper's offset and size in device pixels in the JSON |
| `<WxH>/capture.json` | Display, WebView, locale and theme of the capture |
| `provenance.json` | Cordova APK (hash, version, the chart sources inside it with the matching `client/` files and their last commits), emulator build, fixtures and the SHA-256 of every reference file |
| `tolerances.json` | Screenshot tolerance of each comparison, the metric and the reasons (maintained with the tests; a capture keeps it) |

Sizes: 384×832, 360×780 and 412×892 dp. Fixtures come from the AN-02 corpus: `kma-seoul` (all sizes, captures), `vc-london` (all sizes), and at 384×832 `kma-jeju`, `vc-newyork`, `vc-sydney`, `vc-tokyo`, `kma-seoul-fahrenheit`, `kma-rain-everywhere`, `kma-current-index-first`, `kma-midnight-today-first-day` and `kma-seoul-sharp` (kma-seoul with `current.liveTime` `"2400"`, the "on the hour" drawing). The emulator ran in ko-KR with the light theme.

## Tests

- `ChartSceneTest` (core-domain, JVM): the Kotlin scenes (`HourlyChart`, `DailyChart`) against every captured SVG element, label, legend text and opening offset, within 0.02 dp.
- `ChartScreenshotTest` (app, Robolectric native graphics, SDK 34): the Compose charts at each size and position against the PNGs; passes within the tolerance recorded for that comparison (`ImageDiff`: the share of pixels that differ by more than 64 after a 3×3 blur, the mean difference and the height). Renders and difference overlays go to `app/build/chart-compare/`.
- `ChartBehaviorTest` (app): opening offsets equal the WebView's, and the expander shows and hides the detail rows.
- `ChartDeviceTest` (app, device): the same comparison on the emulator with its own fonts; run by `device-smoke.sh`.
- CI runs the JVM tests in both Android jobs; the job with `client/` also runs [`tools/emulator/check-sources.mjs`](../emulator/check-sources.mjs), which fails when a chart source in `client/www` no longer matches the one in `provenance.json`.

## Recapturing

After a change to the Cordova charts (`check-sources.mjs` fails for the chart references), build the Cordova debug APK from the same revision (`client/`: `npx cordova prepare android && npx cordova compile android --debug`, with the private inputs) and run:

```sh
cd android
ANDROID_SERIAL=emulator-5554 tools/chart-reference/capture.sh <cordova-debug.apk>
./gradlew assembleDebug assembleDebugAndroidTest
ANDROID_SERIAL=emulator-5554 tools/chart-reference/device-smoke.sh
./gradlew test
```

`capture.sh` uses an API 29+ emulator. It takes the emulator offline (`tools/emulator/offline.sh`, shared with the upgrade test), installs the Cordova build for each size at density 2, and draws the fixtures through the app's own services over WebView DevTools (`capture.mjs`). It closes the popup from the offline location load and checks that no bar covers a chart. At the end it uninstalls the build and restores the display and the network. `provenance.mjs` writes `provenance.json`. Review the new captures and update `tolerances.json` with the measured values (the test prints them) only for an explained change.
