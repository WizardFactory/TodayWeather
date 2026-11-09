# Air quality references (AN-09, #2888)

The native air quality screen S05 is compared with the screen drawn by the Cordova debug build itself. The references live in [`app/src/test/resources/air-reference/`](../../app/src/test/resources/air-reference):

| File | Contents |
| --- | --- |
| `<state>/air-<n>.png` | Block `n` of S05 at density 2: 0 the header block with the header bar over it, 1 the gauge, then each card (hourly chart, daily forecast, detail, info, stations) |
| `<state>/air.json` | The places and URL of the state, the scope values the template read, the gauge's widths and the label's `left`, the chart's SVG element by element, and for each block its rect, background, whether it ended under the tab bar (`hidden`), and the rect, text, image, font and color of every element in it |
| `navigation.json` | A pollutant chosen on S03 (`goAirInfoPage('pm25')`) followed through the tab bar: Hourly, Air, Daily, Air, Locations, Air, with the URL, state and selected pollutant after each |
| `provenance.json` | Cordova APK (hash, version, the S05 sources inside it with the matching `client/` files and their last commits), the tracked inputs of the generated stylesheet and of D3, the emulator, the display, the language and the SHA-256 of every reference file |
| `tolerances.json` | Screenshot tolerance of each block, the metric, the reasons and the measured sensitivity (maintained with the tests; a capture keeps it) |

The states, with AN-02 corpus fixtures shown through the app's own services, S05 opened afresh each time as the tab does:

| State | What it shows |
| --- | --- |
| `kma-seoul` | 회현동 alone, the overall index: manual page 10 at the top and, scrolled to the end, page 12 |
| `kma-seoul-pm25` | then the second detail cell (초미세먼지) tapped: manual page 11 |
| `kma-seoul-station-1` | afresh, then the second station (한강대로) tapped |
| `kma-seoul-o3` | afresh at `/tab/air?code=o3`: an hourly series without a forecast |
| `kma-seoul-dark` | the overall index in the dark theme |
| `vc-london` | 런던 added and selected: an overseas place, with the arrows of more than one place |
| `kma-jeju-no-air` | 연동 (`kma-jeju` without `airInfoList` and the observation) added and selected: only the grade scale |

The display is 384×832 dp at density 2, in `ko-KR`. The images are cut from the screen (`screencap`) with the shared block cutter ([`tools/emulator/page-blocks.mjs`](../emulator/page-blocks.mjs), also used by the forecast references); the last block, which ends a pixel under the tab bar, leaves those pixels out. The manual's own images are live data at 411 dp; these are the same states with fixed data, and the fixture's daily forecast makes the page longer than the manual's.

## Tests

- `AirScreenshotTest` (app, Robolectric native graphics, SDK 34): every block of the seven states, rendered at 384 dp and density 2 from the same fixtures and taps, against the PNGs; each comparison passes within the tolerance recorded for it (`ImageDiff`). Renders and difference overlays go to `app/build/air-compare/`.
- `AirPageTest` and `AirChartTest` (core-domain): the text, images and grade colors of every element, the label's position at the captured widths, and every tick, label, date and bar of the captured charts within 0.02 dp.
- `AirTabTest` (app) follows `navigation.json`: the weather tabs keep the pollutant, the Locations tab clears it.
- CI runs the JVM tests in both Android jobs; the job with `client/` also runs [`tools/emulator/check-sources.mjs`](../emulator/check-sources.mjs), which fails when an S05 source in `client/www` no longer matches the one in `provenance.json`.

## Recapturing

After a change to the Cordova S05 (`check-sources.mjs` fails for the air references), build the Cordova debug APK from the same revision (`client/`: `npx cordova prepare android && npx cordova compile android --debug`, with the private inputs) and run:

```sh
cd android
ANDROID_SERIAL=emulator-5554 tools/air-reference/capture.sh <cordova-debug.apk>
./gradlew test
```

`capture.sh` uses an API 29+ emulator. It takes the emulator offline (`tools/emulator/offline.sh`), sets the display and the app's locale, installs the Cordova build, and `capture.mjs` drives it over WebView DevTools: it adds the places with the app's own services, opens S05, taps cells as a user does (Ionic accepts only taps it made, so the click carries `isIonicTap`), and cuts and describes every block. At the end it uninstalls the build and restores the display and the network. `provenance.mjs` writes `provenance.json`. Review the new captures and update `tolerances.json` with the measured values (the test prints them) only for an explained change.
