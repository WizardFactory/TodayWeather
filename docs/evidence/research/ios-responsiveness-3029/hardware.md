# Physical iPhone follow-up on 18 November 2026

The physical target was an iPhone 12 Pro Max on iOS 26.0.1 (23A355), connected to Xcode 27.2 over the local network. The baseline was TodayWeather 2.0.0 (1) at `8dd57e3`. All runs used a development-signed, arm64 Release build under the separate bundle identifier `net.wizardfactory.todayweather.profile3029`. The shipping app and its App Group were isolated from the experiment.

## Chart and launch results

The iPhone registered one animation hitch in twenty forward/return pairs on the Hourly chart, lasting 16.68 ms. The affected pair was batch B, iteration 2. The other nineteen pairs and all forty Daily-chart and vertical-control pairs registered zero hitch time. The OS signpost saw fewer affected pairs than the simulator callback probe. An independent Instruments pass below also found hitches during horizontal scrolling. The paired signpost covers both directions and both drag and deceleration. It cannot locate the one hitch within the pair.

| Surface | Affected pairs A / B | Total hitch time A / B | Median frame rate A / B |
| --- | ---: | ---: | ---: |
| Hourly chart, left then right | 0/10 · 1/10 | 0 · 16.68 ms | 58.67 · 58.49 fps |
| Daily chart, left then right | 0/10 · 0/10 | 0 · 0 ms | 55.04 · 55.85 fps |
| Hourly vertical, forward then reverse | 0/10 · 0/10 | 0 · 0 ms | 58.73 · 58.77 fps |

The OS measured native relaunch to its first responsive frame at median 578 and 575 ms. The test verified the Hourly header and hittable menu. The frame-count field reported zero even where the separate frame-rate field returned a value. Raw frame counts and per-frame maxima cannot be recovered from these aggregate signposts. [OS metrics and samples](hardware-samples.csv)

## Drag and deceleration

A separate instrumented build recorded the owning scroll view, touch dispatch, display-link callbacks and changing content offsets. In each batch, all ten left and ten right gestures moved the Hourly chart horizontally. All ten forward and ten reverse controls moved the page vertically. The physical display reported a 60 Hz maximum. At the start of this run the phone was in portrait at 428 × 926 points, with standard Large text, Low Power Mode off and a fair thermal state.

| Surface and phase | Moving gestures A / B | Worst callback interval A / B |
| --- | ---: | ---: |
| Hourly horizontal drag | 20 / 20 | 16.674 / 16.675 ms |
| Hourly horizontal deceleration | 20 / 20 | 16.674 / 16.807 ms |
| Vertical drag | 20 / 20 | 16.675 / 16.675 ms |
| Vertical deceleration | 20 / 20 | 16.809 / 16.808 ms |

No moving callback interval exceeded 1.5 times its observed frame budget in these gestures. The OS hitch and the callback series came from different runs. [Phase samples including rehearsal](hardware-callbacks.csv)

A positive control stalled the main thread once after release in each direction. The app logged 22 stalls of 120.34–121.16 ms including rehearsal. The OS measured hitch time in all ten measured pairs, with a median of 83.37 ms per pair and a range of 66.69–133.41 ms. Its total was 17 hitches across the ten pairs. The metric detects disruption in this fixture, although main-thread stall duration and presented hitch time have different boundaries. [Stall log](hardware-control.csv) · [OS control samples](hardware-samples.csv)

## Frames on the physical display

A 279.24 s Animation Hitches recording attached to the isolated process and captured 12,221 swaps on the built-in display. The device Mach timebase aligns those events with the scroll-view motion. Count an interval only when both successive swaps fell inside the moving portion of the same drag or deceleration. This yielded 10,936 complete display intervals across the 80 measured gestures. Each batch had ten gestures in each direction per surface.

| Surface and phase | Gestures with a swap interval over 25 ms, A / B | Longest swap interval, A / B |
| --- | ---: | ---: |
| Hourly horizontal drag | 2/20 · 1/20 | 33.350 · 33.340 ms |
| Hourly horizontal deceleration | 19/20 · 20/20 | 50.018 · 66.684 ms |
| Vertical drag | 0/20 · 1/20 | 16.676 · 50.014 ms |
| Vertical deceleration | 18/20 · 18/20 | 50.024 · 100.032 ms |

