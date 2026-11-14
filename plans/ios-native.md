# Plan: iOS-native TodayWeather app (#2948)

Consumes the [intent](../intent/ios-native.md) and [spec](../specs/ios-native.md). One pull request per sub-issue, based on master and merged in dependency order after a cross-provider review PASS and CI (AK, 2026-11-13: through IN-18; IN-06 is go when the spike gates pass). Each PR adds its own section to this plan (design note, user scenarios, acceptance, files, checks), as the [Android plan](android-native.md) did. GitHub owns task status; this plan links to the issues.

## Task graph

| ID | Issue | Scope | Blocked by |
| --- | --- | --- | --- |
| IN-01 | #2950 | project skeleton, imported assets and CI | – |
| IN-02 | #2951 | golden corpus and Swift weather core (G3) | IN-01 |
| IN-03 | #2952 | Cordova data migration and simulator upgrade test (G1, state) | IN-01 |
| IN-04 | #2953 | push re-registration after the update (G1, push) | IN-03 |
| IN-05 | #2954 | hourly and daily charts in SwiftUI (G2) | IN-02 |
| IN-06 | #2955 | spike review, re-estimate and decisions | IN-02..IN-05 |
| IN-07 | #2956 | app shell, navigation, themes, languages, launch continuity | IN-06 |
| IN-08 | #2957 | weather data layer and S03/S04 | IN-07 |
| IN-09 | #2958 | air quality S05 | IN-08 |
| IN-10 | #2959 | start screen, location and place search | IN-08 |
| IN-11 | #2960 | saved places S02 | IN-10 |
| IN-12 | #2961 | settings and menu hand-offs | IN-08 |
| IN-13 | #2962 | nationwide weather, air and warnings | IN-08 |
| IN-14 | #2963 | notification settings and alarms | IN-11 |
| IN-15 | #2964 | ads, analytics consent and crash reporting | IN-07 |
| IN-16 | #2965 | sharing, entry links and backup | IN-08 |
| IN-17 | #2966 | rollback hand-back to the Cordova app | IN-14 |
| IN-18 | #2967 | parity verification, iPad and the user manual | IN-09, IN-12..IN-16 |
| IN-19 | #2968 | release, upgrade gate and phased rollout | IN-17, IN-18 |

The IDs match the Android tasks one to one (IN-NN ↔ AN-NN), so each task has a merged Android pull request and an `android/README.md` section as its behavior reference.

- **Ready now:** IN-01.
- **Critical path:** IN-01 → (IN-02 → IN-05, or IN-03 → IN-04) → IN-06 → IN-07 → IN-08 → IN-10 → IN-11 → IN-14 → (IN-17 or IN-18) → IN-19.
- **Parallel work:** IN-02 and IN-03 after IN-01; IN-09, IN-10, IN-12, IN-13 and IN-16 after IN-08; IN-15 any time after IN-07.
- **Gate:** IN-07 onward starts only after IN-06 closes with AK's go decision.
- **Input that blocks one task:** IN-10 needs the Places API key for iOS from AK, and through it IN-11, IN-14 and IN-17 wait. If it is still missing after IN-08, do IN-09, IN-12, IN-13, IN-15 and IN-16 first.
- **Human-owned:** IN-19, and the physical-iPhone criterion of IN-14, which writes to the production push server and needs AK's explicit authorization.

## Ownership and shared files

| Area | Owner task | Later tasks |
| --- | --- | --- |
| `ios/` project file, `ios/Core/Package.swift`, `Package.resolved`, `.github/workflows/ios.yml`, import tool | IN-01 | Add targets, dependencies and CI steps; keep both CI jobs |
| `TWModel`, `TWDomain` and the corpus copy | IN-02 | IN-05 adds chart scenes; screen tasks add scopes checked by the corpus |
| `TWStorage`, the migration and the upgrade test harness | IN-03 | IN-04 adds push; IN-14 and IN-17 extend the test |
| Push registration client | IN-04 | IN-11, IN-12 and IN-14 call it |
| App shell, entry-event queue, banner slot | IN-07 | Screen tasks plug into it; IN-15 fills the banner slot; IN-16 adds links |
| `client/` | IN-17 only, and only if the hand-back reader needs an iOS fix | – |
| `ios/README.md`, this plan | every task adds its section | – |

Parallel tasks touch the shared files of the first row. The coordinator merges them one at a time and reruns the checks on the combined revision before releasing dependent tasks.

## Environment (checked 2026-11-13)

- This Mac: Xcode 27.2, Swift 6.4.2, Apple silicon, 16 GiB memory, 35 GiB free disk. Xcode 27 simulates iOS 17 and later; the installed runtime is iOS 26.5 with iPhone SE (3rd generation, 375×667 pt), iPhone 16 (393×852 pt), iPhone 16 Pro Max (440×956 pt) and iPad devices. The deployment target is iOS 17.0, so no 320 pt device exists.
- `scripts/verification/rewrite/native` already builds the Cordova iOS app for a simulator, injects a harness and drives it; IN-03 and IN-05 can reuse that for seeding and reference captures.
- Not available in this checkout: the private client inputs for a Cordova iOS build. Fetch them before IN-03 and IN-05.
- A physical iPhone is needed for IN-14 and IN-19 only.

## Conditions that require replanning

- A spike gate fails, or IN-06 switches core reuse to Kotlin Multiplatform: IN-02 and every task that uses `TWDomain` change, and the Android modules enter the scope.
- The upgrade cannot be tested on a simulator (the container is not kept): move G1 to a physical device and re-scope IN-03 and IN-04.
- IN-02 finds JavaScriptCore differences that AK wants to follow: the corpus gains iOS-only expectations, and the tasks that consume those functions inherit them.

## User scenarios

