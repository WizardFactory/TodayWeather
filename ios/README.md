# TodayWeather for iOS (native)

Swift and SwiftUI replacement of the Cordova app in `client/`, tracked in #2948. It ships as an update of the App Store app `net.wizardfactory.todayweather` and uses the legacy server API as it is. The work is split into sub-issues IN-01 to IN-19 (#2950–#2968); see the [plan](../plans/ios-native.md) and the [spec](../specs/ios-native.md).

The iOS build never reads `client/`, `android/`, `tw.ios/`, `ta.ios/` or `applewatch/`. Images, translations, the town list, fonts and icons are copied into `ios/` by an import tool, with a provenance record.

## Layout

| Path | Contents |
| --- | --- |
| `TodayWeather.xcodeproj` | The app target `TodayWeather` and the app-hosted test target `TodayWeatherTests`. Their folders are folder-synchronized groups: adding a file there needs no project edit. |
| `TodayWeather/` | The SwiftUI app and its asset catalog (app icon, launch image). |
| `TodayWeatherTests/` | Tests that run inside the app on a simulator. |
| `Core/` | Local Swift package. `TWModel` and `TWDomain` use Foundation only (no UIKit or SwiftUI), so they also run with `swift test` on macOS. `TWData` (API client), `TWStorage` (state and the Cordova migration) and `TWResources` (the copies from `client/`). |
| `provenance/` | Source path, last commit and hashes of every copied file. |
| `tools/` | Development tools. They may read `client/` or `android/` when they regenerate copies; the Xcode build does not. |

