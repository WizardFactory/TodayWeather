# Saved places references (AN-11, #2890)

S02 is compared with the Cordova debug build itself (manual pages 13, 14, 18 and 19; pages 15–17 and 20 are S03 states, which the forecast references cover). The references live in [`app/src/test/resources/places-reference/`](../../app/src/test/resources/places-reference):

| File | Contents |
| --- | --- |
| `<lang>/favorites.png`, `.json` | The list with 서울 (page 13) |
| `<lang>/search.png`, `.json` | The search for 부산: 현재위치로 지역찾기, ten bundled towns and "powered by TodayWeather" (page 14) |
| `<lang>/edit.png`, `.json` | Edit mode with 현재위치 (switch off), 서울, 부산광역시 and London (page 18) |
| `<lang>/location.png`, `.json` | The find-by-location result with Google's logo (page 19) |
| `provenance.json` | Cordova APK (hash, version, the sources inside it with the matching `client/` files and their last commits), the stylesheet's tracked input, the emulator and the SHA-256 of every reference file |
| `tolerances.json` | Screenshot tolerance of each comparison, the metric and the reasons |

Each JSON has the header's field and mode button, the rows with their cells (name lines, sky icon, temperatures, bell, switch, ⊗), the find button and the dividers, with rects and styles. The display is 384×832 dp at density 2. Places are added through the app's own `WeatherInfo` with the AN-02 corpus fixtures (kma-seoul, vc-london), and the page talks to a stand-in server inside the WebView (weather, the coordinates geocode with geocode-seoul, push). Search mode is entered through SearchCtrl's handlers without the soft keyboard; 편집/확인/취소 and 현재위치로 지역찾기 are real taps. Location is granted before the first start and the emulator's position is set (offline, so the geocode is the stand-in's).

## Tests

- `PlacesScreenshotTest` (app, Robolectric native graphics, SDK 34): the four states against the PNGs, rendered at 384×762 dp and density 2 with the same fixtures; each comparison passes within the tolerance recorded for it (`ImageDiff`); `koreanBoxes` checks the edit rows and the find button against the JSON.
- CI runs the JVM tests in both Android jobs; the job with `client/` also runs [`tools/emulator/check-sources.mjs`](../emulator/check-sources.mjs), which fails when a source in `client/www` no longer matches the one in `provenance.json`.

## Recapturing

After a change to these sources, build the Cordova debug APK from the same revision (`client/`: `npx cordova prepare android && npx cordova compile android --debug`, with the private inputs) and run:

```sh
cd android
ANDROID_SERIAL=emulator-5554 tools/places-reference/capture.sh <cordova-debug.apk>
./gradlew test
```

`capture.sh` uses an API 33+ emulator (per-app languages). It takes the emulator offline (`tools/emulator/offline.sh`), sets the display and the position, and for each language installs the Cordova build with that per-app locale; `capture.mjs` drives it over WebView DevTools. At the end it uninstalls the build and restores the display and the network. Update `tolerances.json` with the measured values (the test prints them) only for an explained change.