Program level; each PR adds its task scenarios. "C" numbers are the completion criteria of #2948 in order.

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | Criteria | Task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| US1 | A Cordova 1.1.1 user updates and keeps everything | Places, units, settings and alarms saved in 1.1.1 | Update to the native app; open it | The same places, selected place, units, settings and alarms; push registered again with the same `Device-Id`; analytics still off | A key is missing or malformed: its defined default applies and the rest migrates | C2, C3 | IN-03, IN-04, IN-19 |
| US2 | A 1.0.10 user updates straight to the native app | State only in the App Group suite | Update; open | The state from the suite, with defaults for keys that lived only in the web storage | Empty suite: the start screen (S01) | C2 | IN-03 |
| US3 | A new user gets weather on first launch | Fresh install | Open; allow location, or deny it and search for a place | S03 for the current position or the searched place | Location denied or off: the denial message, no hang | C4 | IN-07, IN-08, IN-10 |
| US4 | A user reads hourly, daily and air information | A saved place | Open the Hourly, Daily and Air tabs; scroll the charts | The same values, charts and stations as the Cordova iOS app | Request fails: the retry confirmation; no air data: the grade scale only | C4, C5, C6 | IN-05, IN-08, IN-09 |
| US5 | A user manages places | – | Search, add, switch by swiping, delete | The list and the selected place persist; deleting a place removes its alarms on the server | Add fails: the add-place alert | C4 | IN-10, IN-11 |
| US6 | A user sets an alarm and opens its notification | Notifications allowed | Save an alarm; tap the delivered notification | The alarm is registered once; the tap opens that place | Permission denied: the permission dialog; equal hours: the message | C8 | IN-04, IN-14 |
| US7 | A user changes units, theme or startup page | – | Change a setting | It applies at once and survives a restart; a unit change re-posts the push list | – | C4 | IN-12 |
| US8 | A user in Korea opens the nationwide pages | Region KR | Open nationwide weather, air and warnings | The Cordova pages with the same data | Empty or failed response: the Cordova empty state | C4 | IN-13 |
| US9 | A user controls ads and analytics | – | Answer the consent form; opt in to analytics and withdraw | Ads load after consent, non-personalized and without a tracking prompt; analytics only while opted in | A failed consent write counts as a withdrawal | C9 | IN-15 |
| US10 | A user shares weather or opens an entry link | A saved place | Share from S03; open a link if the shipped app registers one | The Cordova text and link; the linked place opens | No place selected: nothing is shared | C4 | IN-16 |
| US11 | A user is moved back to a Cordova build after a rollback | Native app used, places edited | Install the fallback Cordova build; later the native app again | The fallback shows the native state; the native app adopts changes made there | Hand-back interrupted: the fallback keeps its old state rather than half of the new one | C10 | IN-17 |
| US12 | An iPad user rotates and resizes the window | iPad | Rotate; resize in Split View | No clipped content at any size or text size | – | C4 | IN-07, IN-18 |
| US13 | A developer builds and tests without the other directories | Xcode | Build and test `ios/` in a checkout without `client/`, `android/` and the legacy iOS directories | Build and tests pass | A reference outside `ios/` fails the job | C7 | IN-01 |
| US14 | AK releases the app | Release inputs, a physical iPhone | TestFlight update over the App Store build; phased release | State and push kept; the release reaches 100% | A pause criterion triggers: pause the phased release; if needed ship the fallback Cordova build | C3, C11, C12 | IN-19 |

C1 (decisions recorded) belongs to IN-06, and C13 (documentation) to IN-01, IN-18 and IN-19.

## IN-01 — project skeleton, imported assets and CI (#2950)

Design skipped: no system flow; the layout follows #2948 and the Android module split. Archify not applicable (the service overview gains the iOS client in IN-19, as the Android client does in AN-19).

- **Project:** a hand-written `TodayWeather.xcodeproj` (object version 77) whose app and test folders are folder-synchronized groups, so later sub-issues add files without project edits. The core is a local Swift package `ios/Core` (`TWModel`, `TWDomain`, `TWData`, `TWStorage`, `TWResources`) with iOS 17 and macOS 14 platforms, so Foundation-only code is also tested with `swift test`.
- **Copies:** `ios/tools/import_client_assets.py` mirrors the Android tool. The copies live in the package's `Client` folder and are bundled verbatim (`.copy`), so their provenance hashes can be checked in the built bundle. The folder is not called `Resources`: on iOS that name makes CFBundle use the old bundle layout (observed in the first simulator run). Catalogs become `Localizable.strings` per `.lproj`, read through `TWResources.strings(catalog:)`, because the app chooses the catalog as the Cordova app does (IN-07). Ionicons comes from the committed Android copy, checked against its provenance record.
- **CI:** `.github/workflows/ios.yml` on `macos-26` with Xcode 26.6 and the iOS 26.5 simulator; the job without other directories deletes `client/`, `android/`, `tw.ios/`, `ta.ios/` and `applewatch/`.
- **Versions:** `MARKETING_VERSION` 2.0.0 and build 1 are placeholders above the store's 1.1.1; IN-19 sets the release values.

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| IN01-US1 | Developer builds and tests the app | Xcode 27.2 or 26.6, iOS 26.5 simulator | `swift test` in `ios/Core`; `xcodebuild … test` in `ios/` | Package and app-hosted tests pass | A missing copy or changed byte fails `ImportedClientAssetsTests` with the file name | AC1 |
| IN01-US2 | Maintainer refreshes translations after a `client/` change | Full Git history | Run the import tool; commit | Changed `.strings` and provenance; unchanged inputs give no diff | Non-string catalog entry or unexpected `town.js`: the tool stops with the key | AC2 |
| IN01-US3 | Reviewer confirms the build reads only `ios/` | CI or a copy of `ios/` alone | Build and test without the other directories | Build and tests pass | A reference outside `ios/` fails the job | AC1 |
| IN01-US4 | Tester starts the app | iPhone and iPad simulators | Install the debug app, open it | The app opens and keeps running | – | AC3 |

### Acceptance (from #2950)

- AC1: `swift test` and the simulator build and tests pass locally and in both CI jobs, including the job without the other directories.
- AC2: Re-running the import tool produces no diff; provenance lists every copied file with source path, commit and SHA-256.
- AC3: The debug app installs and starts on an iPhone and an iPad simulator.
- AC4: README, artifact checker, review PASS and CI before merge.

### Checks

Test-first: `ImportedClientAssetsTests` failed before the import (no provenance, no copies) and passed after it. The first simulator run then failed where macOS passed (the `Resources` folder layout), which led to the `Client` folder. Smoke: import tool run twice with no tree change; install and launch on owned `tw_iphone16` and `tw_ipadpro13` simulators; build and test a copy of `ios/` alone.

## IN-02 — golden corpus and Swift weather core (#2951)

Design skipped: there is no new system flow. The port follows the Android core module by module, and the corpus decides behavior. Archify is not applicable (no route, collector or storage change).

