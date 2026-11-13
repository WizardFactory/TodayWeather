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

CI (`.github/workflows/ios.yml`) runs the same commands twice: once after re-running the import tools (client assets and golden corpus) and checking that they change nothing, and once in a checkout whose `client/`, `android/`, `tw.ios/`, `ta.ios/` and `applewatch/` directories have been deleted.

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

## Private inputs

None yet; the build and the tests run without private inputs. Later sub-issues add them outside Git (ignored by `ios/.gitignore`): the Firebase configuration `GoogleService-Info.plist` (IN-03, IN-04), and a `Private.xcconfig` with the server URL, the AdMob and Places identifiers (IN-08, IN-10, IN-15) and release signing (IN-19).
