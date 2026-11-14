# TodayWeather for iOS (native)

Swift and SwiftUI replacement of the Cordova app in `client/`, tracked in #2948. It ships as an update of the App Store app `net.wizardfactory.todayweather` and uses the legacy server API as it is. The work is split into sub-issues IN-01 to IN-19 (#2950–#2968); see the [plan](../plans/ios-native.md) and the [spec](../specs/ios-native.md).

The iOS build never reads `client/`, `android/`, `tw.ios/`, `ta.ios/` or `applewatch/`. Images, translations, the town list, fonts and icons are copied into `ios/` by an import tool, with a provenance record.

## Layout

| Path | Contents |
| --- | --- |
| `TodayWeather.xcodeproj` | The app target `TodayWeather` and the app-hosted test target `TodayWeatherTests`. Their folders are folder-synchronized groups: adding a file there needs no project edit. |
| `TodayWeather/` | The SwiftUI app and its asset catalog (app icon, launch image). |
| `Support/` | The app's `Info.plist` additions (merged into the generated one) and its entitlements (App Group). |
| `TodayWeatherTests/` | Tests that run inside the app on a simulator. |
| `Core/` | Local Swift package. `TWModel` and `TWDomain` use Foundation only (no UIKit or SwiftUI), so they also run with `swift test` on macOS. `TWData` (API client), `TWStorage` (state and the Cordova migration) and `TWResources` (the copies from `client/`). |
| `provenance/` | Source path, last commit and hashes of every copied file. |
| `tools/` | Development tools. They may read `client/` or `android/` when they regenerate copies or build test inputs; the Xcode build does not. |

Bundle ID `net.wizardfactory.todayweather`, deployment target iOS 17.0 (decided on #2948), iPhone and iPad. Swift Package Manager dependencies are pinned by the committed `TodayWeather.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`: Firebase 13.1.1, product `FirebaseAnalyticsCore` (IN-03).

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
- **Drawing (`TodayWeather/Chart/`):** `HourlyChartView` (header rows, chart, separators, detail rows, the pinned legend and the expander row) and `DailyChartView` draw the scenes with SwiftUI `Canvas`, in the colors of the Cordova SCSS for the light, dark, old and photo themes (`ChartColors`), with the images of `TWResources` and the theme's image folders of `theme.js`. Text is drawn with CoreText in the system UI font (`-apple-system` in WebKit) with CoreText's fallback fonts; rows have WebKit's `line-height: normal` (each used font's ascent and descent rounded up to whole points: 19 pt for 15 px text, 22 pt for 17 px), and the expander glyph comes from the imported Material Icons font. Both charts open at the Cordova scroll position: the opening offset rounded down to a whole point, as WebKit's `scrollLeft` (iOS 17 has no offset scroll position, so a marker view at that offset is the scroll target). The views take the chart, the expanded state, a toggle action and `applyCount`; IN-07 and IN-08 supply the data, theme, catalog, units and the stored `expandShortChart`.
- **Scroll resets (`applyCount`):** the Cordova page sets `scrollLeft` to the opening position after every `applyWeatherData` (opening the tab, changing the place, a refresh, also with unchanged data), and at no other time; a tap on the expander keeps the position. The page that owns the charts keeps one integer and increments it each time it applies weather to the page (each complete Cordova `applyWeatherData`, as the Android `ForecastScope.scrolls` counts them; an apply that returns early does not count), and passes it to both views as `applyCount`. Each change scrolls the chart back to the opening position, whether or not the chart changed; a user's scroll stays until then, and changing `expanded` does not move it.
- **Without a scroll view:** `HourlyChartFrame` and `DailyChartFrame` show the same content and pinned parts at a given scroll offset; the screenshot tests render them, so no test or preview mode exists in the app.

### References and tests

| File | Contents |
| --- | --- |
| `Core/Tests/TWDomainTests/ChartReference/android/` | The Cordova scenes captured on the Android emulator (360×780, 384×832, 412×892 dp), copied by `tools/import_chart_reference.py` (provenance `provenance/chart-reference.json`) |
| `Core/Tests/TWDomainTests/ChartReference/ios/<WxH>/` | The Cordova iOS scenes at 375×667, 393×852 and 440×956 pt: every SVG element with its attributes and text, the rects of the header labels, legend, separators and expander, computed styles and scroll offsets (`kma-seoul` and `vc-london` at every size, eleven fixtures at 393×852) |
| `TodayWeatherTests/ChartReference/` | Captures of the Cordova iOS chart wrappers for `kma-seoul` at each size, at the opening position and both scroll ends (sRGB PNG), `captures.json` (scroll offsets and pixel sizes), the served response `kma-seoul.input.json` and `tolerances.json` |
| `provenance/chart-captures.json` | Build commit and recipe, the chart sources inside the built app compared with `client/`, simulator, runtime, user agent, WebView origin in each screenshot, served data and the SHA-256 of every capture file |

- `ChartSceneTests` (`swift test` and the scheme): the Swift scenes against every element, label, legend text and opening offset of both reference sets, within 0.02 pt; the Android set with the Android metrics, the iOS set with the iOS metrics. `ChartReferenceProvenanceTests` checks that every reference file is listed with its hash.
- `ChartScreenshotTests` (app-hosted): renders the charts with `ImageRenderer` at the capture's width, scroll offset and pixel scale (2 at 375×667, 3 otherwise) and compares them with the captures by the AN-05 metric (the share of pixels whose largest channel differs by more than 64 after a 3×3 blur, the mean difference and the height); each comparison passes within the value recorded in `tolerances.json` plus the Android margins (0.0015, 0.3, 0 px), which also says why. The render does not depend on the simulator model, so CI's iPhone 17 runs all three sizes; renders and difference images go to the app's `tmp/chart-compare/`. `ChartScrollTests` puts the live views in a window and checks that their scroll views open at the captured `scrollLeft`. `ChartApplyTests` keeps one view in a window, scrolls it to the end and checks that applying other weather with the same opening offset, or the same data again, returns both charts to the captured opening, and that toggling the expander keeps the position.
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