- **Copy:** `ios/tools/import_corpus.py` copies the tracked files of `android/core-domain/src/test/resources/corpus/` byte for byte into `Core/Tests/TWDomainTests/Corpus/` (bundled with `.copy`) and writes `provenance/corpus.json`. CI's build job re-runs it, and both trigger lists include the Android corpus path. The standalone job reads only the copy.
- **Model:** `TWModel.JSONValue` keeps member order and number texts, so the comparison checks member order and integer versus fractional numbers, which the Kotlin tests do not. The views of `Models.kt` are protocols and structs over `JSONObject`.
- **Domain:** a Swift port of `Js.kt`, `Text.kt`, `WeatherConverter.kt`, `AirQuality.kt`, `Nationwide.kt`, `Warnings.kt` and `ChartPosition.kt`. The JVM APIs are replaced: `BigDecimal` rounding by the exact printf expansion with half-up rounding on its digits, and `Calendar` by proleptic Gregorian arithmetic with `TimeZone` offsets. The Swift port follows JavaScript in two places where the Kotlin emulation differs outside the corpus (exponential number text, boolean air grades); [`ios/tools/corpus/differences.md`](../ios/tools/corpus/differences.md) lists them.
- **JavaScriptCore:** `ios/tools/corpus/compare_jsc.py` runs the unchanged generator in the macOS `jsc` shell, with Node's `vm`, `fs`, `crypto` and `path` provided by `node-shim.js` and one run per time zone. It compares 2,611 cases. In `special.json`, 21 values differ: JavaScriptCore rejects day overflow and accepts second 60. `Warnings.jsDate` follows JavaScriptCore, and the tests expect the JavaScriptCore output for exactly those values (`JavaScriptCore/differences.json`). Under #2948 decision 2 this holds until IN-06 records the decision.

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| IN02-US1 | Developer checks the Swift core against the Cordova code | Xcode 27.2 or 26.6 | `swift test` in `ios/Core`; the scheme's tests on a simulator | Every corpus case matches, with member order and number texts | A differing value fails with its case and JSON path | AC2 |
| IN02-US2 | Maintainer refreshes the corpus after a client change | Full Git history; the Android corpus regenerated | Run `import_corpus.py` twice; commit | Changed copies and provenance the first time, no change the second | Untracked or missing corpus file: the tool stops; stale copy: CI's diff check fails | AC1 |
| IN02-US3 | Reviewer confirms the engine question for iOS | macOS with jsc, `android/` and `client/` | Run `compare_jsc.py` | Every value equal except the recorded ones; `differences.md` names them with evidence | A new difference or a missing file: exit 1 with the case and both values | AC3 |
| IN02-US4 | Developer builds without `android/` | Copy of `ios/` alone | `swift test` | The tests read only the bundled copy and pass | A reference outside `ios/` fails the standalone job | AC2 |

### Acceptance (from #2951)

- AC1: Re-running the corpus copy without source changes produces no diff.
- AC2: The Swift corpus tests pass for every case, on macOS and on an iOS Simulator, in both CI jobs.
- AC3: `ios/tools/corpus/differences.md` lists every case whose JavaScriptCore output differs from the Node corpus, or states that the run found none, with the command that produced the result.
- AC4: README, artifact checker, review PASS and CI before merge.

### Checks

Test-first: the tests ran first against stubs of the `TWDomain` API and a stubbed number formatter; every corpus test failed on assertions, and the IN-01 tests passed. The JavaScriptCore expectations went through the same cycle: `warningsMatchCordova` failed on the 7 affected cases until `Warnings.jsDate` followed JavaScriptCore. Green runs: `swift test` on macOS and the scheme's tests on the owned `tw_dev_in02` simulator. Smoke checks: both import tools run twice with no tree change; `swift test` in a copy of `ios/` alone; `compare_jsc.py` (exit 0, differences as recorded); the artifact checker on the staged tree.

## IN-03 — Cordova data migration and simulator upgrade test (#2952)

Design note: the per-key rules port the Android `CordovaMigration` (AN-03) to Swift in `TWStorage`, which uses Foundation and SQLite only and runs under `swift test`. iOS differs in where the data lives. `localStorage` is read from WebKit's files, not through a `WKWebView` serving `app://localhost`: a web view needs the main thread and a web content process, which a background start may not get, and WebKit would open, and could migrate, the files it serves. The database and its write-ahead log are copied and the copy is read, so the source stays byte-identical. On the iOS 26.5 simulator the newest writes were only in the `-wal` file, and the layout was `Library/WebKit/<bundle id>/WebsiteData/Default/<hash>/<hash>/LocalStorage/localstorage.sqlite3`, located through WebKit's `origin` file. The device path without the bundle ID and the older single-directory file are supported from WebKit's source, not observed. The App Group suite is read through `UserDefaults`, typed as the plugin stores values. Stored texts are parsed by IN-02's strict `TWModel.JSONValue`, and stored strings and keys are compared by UTF-16 code units (`JSString`); the state file is written through `JSONValue`, so Cordova records keep member order, number texts and keys that differ only by normalization. Analytics: Firebase 13.1.1 `FirebaseAnalyticsCore` (the Cordova build's variant without ad-ID and on-device conversion), pinned by the committed `Package.resolved`. Collection is disabled and consent denied before `FirebaseApp.configure()`, which runs only with a `GoogleService-Info.plist` in the bundle; on the simulator the persisted flag changed from 1 (Cordova opt-in) to 2 before `configure`. The upgrade test needs the App Group entitlement, which simulator builds carry in the executable when signed for the simulator; CI builds keep `CODE_SIGNING_ALLOWED=NO` and do not run it. Archify not applicable (no service flow change; the app's start only).

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| IN03-US1 | Cordova 1.1.1 user updates to the native app | Places, units, settings, alarms and an analytics opt-in in 1.1.1 | Install the native update; open it; reopen it | Same places, selection, units, settings and alarms; `Device-Id` = `CDVUUID`; analytics off, no event; Cordova storage unchanged | A missing or broken key takes the Cordova default, recorded in `MigrationInfo` | AC1, AC2 |
| IN03-US2 | User updating straight from 1.0.10 | State only in the App Group suite | Update; open | The suite's state; defaults for `startupPage`, `refreshInterval` and `guideVersion` | Empty suite: a new install's state | AC1, AC3 |
| IN03-US3 | User of a version before `pushData2` | Legacy `pushData` only | Update | Alarms converted as `loadOldPushInfo`; alert introduction pending | – | AC1 |
| IN03-US4 | iOS starts the updated app in the background before the first unlock | Data protection active | Background launch, later unlock | The migration waits and runs once protected data is available; nothing empty is stored | A source that cannot be read stops the run without writing | AC1 |
| IN03-US5 | Maintainer runs the upgrade test | Xcode 27, a `tw_*` simulator, Node and CocoaPods | `build-cordova.sh`; `run-upgrade-test.sh … localStorage` and `… suite` | Both pass; no request for a production host | Another simulator: refused; a request for a TodayWeather host or an API path elsewhere: fail | AC2, AC3 |

### Acceptance (from #2952)

- AC1: Unit tests cover valid, partial, malformed, suite-only and legacy-`pushData` inputs and a fixture of each supported storage layout, and a second migration run changes nothing.
- AC2: The simulator upgrade test passes: places, `cityIndex`, units, settings and alarms match the Cordova state; `Device-Id` equals the stored `CDVUUID`; after a restart analytics collection is disabled and no event is sent, although the Cordova opt-in was present; the source storage still exists; no request reached a production host.
- AC3: The same test passes from a state that exists only in the App Group suite.
- AC4: README, artifact checker, review PASS and CI before merge.

### Checks

