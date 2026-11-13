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
