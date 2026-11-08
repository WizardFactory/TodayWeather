# Weather page references (AN-08, #2887)

The native weather pages S03 (Hourly) and S04 (Daily) are compared with the pages drawn by the Cordova debug build itself. The references live in [`app/src/test/resources/forecast-reference/`](../../app/src/test/resources/forecast-reference):

| File | Contents |
| --- | --- |
| `<place>/<page>-<n>.png` | Block `n` of the page at density 2: 0 the header block with the header bar over it, 1 the chart, then each card and the attribution |
| `<place>/<page>.json` | For each block: its rect, background, whether it was taller than the screen or ended under the tab bar (`hidden`), and the rect, text, image, font and color of every element in it |
| `provenance.json` | Cordova APK (hash, version, the page sources inside it with the matching `client/` files and their last commits), the tracked inputs of the generated stylesheet, the emulator, the display, the language and the SHA-256 of every reference file |
| `tolerances.json` | Screenshot tolerance of each block, the metric, the reasons and the measured sensitivity (maintained with the tests; a capture keeps it) |

The places are AN-02 corpus fixtures shown with the app's own services: 회현동 (`kma-seoul`) alone, then London (`vc-london`) added and selected, so its pages have the arrows of more than one place. The display is 384×832 dp at density 2, in `ko-KR`, light theme. The images are cut from the screen (`screencap`); a block taller than the screen is stitched from screens scrolled a block at a time, and the last block, which ends a pixel under the tab bar, leaves those pixels out.

These are the states of the Cordova manual's pages 3 to 9 (S03 at the top and in its details, S04, the charts) with fixed data; the charts' scroll ends are covered by the AN-05 references ([`tools/chart-reference`](../chart-reference/README.md)).

## Tests

- `ForecastScreenshotTest` (app, Robolectric native graphics, SDK 34): every block of both pages, rendered at 384 dp and density 2 from the same fixtures, against the PNGs; each comparison passes within the tolerance recorded for it (`ImageDiff`). Renders and difference overlays go to `app/build/forecast-compare/`.
- `ForecastPageTest` (core-domain): the text, images and grade colors of every element of the JSON records against the page model, and the template rules the captures do not reach.
- CI runs the JVM tests in both Android jobs; the job with `client/` also runs [`tools/emulator/check-sources.mjs`](../emulator/check-sources.mjs), which fails when a page source in `client/www` no longer matches the one in `provenance.json`.

## Recapturing

After a change to the Cordova pages (`check-sources.mjs` fails for the forecast references), build the Cordova debug APK from the same revision (`client/`: `npx cordova prepare android && npx cordova compile android --debug`, with the private inputs) and run:

```sh
cd android
ANDROID_SERIAL=emulator-5554 tools/forecast-reference/capture.sh <cordova-debug.apk>
./gradlew test
```

`capture.sh` uses an API 29+ emulator. It takes the emulator offline (`tools/emulator/offline.sh`), sets the display and the app's locale, installs the Cordova build, and `capture.mjs` drives it over WebView DevTools: it adds the places with the app's own services, opens each page afresh, and cuts and describes every block. At the end it uninstalls the build and restores the display and the network. `provenance.mjs` writes `provenance.json`. Review the new captures and update `tolerances.json` with the measured values (the test prints them) only for an explained change.