Bundle ID `net.wizardfactory.todayweather`, deployment target iOS 17.0 (decided on #2948), iPhone and iPad. Swift Package Manager dependencies are pinned by `Package.resolved` files committed with the project; the skeleton has none yet.

## Prerequisites

- Xcode 27.2 (local builds; Swift 6.4) or Xcode 26.6 (CI, the default of the GitHub `macos-26` image). Xcode 27 simulates and debugs iOS 17 and later.
- An iOS 26.5 simulator runtime. Device checks use simulators created for this project, named `tw_…` (for example `xcrun simctl create tw_iphone16 com.apple.CoreSimulator.SimDeviceType.iPhone-16 com.apple.CoreSimulator.SimRuntime.iOS-26-5`), so a simulator or phone used by other work is never the target.
- Python 3 for the import tool.

## Build and test

```sh
cd ios/Core && swift test                      # Core package tests on macOS
cd ios && xcodebuild -project TodayWeather.xcodeproj -scheme TodayWeather \
  -destination 'platform=iOS Simulator,name=tw_iphone16' \
  -derivedDataPath build/DerivedData CODE_SIGNING_ALLOWED=NO test   # app and package tests on a simulator
```

The scheme's test action runs the app-hosted tests and the package tests. `build/` is ignored.

CI (`.github/workflows/ios.yml`) runs the same commands twice: once after re-running the import tools (client assets, golden corpus and chart scenes) and checking that they change nothing, and once in a checkout whose `client/`, `android/`, `tw.ios/`, `ta.ios/` and `applewatch/` directories have been deleted.

## Imported client assets

```sh
python3 ios/tools/import_client_assets.py
```

It copies into `Core/Sources/TWResources/Client/`:

- `client/www/img/**/*.png` to `img/` with the same relative paths;
- `client/www/data/town.js` to `data/towns.json`;
- `client/www/locales/<code>.json` to `<lproj>/Localizable.strings` (`en`, `ko`, `ja`, `de`, `zh-CN` → `zh-Hans`, `zh-TW` → `zh-Hant`), with keys and values kept literally;
- the Material Icons font (`client/www/fonts`) and the Ionicons font to `fonts/`.

It also copies the App Store icon (`client/tw.resources/icon.png`, no alpha channel) and the Cordova launch image (`client/tw.resources/ios/splash/Default@2x~universal~anyany.png`) into `TodayWeather/Assets.xcassets`. Ionicons 2.0.1 comes with Ionic 1.3.5, which Bower installs outside Git; the tool takes the committed Android copy after checking it against `android/app/provenance/cordova-fonts.json` and records both steps. `client/www/img/KR.png`, a same-content duplicate of the `kr.png` the app uses, is skipped and listed (the tool reads the image list from Git, so case-insensitive file systems give the same result).

The package copies the `Client` folder verbatim (`.copy`), so the bytes in the built bundle match the provenance hashes; `ImportedClientAssetsTests` checks that every copy is listed, present and unchanged. Code reads the copies through `TWResources` (`url(_:)`, `strings(catalog:)`). The folder is not called `Resources`, because on iOS a top-level `Resources` folder makes CFBundle treat the bundle as the old layout and move its resource URL into it.

Do not edit the generated files. While the Cordova apps exist, change translations in `client/www/locales/` (for example #2613) and re-run the tool, so both native apps get the change. The tool needs the full Git history.

## Golden corpus

`TWModel` and `TWDomain` are a Swift port of the Android core (`android/core-model`, `android/core-domain`: `Models.kt`, `Js.kt`, `Text.kt`, `WeatherConverter.kt`, `AirQuality.kt`, `Nationwide.kt`, `Warnings.kt`, `ChartPosition.kt`). They are checked against the golden corpus, the outputs of the Cordova client code that `android/tools/corpus/generate.mjs` writes under Node. To copy the corpus, run:

```sh
python3 ios/tools/import_corpus.py
```

The tool copies every tracked file of `android/core-domain/src/test/resources/corpus/` (inputs, expected outputs and `source.json`), byte for byte, into `Core/Tests/TWDomainTests/Corpus/`. It records each file's source path, last commit and hashes in `provenance/corpus.json`. Re-running it without source changes changes nothing, and CI fails on a stale copy. After the Android corpus changes (`node android/tools/corpus/generate.mjs`), re-run the tool and commit both.

- **JSON values:** `TWModel.JSONValue` is a JSON tree that keeps member order (JavaScript's order: array-index keys first) and each number's text. As a result, integers and fractional numbers stay apart, and a value read from a response is written back unchanged. Numbers that the code computes get JavaScript's `Number.prototype.toString` text (`JSNumberFormat`). Missing properties are Swift `nil` (JavaScript `undefined`); JSON `null` is `.null`. Member names and strings compare by UTF-16 code units, as in JavaScript (`TWModel.JSString`; Swift's `String` would treat `"\u{E9}"` and `"e\u{301}"` as equal). The parser is strict: `\u` takes exactly four hex digits, and invalid UTF-8 is an error. The response models (`PlaceWeather`, `CurrentWeather`, `NationResponse`, `WeatherWarning`, `GeocodeResponse`, …) are views over these objects, as on Android.
- **JavaScript semantics:** `TWDomain.Js` has JavaScript's truthiness, loose equality, relational comparison and ToNumber, and the number formatting. `toFixed` rounds the exact binary value half up: the exact decimal expansion comes from printf, and the rounding is done on its digits. Dates use a proleptic Gregorian calendar with Foundation's `TimeZone`. A local time without an offset that falls in a daylight-saving gap moves forward by the gap, and one in an overlap is the earlier instant (ECMAScript's LocalTime→UTC rule, as JavaScriptCore applies it). Strings are compared, searched and split by code units (`JSString`).
- **Tests:** `TWDomainTests` (`GoldenCorpusTests`, `GoldenCorpusDisplayTests`, `ModelsTests`) port the Kotlin tests and compare field by field. The comparison checks member names and their order, array lengths, strings and number texts. Every case the Kotlin tests check is checked. `TWModelTests` checks the JSON tree and the number text. Both targets run with `swift test` and in the scheme's test action on a simulator.

### JavaScriptCore

The Cordova iOS app runs the client code in JavaScriptCore, while the corpus comes from V8. To compare the two engines (macOS; needs `android/` and `client/`), run:

```sh
python3 ios/tools/corpus/compare_jsc.py [--report FILE] [--write]
```

The tool runs the unchanged generator in the macOS `jsc` shell, with the Node APIs it uses provided by `tools/corpus/node-shim.js`. It runs once per time zone and compares every case with the Node corpus. Values that differ are recorded in `Core/Tests/TWDomainTests/JavaScriptCore/differences.json`. For exactly those values the Swift tests expect the JavaScriptCore output; `--write` updates the record. [`tools/corpus/differences.md`](tools/corpus/differences.md) lists the differences with the run's command and versions, and what the run did not compare. The 2026-11-13 run found 21 values in `special.json`: JavaScriptCore rejects a day past the end of its month and accepts second 60. `Warnings.jsDate` follows JavaScriptCore.

## Charts

The hourly and daily forecast charts (gate G2, IN-05) port the Android AN-05 charts, which reproduce the Cordova D3 directives (`ngShortChart`, `ngShortDetailChart`, `ngMidChart` in `client/www/js/app.js`).

- **Scenes (`TWDomain`, `Chart/`):** `HourlyChart` and `DailyChart` build each chart as the SVG the directive draws, element by element (`Svg`): D3 v3 bands and `.nice()` scales (`D3`), the current point inserted into the line, labels, icons, the header labels, the legend texts and the opening scroll offset (`ChartPosition`). `ChartMetrics` takes the sizes from the screen size as `initSize` does, with its iOS branch (a 20 pt status bar less in the header's content height; it changes the chart heights only where the height bounds the header font, as on a landscape iPad). A place without `timeChart` or `dayChart` gives no chart (the directive throws there). `ChartTexts.keys` lists the catalog strings the charts show.
- **Drawing (`TodayWeather/Chart/`):** `HourlyChartView` (header rows, chart, separators, detail rows, the pinned legend and the expander row) and `DailyChartView` draw the scenes with SwiftUI `Canvas`, in the colors of the Cordova SCSS for the light, dark, old and photo themes (`ChartColors`), with the images of `TWResources` and the theme's image folders of `theme.js`. Text is drawn with CoreText in the system UI font (`-apple-system` in WebKit) with CoreText's fallback fonts; rows have WebKit's `line-height: normal` (each used font's ascent and descent rounded up to whole points: 19 pt for 15 px text, 22 pt for 17 px), and the expander glyph comes from the imported Material Icons font. Both charts open at the Cordova scroll position: the opening offset rounded down to a whole point, as WebKit's `scrollLeft` (iOS 17 has no offset scroll position, so a marker view at that offset is the scroll target). The views take the chart, the expanded state and a toggle action; IN-07 and IN-08 supply the data, theme, catalog, units and the stored `expandShortChart`.
- **Without a scroll view:** `HourlyChartFrame` and `DailyChartFrame` show the same content and pinned parts at a given scroll offset; the screenshot tests render them, so no test or preview mode exists in the app.

### References and tests

| File | Contents |
| --- | --- |
| `Core/Tests/TWDomainTests/ChartReference/android/` | The Cordova scenes captured on the Android emulator (360×780, 384×832, 412×892 dp), copied by `tools/import_chart_reference.py` (provenance `provenance/chart-reference.json`) |
| `Core/Tests/TWDomainTests/ChartReference/ios/<WxH>/` | The Cordova iOS scenes at 375×667, 393×852 and 440×956 pt: every SVG element with its attributes and text, the rects of the header labels, legend, separators and expander, computed styles and scroll offsets (`kma-seoul` and `vc-london` at every size, eleven fixtures at 393×852) |
| `TodayWeatherTests/ChartReference/` | Captures of the Cordova iOS chart wrappers for `kma-seoul` at each size, at the opening position and both scroll ends (sRGB PNG), `captures.json` (scroll offsets and pixel sizes), the served response `kma-seoul.input.json` and `tolerances.json` |
| `provenance/chart-captures.json` | Build commit and recipe, the chart sources inside the built app compared with `client/`, simulator, runtime, user agent, WebView origin in each screenshot, served data and the SHA-256 of every capture file |

- `ChartSceneTests` (`swift test` and the scheme): the Swift scenes against every element, label, legend text and opening offset of both reference sets, within 0.02 pt; the Android set with the Android metrics, the iOS set with the iOS metrics. `ChartReferenceProvenanceTests` checks that every reference file is listed with its hash.
- `ChartScreenshotTests` (app-hosted): renders the charts with `ImageRenderer` at the capture's width, scroll offset and pixel scale (2 at 375×667, 3 otherwise) and compares them with the captures by the AN-05 metric (the share of pixels whose largest channel differs by more than 64 after a 3×3 blur, the mean difference and the height); each comparison passes within the value recorded in `tolerances.json` plus the Android margins (0.0015, 0.3, 0 px), which also says why. The render does not depend on the simulator model, so CI's iPhone 17 runs all three sizes; renders and difference images go to the app's `tmp/chart-compare/`. `ChartScrollTests` puts the live views in a window and checks that their scroll views open at the captured `scrollLeft`.
- What the tolerances leave: glyph rasterization (WebKit places glyphs on its own subpixel grid) and image filtering, up to about one device pixel at text edges. A today line 1 pt wide instead of 2 is detected at 375×667 and 393×852 but not at 440×956; a 1 pt vertical shift of the daily chart is detected at every size (plans/ios-native.md, IN-05).

### Recapturing

After a change to the Cordova charts (the chart sources in `provenance/chart-captures.json` no longer match `client/`), rebuild the Cordova reference app and capture on the owned simulators (macOS with Xcode, Node, network for npm and Bower; see [`tools/chart-reference`](tools/chart-reference/README.md)):

```sh
sh ios/tools/chart-reference/build-cordova.sh ios/build/chart-reference http://127.0.0.1:18453
for udid in 52E0C852-6471-487A-A2B5-99E41E0CA3D4 9CAAD5CA-A41F-4C19-808E-907D3E1F6F48 C07BFC9B-AB5D-42CC-B7B5-ABF70B07E50B; do
  python3 ios/tools/chart-reference/capture.py run $udid ios/build/chart-reference/TodayWeather.app
done
python3 ios/tools/chart-reference/capture.py provenance ios/build/chart-reference/TodayWeather.app
```

Then run the tests; update `tolerances.json` with the measured values (the test prints them) only for an explained change. After the Android references change, re-run `python3 ios/tools/import_chart_reference.py`; CI fails on a stale copy.

## Private inputs

None yet; the build and the tests run without private inputs. Later sub-issues add them outside Git (ignored by `ios/.gitignore`): the Firebase configuration `GoogleService-Info.plist` (IN-03, IN-04), and a `Private.xcconfig` with the server URL, the AdMob and Places identifiers (IN-08, IN-10, IN-15) and release signing (IN-19).
