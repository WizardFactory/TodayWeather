# Profiling the native iOS fixture build

To reproduce the 2.0.0 (1) baseline from this evidence revision, create a disposable worktree at `8dd57e3d6a7c4dfb6b63c3056a1bf125284729f1`. From that worktree, copy in the measurement tools and opt-in tests with the command below. Run the simulator instructions there. The chart code on the evidence revision already includes the later product changes.

```sh
git restore --source=origin/evidence/ios-responsiveness-3029 --worktree -- \
  ios/tools/responsiveness ios/TodayWeatherUITests/ResponsivenessUITests.swift \
  ios/TodayWeatherTests/ResponsivenessPhaseTests.swift
```

From the repository root on an Apple silicon Mac with Xcode, a supported simulator runtime and Python 3:

```sh
mkdir -p reports
ios/tools/responsiveness/run.sh reports/ios-profile-run \
  com.apple.CoreSimulator.SimDeviceType.iPhone-16 com.apple.CoreSimulator.SimRuntime.iOS-26-5
```

Use a new output directory for each run. The runner creates and shuts down a dedicated simulator. Its UDID, pinned revision, Release products, XCTest results, request ledger, component samples, per-action summary and foreground/background process samples stay in the output directory. It builds with a loopback weather URL and blank Places, banner and photo settings. Port 18529 must be available. The runner returns a failure when a test fails. The logs retain the failed action and its batch. Run the opt-in UI tests through the runner so the fixture configuration is verified before launch.

The first pass rehearses each short interaction before two batches of ten. For metrics collected by XCTest itself, each invocation performs ten measurements after its warm-up. The runner invokes launch and scroll twice. A tap sample starts before the automation call and ends after the route-specific assertion. The system launch signpost measures the first responsive frame. Scroll signposts sum drag and deceleration separately for the paired forward/reverse gesture. See the [dated results and coverage](../../../docs/evidence/research/ios-responsiveness-3029/README.md).

## Supplemental experiments

- **Install and migration.** Use a disposable 13-inch iPad Pro (M4) at default portrait geometry and text size. Build the same Release app for port 18530, run `server.py 18530 LOG.jsonl` and install the app once. `launch.py` uninstalls that bundle for every trial on the named profile simulator. Pass its UDID, the app directory, the two dated reference PNGs and a new output directory. The script requires ffmpeg. Each upgrade trial copies the captured Cordova WebKit tree into the fresh data container. It verifies migration source, selected place and screen pixels. It alternates trial order and excludes the status bar. A screen observation includes simctl dispatch and screenshot latency.
- **Cache visibility.** With `server.py` running and a seeded iPhone 16 profile simulator, run `python3 ios/tools/responsiveness/cache.py UDID CONTROLS.json NEW_OUTPUT`. Confirm that its two reference screenshots show the expected temperatures. The following describes its observation protocol. In the dedicated simulator's `Library/Caches/weather` JSON for `coord:37.567,126.978`, set `weather.currentWeather.t1h` to 42.8. Serve the unchanged 3.3-degree Seoul fixture with `{"delay_ms":4500}` in the server controls. Capture separate hero references with a longer rehearsal delay. For every cold process restore the cached marker, observe the temperature region until both states appear, and retain upper bounds from launch dispatch to each screenshot. The server ledger supplies the successful request count and payload size.
- **Decoder prototype.** The optimized TownProbe links the Release simulator objects. Its `typedList` control decodes fixed fields and checks equality of every town and its coordinates. For the app-level comparison, make a disposable copy of baseline `ios/`, replace the body of `BundledTown.list` with `try? typedList(data)`, copy the `TownFields` and `typedList` declarations from TownProbe, and run the same search UI test on baseline, prototype and baseline again. The executable and URL of each build must correspond to its local fixture.
- **Display callbacks.** In a separate baseline copy, add `ProfileWindow.swift` to the synchronized app target and change the single scene-window constructor in `AppScenes.swift` from `UIWindow(windowScene: scene)` to `ProfileWindow(windowScene: scene)`. Install that Release build in a dedicated simulator. Run `testHourlyScroll` twice. After each run, copy `Documents/scroll-callbacks.csv` from the app data container and move it aside before collecting the next batch. `scroll.py CAPTURE.csv` summarizes distinct touch IDs, scroll-view ancestors, axes, drag and post-release callbacks. The first forward/reverse pair rehearses the test. The capture measures app-side callback cadence during motion. A compositor trace is needed for presented frames.
- **Shape and text controls.** The supplemental `testScrollSurfaces` requires `TEST_RUNNER_TW_SCROLL_MATRIX=1`. Set the fixture controls to `{"size":"sparse"}` or `{"size":"dense"}`. Pass the same value as `TEST_RUNNER_TW_PROFILE_SIZE` and `normal` or `large` as `TEST_RUNNER_TW_PROFILE_TEXT`. A fresh Seoul seed has one saved city plus its position placeholder. For the long list, stop the disposable app and append forty copies of its Seoul place with distinct names to its native state. Restore the short seed between conditions. The sparse fixture returns 8 short forecast rows, one station and one warning. The dense fixture returns all 41 short rows, 18 named stations and 18 warning records. Run `scroll.py CAPTURE.csv --log XCTest.log` to match the simulator uptime of each touch with its test action. A gesture can target content that fits entirely. Check the observed axis and displacement before counting a scroll.
- **Chart repeat.** On the instrumented build with the dense fixture, enable `TEST_RUNNER_TW_SCROLL_MATRIX=1` and run `testChartPans`. Save the CSV and use the matching test log with `scroll.py`. The suffix on the gesture label identifies batch and repetition. Batch zero rehearses a pan in each direction for each chart.
- **Hosted phase boundaries.** In a Release, arm64 build of the TodayWeather scheme with `ENABLE_TESTABILITY=YES` and blank private settings, select `-only-testing:TodayWeatherTests/ResponsivenessPhaseTests` and pass `TEST_RUNNER_TW_PROFILE_PHASES=1` to xcodebuild. This experiment observes local and predicted rows in the hosted accessibility tree and timestamps national route, fixture delivery, correct populated content and Back separately. It uses in-memory stores and injected responses.
- **Repeated visits.** The runner samples the target simulator app PID after each successfully observed return in the national-page and settings journey. `visits.csv` includes process CPU time, RSS and cumulative fixture request/body totals. Compare samples for the same PID and subtract consecutive counters. RSS includes regenerable allocations and the resident parts of shared mappings.

