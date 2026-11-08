# Shell references (AN-07, #2886)

The native shell (tab bar, header bar and side menu) is compared with the Cordova shell drawn by the Cordova debug build itself. The references live in [`app/src/test/resources/shell-reference/`](../../app/src/test/resources/shell-reference):

| File | Contents |
| --- | --- |
| `<lang>/<theme>-{tabs,header,menu}.png` | The tab bar, the header bar and the open side menu on the Hourly tab of a saved place, at density 2, for `ko-KR` and `en-US` and the light, dark, photo and old themes |
| `<lang>/<theme>.json` | For each part: its rect, computed colors and font, the tab items and menu rows with their texts and rects, the header title, and where the image was cut from the screen |
| `provenance.json` | Cordova APK (hash, version, the shell sources inside it with the matching `client/` files and their last commits), the tracked inputs of the generated stylesheet and Ionic, the emulator and the SHA-256 of every reference file |
| `tolerances.json` | Screenshot tolerance of each comparison, the metric, the reasons and the measured sensitivity (maintained with the tests; a capture keeps it) |

The display is 384×832 dp at density 2. The place is the `kma-seoul` fixture of the AN-02 corpus, named 회현동, shown with the app's own services; analytics has not been chosen and the other settings are the defaults.

The images are cut from the screen (`screencap`) at the element rects. DevTools screenshots are not used: on 2026-11-08 they drew the English menu's rows 2.5 dp shorter than the page's layout and the screen, and the photo theme's header smaller.

## Tests

- `ShellScreenshotKoTest` and `ShellScreenshotEnTest` (app, Robolectric native graphics, SDK 34): the Compose tab bar, header bar and side menu in each theme against the PNGs; each comparison passes within the tolerance recorded for it (`ImageDiff`: the share of pixels that differ by more than 64 after a 3×3 blur, the mean difference and the height). Renders and difference overlays go to `app/build/shell-compare/`.
- `ShellTest` (app): tabs, startup page, menu rows with their values and chevrons, back and the exit confirmation. It covers what the whole-image comparison misses (see `sensitivity` in `tolerances.json`).
- CI runs the JVM tests in both Android jobs; the job with `client/` also runs [`tools/emulator/check-sources.mjs`](../emulator/check-sources.mjs), which fails when a shell source in `client/www` no longer matches the one in `provenance.json`.

## Recapturing

After a change to the Cordova shell (`check-sources.mjs` fails for the shell references), build the Cordova debug APK from the same revision (`client/`: `npx cordova prepare android && npx cordova compile android --debug`, with the private inputs) and run:

```sh
cd android
ANDROID_SERIAL=emulator-5554 tools/shell-reference/capture.sh <cordova-debug.apk>
./gradlew test
```

`capture.sh` uses an API 29+ emulator. It takes the emulator offline (`tools/emulator/offline.sh`), sets the display, and for each language installs the Cordova build with that per-app locale. `capture.mjs` drives the app over WebView DevTools to show the place in each theme with the app's own services, measures the parts and cuts their images from the screen. It closes the popup from the offline location load. At the end it uninstalls the build and restores the display and the network. `provenance.mjs` writes `provenance.json`. Review the new captures and update `tolerances.json` with the measured values (the test prints them) only for an explained change.
