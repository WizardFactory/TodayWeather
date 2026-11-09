# Settings references (AN-12, #2891)

The native settings pages, the About popup and the weather page after a settings change are compared with the Cordova debug build itself. The references live in [`app/src/test/resources/settings-reference/`](../../app/src/test/resources/settings-reference):

| File | Contents |
| --- | --- |
| `ko-KR/units*.png`, `ko-KR/radio-*.png` | S07 and the S08 lists from the top of the page to 20 CSS px under the list: S07 in each theme and after 온도단위 F, every unit's and setting's list, the theme list in each theme (manual pages 25, 26, 28 and 29) |
| `ko-KR/hourly-f/`, `ko-KR/hourly-dark/`, `ko-KR/hourly-photo/` | Every block of S03 after the unit change and in the dark and photo themes (manual pages 27, 30 and 31), cut like the forecast references |
| `<lang>/about.png` | The About popup over the menu scrolled to its end, the whole WebView (manual page 36), in `ko-KR` and `en-US` |
| `<lang>/<state>.json` | The header bar, title, back button and every row of a page with their rects, colors, fonts, values and check marks; the popup's parts and backdrop |
| `<lang>/requests.json` | Every request each step sent, in order, with the server's address, the photo feed's URL and the device id left out |
| `photo.png` | The synthetic photo the photo theme shows (`photo.mjs`): served to the Cordova build as the feed's only photo, drawn by the native tests |
| `provenance.json` | Cordova APK (hash, version, the settings sources inside it with the matching `client/` files and their last commits), the stylesheet's tracked input, the emulator and the SHA-256 of every reference file |
| `tolerances.json` | Screenshot tolerance of each comparison, the metric, the reasons and the measured sensitivity (maintained with the tests; a capture keeps it) |

The display is 384×832 dp at density 2. The place is the AN-02 corpus fixture `kma-seoul` (회현동) with an alarm and a token, so a unit change posts the push list. Every step is a real tap on the screen (`adb input tap` at the element's center), in the order a user goes: the menu, 단위설정, each unit's list, 온도단위 F and back to the weather, the startup page, the refresh interval, each theme, About.

The page talks to a stand-in server inside the WebView (`XMLHttpRequest` replaced for the server's URLs only): a weather request gets the corpus fixture whose units match the request (`kma-seoul` in °C, `kma-seoul-f` in °F), as the server converts units; the photo feed gets `photo.png` for every sky; the push list gets 200. The recorded requests show what the native app must send: a unit choice posts the push list and requests the weather in the new unit at once, on S08; a startup page, refresh interval or theme choice requests the weather; opening a page or going back sends nothing.

## Tests

- `SettingsScreenshotTest` (app, Robolectric native graphics, SDK 34): every page and block against the PNGs, rendered at 384 dp and density 2 with the same fixtures and settings; each comparison passes within the tolerance recorded for it (`ImageDiff`). Renders and difference overlays go to `app/build/settings-compare/`.
- `SettingsActionsTest` (core-data) compares the weather request after 온도단위 F with the one in `ko-KR/requests.json`.
- CI runs the JVM tests in both Android jobs; the job with `client/` also runs [`tools/emulator/check-sources.mjs`](../emulator/check-sources.mjs), which fails when a settings source in `client/www` no longer matches the one in `provenance.json`.

## Recapturing

After a change to the Cordova settings pages (`check-sources.mjs` fails for the settings references), build the Cordova debug APK from the same revision (`client/`: `npx cordova prepare android && npx cordova compile android --debug`, with the private inputs) and run:

```sh
cd android
ANDROID_SERIAL=emulator-5554 tools/settings-reference/capture.sh <cordova-debug.apk>
./gradlew test
```

`capture.sh` uses an API 29+ emulator. It takes the emulator offline (`tools/emulator/offline.sh`), writes `photo.png`, sets the display, and for each language installs the Cordova build with that per-app locale; `capture.mjs` drives it over WebView DevTools and real taps, closing popups with their first button so Ionic keeps its backdrop. At the end it uninstalls the build and restores the display and the network. `provenance.mjs` writes `provenance.json`. Review the new captures and update `tolerances.json` with the measured values (the test prints them) only for an explained change.