Instruments attributed eight hitches to the app during six of the forty measured horizontal gestures. Three started during drag and five during deceleration. Both batches recorded four hitches across three gestures, around one 60 Hz frame of delay per hitch. The forty vertical gestures had zero attributed hitches in their moving phases. Two further events in the recording fell outside all measured motion windows. The Instruments and XCTest runs used different binaries and instrumentation, so their counts cannot be pooled into an incident rate. The horizontal chart has the clearest repeatable rendering delay on this phone. The controlled text-layout experiment below tests the cause of these misses. [App-attributed hitch events](hardware-hitches.csv)

Both surfaces frequently went more than 25 ms between swaps during deceleration. These intervals measure how long a displayed surface persisted while the app reported changing offsets. They include slow movement near rest. Assigning a dropped frame or a chart-specific defect to every long interval would overstate the evidence. [Per-gesture display intervals](hardware-frames.csv) · [Swaps from the longest intervals and their controls](hardware-swap-trace.csv)

## Why the Hourly chart misses frames

When horizontal scrolling makes SwiftUI rebuild the Hourly Canvas display list, the app walks all day and hour labels and the SVG scene again on the main thread. For each label, the baseline constructs an attributed string, creates a Core Text line, and separately measures ascent and descent. Measurement constructs another line to inspect fallback glyph fonts. The same strings and sizes recur across draws. The captured stack runs from Core Animation transaction commit through SwiftUI layout, `CanvasDisplayList.updateValue()`, `HourlyChartContent`, `CssText.line` and `CTLineCreateWithAttributedString`. The SVG value labels use the same helpers. [Hourly Canvas](../../../../ios/TodayWeather/Chart/HourlyChartView.swift) · [Text measurement](../../../../ios/TodayWeather/Chart/ChartStyle.swift) · [SVG text](../../../../ios/TodayWeather/Chart/SvgDrawing.swift)

For each of the eight attributed hitches in moving gestures, join the app update, renderer and GPU intervals by display swap ID. Compare each hitch with the nearest earlier completed non-hitch app update in the same gesture and phase. Sample the app's running main thread only inside the corresponding update interval. Instruments weights each sample at 1 ms. Stack categories may overlap.

| Same-device trace | Eight hitch frames | Eight matched normal frames |
| --- | ---: | ---: |
| App update duration, median (range) | 20.26 ms (17.42–22.70) | 1.98 ms (1.26–3.54) |
| Renderer duration, median | 5.54 ms | 5.75 ms |
| GPU duration, median | 0.71 ms | 0.66 ms |
| Samples in Hourly scrolling Canvas / all running main-thread samples | 115 / 158 | 0 / 15 |
| Samples in chart font, line construction or text metrics | 102 / 158 | 0 / 15 |

Every affected app update exceeded the 16.67 ms display period. Horizontal updates with no sampled content draw had a 2.89 ms median across 5,314 updates wholly inside measured movement. The median was 14.21 ms for 187 horizontal updates with a sampled draw. The 5,532 vertical updates had no sampled Hourly content draw. This explains how the problem can be specific to a subset of horizontal frames even when callbacks keep arriving on time. The trace does not identify the individual SwiftUI dependency that invalidated the display list. [Per-frame comparisons](chart-cause-frames.csv)

### Isolating the cost of text layout

The iPhone ran one arm64 Release diagnostic binary in original → reuse → reuse → original order. Each process rehearsed one left/right pair, then measured ten pairs in the same dense Seoul chart. The launch flag changed only reuse of immutable Core Text lines (keyed by text runs, sizes and color) and ascent/descent (keyed by text and size). Both modes kept the same drawing commands, chart data, gesture driver and timing probes. The probe timed the scrolling content Canvas closure with the device monotonic clock and wrote records on a background queue. Only draws fully contained within an XCUI swipe call enter the distribution.

| Run order | Completed content draws | Median draw | p95 draw | Pairs with an OS hitch |
| --- | ---: | ---: | ---: | ---: |
| Original, A1 | 100 | 11.14 ms | 14.79 ms | 6/10 |
| Reuse, B1 | 96 | 2.82 ms | 3.48 ms | 0/10 |
| Reuse, B2 | 100 | 2.75 ms | 3.42 ms | 0/10 |
| Original again, A2 | 100 | 11.13 ms | 13.21 ms | 0/10 |

