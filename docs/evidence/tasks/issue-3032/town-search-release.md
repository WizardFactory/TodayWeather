# Cold local town search on iPhone 16

Measured 2026-11-18 on an arm64 iPhone 16 simulator (iOS 26.5, Xcode 27.2/27B52). Baseline `dc90829466702b929858b443771c41c879f1d9d5` uses the strict JSON tree decoder. The candidate uses the shared app loader and typed decoder for the shipped file. Both Release builds use the same local resources and hosted Start view with Google disabled. [Raw samples in nanoseconds](town-search-samples.csv) and [issue](https://github.com/WizardFactory/TodayWeather/issues/3032).

| Implementation | Batch | File lookup and read (ms) | Decode (ms) | Input handler (ms) | Main-actor search work (ms) | First visible local row (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 1 | 0.65 [0.19–3.22] | 31.78 [21.65–34.13] | 33.74 [23.14–36.74] | 33.74 [23.14–36.74] | 40.13 [27.75–45.15] |
| Baseline | 2 | 0.65 [0.21–0.95] | 33.20 [21.58–42.77] | 35.10 [23.12–45.46] | 35.10 [23.12–45.46] | 44.16 [29.50–52.14] |
| Candidate | 1 | 0.44 [0.23–0.63] | 10.09 [5.55–11.91] | 0.04 [0.03–0.15] | 1.43 [1.22–2.25] | 27.03 [16.14–43.03] |
| Candidate | 2 | 0.59 [0.31–1.11] | 11.45 [6.64–12.47] | 0.09 [0.03–0.15] | 2.15 [1.24–2.37] | 35.90 [22.28–40.80] |

Values are median [min–max] across ten samples per batch after two rehearsals. All 20 measured queries in each build produced the expected `대치1동` row. The first-visible median decreased by 13.10 ms in batch 1 and 8.26 ms in batch 2. Both the read and decode ran on the main thread for every baseline sample and off it for every candidate sample.

The probe runs `xcodebuild test` on the `TodayWeather` scheme with `-configuration Release -parallel-testing-enabled NO ENABLE_TESTABILITY=YES ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO` and only the temporary hosted probe and candidate contract suite selected. Each query creates a new Start fixture, with an empty in-memory loader and a fresh hosted view after the introductory alert closes. The operating system's filesystem cache is left at its natural state. It timestamps the call to the same `StartPage.change` handler used by the search input binding, then checks the window for `start-result-0` and validates the current query and the single expected result. Accessibility polling sleeps for 1 ms between misses. This interval includes handler, scheduling and observable SwiftUI row creation. It excludes keyboard event delivery and does not measure compositor presentation or a physical device.

Lookup/read measures resource URL resolution and `Data(contentsOf:)`. Decode includes the candidate's fixture digest check and typed parser. Main-actor search work measures the synchronous input handler plus the candidate's resumed scan and publication. It excludes suspended time, SwiftUI layout, and the shared cache's small bookkeeping hop. The probe logs these intervals with a monotonic clock. Instrumentation is temporary and follows the same data/query paths as the shipping implementation. The comparison measures both changes together.
