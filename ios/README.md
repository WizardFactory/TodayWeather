# TodayWeather for iOS (native)

Swift and SwiftUI replacement of the Cordova app in `client/`, tracked in #2948. It ships as an update of the App Store app `net.wizardfactory.todayweather` and uses the legacy server API as it is. The work is split into sub-issues IN-01 to IN-19 (#2950–#2968); see the [plan](../plans/ios-native.md) and the [spec](../specs/ios-native.md).

The iOS build never reads `client/`, `android/`, `tw.ios/`, `ta.ios/` or `applewatch/`. Images, translations, the town list, fonts and icons are copied into `ios/` by an import tool, with a provenance record.

## Layout

| Path | Contents |
| --- | --- |
| `TodayWeather.xcodeproj` | The app target `TodayWeather` and the app-hosted test target `TodayWeatherTests`. Their folders are folder-synchronized groups: adding a file there needs no project edit. |
| `TodayWeather/` | The SwiftUI app and its asset catalog (app icon, launch image). |
| `Support/` | The app's `Info.plist` additions (merged into the generated one), its entitlements (App Group, `aps-environment`) and `App.xcconfig` (the app target's build settings, which include the private `Private.xcconfig`). |
| `TodayWeatherTests/` | Tests that run inside the app on a simulator. |
| `Core/` | Local Swift package. `TWModel` and `TWDomain` use Foundation only (no UIKit or SwiftUI), so they also run with `swift test` on macOS. `TWData` (API client), `TWStorage` (state and the Cordova migration) and `TWResources` (the copies from `client/`). |
| `provenance/` | Source path, last commit and hashes of every copied file. |
| `tools/` | Development tools. They may read `client/` or `android/` when they regenerate copies or build test inputs; the Xcode build does not. |

