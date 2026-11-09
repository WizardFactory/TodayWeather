# Nationwide and warning references (AN-13, #2892)

The native nationwide pages and warnings are compared with the Cordova debug build itself. The references live in [`app/src/test/resources/nation-reference/`](../../app/src/test/resources/nation-reference):

| File | Contents |
| --- | --- |
| `ko-KR/nation-*.png` | S10 and S11 from the top of the page to 20 CSS px under the map: S10's three modes (manual pages 33 and 34), S11's six tabs (page 35; CO after a swipe of the strip), the failed answer, the dark and old themes, the wind in km/h and the AirNow standard |
| `ko-KR/nation-loading.png` | S10 while its request runs: Ionic's backdrop and loading box, the whole WebView |
| `<lang>/warnings.png`, `<lang>/warnings-<i>.png` | S12 as it opens (page 32), then each card whole, stitched when taller than the screen under the header; the dark and old themes; `warnings-empty` and `warnings-failed` |
| `<lang>/<state>.json` | The header, title and back button, and per page its parts with their rects, colors and fonts: the mode buttons or tabs and the strip's scroll, the map and every label with its parts, every card with its parts, the loading parts. A card's `clipTop` is what the header hides of it. |
| `<lang>/requests.json` | Every request each step sent, in order, with the server's address and the photo feed's URL left out |
| `provenance.json` | Cordova APK (hash, version, the sources of the three pages inside it with the matching `client/` files and their last commits), the stylesheet's tracked input, the emulator and the SHA-256 of every reference file |
| `tolerances.json` | Screenshot tolerance of each comparison, the metric, the reasons and the measured sensitivity (maintained with the tests; a capture keeps it) |

The display is 384×832 dp at density 2, in `ko-KR` and in `en-KR`: English with the region Korea, so the Korea-only menu rows show. The place is the AN-02 corpus fixture `kma-seoul` (회현동). Every step is a real tap on the screen (`adb input tap` at the element's center): the menu, the row, the mode buttons and tabs. The strip is swiped from inside the screen, as a swipe from the edge is the system's back gesture. Popups are closed with their first button so that Ionic keeps the backdrop element that its loading overlay uses.

The page talks to a stand-in server inside the WebView (`XMLHttpRequest` replaced for the server's URLs only):
- weather: the corpus fixture `kma-seoul`;
- `/v000903/nation/KR`: the corpus input `nation.json` (a production answer). For the loading state it answers after 4 s; it also answers with an empty answer and with a 500;
- `/v000903/kma/special`: the corpus input `special.json` (three bulletins). It also answers with `[]` and with a 500.

The recorded requests show what the native app must send:
- the nation request with the stored units, three times 2 s apart when the answer is late, once when it fails at once;
- the warnings request once, with `responseType: 'json'`;
- a new request each time a page opens.

## Tests

- `NationScreenshotTest` (app, Robolectric native graphics, SDK 34): every page, state and card against the PNGs, rendered at 384 dp and density 2 with the same answers. Each comparison passes within the tolerance recorded for it (`ImageDiff`). Renders and difference overlays go to `app/build/nation-compare/`.
- `NationGeometryTest`: the labels relative to the map, the mode buttons, the tabs (also scrolled to CO), the cards' tops and heights and the loading box against the recorded rects, within 0.5 dp.
- `NationPagesTest` (core-domain) compares every label's name, icon and values and every card's parts with the JSON. `NationSourceTest` (core-data) compares the requests with `ko-KR/requests.json`.
- CI runs the JVM tests in both Android jobs. The job with `client/` also runs [`tools/emulator/check-sources.mjs`](../emulator/check-sources.mjs), which fails when a source of the three pages in `client/www` no longer matches the one in `provenance.json`.

## Recapturing

After a change to the Cordova pages (`check-sources.mjs` fails for the nation references), build the Cordova debug APK from the same revision (`client/`: `npx cordova prepare android && npx cordova compile android --debug`, with the private inputs) and run:

```sh
cd android
ANDROID_SERIAL=emulator-5554 tools/nation-reference/capture.sh <cordova-debug.apk>
./gradlew test
```

`capture.sh` uses an API 29+ emulator. It takes the emulator offline (`tools/emulator/offline.sh`) and sets the display. For each language it installs the Cordova build with that per-app locale, and `capture.mjs` drives it over WebView DevTools and real taps. At the end it uninstalls the build and restores the display and the network. `provenance.mjs` writes `provenance.json`. Review the new captures, and update `tolerances.json` with the measured values (the test prints them) only for an explained change.
