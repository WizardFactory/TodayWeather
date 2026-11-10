# Notification settings references (AN-14, #2893)

S09 is compared with the Cordova debug build itself (manual pages 21–23). The references live in [`app/src/test/resources/push-reference/`](../../app/src/test/resources/push-reference):

| File | Contents |
| --- | --- |
| `<lang>/settings.png`, `.json` | S09 of 서울 without records: the defaults (page 21) |
| `<lang>/picker.png`, `.json` | The time picker after a real tap on the add row `HH:MM` (page 22) |
| `<lang>/confirm.png`, `.json` | The save confirmation O12 after a real tap on Cancel (page 23) |
| `<lang>/equal.png`, `.json` | O13 after a real tap on Save with a stored alert from 09 to 09 |
| `<lang>/permission.png`, `.json` | O11 after a real tap on Save while the push service reports notifications off |
| `<lang>/intro.png`, `.json`, `<lang>/foreground.png`, `.json` | O06 and O07 over Hourly (TabCtrl's events) |
| `<lang>/requests.json` | The push requests the run sent (the token replaced) |
| `provenance.json` | Cordova APK (hash, version, the sources inside it with the matching `client/` files and their last commits), the tracked inputs of the stylesheet and of the two Bower libraries (`client/bower.json`), the emulator and the SHA-256 of every reference file |
| `tolerances.json` | Screenshot tolerance of each comparison, the metric and the reasons |

Each JSON has the header (back arrow, title), the cards, items, descriptions with Chrome's line boxes, the switch, the hour bar's parts (line, bar, handles, labels, grid), the weekday buttons, the row icons, Cancel and Save, and the popup (head, title, body lines, buttons; the picker's heading, boxes, colons and arrows), with rects and styles. The display is 384×832 dp at density 2. 서울 is added through the app's own `WeatherInfo` with the AN-02 corpus fixture kma-seoul; records are seeded through the `Push` service (`newPushAlert`, `newPushAlarm`, `savePushInfo`) with a token; the page talks to a stand-in server inside the WebView. Each S09 opens from Favorites, because the page initializes its hour bar by element id and an S09 opened over another would bind the bar to the old page's input.

## Tests

- `AlarmsScreenshotTest` (app, Robolectric native graphics, SDK 34): the S09 states and O11, O13 against the PNGs, rendered at 384×762 dp and density 2 with the same place and records; each comparison passes within the tolerance recorded for it (`ImageDiff`); the cards, titles, descriptions, weekday buttons, rows, bar, Cancel and Save, the switch, the picker's parts and the popups' boxes against the JSON within 0.6 dp. O06 and O07 are checked by their boxes only: Hourly under them depends on the clock.
- CI runs the JVM tests in both Android jobs; the job with `client/` also runs [`tools/emulator/check-sources.mjs`](../emulator/check-sources.mjs), which fails when a source in `client/www` no longer matches the one in `provenance.json`.

## Recapturing

After a change to these sources, build the Cordova debug APK from the same revision (`client/`: `npx cordova prepare android && npx cordova compile android --debug`, with the private inputs) and run:

```sh
cd android
ANDROID_SERIAL=emulator-5554 tools/push-reference/capture.sh <cordova-debug.apk>
./gradlew test
```

`capture.sh` uses an API 33+ emulator (per-app languages). It takes the emulator offline (`tools/emulator/offline.sh`), sets the display, and for each language installs the Cordova build with that per-app locale and the notification permission granted before the first start; `capture.mjs` drives it over WebView DevTools. At the end it uninstalls the build and restores the display and the network. Update `tolerances.json` with the measured values (the test prints them) only for an explained change.
