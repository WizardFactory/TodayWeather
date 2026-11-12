# Privacy references (AN-15, #2894)

The menu's privacy rows are compared with the Cordova debug build itself. The references live in [`app/src/test/resources/privacy-reference/`](../../app/src/test/resources/privacy-reference):

| File | Contents |
| --- | --- |
| `<lang>/menu-off.png`, `menu-allowed.png` | The menu scrolled to its end, the whole WebView, with 선택적 이용 통계 · 꺼짐 and, after 동의, · 동의함 |
| `<lang>/analytics-popup.png` | The usage analytics popup over that menu (manual page 37) |
| `<lang>/<state>.json` | The four rows' text, rects and styles; the popup's parts, its body's line boxes as Chrome broke them, and the backdrop |
| `<lang>/actions.json` | `navigator.language` and `Util.language`; after each step the choice and what the app stored; the URLs 개인정보처리방침 and 이용약관 opened; what 광고 개인정보 선택 did; whether Android back closed the popup and the menu |
| `provenance.json` | Cordova APK (hash, version, the sources inside it with the matching `client/` files and their last commits), the stylesheet's tracked input, the emulator and the SHA-256 of every reference file |
| `tolerances.json` | Screenshot tolerance of each comparison, the metric and the reasons (maintained with the tests; a capture keeps it) |

The WebView is 384×762 dp at density 2, the size the tests render: `capture.sh` sets the display's height so that the room between the status and navigation bars is 762 dp (384×832 dp under the 46 dp status bar of the first capture, 384×810 dp under the 24 dp one the capture emulator showed on 2026-11-10), and `capture.mjs` stops on any other WebView size. The place is the AN-02 corpus fixture `kma-seoul` (회현동). Every step is a real tap on the screen (`adb input tap` at the element's center) or the Android back key, in the order a user goes: the menu, 선택적 이용 통계, back, 동의, 거부 / 철회, 개인정보처리방침, 이용약관, 광고 개인정보 선택, then the About popup and back. The system browser is recorded instead of opened (`cordova.InAppBrowser.open`), and the AdMob plugin's privacy form call records which callback it answered.

What the captures show (in `actions.json`):
- `Util.language` is `ko-KR` in Korean, so both rows open the `.en` pages (B13 in `tools/corpus/differences.md`);
- the ad privacy form answers success and shows nothing where no form is required (B14);
- one Android back key closes the popup and, depending on a race, the menu too (B17): each capture records which happened.

## Tests

- `PrivacyScreenshotTest` (app, Robolectric native graphics, SDK 34): the three states against the PNGs, rendered at 384×762 dp and density 2; each comparison passes within the tolerance recorded for it (`ImageDiff`). The popup's body lines equal the capture's line boxes. Renders and difference overlays go to `app/build/privacy-compare/`.
- `PrivacyMenuTest` covers what `actions.json` records, with the native differences.
- CI runs the JVM tests in both Android jobs; the job with `client/` also runs [`tools/emulator/check-sources.mjs`](../emulator/check-sources.mjs), which fails when a source in `client/www` no longer matches the one in `provenance.json`.

## Recapturing

After a change to these sources (`check-sources.mjs` fails for the privacy references), build the Cordova debug APK from the same revision (`client/`: `npx cordova prepare android && npx cordova compile android --debug`, with the private inputs) and run:

```sh
cd android
ANDROID_SERIAL=emulator-5554 tools/privacy-reference/capture.sh <cordova-debug.apk>
./gradlew test
```

`capture.sh` uses an API 33+ emulator (per-app languages). It takes the emulator offline (`tools/emulator/offline.sh`), so the opt-in sends nothing, sets the display, and for each language installs the Cordova build with that per-app locale; `capture.mjs` drives it over WebView DevTools and real taps. At the end it uninstalls the build and restores the display and the network. `provenance.mjs` writes `provenance.json`. Review the new captures and update `tolerances.json` with the measured values (the test prints them) only for an explained change.