## App shell (IN-07)

The frame every screen shares (#2956): the rules in `TWDomain` `Shell/` (Foundation only), the state owner in `TWStorage`, the photo feed in `TWData`, the SwiftUI shell in `TodayWeather/Shell/`. The Cordova iOS build decides; the Android AN-07 shell is the port's starting point.

- **Start (`AppLaunch`, `RootView`):** the launch screen (`LaunchScreen.storyboard`: the `Splash` image with aspect fill on white, the layout of cordova-ios's `CDVLaunchScreen`) and then `SplashView` (the image filling the screen under a white status bar, as the Cordova splash shows it until the first view) stay until the Cordova migration has finished. `AppStartup` (IN-03) hands the migrated state to `AppLaunch.migrationFinished` (a `didSet` on its `state`), which creates the shell. `StartGate`: S01 shows while the stored `startVersion` is missing or below 1 (app.js L362-L367; IN-10 builds S01, `StartPlaceholder` stands in); otherwise the first tab follows the startup-page setting (`StartupPage.tab`: "0" Hourly, "1" Daily, "2" Locations, "3" Air, anything else Hourly).
- **Entry events (`EntryQueue`, `EntryEvent`):** the launch, a return from the background (Cordova's `resume`), notification taps and links are held until the migration has finished and then handled in arrival order, later ones at once. The app registers no URL scheme: the Cordova 1.1.x build registers none (only the Firebase one); IN-16 decides. IN-04 and IN-14 submit notification taps (`AppLaunch.shared.entries.submit(.notification(cityIndex:))`).
- **State (`AppStateHolder`):** the single owner of the app state for the UI from the end of the migration on. A change shows at once and is saved in order; each save writes the whole state after that change, one after the other (a chain of tasks, no continuations), so the file ends with the newest state; a failed save stays shown and is written with the next change. Other writers of the process use `update`, which returns once saved. IN-04's `PushSync`, which now reloads and rewrites the state file itself, should move its token and record writes to `AppLaunch.shared.holder.update { … }` when IN-04 and IN-07 meet, so the two never overwrite each other's changes.
- **Tabs (`TabBar`, `TabTaps`):** Locations, Hourly, Daily, Air with the iOS template's Ionicons (`tabs.html`: `ion-ios-star(-outline)`, `ion-ios-clock-outline`, `ion-ios-calendar-outline`, `ion-ios-cloud-outline`; the selected weather or air tab shows `ion-ios-reload`). A tap on the selected weather or air tab asks for a reload (`ShellModel.onRefresh`, IN-08) unless the previous weather or air tab tap was 700 ms or less before (`doTabForecast`; every such tap counts, the Locations tab never does). `onTabTap` lets IN-10 take a tap first (the start choice O02).
- **Side menu (S06, `SideMenu`):** full screen over the WebView's area, sliding in over 200 ms; rows in Cordova order (index.html L97-L171), the Korea-only rows for region KR, chevrons where the iOS template has them (also Units, Send feedback, Rate and About), the analytics, ad privacy, policy and terms rows as blocks, the version and the startup page, refresh interval and theme values. Rows that leave the menu close it first (`toggleLeft`); `ShellModel.onMenuRow` connects them (IN-12, IN-13, IN-15).
- **Popups (`Popup`, `IonicPopupView`):** one at a time, closed only by their buttons; iOS has no back button. Android-only behavior that is not built: the back-button exit confirmation O15 and the back-button handling of `controller.tabctrl.js` (registered only `if (ionic.Platform.isAndroid())`).
- **Themes (`Theme`, `ShellColors`):** light, dark, photo and old with the image folders of `theme.js` and the SCSS colors per tab: the old theme colors Hourly and Daily; the photo theme's Hourly and Daily headers are clear with outlined text; the menu has the theme's plain bar. The status bar shows `applyIOSStatusBar`'s color per theme and tab (it keeps the tab's color with the menu open) with light content, or dark content for the light theme (`styleDefault` is dark content on iOS 13 and later); the app's style is the application's (`UIViewControllerBasedStatusBarAppearance` false, `StatusBar.swift`).
- **Photo feed (`WeatherPhotos`, `WeatherPhotoFeed`):** loaded when the app opens and when a network comes back, like `loadWeatherPhotos`: attempts 2 s apart while none has answered (up to three, 20 s each; the first to settle decides, the others are cancelled), once per process after a success. The URL is the private build input `TW_WEATHER_PHOTOS_URL` (Info.plist `TWWeatherPhotosURL`); without it nothing is requested and the photo theme shows no photo, as Cordova builds from the template. IN-08 shows the photos.
- **Languages (`AppLanguage`, `ShellLocale`):** the WKWebView reports only the first system language, minimized (`en-KR` → `en-US`, `de-AT` → `de-DE`, `ja-JP` → `ja`, `zh-Hant-TW` → `zh-TW`), recorded from the Cordova build for twelve system settings (`Core/Tests/TWDomainTests/ShellReference/languages.json`). That tag picks one of the six catalogs as angular-translate does, gives `Util.region` (so English with region Korea shows no Korea-only rows) and the `Accept-Language` header (`ko-KR,ko;q=0.9`, `zh-TW,zh-Hant;q=0.9`, `ja`), which IN-08 sends. IN-03's migration region (`CordovaRegion`) reads `Locale.preferredLanguages` instead; the two differ for a language with another region (see the plan's open risks).
- **Layout:** the WebView's area starts under the status bar (`StatusBarOverlaysWebView` false); the rest of the top safe area (5 pt on a Dynamic Island iPhone) is added to the header bar, as Ionic's `env(safe-area-inset-top)`; the tab bar reaches the bottom edge with the home indicator's inset inside it; the side insets stay clear in the header and the tab bar; the keyboard covers the page without moving the layout (`KeyboardResize` false). Text follows Dynamic Type (labels, titles and menu rows grow; tab labels may take two lines; glyphs keep their size). `ShellView(banner:)` reserves the slot under the tab bar for IN-15.

### References and tests

| File | Contents |
| --- | --- |
| `TodayWeatherTests/ShellReference/shell-<lang>-<theme>-<tab>-{tabs,header,statusbar}.png` | The Cordova tab bar, header bar and status bar on each tab, in `ko-KR` and `en-US` and each theme, from the 393×852 pt simulator at scale 3 |
| `TodayWeatherTests/ShellReference/shell-<lang>-<theme>-menu.png`, `…-menu-statusbar.png`, `shell-<lang>-<theme>.json`, `shell-<lang>-splash.png`, `shell-captures.json` | The open menu, every part's rects, texts and computed styles, the launch image (scaled to points) and the manifest |
| `TodayWeatherTests/ShellReference/shell-tolerances.json` | The tolerance of every comparison, the masks, the reasons and the measured sensitivity |
| `Core/Tests/TWDomainTests/ShellReference/languages.json` | `navigator.language(s)` and `Accept-Language` of the Cordova WebView for twelve system language settings |
| `provenance/shell-captures.json` | Build commit and recipe, the shell sources inside the built app compared with `client/`, simulator, environment and the SHA-256 of every reference file |

- `ShellLogicTests`, `AppLanguageTests`, `EntryQueueTests` (`TWDomainTests`), `AppStateHolderTests` (`TWStorageTests`) and `ShellReferenceProvenanceTests`: `swift test` and the scheme.
- App-hosted: `ShellTests` (tab switching and the reload rule, the startup page, the menu opening and closing and its rows, closing a popup; driven through the views' accessibility elements as a tap reaches them), `LaunchContinuityTests` (entry events during the migration are handled after it, in order; the launch image until then; S01), `WeatherPhotoFeedTests` (attempt timing on a shortened gap, sharing, retry), `ShellScreenshotTests` (73 comparisons with the AN-05 metric: tab bar and header bar on every tab, the menu, in each theme and both languages, and the launch image; header bars without the page's own buttons; plus each hairline and every status bar color) and `ShellFitTests` (iPad portrait and landscape, Split View third and half, a small Stage Manager window, iPhone SE and landscape, in all six catalogs at the default size and `xxxLarge`: tab items and menu rows inside the window, tab labels in at most two lines with room for them; and one live shell whose window turns from portrait to landscape and resizes to Split View and Stage Manager sizes, menu open). The suites that host windows run serialized (`HostedShellTests`). iPadOS 26.5 rejects a programmatic orientation change of the test host's scene in its windowing mode (`UISceneErrorDomain` 101), so the rotation is a change of the window's frame; a rotation of the simulator itself was not exercised.

### Recapturing

After a change to the Cordova shell (the shell sources in `provenance/shell-captures.json` no longer match `client/`), on the owned simulator `twios_cap_16` (macOS with Xcode, Node, network for npm and Bower):

```sh
sh ios/tools/chart-reference/build-cordova.sh ios/build/shell-reference http://127.0.0.1:18454
python3 ios/tools/shell-reference/capture.py languages 517DC815-4EF1-4EC7-835C-FAD594AFB4C5 ios/build/shell-reference/TodayWeather.app
for lang in ko-KR en-US; do
  python3 ios/tools/shell-reference/capture.py run 517DC815-4EF1-4EC7-835C-FAD594AFB4C5 ios/build/shell-reference/TodayWeather.app $lang
done
python3 ios/tools/shell-reference/capture.py provenance ios/build/shell-reference/TodayWeather.app
```

`capture.py` refuses other simulators, erases the owned one, sets the language, installs a copy of the build with `capture.js` injected and drives the app's own services: the `kma-seoul` response served by the local fixture server as the place 회현동, S01 closed as StartCtrl closes it, each theme in turn. The Ads SDK is not started (no UMP form or ATT prompt over the page, and no banner). It fails when a request leaves the Mac. Then run the tests and update `shell-tolerances.json` with the measured values (the test prints them) only for an explained change. Delete `ios/build/shell-reference/` afterwards; the Cordova build also leaves an Xcode DerivedData folder `App-*`.

## Weather data and screens (IN-08)

The weather of the saved places and the pages S03 (Hourly) and S04 (Daily) (#2957): the request rules in `TWDomain` `Forecast/`, the client, cache and loading in `TWData`, the SwiftUI pages in `TodayWeather/Weather/`. Ported from the Android AN-08 pages (`WeatherRequests`, `WeatherRepository`, `WeatherSession`, `ForecastScope`, `ForecastPage`, `WeatherPage`) and checked against the Cordova iOS build.

- **Request (`WeatherRequests`, `TWDomain`):** `getWeatherByGeoInfo`: `/weather/v000903/coord/{lat},{long}` when the latitude is truthy (JavaScript's number text), else for an address the KMA town route `/v000903/kma/addr/{first}/{second}/{third}` (`대한민국 ` added when missing), else the free-form `/weather/v000903/addr/{address}`, which the gateway answers with HTTP 501; then the units in `Units.getAllUnits()` order and `airForecastSource=kaq`. A place with neither fails without a request (`invalid_input`). The URL is percent-encoded as WebKit encodes it (`requestURL`). The header `Accept-Language` is the WKWebView's (`ShellLocale.acceptLanguage`, IN-07: `ko-KR,ko;q=0.9`). The server is the private build input `TW_SERVER_URL` (Info.plist `TWServerURL`); without it nothing is requested and a load fails as a request without a server does.
- **Attempts (`firstSettled`, V08):** `_retryGetHttp`: the next attempt 2 s after the previous while none has settled, up to three, each ending after 10 s; the first to settle decides, an error status (the 501 too) or a timeout included, so a fast failure sends one request. The others are then cancelled; Cordova let them run and could still start an attempt after the promise settled (A06, recorded in the golden). The clock is injected (`AppClock`), so the tests run the timers on a virtual clock.
- **Weather (`WeatherRepository`, `@MainActor`):** entries by place (`current`, `coord:lat,long`, `addr:…`); only the latest request of a place counts (an older answer, a failure too, is `superseded`), and a response applies to the place that requested it whatever is selected when it arrives (V09, the A01 fix of AN-06). `updateCity`: fields a response leaves out keep their value (A02); the current position takes the response's name, country, address and location, a saved place without a location takes the response's. The ten-minute gate (`canLoadCity`) lives in memory. Entries are cached in `Library/Caches/weather` (written atomically), so a cold start shows the last weather while it loads. The request log shows the route publicly and the URL privately.
- **Loading (`WeatherSession`):** TabCtrl's `loadWeatherData` and `reloadEvent`: the launch (`init`), a tap on the selected weather or air tab (IN-07's `onRefresh`), the retry's OK and the refresh timer load at once (`reloadCity`); a return to the foreground (`resume`) and a return from search wait for the gate; the refresh-interval setting restarts the timer only. The timer (`setRefreshTimer`, minutes of `refreshInterval`, none for "0") restarts with every load. A failure opens the retry confirmation O03 (`LOC_ERROR`, `LOC_FAIL_TO_GET_WEATHER_INFO`, 닫기 / 확인), which holds other reloads until answered; OK reloads. The swipes and arrows move between the enabled places (`PlaceIndex`) and load through the gate. A response saves what it changed in its place and a photo from the feed (`findWeatherPhoto`) through the `AppStateHolder`. `applies` counts TabCtrl's `applyEvent`s; the page applies the selected place on each. The current position's own lookup (`updateCurrentPosition`) and the start choice O02 are IN-10's: until then a current position loads by its saved location.
- **Pages (`ForecastScope`, `ForecastPage`, `WeatherScreens`, `WeatherPageView`):** `ForecastScope` is ForecastCtrl's scope for one visit (a new one each time a weather tab opens), with the controller's early returns and the values an apply leaves from an earlier place; the corpus (`forecast.json`, 58 visits) runs the controller itself. `ForecastPage` is what the templates show: the header block (temperature with its raised `˚`, sky image, summary lines broken as WebKit breaks them), the hourly AQI forecast or current air, the detail weather rows (UV, the pollen row and its popup), the detail AQI rows (station, times, the standard and forecast-source links), S04's daily AQI and the three days' details, and the data-source notice (Dark Sky image or the Visual Crossing link). The charts are IN-05's at the opening position after each complete apply (`scrolls`). The header bar shows the place's name, the current position's location glyph (`location_on`/`location_off` by the when-in-use authorization; a tap opens the app's settings) or, while the selected place loads, the bubbles spinner (O17, `.spinner` #444), and the bell and share buttons of the iOS template (IN-14 and IN-16 connect them). Taps: the air summary and cells open the Air tab (IN-09 adds the pollutant), the standard opens the units page (IN-12), the forecast source its description (kaq, airkorea), the notice the provider's page.
- **Layout:** the Cordova iOS measures (`WeatherMetrics`): the header block 64 pt above its content (`.platform-ios`), cards with 10 pt padding and 5 pt apart, table rows 24.516 pt with the image at the row's bottom, text on WebKit's `line-height: normal` baselines (`CssLine`: each used font's ascent and descent rounded up). Text follows Dynamic Type (sizes scale with `body`; rows and the header block grow); the charts keep the Cordova sizes, as IN-05 draws them. Colors per theme (`WeatherColors`): light, dark, old (white text over the grade colors) and photo (the place's photo under the header with its veil, `img/bg.png` when it does not load).

### References and tests

| File | Contents |
| --- | --- |
| `TodayWeatherTests/ForecastReference/<page>-<block>.png` | The blocks of the Cordova iOS pages at 393x852 pt and scale 3: `kma-seoul-hourly`, `-daily` (회현동 alone), `vc-london-hourly`, `-daily` (런던 added after it: the arrows), `kma-seoul-hourly-expanded-1` (the chart with its detail rows); `o03-weather.png` (O03) |
| `TodayWeatherTests/ForecastReference/forecast-captures.json`, `forecast-<fixture>.input.json`, `forecast-tolerances.json` | Manifest (blocks, the header bar's rects, the places, O03's texts), the served responses, and each block's tolerance with the reasons and the measured sensitivity |
| `Core/Tests/TWDomainTests/ForecastReference/<page>.json` | Every element of every block: rect, text, image, font, color |
| `Core/Tests/TWDataTests/Golden/weather-timed.json` | `getWeatherByGeoInfo` on a virtual clock (attempt times, settle time and outcome) and `canLoadCity` at given times, from the Cordova code in JavaScriptCore (`tools/weather/generate.py`) |
| `provenance/forecast-captures.json` | Build commit and recipe, the page sources inside the built app compared with `client/`, the run's simulator and environment, and the SHA-256 of every reference file |

- `TWDomainTests`: `WeatherRequestsTests` (the 15 URL cases of `requests.json`, JavaScript number text, WebKit's encoding), `ForecastScopeTests` (58 visits, TabCtrl's helpers, the place selection), `ForecastPageTests` (the text, images and grade colors of every captured element; the template rules the captures do not reach), `ForecastReferenceProvenanceTests`.
- `TWDataTests` (virtual clock `VirtualClock`, server double `ScriptedWeatherHTTP`): `WeatherRequestTests` (the ten V08 cases of the golden, the request's path, units and `Accept-Language`, the address fallbacks and the 501, no server, the gate cases of the golden, late responses, A02 and the cache) and `WeatherSessionTests` (senders and the gate, the refresh interval and its restart, O03, swipes, a late response saved with its place, photos).
- App-hosted: `WeatherScreenshotTests` (20 blocks by the AN-05 metric within `forecast-tolerances.json`; the header block with the shell's bar over it), `WeatherTabTests` (the launch and a tab tap reload with the WebView's header, the spinner, O03 with the captured texts and its OK, the expander stored, the pollen and forecast-source popups, the air link, a late response) and `WeatherFitTests` (every catalog at the default size and `xxxLarge`, at 375, 393, 834, 1024 and 1366 pt: the page keeps the window's width, summary lines fit the main box, detail rows fit the window).
- Manual pages 3–9: page 3 is the header block and the hourly cards, page 4 the expanded chart, page 7 the daily page; the chart ends of pages 5, 6, 8 and 9 are IN-05's `ChartScreenshotTests` at 393x852. O03 is compared by its texts and buttons; its look is IN-07's popup.

### Recapturing and regenerating

After a change to the Cordova weather pages (the page sources in `provenance/forecast-captures.json` no longer match `client/`), on the owned simulator `twios_cap_16`:

```sh
sh ios/tools/chart-reference/build-cordova.sh ios/build/forecast-reference http://127.0.0.1:18455
python3 ios/tools/forecast-reference/capture.py run 517DC815-4EF1-4EC7-835C-FAD594AFB4C5 ios/build/forecast-reference/TodayWeather.app
python3 ios/tools/forecast-reference/capture.py provenance ios/build/forecast-reference/TodayWeather.app
```

`capture.py` refuses other simulators, erases the owned one, sets ko-KR, installs a copy of the build with `capture.js` injected, and drives the app's own services: the corpus responses served by the local fixture server, 회현동 then 런던 added, each page opened afresh and cut block by block (a block taller than the screen is stacked from screens, `blocktool.swift`), the expander through the controller, and O03 after a failed reload (the server answers 503). The Ads SDK is not started. It fails when a request leaves the Mac. Then run the tests and update `forecast-tolerances.json` with the measured values (the test prints `FORECAST-COMPARE` lines) only for an explained change. Delete `ios/build/forecast-reference/` and the build's DerivedData folder `App-*` afterwards.

After a change to `service.weatherutil.js` or `service.weatherinfo.js`, run `python3 ios/tools/weather/generate.py` (macOS `jsc`; needs `client/` and the Git history) and commit the golden; CI fails on a stale copy.

### Against production

`TW_SERVER_URL` in the ignored `ios/Private.xcconfig` (until IN-04's `Support/App.xcconfig` includes it, build with `-xcconfig Private.xcconfig`); the build then sends read-only weather GETs to the legacy server. The IN-08 run used the owned `twios_dev_in07` simulator with an injected state (an unsigned build has no App Group container): 회현동 and 런던, each on Hourly and Daily, one GET per launch.

## Air quality (IN-09)

The Air tab, S05 (#2958): AirCtrl's scope and the template in `TWDomain` `Air/`, the SwiftUI page in `TodayWeather/Air/`, connected to IN-08's loading in `WeatherScreens`. Ported from the Android AN-09 page (`AirScope`, `AirPage`, `AirChart`, `AirScreen`) and checked against the Cordova iOS build.

- **Scope (`AirScope`):** a visit of AirCtrl (`/tab/air`, `cache: false`): `open` on the pollutant of the link (`?code=`, else the overall index), `apply` for the selected place, `setCode` and `setStation` for the detail and station cells (each brings the page to the top, `scrolls`), `applyEvent` for TabCtrl's `applyEvent` (back to the first station). `_applyWeatherData` runs in one `try`: it stops at the first value it cannot read, and what it did not reach keeps an earlier place's value (A16); a missing chart slot is dated in the device's zone with JavaScriptCore's date reading (`Warnings.jsDate`) and wall-clock `setHours`. `airUnit` is TabCtrl's standard; a change on the units page goes to the visit as it is (`changeAirUnitEvent`).
- **Page (`AirPage`, `AirChart`):** the main box (title, the grade at `bigFontSize × 0.55` or the value at `bigFontSize` with ㎍/㎥ or ppm, the grade line with the face and the advice, the current weather), the gauge (the standard's bands with `~ bound`, the value label placed by `getLabelPosition` from whole-point `offsetWidth`s), the chart title, the daily, detail, info (station, publication, standard, forecast time, forecast source) and station cells; values as sent (no rounding; a station value of 0 shows `-`). `AirChart` is ngAirChart's SVG: 24 slots on D3 bands, `nice` scale, a tick per date with a label every three hours and the date under 0시, the current hour's 2 pt line, bars in the grade colors.
- **Screen (`AirPageView`, `AirChartView`, `AirStyle`):** the Cordova iOS measures: the header block (64 pt above, `headerHeight` at least), the gauge 4 pt in from the card's sides, cards with 10 pt padding and 5 pt apart, the detail and station cells (`border-spacing` 10, at least 110 pt, stretched to the card or scrolling sideways), the info card as IN-08's detail AQI rows. The grade line is drawn with CoreText (each piece on its own baseline: the face's box is the 24 pt line, `vertical-align: bottom`); the chart with `Canvas`, its axis on whole device pixels (`crispEdges`). Colors: the dark theme has its own (`.dark-theme.air`); the photo and old themes show the light page. Text follows Dynamic Type (the header block, gauge and cells grow; the chart keeps the Cordova sizes).
- **In the shell (`WeatherScreens`):** a new visit each time the Air tab opens; each of the session's `applies` is an `applyEvent` (a load, a reload by a tap on the selected Air tab, a swipe or the arrows, a response). `goAirInfoPage(code)` on S03 and S04 sets the link's pollutant, which stays while the weather tabs change the path and is cleared by the Locations tab (`navigation` of `air-captures.json`, recorded from the Cordova build). The current weather opens S03 (`goWeather`), the standard row the units page (IN-12), the forecast source its description O08 (`popUpAirForecastInfo`, kaq and airkorea only). The location glyph is inert on S05 (`switchToLocationSettings` is ForecastCtrl's, A10). The page stores nothing: the session saves responses through the `AppStateHolder`.

### References and tests

| File | Contents |
| --- | --- |
| `TodayWeatherTests/AirReference/<state>-<block>.png` | The blocks of the Cordova iOS S05 at 393x852 pt and scale 3 (0 the header block with the bar, 1 the gauge, then each card) in seven states: `kma-seoul` (manual page 10, and page 12 at the end), `kma-seoul-pm25` (page 11), `kma-seoul-station-1`, `kma-seoul-o3` (`?code=o3`, no forecast), `kma-seoul-dark`, `vc-london` (second place), `kma-jeju-no-air` (the scale only); `o08-airkorea.png` |
| `TodayWeatherTests/AirReference/air-captures.json`, `air-<fixture>.input.json`, `air-tolerances.json` | Manifest (states, places, blocks, O08's texts, the navigation of a pollutant chosen on S03), the served responses, and each block's tolerance with the reasons |
| `Core/Tests/TWDomainTests/AirReference/<state>.json`, `o08-airkorea.json`, `navigation.json` | Every element of every block (rect, text, image, font, color, borders), the scope values, the gauge's widths and the chart's SVG |
| `Core/Tests/TWDomainTests/AirReference/air-scale.json` | V32: `setAirUnit`, `grade2Color`, `getSentimentIcon` and `getLabelPosition` of the Cordova sources run in the macOS JavaScriptCore shell (`tools/air/generate.py`, with the sources' commits and hashes) for every standard, pollutant, grade and the iOS gauge widths |
| `provenance/air-captures.json` | Build commit and recipe, the S05 sources inside the built app compared with `client/`, the run's simulator and environment, and the SHA-256 of every capture file |

- `TWDomainTests`: `AirScopeTests` (the 32 visits and 97 steps of `air.json`, station switching, the page without air data, slot dating in Seoul and New York checked in JavaScriptCore), `AirScaleTests` (V32 through the page model: bands, colors, faces and 4,160 label positions), `AirPageTests` (every captured element of the seven states, the label position at the captured widths, the template rules), `AirChartTests` (every tick, label, date and bar of the five captured charts within 0.02 pt; D3's rules), `AirReferenceProvenanceTests`.
- App-hosted: `AirScreenshotTests` (40 blocks by the AN-05 metric within `air-tolerances.json`), `AirTabTests` (stations and a reload back to the first, the link's pollutant across the tabs as captured, O08 with the captured texts, the weather link, a response without air data), `AirLiveTests` (taps on station and detail cells in the live shell) and `AirFitTests` (every catalog at the default size and `xxxLarge`, at 375, 393, 834, 1024 and 1366 pt; every theme's page colors).

### Recapturing and regenerating

After a change to the Cordova S05 (the sources in `provenance/air-captures.json` no longer match `client/`), on the owned simulator `twios_cap_16`:

```sh
sh ios/tools/chart-reference/build-cordova.sh ios/build/air-reference http://127.0.0.1:18456
python3 ios/tools/air-reference/capture.py run 517DC815-4EF1-4EC7-835C-FAD594AFB4C5 ios/build/air-reference/TodayWeather.app
python3 ios/tools/air-reference/capture.py provenance ios/build/air-reference/TodayWeather.app
```

`capture.py` uses the forecast tool's fixture server, simulator preparation, block cutter and request check (`tools/forecast-reference/capture.py`): it refuses other simulators, erases the owned one, sets ko-KR, installs a copy of the build with `capture.js` injected, adds the corpus places through the app's own services and opens S05 afresh for each state; the cells' taps go to their handlers, the tab taps carry `isIonicTap`. It fails when a request leaves the Mac. Then run the tests and update `air-tolerances.json` with the measured values (the test prints `AIR-COMPARE` lines) only for an explained change. Delete `ios/build/air-reference/` and the build's DerivedData folder `App-*` afterwards.

After a change to `controller.tabctrl.js`, `controller.air.js` or `service.weatherutil.js`, run `python3 ios/tools/air/generate.py` (macOS `jsc`; needs `client/` and the Git history) and commit the golden; CI fails on a stale copy.

### Against production

`ProductionAirTests` (app-hosted) runs only with `TEST_RUNNER_TW_PRODUCTION_AIR=1` in a build with the private `TW_SERVER_URL` (`-xcconfig Private.xcconfig`); otherwise it is skipped, as in CI. It sends one read-only GET for 회현동 through the app's client, opens the Air tab in the live shell, taps the second station and checks that the shown observation changed; it writes the request paths (no host) and the page before and after the tap to the app's `tmp/air-production/`.

## Private inputs

The build and the tests run without private inputs. They stay outside Git (ignored by `ios/.gitignore`): the Firebase configuration `GoogleService-Info.plist` of the existing Firebase iOS app (IN-03, IN-04; without it the app does not configure Firebase), and a `Private.xcconfig` with the server URL `TW_SERVER_URL` (IN-04, IN-08; Info.plist `TWServerURL`, empty without it), the weather photo feed `TW_WEATHER_PHOTOS_URL` (IN-07; Info.plist `TWWeatherPhotosURL`, empty without it), the AdMob and Places identifiers (IN-08, IN-10, IN-15) and release signing (IN-19).

## Data migration from the Cordova app

The native app replaces the Cordova app as an update with the same bundle ID, so it inherits the Cordova data container and App Group. On every start (`AppStartup`, called from `application(_:didFinishLaunchingWithOptions:)`, so also when iOS starts the app in the background) it turns analytics off and then runs `MigrationRunner` (`TWStorage`). The first successful run builds `Library/Application Support/TodayWeather/app_state.json` (`AppState`, written atomically) from the Cordova storage; later runs return the stored state unchanged. The migration only reads the Cordova storage: nothing there is changed or removed. Until protected data is available (before the first unlock after a restart) the run waits for `protectedDataDidBecomeAvailableNotification`. Absence and unreadability are kept apart: only a path that does not exist counts as absent (no WebKit storage at all, as after an update from 1.0.10; no suite file; no state file). A WebKit directory, `origin` file, database or log, the suite's preferences file or the state file that exists but cannot be read now (permissions, data protection), and a missing App Group container, stop the run without writing anything (`CordovaSources.SourceError.unavailable`); the run is tried again when protected data becomes available and at the next start. A database copy that is no SQLite `localStorage` database is recorded and the suite is used; a corrupt state file is replaced by a new migration.

- **Sources, per key:** the WKWebView `localStorage` of origin `app://localhost` first, then the App Group suite `group.net.wizardfactory.todayweather` (`cordova-plugin-app-preferences`). `localStorage` holds the newest values: the Cordova app writes it first and mirrors it to the suite asynchronously. A value that does not parse falls back to the next source. Values are parsed as strict JSON by `TWModel.JSONValue` (what `JSON.parse` reads back from `JSON.stringify`), which keeps member order and number texts; stored strings and keys are compared by UTF-16 code units (`JSString`), as the Cordova code compares them, so texts that differ only by Unicode normalization stay apart. The state file is written through the same type. The Cordova app stores JSON text as strings in the suite; the plugin can also have stored numbers and booleans (`NSNumber`) and UTF-8 `NSData`, which are read as the text the plugin's `fetch` returns. Data that is not UTF-8, and property-list types the plugin never writes, count as malformed. Keys starting with `_` (the rollback hand-back marker) are not read.
- **How `localStorage` is read:** from WebKit's files, without a web view (`WebKitLocalStorage`). The database and its write-ahead log are copied to a temporary directory, and the copy is read with SQLite (`ItemTable`, UTF-16LE values). A `WKWebView` serving `app://localhost` was not used: it needs the main thread and a web content process, which a background start may not get, and WebKit would open, and could migrate, the files it serves. Layouts:

  | Layout | Path under the data container | Evidence |
  | --- | --- | --- |
  | Per origin (WebKit of iOS 17 and later) | `Library/WebKit/<bundle id>/WebsiteData/Default/<salted top origin>/<salted origin>/LocalStorage/localstorage.sqlite3` and `-wal`; the `origin` file next to `LocalStorage/` names `app://localhost` as both origins | Captured from the Cordova 1.1.1 build on the iOS 26.5 simulator; the newest writes were only in the `-wal` file |
  | Per origin, device path | The same under `Library/WebKit/WebsiteData/` (WebKit adds the bundle ID only for processes without their own container) | WebKit source; not observed on a device |
  | Single directory (WebKit before iOS 17) | `Library/WebKit/WebsiteData/LocalStorage/app_localhost_0.localstorage` | WebKit source. WebKit moves it into the per-origin layout when the origin's storage is next opened, so it remains when the Cordova app did not run after an update to iOS 17 or later |

  The per-origin directories are found by their `origin` files, not by the salted hashes. No iOS 17 or 18 simulator was run (Xcode 27 here has the iOS 26.5 runtime only); by WebKit's history they use the per-origin layout.
- **Rules:** those of the Android `CordovaMigration` (`android/README.md`, "Data migration from the Cordova app"):
  - `cities` keep their geography, flags and photo. Weather caches are dropped; a non-object entry keeps its slot as a disabled place; coordinates must be finite and within ±90/±180, otherwise the place is address-only.
  - `cityIndex` follows `loadCities`: missing or out of range gives the first enabled place.
  - `units` follow `Units.loadUnits`: missing members, `aircn` and unknown values take the region defaults. The region is `Util.region` of the iOS app: the last part of the first preferred language with a region, otherwise `KR`.
  - `settingsInfo` falls back to the standalone `localStorage` keys `startupPage` and `refreshInterval`, then to `0`/`0`/`light`; `startVersion` falls back to `guideVersion`.
  - `pushData2` records are kept as stored when they have integer `cityIndex` and `id`, a boolean `enable` and the category's real ISO times and seven-day array; others are dropped and counted. Records naming no place are kept (A24). Legacy `pushData` converts like `loadOldPushInfo` (07:00–22:00 local wall time on the migration day) and sets `needsAlertIntro`.
  - An update straight from 1.0.10 has no `app://localhost` storage and migrates from the suite alone. The standalone keys and `guideVersion` never reached the suite, so their defaults apply.
  - `MigrationInfo` records each key's source and outcome (`migrated`, `partial`, `default`, `malformed`, `legacy`, `absent`; `twAnalyticsConsentV1` is `ignored`) and the database read.
- **Device-Id:** `DeviceIdentity` reads `CDVUUID` from standard `UserDefaults`, where cordova-plugin-device 3.0.0 (`CDVDevice.uniqueAppInstanceIdentifier`) keeps `device.uuid`. Only when it is absent does it store `identifierForVendor.uuidString` there, as the plugin does; when the standard preferences file exists but cannot be read, no identifier is created.
- **Analytics:** off until the user opts in (IN-15); the Cordova opt-in does not carry over. `AnalyticsGuard` calls `setAnalyticsCollectionEnabled(false)` and denies every consent type before `FirebaseApp.configure()` and again after it; `configure` runs only when `GoogleService-Info.plist` is in the bundle. On the simulator this set the SDK's persisted flag (standard `UserDefaults` `/google/measurement/measurement_enabled_state`, `1` after the Cordova opt-in) to `2` and the stored consent (`APMAnalyticsSuiteName`) to denied, already before `configure`. `Support/Info.plist` repeats the Cordova build's defaults, all false: `FIREBASE_ANALYTICS_COLLECTION_ENABLED`, the four `GOOGLE_ANALYTICS_DEFAULT_ALLOW_*` keys, `GOOGLE_ANALYTICS_IDFV_COLLECTION_ENABLED`, `GOOGLE_ANALYTICS_REGISTRATION_WITH_AD_NETWORK_ENABLED` and `FirebaseAutomaticScreenReportingEnabled`. The product is `FirebaseAnalyticsCore`, the variant the Cordova build uses: it leaves out the ad-ID (`IdentitySupport`) and on-device-conversion libraries.

`TWStorageTests` (`swift test`, also in the scheme) cover valid, partial, malformed, suite-only and legacy inputs, canonically equivalent keys and strings, record times with non-ASCII digits (dropped and counted, as Kotlin's ASCII `\d` does), sources that exist but cannot be read, each layout, the read-only access and a second run. Fixtures are under `Core/Tests/TWStorageTests/Fixtures`: `containers/simulator` and `suites/current.plist` were captured from the seeded Cordova app, `containers/device` holds the same files at the device path, and `tools/upgrade/make_fixtures.py` writes the others.

### Upgrade test (simulator)

```sh
ios/tools/upgrade/build-cordova.sh ios/build/upgrade http://127.0.0.1:18452
ios/tools/upgrade/run-upgrade-test.sh <tw_* simulator udid> ios/build/upgrade/TodayWeather.app ios/build/upgrade/run-localStorage localStorage
ios/tools/upgrade/run-upgrade-test.sh <tw_* simulator udid> ios/build/upgrade/TodayWeather.app ios/build/upgrade/run-suite suite
```

`build-cordova.sh` builds the Cordova 1.1.1 test app from `client/` at `HEAD` in a temporary directory (`git archive`; needs Node, CocoaPods and network for npm, Bower and the pods): `npm ci`, Bower, Sass, `make-client-config.mjs` with `TW_SERVER_URL` set to the local recorder, a generated `GoogleService-Info.plist` of a Firebase project that does not exist, `cordova platform add ios` and `cordova build ios --emulator` with `IPHONEOS_DEPLOYMENT_TARGET=15.0` (Xcode 27 rejects the 12.0 of the ad pods). It keeps only the `.app` and `build-cordova.json` (commit and tool versions).

`run-upgrade-test.sh` refuses simulators not named `tw_*` and erases the one it gets. It then:

1. starts `recorder.py` on `127.0.0.1:18452`, installs a copy of the Cordova app with `seed-cordova.js` as its first script, and seeds places, units, settings, alarms (with a stored FCM token) and an analytics opt-in through the app's own services (`WeatherInfo`, `Units`, `TwStorage`, `Push`, `Monetization`);
2. requires, before the update, the opt-in in the Firebase SDK (persisted flag `1`, an event counted), `CDVUUID` equal to `device.uuid` and the state in both stores; the `suite` run then deletes `Library/WebKit`;
3. builds the native app for testing, signed for the simulator with its App Group entitlement, adds a dummy `GoogleService-Info.plist` to a copy of the products, and runs `TodayWeatherTests` twice over the Cordova install (first start, restart). `CordovaUpgradeTests` compares the migrated content with the seed (places with name, address, flags and coordinates, `cityIndex`, every unit, settings, the alarm and alert records, `startVersion`, `Device-Id`, the source of every key), checks that the sources are kept, that a second run changes nothing and that analytics is off. These five tests are skipped without the seed, so the script reads each phase's result bundle (`xcresulttool`) and fails unless all five ran and passed; the host checks below do not repeat the content comparison;
4. checks on the host (`check_upgrade.py`, results in `summary.json`): the state file unchanged by the restart, the SDK's persisted flag off and consent denied, its event counters (`google-app-measurement.sql`) unchanged, the suite and WebKit files byte-identical, and, after further launches with Firebase Analytics debug logging (up to three, until the SDK reports debug logging on, which it does not always do on the first), "Analytics collection disabled" and no "Logging event" in any of their logs.

No request may reach production. The Cordova build's server URL is the recorder, and `seed-cordova.js` reports every request the page starts and sends any request for a host other than this Mac to the recorder instead (one was seen: `maps.googleapis.com/maps/api/mapsjs/gen_204`). The test fails on a request for a TodayWeather host, or for an API path anywhere but the recorder. Limits: requests of native SDKs are not intercepted. With the dummy configuration they cannot reach the production Firebase project (the native app's Firebase Installations call was answered `400 API key not valid`), and the Cordova build uses Google's test ad units. The analytics observations read SDK internals (persisted flag, consent store, event counters) of FirebaseAnalytics 13.1.1 on the iOS 26.5 simulator; a later SDK can move them, which the checks before the update would reveal.