Test-first in a modified form: the rules were drafted before their tests, so the red run used compiling stubs (the migration, the readers, `Device-Id` and the runner returning empty results) and failed 23 of 31 `TWStorageTests` with assertion failures (the 8 others test parts that were not stubbed, such as the JSON parser, or hold for an empty result); the same tests passed against the implementation. Simulator: the scheme runs the app-hosted tests (`AppBundleTests`, `AnalyticsDefaultsTests`, `CordovaUpgradeTests`, which are skipped without a seed) and both package test targets. Smoke: `run-upgrade-test.sh` in `localStorage` and `suite` mode on the owned `tw_dev_in03` simulator (iOS 26.5) with a Cordova 1.1.1 build from `build-cordova.sh`; a copy of `ios/` alone builds and passes `swift test`; the artifact checker on the staged change. After IN-02 merged, the migration moved to `TWModel.JSONValue`: the 30 rule and reader tests kept their results (the parser suite of the removed type was replaced), and `StoredTextTests` (5) cover strict parsing, Kotlin's number views and canonically equivalent keys and strings; the simulator tests and both upgrade runs were repeated.

Review round 1 (CODEX-IN03-1..3), each test-first:

- CODEX-IN03-1: a WebKit directory, `origin` file, database or log that existed but could not be read was taken for absence (`try?`, `fileExists`), so the runner stored defaults as a finished migration and kept them after access returned. `FileProbe` now tells absence (`ENOENT`/`ENOTDIR`) from unreadability, which throws `SourceError.unavailable` and stops the run without writing; the same applies to the state file's directory, the suite's preferences file (and a missing App Group container) and the standard preferences file before a new `CDVUUID` is created. `AppStartup` tries again when protected data becomes available. A database copy that is no SQLite database stays a recorded, permanent condition. Red: 7 of the 9 unreadable WebKit paths (all but the database and its log, whose copy already failed) stored the placeholder and kept it after access returned; the unreadable state directory was taken for no state; the suite and `Device-Id` cases did not throw. A lone surrogate in a stored value no longer empties the value (red: the list became malformed).
- CODEX-IN03-2: ICU's `\d` matched Arabic-Indic and fullwidth digits, and the date check then indexed missing numbers and crashed (red: `Index out of range`). The patterns are ASCII (`[0-9]`), as Kotlin's `\d` is, and the number count is checked: such records are dropped and counted, legacy times become null.
- CODEX-IN03-3: the harness took the suite name in the log as proof, which also holds when the five upgrade tests are skipped (red: the previous harness with the seed removed reported PASS). It now reads each phase's `.xcresult` and requires the five tests passed; the same run without the seed fails. The host checks wait for the opt-in flag's value before the update (a run caught it between the SDK's off and on writes).

## IN-05 — hourly and daily charts in SwiftUI (#2954)

Design skipped: no new system flow. The scenes follow the Android AN-05 port element by element, and the Cordova iOS build decides the drawing. Archify not applicable (no route, collector or storage change).

- **Scenes (`TWDomain/Chart/`):** a Swift port of `D3.kt`, `Svg.kt`, `ChartMetrics.kt`, `HourlyChart.kt` and `DailyChart.kt`. `ChartMetrics` adds the iOS branch of `initSize` (20 pt status bar). It changes nothing on phones, where the width bounds the header font, but it does on a landscape iPad. Where the Kotlin code throws (no `timeChart` or `dayChart`), `build` returns nil. Series names compare with `JSString`.
- **References:** `ios/tools/import_chart_reference.py` copies the Android scene JSON with provenance. It leaves out the Android WebView PNGs and the Android tolerances, and lists both. `ios/tools/chart-reference` builds the Cordova 1.1.1 simulator app with the IN-03 recipe, using a local fixture server and a dummy Firebase project, and captures on the three owned simulators. The fixtures go through the app's own request path, so the server answers `/weather/v000903/coord/…` with corpus responses. The scenes use the Android capture shape. The wrapper screenshots are cropped by a calibration marker drawn in each screenshot. One run showed the WebView 54 pt lower for the hourly chart at 393×852.
- **Drawing (`TodayWeather/Chart/`):** SwiftUI `Canvas` draws the shapes and images. CoreText draws the text in the system UI font, matching WebKit's `-apple-system` with fallback fonts. Row heights use `line-height: normal`: each font's ascent and descent rounded up, measured as 19 and 22 pt in the captures. The expander glyph comes from the imported Material Icons font. The colors are the SCSS colors of all four themes.
- **Screenshot hosting:** the tests render `HourlyChartFrame` and `DailyChartFrame` with `ImageRenderer` in the app-hosted test target. These frames hold the same content and pinned views as the live views, at a given offset. This adds no app mode or preview entry, and the render depends on the requested scale, not on the simulator model. So CI's iPhone 17 compares all three sizes against the committed references, and no per-model split is needed. The live scroll views are checked separately in a window (`ChartScrollTests`). iOS 17 has no offset scroll position, so the opening offset is a marker view's position.
- **Scroll resets (review fix CODEX-IN05-1):** Cordova sets `scrollLeft` after every `applyWeatherData`, also for unchanged data, and the expander only toggles `expand`. So the views take `applyCount`, which the owning page increments on each apply, and scroll back to the opening position on every change. The first version reset only on appear and on a changed opening offset, so a user's scroll survived a new apply with the same offset. Changing `expanded` keeps the position. `ChartApplyTests` covers both charts in one live view instance.
- **Tolerances:** these use the AN-05 metric and the Android margins. The recorded values and the reasons are in `ios/TodayWeatherTests/ChartReference/tolerances.json`. Strong differences are 0.0010–0.0069 and mean differences 1.07–2.29, with heights equal. A second capture of all sizes gave the same values. What remains is glyph rasterization and image filtering. Snapping baselines to device pixels was tried and made 375×667 worse.

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| IN05-US1 | User reads the hourly chart | Converted place weather | Open the chart; scroll to both ends; tap the expander | The Cordova scene: header, lines, current point, labels, icons, pinned legend, detail rows; opens one column before the current hour | No `timeChart`: no chart instead of a crash | AC1, AC2 |
| IN05-US2 | User reads the daily chart | Converted place weather | Open the chart; scroll to both ends | The Cordova bars, icons, texts and today circle; today in the third column | No `dayChart`: no chart | AC1, AC2 |
| IN05-US3 | Developer checks the scenes | Xcode 27.2 or 26.6 | `swift test`; the scheme's tests | Every element of the Android and iOS reference scenes within 0.02 pt | A differing element fails with its path, class and attribute | AC1 |
| IN05-US4 | Developer checks the screenshots in CI | CI simulator, no `client/` or `android/` | The scheme's tests | All 18 comparisons within their recorded tolerances | A changed drawing exceeds the tolerance; renders and differences in `tmp/chart-compare/` | AC2 |
| IN05-US5 | Maintainer recaptures after a Cordova chart change | Mac with Xcode, Node and the owned simulators | `build-cordova.sh`, `capture.py run` per simulator, `capture.py provenance` | New references with provenance; no request left the Mac | A request for another host or a bar over the chart stops the run | AC2 |

### Acceptance (from #2954)

- AC1: The Swift chart scenes equal the copied Cordova scenes element by element. Both the Android set and the iOS set are checked.
- AC2: The screenshot comparisons with the Cordova iOS captures pass at 375×667, 393×852 and 440×956 pt within the recorded tolerances, at the opening position and at both scroll ends.
- AC3: README, artifact checker, review PASS and CI before merge.

### Checks

Test-first: `ChartSceneTests` ran first against stub builders that returned empty scenes and labels. It failed on assertions: 152 issues, plus the then-missing iOS set. It passed after the port. The screenshot tests went through two fixes. The first render was 10–13 % strong because the frame took the content's width. After that fix, the measured values were recorded.

Mutation checks of the tolerances, run once and reverted:

- A today line 1 pt wide instead of 2 fails at 375×667 and 393×852 at every position. At 440×956 it stays within the margin.
- Moving the daily chart down 1 pt fails at every size, on height and strong.

Review fix CODEX-IN05-1, test-first: `ChartApplyTests` ran with `applyCount` accepted but not yet wired. The four apply cases (another weather with the same opening, and the same data again, for both charts) failed on the offset assertions. The expander case passed, as a guard. All passed after the reset was wired.

Green runs: `swift test` on macOS, the scheme's tests on `tw_cap_16`, and `swift test` in a `git archive` copy of `ios/` alone. Smoke checks: both import tools run twice with no tree change, and the artifact checker on the staged tree.

## IN-07 — app shell, navigation, themes and languages (#2956)

Design note: the rules are Foundation-only data and functions in `TWDomain` `Shell/` (themes, tabs, startup page, menu rows, tab taps, start gate, languages, photo grouping, the entry-event queue), the single state owner `AppStateHolder` is in `TWStorage`, the photo feed in `TWData`, and the SwiftUI shell in `ios/TodayWeather/Shell/`. Ported from the Android AN-07 shell and corrected against the Cordova iOS build, which was captured on the owned `twios_cap_16` simulator (`ios/tools/shell-reference`, the IN-05 build recipe with a local fixture server; no request left the Mac). Archify not applicable (no route, collector or storage change; the app's start only).

- **Launch continuity:** the launch storyboard and `SplashView` reproduce the Cordova launch screen and splash (captured before `navigator.splashscreen.hide`). `AppStartup` hands the migrated state to `AppLaunch` through a `didSet` on its `state` (a small edit away from the lines IN-04 changes). `EntryQueue` holds the launch, resume, notification-tap and link events until then and hands them out in arrival order; screens connect through `AppLaunch.onShell` before the held events go out. The start gate follows `startVersion` (S01 while missing or below 1), as the Android `StartGate`.
- **State owner:** `AppStateHolder` shows a change at once and saves the whole state after each change in order, through a chain of detached tasks (each awaits the previous; no continuation exists to be dropped). A failed save is written with the next change, as the Android holder retries. IN-04's `PushSync` should route its writes through `holder.update` when the two meet.
- **iOS template:** the tabs use `tabs.html` (iOS Ionicons and `ion-ios-reload`), the menu's back button `ion-ios-arrow-back`, chevrons on Units, Send feedback, Rate and About (`!isAndroid()`); the status bar takes `applyIOSStatusBar`'s color per theme and tab with light content except in the light theme (`styleDefault` = dark content, cordova-plugin-statusbar 4.0.0). Measured: a 49 pt header bar (`env(safe-area-inset-top)` 5 pt + 44) under a 54 pt status bar, an 83 pt tab bar (49 + 34) to the bottom edge, menu rows 55 pt apart, blocks 47 pt with 9/10 pt gaps, a 1 px `#d2d2d2` line at the menu's bottom; the photo theme's Daily header is clear like Hourly (the captures; the SCSS rule names another selector).
- **Android-only, not built (checked in the Cordova iOS source):** the back-button exit confirmation O15 and the back-button handler (`controller.tabctrl.js` registers it only on Android), `MobileAccessibility.usePreferredTextZoom` (Android only; the native app follows Dynamic Type as decided on #2948).
- **Languages:** the WKWebView reports and sends only the first system language, minimized (recorded for twelve settings): the catalog, `Util.region` and `Accept-Language` follow that tag. English with region Korea therefore shows no Korea-only rows, as in the Cordova iOS app.
- **Photo feed:** `firstSettled` reproduces `_retryGetHttp` (attempts 2 s apart, 20 s each, the first to settle decides, the others are cancelled); the URL is a private input (`TW_WEATHER_PHOTOS_URL`).
- **Tests without app modes:** the shell is driven in app-hosted tests through its accessibility elements (activated as VoiceOver does) in windows of the test host, with state injected through `AppStateHolder` and an in-memory store; screenshots render the parts with `ImageRenderer` (`SideMenu(scrolls: false)` renders the rows without a scroll view, as the chart frames do).

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| IN07-US1 | User switches tabs and reloads | A saved place | Tap Daily, tap Daily again after a second, tap it twice quickly | Daily shows; one reload request; the quick second tap does nothing | Locations tapped again: nothing | AC1 |
| IN07-US2 | User who chose a startup page opens the app | Startup page "Air" | Open the app | The Air tab is selected first | An unknown stored value: Hourly | AC1 |
| IN07-US3 | User opens the menu and leaves it | – | Tap the menu button; tap back; open again and choose Theme | The menu slides in with the Cordova rows (Korea-only rows for KR); back closes it; Theme closes it and opens the setting (IN-12) | Version row: nothing happens | AC1 |
| IN07-US4 | User answers a popup | A popup shown | Tap outside it, then a button | Outside: nothing; the button closes it and runs its action; the next popup shows | – | AC1 |
| IN07-US5 | User sees the Cordova look in each theme and language | Theme light, dark, photo or old; ko or en | Open Hourly, Daily, Air, Locations and the menu | Tab bar, header bar, menu and status bar as the Cordova iOS build | – | AC2 |
| IN07-US6 | iPad user rotates and resizes | iPad, text size up to xxxLarge | Turn the window from portrait to landscape; use Split View and a small Stage Manager window | Tab items and menu rows inside the window; tab labels in two lines at most, never cut | – | AC3 |
| IN07-US7 | User taps a notification while the app starts | Cordova data being migrated | Tap the notification during the migration | The launch screen stays; after the migration the launch and the tap are handled in that order with the migrated state | Unreadable sources: the migration waits and the events with it | AC4 |
| IN07-US8 | New user opens the app | No `startVersion` | Open | The launch image, then S01 (IN-10) | – | AC4 |

### Acceptance (from #2956)

- AC1: UI tests pass for tab switching, the startup-page setting, opening and closing the menu and closing a dialog.
- AC2: Screenshot tests cover the shell in each theme, in Korean and English.
- AC3: On iPad simulators, rotating and resizing the window leave no clipped content.
- AC4: A test shows that an entry event arriving during the migration is handled after it finishes.
- AC5: README, artifact checker, review PASS and CI before merge.

### Checks

Test-first: the logic tests (`ShellLogicTests`, `AppLanguageTests`, `EntryQueueTests`, `AppStateHolderTests`, 19 tests) ran first against compiling stubs of the new API (empty rules, a holder that stores nothing, a queue that never hands out) and all 19 failed on assertions (329 issues); they passed against the implementation. The app-hosted shell tests first failed because SwiftUI built no accessibility elements in the test process; turning on accessibility automation in the test (libAccessibility, test code only) and keeping container identifiers off their children made them reach the views.

Captures: the Cordova 1.1.2 build from the base commit (`build-cordova.sh` with server `http://127.0.0.1:18454`), `capture.py languages` (12 system settings) and `capture.py run` in ko-KR and en-US on `twios_cap_16`; the first runs stopped on the UMP/ATT form over the page (#2945), so the capture script no longer starts the Ads SDK. Screenshot comparisons: the first run measured the header's menu glyph 2 pt left, the title 1 pt high, the tab labels 2/3 pt low, the menu laid out one row off, a missing menu bottom line, the splash image sized to the WebView instead of the screen and the photo theme's Daily header drawn plain; after the fixes all 73 comparisons are within strong 0.0081 and mean 1.4. Mutation checks, run once and reverted: without the hairlines all 32 tab-bar and 28 header hairline checks failed (and 56 of 64 means); with tab labels kept to one line `ShellFitTests` failed 12 times (German, Japanese and Chinese labels at xxxLarge in narrow windows).

Smoke: the unsigned app installed on `twios_dev_in07` with a stored state (dark, then light theme) opened the shell with light, then dark status bar content. Import tools run twice with no change; the artifact checker on the staged change. Final runs on the committed tree: `swift test`, the scheme on `twios_dev_in07` (unsigned), the shell and fit tests on `twios_dev_in07_ipad`, and `swift test` in a `git archive` copy of `ios/` alone (logs under `reports/sdlc/ios-in-07/checks/`). In the first full scheme run the menu test read the menu mid-slide while the screenshot tests kept the main actor busy; the window-hosting suites now run serialized and wait for the menu to settle. A first iPad test asked the scene to rotate; iPadOS 26.5 refused (`UISceneErrorDomain` 101, windowing mode), so one live shell's window now turns and resizes instead.

Open risks: `CordovaRegion` (IN-03) derives the migration region from `Locale.preferredLanguages`, while the Cordova iOS app used the WebView's minimized tag (English with region Korea: KR there, US in Cordova), which affects only the defaults of missing unit members; IN-08 should decide whether to align it. The status bar style uses the application-wide API (deprecated, effective while view-controller-based appearance is off). Accessibility automation in the tests is a private switch of the simulator runtime. A rotation of the simulator device with the running app was not exercised (only window frames in both orientations).

## IN-08 — weather data layer and S03/S04 (#2957)

Design note: the request rules are Foundation-only `TWDomain` code (`Forecast/`: `WeatherRequests`, `ForecastScope`, `ForecastPage`, `PlaceIndex`), the client, cache and loading are `TWData` (`WeatherRepository`, `WeatherSession`, `firstSettled` with an injected `AppClock`; `TWData` now depends on `TWStorage`, as IN-04 also declares), and the pages are SwiftUI in `ios/TodayWeather/Weather/` connected to IN-07's hooks (`AppLaunch` creates `WeatherScreens` with the shell; the launch and resume entry events, `onRefresh`, `TabContent` with a title accessory). Ported from the Android AN-08 pages and corrected against the Cordova iOS build, captured on the owned `twios_cap_16` simulator (`ios/tools/forecast-reference`, the IN-05/IN-07 build recipe with a local fixture server; no request left the Mac). Archify not applicable (no route, collector or storage change on the server; the client's request is the documented `v000903` contract).

- **Request and attempts:** the URL of `getWeatherByGeoInfo` with JavaScript's number text and WebKit's percent-encoding; `Accept-Language` is the WKWebView's (`ShellLocale.acceptLanguage`, one minimized language: `ko-KR,ko;q=0.9`, where Android sends Chrome's list). `_retryGetHttp`'s timing is generated from the Cordova code in the macOS JavaScriptCore shell on a virtual clock (`ios/tools/weather/generate.py`, `TWDataTests/Golden/weather-timed.json`) and the Swift client is checked against it on a virtual clock. Decision (V08 asks the replacement to document it): the first attempt to settle decides and the others are cancelled; the legacy attempts that start after the promise settled (A06) are not sent. A fast error status, the gateway's 501 for the free-form address route included, therefore sends one request and opens O03, as in Cordova.
- **Late responses and the gate:** responses are keyed by place and only a place's latest request counts (V09, the A01 fix of AN-06); the ten-minute gate is in memory and checked against the Cordova `canLoadCity` in JavaScriptCore; the refresh timer restarts with every load. The weather cache is `Library/Caches/weather` (Cordova kept the weather with the city in `localStorage`; Android uses `files/weather/`).
- **Pages:** `ForecastScope` and `ForecastPage` run the corpus (`forecast.json`) and the captured Cordova iOS elements; the SwiftUI layout uses the measured Cordova iOS sizes (`WeatherMetrics`, `CssLine` baselines from WebKit's `line-height: normal`). The charts are IN-05's.
- **Cordova iOS–specific, not Android:** the header block's 64 pt (`.platform-ios`); the iOS template's bell and share glyphs; the location glyph opens the app's settings (`switchToSettings`) and reads when-in-use authorization (`Util.isLocationEnabled` on iOS); the header spinner in `.spinner` #444 (Android kept a white spinner, A08); the WebView's single `Accept-Language` tag.
- **Kept from Android's decisions:** the spinner follows the selected place's request (Cordova had one TabCtrl flag); a response saves its place's changes and photo wherever the place is now.
- **Left to later tasks:** the current position's own lookup and O02 (IN-10), the bell (IN-14), share (IN-16), the units page (IN-12), the Air tab's pollutant (IN-09). Until IN-10 a current position loads by its saved location.
- **Not built (decided):** no test, mock or dry-run mode; the tests inject a virtual clock, a server double and the state through `AppStateHolder`.

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| IN08-US1 | User reads today's weather against yesterday | A saved place with coordinates | Open the app on Hourly | The place's name, temperature, sky, the comparison with yesterday (`yesterday.t1h`), the air summary, the hourly chart and the cards as the Cordova iOS page | The request fails: O03 (오류, 날씨 정보를 가져오지 못하였습니다, 닫기/확인); OK reloads | AC1, AC2, AC3 |
| IN08-US2 | User reads the coming days | A saved place | Tap Daily | The daily chart at today's position, the daily AQI and the three days' details | No daily data: the Cordova early return keeps the previous page | AC2, AC3 |
| IN08-US3 | User refreshes | Weather shown | Tap the selected tab; return to the app within and after ten minutes; wait for the refresh interval | The tap and the timer reload at once; a return within ten minutes loads nothing, later it loads | A tap while O03 is open: nothing | AC1 |
| IN08-US4 | User switches places while one loads | Two places, a slow server | Swipe to the next place before the first answers | The page shows the second place; the first place's answer is saved with the first | An older answer after a newer one for the same place counts for nothing | AC1 |
| IN08-US5 | User of an old saved place without coordinates | A Korean or a free-form address | Open the place | A Korean address loads by the KMA town route and takes the response's coordinates | A free-form address: one request, the gateway's 501, O03 | AC1 |
| IN08-US6 | User with larger text or an iPad | `xxxLarge`, iPad widths | Open Hourly and Daily | Text grows, the header block and rows grow, every summary line fits, the page keeps the window's width | – | AC2 |
| IN08-US7 | Overseas user | 런던 saved | Open Hourly and Daily | The same pages with the Visual Crossing notice and the provider's link | – | AC2, AC3 |
| IN08-US8 | Maintainer recaptures or regenerates | Mac with Xcode, Node, `client/` | `build-cordova.sh`, `capture.py run`/`provenance`; `tools/weather/generate.py` | New references with provenance; an unchanged source gives no diff | A request leaves the Mac or another simulator: the run stops | AC3 |

### Acceptance (from #2957)

- AC1: Unit tests cover request paths, unit parameters, `Accept-Language`, retries and timeouts, late responses and the refresh gate.
- AC2: On a simulator against production (read-only requests), S03 and S04 render for Seoul and London.
- AC3: Screenshot comparison with Cordova iOS captures of the states on manual pages 3–9 passes at 393×852 pt.
- AC4: README, artifact checker, review PASS and CI before merge.

### Checks

Test-first: the logic tests (`ForecastScopeTests`, `WeatherRequestsTests`, `WeatherRequestTests`, `WeatherSessionTests`, 20 tests) ran first against compiling stubs (no URL, an empty scope and helpers, a repository that skips every load, a session that does nothing, `firstSettled` settling at once) and all 20 failed on assertions (about 2,000 issues); they passed against the implementation without a change to the tests' expectations. `ForecastPageTests` (4) failed against a stubbed `ForecastPage` (17 issues) and passed after. The first app run showed the page's background drawn over the shell's status bar (a SwiftUI background extending into the safe area); fixed before the second production run.

Captures: the Cordova 1.1.2 build of the base commit (`build-cordova.sh` with `http://127.0.0.1:18455`), `capture.py run` on `twios_cap_16` (ko-KR, light): 회현동 and 런던 on Hourly and Daily, the expanded chart, O03. The first run's expander did not open (Ionic ignores synthetic clicks) and the daily title was read from the cached bar; the script now calls the controller. Screenshot comparisons: 20 blocks within strong 0.0199 and mean 3.3 (the detail tables' left-aligned text 1 px from the capture: CoreText measures some Korean texts narrower than WebKit); the headers within strong 0.0017. Mutation checks, run once and reverted: the header content 1 pt lower failed all four header blocks; table rows 1 pt taller failed the four detail tables.

Production (AC2): the native app built with the private server URL, unsigned, on `twios_dev_in07` with an injected state; four launches (Seoul and London, Hourly and Daily), one GET each to `/weather/v000903/coord/37.56,126.98` and `/weather/v000903/coord/51.51,-0.13` with the Korean units. The first run's log stream missed the info-level request lines, so the run was repeated: eight GETs in total, all loaded; the screenshots and the request log stay with the run's local evidence. No other production contact: no Firebase configuration in the build, no photo feed, no push.

Smoke: `swift test`; the scheme on `twios_dev_in07` (unsigned); the import tools and `tools/weather/generate.py` twice with no change; `swift test` in a `git archive` copy of `ios/` alone; the artifact checker on the range. A full scheme run once failed on test resources missing from the app's container mid-run (the container moved to `Dead/`); the rerun passed.

Open risks: the screenshots cover the light theme in Korean at 393×852 only; the dark, old and photo themes, English and other sizes are checked by renders and colors, not by captures (IN-18's matrix). No iPad simulator ran the pages (only renders at iPad widths). The charts keep the Cordova sizes at larger text. `CordovaRegion` (IN-03) still differs from the WebView's region for a language with another region (IN-07's open risk); IN-08 left it, since it affects only the defaults of missing unit members, not the requests. The legacy attempts after settlement (A06) are not reproduced, by decision. IN-04's `Support/App.xcconfig` will include `Private.xcconfig`; until it merges, a build with the server URL needs `-xcconfig Private.xcconfig`. Merging with IN-04 touches the same lines of `Package.swift`, `Info.plist` and the workflow (the scheme change is identical).

## IN-09 — air quality S05 (#2958)

Design note: AirCtrl's scope and tab-air.html are Foundation-only `TWDomain` code (`Air/`: `AirScope`, `AirPage`, `AirChart`), the page is SwiftUI in `ios/TodayWeather/Air/` (`AirPageView`, `AirChartView`, `AirStyle`), and `WeatherScreens` (IN-08) runs the air visit next to the weather visits: a new `AirScope` when the Air tab opens, an `applyEvent` at each of the session's `applies`, the link's pollutant (`goAirInfoPage`) kept across the weather tabs until the Locations tab. Ported from the Android AN-09 page and corrected against the Cordova iOS build, captured on the owned `twios_cap_16` simulator (`ios/tools/air-reference`, the IN-05/IN-07/IN-08 build recipe with a local fixture server; no request left the Mac). The grade and scale mapping (V32) is generated from the Cordova sources in the macOS JavaScriptCore shell (`ios/tools/air/generate.py`). Archify not applicable (no route, collector or storage change on the server; the client reads the air data of the documented `v000903` weather response).

- **Scope:** the Swift `AirScope` is a value type whose `_applyWeatherData` throws a private `Stopped` where the JavaScript `try` stops, so the values not reached keep an earlier place's (A16), and the chart series is reassigned after each slot, as the Cordova scope held the array from the start. A missing slot is dated with `Warnings.jsDate` (JavaScriptCore's reading) and local wall-clock `setHours` (`Warnings.localToUTC`); the expectations for Seoul and New York (a spring-forward gap) were checked in `jsc`.
- **Cordova iOS–specific, not Android:** the header block's 64 pt (`.platform-ios .air`), the iOS template's bell and share glyphs, the WebView's widths and line boxes (`CssLine`), the captured iOS gauge widths (385 pt at 393) and label `offsetWidth`s.
- **Drawing:** the grade line is drawn with CoreText in a `Canvas` (the text on its centered line box, the face on the 24 pt line's full height, `vertical-align: bottom`): SwiftUI's baseline offset moved the whole line 4.5 pt in the first render. The chart's axis is snapped to device pixels as WebKit snaps `crispEdges` (an edge halfway between two pixels goes up), found from the dark capture.
- **Shared IN-08 files:** `Card`, `GlyphText`, `AirRows`, `runs` and `rowHeight` of `WeatherPageView.swift` became internal (no other change); `WeatherScreens` gained the air visit, `AirPage.keys` in its texts, the observed air standard, and `goAirInfoPage`'s pollutant.
- **Production check (completion criterion 2):** the app-hosted `ProductionAirTests`, enabled only by `TEST_RUNNER_TW_PRODUCTION_AIR=1` in a build with the private server URL, runs the live shell against the legacy server; without both it is skipped (CI). The server URL came from the Cordova release inputs as IN-08 took it (the copied `Private.xcconfig` held only the Places key).
- **Not built (decided):** no test, mock or dry-run mode; the tests inject a server double, the state through `AppStateHolder`, and tap the live views through their accessibility elements.

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| IN09-US1 | User checks today's air | A saved Korean place with stations | Tap 대기정보 (Air) | The grade (좋음…) in its color with the face and advice, the scale of the selected standard with the value's label, the hourly air chart, the daily forecast, the pollutant cards, the station and forecast-source rows and the nearby stations, as the Cordova iOS page (manual page 10) | The request fails: O03; the page keeps what it showed | AC1, AC3 |
| IN09-US2 | User looks at one pollutant | Air shown | Tap 초미세먼지 in 상세대기정보 | The page goes to the top; the main box, scale, chart and station cells show PM2.5 (manual page 11) | A pollutant without a value: the first with one, the overall index last | AC1, AC3 |
| IN09-US3 | User compares measuring stations | Seoul with three stations | Tap the second station card | Its values in the main box, scale, detail and info cards; the card is selected (manual page 12); a reload or swipe returns to the first station | – | AC1, AC2, AC3 |
| IN09-US4 | User opens air from the weather page | S03 with air cells | Tap the PM2.5 cell, then Hourly, Air, Daily, Air, Locations, Air | S05 opens on PM2.5 and keeps it across the weather tabs; after Locations it opens on the overall index | – | AC1 |
| IN09-US5 | User of a place without air data | A response without stations or observation | Open Air | Only the grade scale, without value, chart or station | A swipe from a place with air keeps that place's air (Cordova A16) | AC1, AC3 |
| IN09-US6 | User reads the forecast source and standard | Air shown | Tap 예보자료, then 대기환경기준 | O08 with the source's description and 닫기; the units page (IN-12) | Another source: nothing opens | AC1 |
| IN09-US7 | User with larger text, another theme or an iPad | `xxxLarge`, dark theme, iPad widths | Open Air | Text and rows grow, every grade line and band text fits (ellipsis as Cordova), the cells scroll sideways; dark colors in the dark theme, the light page in the photo and old themes | – | AC3 |
| IN09-US8 | Maintainer recaptures or regenerates | Mac with Xcode, Node, `client/` | `build-cordova.sh`, `capture.py run`/`provenance`; `tools/air/generate.py` | New references with provenance; unchanged sources give no diff | A request leaves the Mac or another simulator: the run stops | AC1, AC3 |

### Acceptance (from #2958)

- AC1: Unit tests cover the grade and scale mapping for every air standard and pollutant (V32).
- AC2: On a simulator against production (read-only requests), Seoul shows its stations, and selecting another station changes the values.
- AC3: Screenshot comparison with Cordova iOS captures of the states on manual pages 10–12 passes.
- AC4: README, artifact checker, review PASS and CI before merge.

### Checks

Test-first: the logic tests (`AirScopeTests`, `AirScaleTests`, `AirPageTests`, `AirChartTests`, 18 tests) ran first against compiling stubs (a scope whose methods do nothing and whose slot dating returns "", an empty page, an empty chart) and 16 failed on assertions (7,329 issues); the two that passed check the golden's provenance and IN-02's grade tables, which were not stubbed. They passed against the implementation after one fix of the test (the captured header title is null on S05; the title is compared with the captured `address`).

Captures: the Cordova 1.1.2 build of the base commit (`build-cordova.sh` with `http://127.0.0.1:18456`), `capture.py run` on `twios_cap_16` (ko-KR): seven states, O08 and the navigation, 40 blocks. Screenshot comparisons: the first run had every block's height right but the grade line 4.5 pt low (SwiftUI's baseline offset); after drawing it with CoreText the headers are within strong 0.0005, and the axis snapping lowered the dark chart from strong 0.0043 to 0.0014. All 40 blocks within strong 0.0152 and mean 2.12 (the info card is IN-08's detail table, with its 1 px text offsets). Mutation check, run once and reverted: the main box 1 pt lower, the gauge's bands 1 pt lower, the cells 1 pt taller and the chart's axis 1 pt lower failed every header with a main box, every gauge, chart, detail and station block (69 issues; strong 0.019–0.099 against tolerances up to 0.0152), while the untouched daily and info blocks kept their values.

Production (AC2): the native app built with the private server URL, unsigned, on `twios_dev_in07`; `ProductionAirTests` sent one GET (`/weather/v000903/coord/37.56,126.98` with the Korean units and `airForecastSource=kaq`), showed 중구, 한강대로 and 청계천로, and after the tap on 한강대로 the info card named it and the gauge changed from 58 to 53. No other production contact: no Firebase configuration, no photo feed, no push.

Smoke: `swift test`; the scheme on `twios_dev_in07` (unsigned); the import tools, `tools/weather/generate.py` and `tools/air/generate.py` twice with no change; `swift test` in a `git archive` copy of `ios/` alone; the artifact checker on the range.

Open risks: the captures cover Korean at 393×852 in the light and dark themes; English, the old and photo themes and other sizes are checked by renders and colors, not captures (IN-18's matrix). No iPad simulator ran the page (renders at iPad widths). The chart keeps the Cordova sizes at larger text and follows the card's width when the window changes (the Cordova chart kept its first width). The value label's width comes from CoreText's bold digits, up to 1/3 pt narrower than WebKit's, which can move the label by half a point. Merging with IN-04 or IN-10..IN-16 touches `WeatherScreens` (the Air tab content) and the shared `WeatherPageView` helpers made internal here.