Bundle ID `net.wizardfactory.todayweather`, deployment target iOS 17.0 (decided on #2948), iPhone and iPad. Swift Package Manager dependencies are pinned by the committed `TodayWeather.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`: Firebase 13.1.1, products `FirebaseAnalyticsCore` (IN-03) and `FirebaseMessaging` (IN-04).

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

## Private inputs

The build and the tests run without private inputs. They stay outside Git (ignored by `ios/.gitignore`): the Firebase configuration `GoogleService-Info.plist` of the existing Firebase iOS app (IN-03, IN-04; without it the app does not configure Firebase and gets no FCM token), and `ios/Private.xcconfig`, which `Support/App.xcconfig` includes when it exists. It sets the legacy server URL `TW_SERVER_URL` (IN-04; written into `Info.plist` as `TWServerURL`; without it the app sends nothing to the server) and later the AdMob and Places identifiers (IN-08, IN-10, IN-15) and release signing (IN-19). In an xcconfig `//` starts a comment, so the URL is written `TW_SERVER_URL = https:/$()/<host>`.

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

### Push re-registration

After the update the server keeps sending each user's alarms and alerts because the native app registers them again with the same `Device-Id` (gate G1, push part; IN-04, #2953). It does what the Cordova `Push` service does on iOS:

- **The model:** the native app replays the Cordova `Push` service's timeline (`TWData.PushSync`, one actor). Its events are the open, a token that arrives, the list post that the open schedules, and a reply. Each is handled on the actor from reading the state to starting its requests, without suspending, so events never interleave. Requests are started as `$http` starts them and are not awaited before the next event: a slow or failed reply holds nothing back and changes nothing (Cordova only logs replies). The 3-second list post of `loadPushInfo` (`setTimeout`) is due 3 seconds after the open began, on an injectable clock, whatever is in flight then. The token is stored when its replacement is sent, as the Cordova token callback stores it.
- **When the app is opened** (the first time the process becomes active, after the migration; once per process like the Cordova web page, so not for a start in the background for a push or a background task until the user opens the app; `AppStartup`, `PushService.open()`): queued tokens first, then repair the current-position records and records whose `location` has no `lat` from the place list (`loadPushInfo`), replace a changed FCM token on the server (`PUT /v000903/push` with `newToken`/`oldToken`; a first token also posts the list), and when the post is due, post the whole list again (`POST /v000903/push-list`) with the token stored then, when there is one. The token at the open is the one the Firebase Messaging SDK holds (`Messaging.fcmToken`); a token that arrives before the post is replaced at its arrival, so the post carries it, also when its `PUT` failed; one that arrives after the post is only replaced (a first token also posts the list).
- **Requests** (`TWStorage.PushRegistration`, Foundation only): bodies as `_makePostObj` builds them, with `type: "ios"`, the `Device-Id` and `uuid` of `CDVUUID`, `cityIndex`, `id`, category, `enable`, place info, units with `airForecastSource`, `timezoneOffset`, `package` `todayWeather`, the app version, the token, times as UTC seconds of day (an alert whose start equals its end ends one local minute earlier, with JavaScriptCore's daylight-saving rule), and the headers of the Cordova `$http` calls (`Content-Type: application/json` and `Device-Id`; the list post also `Accept-Language`, `navigator.language`; the transport adds Angular's default `Accept: application/json, text/plain, */*`). Every path carries `v000903` (#2948).
- **A token that changes while the app runs** (`MessagingDelegate`) is first stored in `PushTokenQueue` (`Library/Application Support/TodayWeather/push_tokens.json`, in order of arrival), then handled as an event (`PushSync`). When its replacement is sent, the entry is marked with the token it replaced and the state takes the new token; the entry is removed when the reply arrives (failed or not: Cordova does not retry). Tokens left by an earlier process enter the timeline when a process starts (also in the background) and at the open: an unmarked one is handled as a new token, a marked one (its process ended before the reply) has its replacement sent again (the server's replacement of a token it no longer has changes nothing). Tokens B then C are replaced A→B, then B→C, also while the first reply is pending. The next open posts the list with the stored token.
- **Transport** (`TWData.HTTPPushTransport`): `start` resumes a `URLSession` task at once and returns a `PushReply` whose status arrives later, with the Cordova 10-second timeout to `TWServerURL` (private input, above); without it there is no push service and nothing is sent. Firebase Messaging needs the private `GoogleService-Info.plist`; the app registers for remote notifications only when the user allowed notifications (asking is IN-14), so FCM can get the APNs token. `aps-environment` is `development`; IN-19 sets production for the release.

Golden requests: `ios/tools/push/generate.py` runs the Cordova `Push` service (`client/www/js/service.push.js`, with `service.weatherutil.js` for the town of a Korean address) in the macOS JavaScriptCore shell with the platform reporting iOS (`cases.js`, one `jsc` process per time zone), and writes `Core/Tests/TWStorageTests/Fixtures/push/push.json` with the sources' commits and hashes. The cases are those of the Android corpus (first, unchanged, changed token, no token, New York daylight-saving alerts) and tokens delivered while the app runs (first, changed, unchanged). `PushRegistrationTests` compare method, path, headers and body (member order and number texts) with them. The generator also runs `Push.init` on a virtual clock (the service's own `setTimeout`, tokens delivered through its token callback at given times, `$http` replies after scripted delays or failing) and writes `Core/Tests/TWDataTests/Golden/push-timed.json` with the time each request was sent: a token at the open, before and after the 3-second post, a first token before and after it, two tokens, failed requests, and slow replies (a slow `PUT` with a token after the post, slow `PUT`s with two tokens before it, a slow `POST`, a slow first token, a slow failed `PUT`). `PushTimingTests` run `PushSync` on a virtual clock with a transport that answers after the same delays, and compare send times, order, paths, headers, bodies and the stored token. Only the generator reads `client/`; CI's build job re-runs it and fails on a diff. `PushSyncTests` cover the order of tokens, a reply that holds nothing back, a failed request, a missing server URL or `Device-Id`, and a process that ends after the token was queued or while its replacement is in flight (the next process completes it); `PushReplyTests` cover the reply handle and the virtual clock (each waiter and sleeper resumed exactly once, cancellation included); `HTTPPushTransportTests` cover the HTTP request.

### Upgrade test (simulator)

```sh
ios/tools/upgrade/build-cordova.sh ios/build/upgrade http://127.0.0.1:18452
ios/tools/upgrade/run-upgrade-test.sh <tw_* simulator udid> ios/build/upgrade/TodayWeather.app ios/build/upgrade/run-localStorage localStorage [token-a|token-b]
ios/tools/upgrade/run-upgrade-test.sh <tw_* simulator udid> ios/build/upgrade/TodayWeather.app ios/build/upgrade/run-suite suite [token-a|token-b]
```

`build-cordova.sh` builds the Cordova 1.1.1 test app from `client/` at `HEAD` in a temporary directory (`git archive`; needs Node, CocoaPods and network for npm, Bower and the pods): `npm ci`, Bower, Sass, `make-client-config.mjs` with `TW_SERVER_URL` set to the local recorder, a generated `GoogleService-Info.plist` of a Firebase project that does not exist, `cordova platform add ios` and `cordova build ios --emulator` with `IPHONEOS_DEPLOYMENT_TARGET=15.0` (Xcode 27 rejects the 12.0 of the ad pods). It keeps only the `.app` and `build-cordova.json` (commit and tool versions).

`run-upgrade-test.sh` refuses simulators not named `tw_*` and erases the one it gets. It then:

1. starts `recorder.py` on `127.0.0.1:18452`, installs a copy of the Cordova app with `seed-cordova.js` as its first script, and seeds places, units, settings, alarms (with a stored FCM token) and an analytics opt-in through the app's own services (`WeatherInfo`, `Units`, `TwStorage`, `Push`, `Monetization`);
2. requires, before the update, the opt-in in the Firebase SDK (persisted flag `1`, an event counted), `CDVUUID` equal to `device.uuid` and the state in both stores; the `suite` run then deletes `Library/WebKit`;
3. builds the native app for testing, signed for the simulator with its App Group entitlement, adds a dummy `GoogleService-Info.plist` to a copy of the products, and runs `TodayWeatherTests` twice over the Cordova install (first start, restart). `CordovaUpgradeTests` compares the migrated content with the seed (places with name, address, flags and coordinates, `cityIndex`, every unit, settings, the alarm and alert records, `startVersion`, `Device-Id`, the source of every key), checks that the sources are kept, that a second run changes nothing and that analytics is off. These five tests are skipped without the seed, so the script reads each phase's result bundle (`xcresulttool`) and fails unless all five ran and passed; the host checks below do not repeat the content comparison;
4. checks on the host (`check_upgrade.py`, results in `summary.json`): the state file unchanged by the restart, the SDK's persisted flag off and consent denied, its event counters (`google-app-measurement.sql`) unchanged, the suite and WebKit files byte-identical, and, after further launches with Firebase Analytics debug logging (up to three, until the SDK reports debug logging on, which it does not always do on the first), "Analytics collection disabled" and no "Logging event" in any of their logs;
5. push (IN-04): the native build is made with `TW_SERVER_URL` empty (checked in its `Info.plist`), so its own starts send nothing. `PushUpgradeTests` then goes through the app's start path in two further processes (each result bundle must report it passed, not skipped): an `AppStartup` whose push service the test builds (`makePush`, test-only injection on the test's own instance) runs the migration and the `Device-Id` read, must send nothing at its start, and runs the open registration when the test posts `UIApplication.didBecomeActiveNotification`, over the migrated state, the token queue and the `Device-Id`, with the FCM token from a test double installed by the test (`token-a`, the token the seed stored, or `token-b`) and the recorder as server. The seed sets the Cordova token through `Push._updateFcmToken` and has the Cordova app post its list once (`Push._postPushList`): both requests reach the recorder as references. `check_upgrade.py push` requires, from the recorder's log of headers and bodies: for `token-b` one `PUT /v000903/push` (`token-b` for `token-a`) with the headers of the Cordova token request, and in each process one `POST /v000903/push-list` holding every migrated alarm and alert once, all with the Cordova `Device-Id` and `type: "ios"`; each record with the same members, order and values as in the Cordova post but for `appVersion` and `fcmToken`, and `Content-Type`, `Accept-Language`, `Device-Id` and `Accept` equal to the Cordova post's; the token stored and no token left in the queue.

No request may reach production. The native build has no server URL and the push test sends only to the recorder. The Cordova build's server URL is the recorder, and `seed-cordova.js` reports every request the page starts and sends any request for a host other than this Mac to the recorder instead (one was seen: `maps.googleapis.com/maps/api/mapsjs/gen_204`). The test fails on a request for a TodayWeather host, or for an API path anywhere but the recorder. Limits: requests of native SDKs are not intercepted. With the dummy configuration they cannot reach the production Firebase project (the native app's Firebase Installations call was answered `400 API key not valid`), and the Cordova build uses Google's test ad units. The analytics observations read SDK internals (persisted flag, consent store, event counters) of FirebaseAnalytics 13.1.1 on the iOS 26.5 simulator; a later SDK can move them, which the checks before the update would reveal.
