# Start page references (AN-10, #2889)

The start page S01 and its access notice O01 are compared with the Cordova debug build itself (manual pages 1 and 2). The references live in [`app/src/test/resources/start-reference/`](../../app/src/test/resources/start-reference):

| File | Contents |
| --- | --- |
| `<lang>/access.png`, `access.json` | O01 over S01 on a new install, the whole WebView: the popup's parts with their rects and styles, its body's line boxes as Chrome broke them, the backdrop, and the page under it |
| `<lang>/start.png`, `start.json` | S01 after O01's OK: the icon, the cards, the search row, its glyph and input (with the placeholder's style), each city shortcut with its rect and line box, and 현재위치 날씨보기 |
| `provenance.json` | Cordova APK (hash, version, the sources inside it with the matching `client/` files and their last commits), the stylesheet's tracked input, the emulator and the SHA-256 of every reference file |
| `tolerances.json` | Screenshot tolerance of each comparison, the metric and the reasons (maintained with the tests; a capture keeps it) |

The display is 384×832 dp at density 2, so `window.screen.height` gives 17 shortcuts, as on the manual's device. Each language is a new install with the per-app locale set and the notification permission granted (as for the manual's captures); location is not granted. As the manual's harness did, the capture waits for the start page and its notice plus 1.5 s, then closes the notice with a real tap on its OK (`adb input tap` at the button's center).

## Tests

- `StartScreenshotTest` (app, Robolectric native graphics, SDK 34): both states against the PNGs, rendered at 384×762 dp and density 2 in a 384×832 dp window; each comparison passes within the tolerance recorded for it (`ImageDiff`). The notice's body lines equal the capture's line boxes, and the page's boxes lie where `start.json` has them.
- CI runs the JVM tests in both Android jobs; the job with `client/` also runs [`tools/emulator/check-sources.mjs`](../emulator/check-sources.mjs), which fails when a source in `client/www` no longer matches the one in `provenance.json`.

## Recapturing

After a change to these sources (`check-sources.mjs` fails for the start references), build the Cordova debug APK from the same revision (`client/`: `npx cordova prepare android && npx cordova compile android --debug`, with the private inputs) and run:

```sh
cd android
ANDROID_SERIAL=emulator-5554 tools/start-reference/capture.sh <cordova-debug.apk>
./gradlew test
```

`capture.sh` uses an API 33+ emulator (per-app languages). It takes the emulator offline (`tools/emulator/offline.sh`), sets the display, and for each language installs the Cordova build with that per-app locale; `capture.mjs` drives it over WebView DevTools and a real tap. At the end it uninstalls the build and restores the display and the network. `provenance.mjs` writes `provenance.json`. Review the new captures and update `tolerances.json` with the measured values (the test prints them) only for an explained change.
