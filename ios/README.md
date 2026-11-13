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

CI (`.github/workflows/ios.yml`) runs the same commands twice: once after re-running the import tool and checking that it changes nothing, and once in a checkout whose `client/`, `android/`, `tw.ios/`, `ta.ios/` and `applewatch/` directories have been deleted.

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

## Private inputs

None yet; the build and the tests run without private inputs. Later sub-issues add them outside Git (ignored by `ios/.gitignore`): the Firebase configuration `GoogleService-Info.plist` (IN-03, IN-04), and a `Private.xcconfig` with the server URL, the AdMob and Places identifiers (IN-08, IN-10, IN-15) and release signing (IN-19).