Reusing chart text removed about 8.3 ms from the median redraw in both comparisons. Disabling reuse restored the original draw cost. The unchanged binary produced byte-identical 1,284 × 902 opening-chart PNGs across all four launches, and each measured pair verified visible displacement in both directions and the expected city title. The diagnostic sample establishes a reversible CPU cost. The final original batch also had zero hitches, so these 40 pairs do not establish how often shipping users would avoid a missed frame. The test measures the two forms of reuse together. A production implementation would need a bounded cache and correctness checks for changing content and typography. [Per-pair OS metrics](chart-cause-trials.csv) · [Per-draw timings](chart-cause-paints.csv)

## Search and drawer

The same iPhone ran the release baseline, current master at `4afc6d2a`, then the baseline again. Each test typed 부산 after terminating and relaunching the app, confirmed the echoed text and first matching town, cleared the query, and repeated the input in the same process. The municipal data, driver, seed and build settings were shared. Each cell gives the two batch medians in milliseconds. The final column takes the difference within each trial before computing its median.

| Build | First search | Repeated search | Paired first minus repeated |
| --- | ---: | ---: | ---: |
| Baseline | 709.7 / 703.0 | 671.5 / 672.3 | 38.5 / 36.6 |
| Current master | 681.9 / 679.5 | 675.2 / 676.1 | 9.5 / -0.3 |
| Baseline repeat | 758.0 / 755.0 | 670.4 / 686.7 | 75.7 / 36.6 |

Both current-master batches had a smaller median first-search penalty than all four baseline batches. This supports a reduction in the cold cost for this particular input and phone. The interval includes keyboard injection, app work and accessibility observation. The spread in the baseline repeat limits the precision of any user-facing time savings. Master combines typed decoding with a shared asynchronous loader, so the experiment cannot attribute the change to either in isolation. The activity trace retains the first measured cold and warm query in batch A for each build, including input synthesis and row lookup. [XCUI trace excerpt](hardware-search-trace.csv)

The drawer became hittable by median 494/494 ms after XCUI tap dispatch. Return from Units to interactive Hourly took median 583/584 ms. Both ten-run batches verified the Units destination and the home screen. These action-to-assertion intervals include input injection and XCTest synchronization. [Underlying samples](hardware-samples.csv)

## Protocol

The physical build used the same dense Seoul data as the simulator chart experiment. The weather GET read the fixture from the app bundle at the transport boundary. There were 41 short forecast rows and 18 named air stations. The fixture was 324,517 bytes with SHA-256 `1945adf31948ff8dfbd4aba283d597f1a6a8d1ca802d5f4e518fcb31b974c088`. The Seoul city, units and startup state came from the native simulator seed. The phone retained its system text-size setting. The fixture used Korean app launch arguments and portrait orientation. The initial attempt with an empty app container stayed on the launch screen and failed the 30-second Hourly assertion. The device-only profiling bundle omits the production App Group entitlement. On an empty store, `MigrationRunner` requests Cordova sources. `suiteValues` throws if the App Group container is missing, and `AppStartup.loadState` defers startup. The signed profiling binary had no App Group entitlement. The pinned storage test `anUnreadableSuiteIsNotAbsence` reproduced the missing-container error. With existing native state, the runner returns before reading those sources. This explains the fixture timeout and leaves production first-install and upgrade latency unmeasured. [Startup](../../../../ios/TodayWeather/AppStartup.swift) · [Migration and source checks](../../../../ios/Core/Sources/TWStorage/AppStateStore.swift)

The chart walk recorded a rehearsal, then two sets of ten left/right pairs per chart. The displayed chart had to change after a left pan and the city title had to stay the same. Separate OS metric runs used XCTest’s scrolling-and-deceleration signpost and required the chart region to change on both the forward and return pan. The vertical control checked displacement and return of the Hourly header. The native launch metric required the expected header and a hittable menu. Each OS metric invocation had its warm-up and ten measured iterations. The two invocations used the same binary and fixtures. [UI assertions](../../../../ios/TodayWeatherUITests/ResponsivenessUITests.swift) · [Individual observations](hardware-samples.csv)

Full xcresults, per-gesture timestamps, fixture sources, build logs and graphics-instrument diagnostics are retained locally in `reports/3029/physical-retry/`.