## Physical iPhone

Use a development-signed copy of the intended release revision on a compatible physical phone. Give the fixture app and UI runner distinct bundle identifiers from the installed product and omit the production App Group and push entitlements. Put the dense Seoul JSON in the app bundle, return its bytes at the weather GET transport boundary for the exact Seoul coordinates, and use empty SDK settings. With the profile app stopped, copy [the native Seoul seed](seoul-state.json) into `Library/Application Support/TodayWeather/app_state.json` in that app’s data container. Set the test runner’s `XCUIApplication(bundleIdentifier:)` target to the profile app if Xcode resolves the original product. This setup exercises a native relaunch from known state. The simulator runner's loopback server lives on the Mac.

Build the TodayWeatherUITests scheme for the device in Release. Run the following selectors together twice, with parallel testing disabled and `TEST_RUNNER_TW_PROFILE_FIXTURE=1`. Each invocation uses a fresh xcresult path.

- `ResponsivenessUITests/testDeviceHourlyChart`
- `ResponsivenessUITests/testDeviceDailyChart`
- `ResponsivenessUITests/testDeviceVertical`
- `ResponsivenessUITests/testNativeRelaunch`

Use the `TodayWeatherUITests/` target prefix in xcodebuild's `-only-testing:` options. Export each result with `xcrun xcresulttool get test-results metrics --path RUN.xcresult`. Each scroll iteration is a pair of opposite directions. Read the duration, frame rate and hitch counters with their reported units. [Observed device conditions and results](../../../docs/evidence/research/ios-responsiveness-3029/hardware.md)

For the hitch-detection control, install the separate build that uses the supplied ProfileWindow and run only `ResponsivenessUITests/testInjectedHourlyChart` with `TEST_RUNNER_TW_PROFILE_INJECTION_CONTROL=1` and the fixture flag. The test requests one 120 ms main-thread stall per moving gesture after release. Retrieve `Documents/injection-log.csv` from the profile app container and compare the logged stalls to the measured OS hitch durations.
