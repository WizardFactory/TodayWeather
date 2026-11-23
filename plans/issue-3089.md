# Shorten iOS pull request checks

[Issue #3089](https://github.com/WizardFactory/TodayWeather/issues/3089) tracks the work. This plan proposes a measured trial for the [iOS workflow](../.github/workflows/ios.yml). The CI maintainer owns the workflow, test partition and rollout. Keep the app, production configuration, screenshot baselines and tolerances unchanged throughout the trial.

## Baseline

On #3070 the regular job took 66m08s, its simulator step took 61m34s and the 193-test app run took 51m46s. The macOS core step took 3m29s and UI-test compilation took 27s. The nationwide-screen suite alone took 8m17s. In a different completed standalone run the size/language matrix took 27m02s of the 83m14s app run. Compare candidates on a common revision. These two historical samples give useful weights but are not a paired benchmark. [Regular job](https://github.com/WizardFactory/TodayWeather/actions/runs/44881036804/job/136776147199) · [Standalone job](https://github.com/WizardFactory/TodayWeather/actions/runs/44699885221/job/136165402626)

## First implementation plan · Measure the cost of a screenshot comparison

**Question.** How much simulator test time can the iOS CI maintainer recover by writing PNGs only for failed comparisons? Which part of a comparison should be investigated next? Complete this experiment before selecting a runner partition.

1. **Freeze the sample.** Run all states in NationScreenshotTests and a fixed, versioned manifest of MatrixScreenshotTests cases. Use all declared argument cases of alarmsPage (full screen), weatherPages (blocks across 375@2x, 393@3x and 440@3x) and sideMenu (masked copy). Profile the iPad hosted-layout suite separately if needed. Record the method, state, locale, point size, pixel dimensions and reference identity for every measured image. Freeze the same cases for both modes before inspecting results. The sample is for profiling. Keep the full PR suite and all tolerances for qualification.
2. **Build once.** On the same revision build one instrumented Debug test binary with a runtime capture-mode switch. Pin the runner image, Xcode, simulator device/OS, scale, locale, fixtures and test order. Start every run with an empty, run-specific chart-compare directory. Avoid concurrent simulator work on the measuring host. Record simulator startup and build time separately in the run notes.
3. **Measure the work.** Use a monotonic clock to time non-overlapping reference decode/crop/copy, native render, blur, pixel comparison, and diagnostic image construction/encoding/writing. Batch timing output after each case. Record suite elapsed time, other elapsed time, case count, image count and bytes written. Record the instrumentation overhead using an untimed-control mode. Use serial execution for the sample so phase totals can be interpreted against elapsed time.
4. **Run a paired experiment.** A writes every comparison. B writes only failures. Warm both modes, then alternate pair order (AB, BA, AB) with identical fixtures. Keep per-pair timings and the median of A minus B, by suite and overall. Define repeat noise as the larger within-mode range (max minus min for the three A times and the three B times). Count a speedup as repeatable only if all three paired savings are positive and their median exceeds twice this noise. This is a screening rule, not a statistical significance test. Retain the raw measurements and environment metadata with the CI run.
5. **Prove the diagnostic path.** Require identical expected case IDs, pass/fail results, strong and mean differences, height deltas and mask bits for identical input bitmap pairs. Hash masks outside timed sections. Use the test-only environment flag to crop one rendered screen to a single pixel row and breach the existing height tolerance and confirm a failing result plus readable native/diff PNGs in B. Passing cases in B emit no diagnostic PNGs. Explicit capture-all mode still produces the complete reference set of diagnostic files. Clear the mismatch flag before the timing trials.
6. **Record the decision.** A missing case, changed comparison or missing failure image blocks adoption. Report observed savings alongside repeat noise and the largest measured phase. Use phase shares from capture-all runs. If PNG output takes at least 10% or the repeatable-speedup rule passes, qualify failure-only on CI. If the paired result is inconclusive, report any I/O savings separately. At 40% or more for blur plus compare, prioritize a metric-equivalent comparator experiment. At 40% or more for render or residual, profile that path before optimizing it. Local measurements guide prioritization. Measure workflow adoption on macos-26 CI. Validate any winning configuration on a complete standalone run before using it in the wider workflow trial. The 30% target applies to the eventual PR workflow, not this sample.

**Implementation handoff.** One iOS CI maintainer owns the test-only hooks and experiment harness under ios/TodayWeatherTests and ios/tools. Deliver a case manifest, reproducible run invocation, per-case timing table, paired summary and the induced-failure artifacts. Record selected evidence and the decision on #3089. The current deliverable is the protocol; measurements start during implementation.

## Implementation sequence

| Task | Depends on | Owned change and verification |
| --- | --- | --- |
| A · Capture the baseline | Ready | In ios/tools and the workflow summary, record workflow creation, job starts/finishes, runner image, Xcode/runtime, executed test IDs, parameter cases, skips, setup/build time and comparison artifacts. Inventory TodayWeatherTests plus TWResourcesTests, TWStorageTests, TWModelTests, TWDomainTests and TWDataTests in the [shared scheme](../ios/TodayWeather.xcodeproj/xcshareddata/xcschemes/TodayWeather.xcscheme) and current required-check names. Record available macOS slots. Verify the inventory against a complete standalone result. |
| A2 · Reduce work per comparison | A | Time render, image decode, blur/compare and PNG writing separately on a representative ordinary suite and matrix cases. Benchmark failure-only PNG output with an explicit capture-all mode for maintainers. Optimize the pixel loop only if profiling warrants it. Compare old and new strong/mean/height and every mask bit on existing images, edges, unequal sizes and threshold cases. Force a mismatch and verify both diagnostic PNGs. |
| B · Compare partitions | A2 | Trial two standalone simulator partitions on a branch. Start with matrix plus short suites versus remaining screenshots and layout tests, then rebalance using A. Use explicit selectors for heavy suites and a complementary default run for everything else. Verify selectors against actual Xcode results, including all eight parameterized methods in [MatrixScreenshotTests](../ios/TodayWeatherTests/MatrixScreenshotTests.swift) and package testables. Each simulator runner removes and verifies absence of the legacy directories before building. |
| C · Qualify the merge gate | B | Preserve the full-checkout import/regeneration check and UI-test compilation. Keep the macOS core tests in the standalone environment. Validate the success and failure paths below. Preserve existing check names or map them through aggregate checks that inspect every dependency, including cancellations. Confirm protections before cutover. |
| D · Adopt or revert | C | Measure the workflow on the same source, Xcode, simulator and runner class. Compare at least three baseline and three candidate runs, alternating where capacity permits. Record individual wall times, medians, queue and total runner minutes. Keep the existing workflow as the rollback revision. |

One implementation PR against then-current master can carry A through D, with separately measurable commits for A2 and B and trial runs on its candidate branch before switching the normal PR path. Preserve the existing trigger paths and data-generation checks. Parallel work begins only after A identifies which selectors and macOS slots are available. If only one slot is available, benchmark one deduplicated standalone simulator run first. Build artifacts shared across hosts introduce a separate portability question; start with isolated builds and measure the overhead.

## Acceptance scenarios

| User and prerequisite | Action | Expected evidence and failure path |
| --- | --- | --- |
| Contributor with a passing reference revision | Run both layouts on the same source, compare expected IDs with the union of completed candidate results, then add a small test outside the heavy groups. | All expected testables and parameter cases run, the new test is discovered, and unexplained skips, overlaps or omissions fail qualification. Retain the intentional macOS/iOS platform coverage. |
| iOS maintainer with a disposable test branch | Introduce a reference mismatch, stale imported asset and dependency on a removed directory in separate trials. Cancel or omit one required partition in a further trial. | Visual failure surfaces the case and downloadable image/diff with a unique artifact name. Import drift fails the full-checkout job. The dependency fails standalone. The aggregate cannot pass on a missing, cancelled or failed partition. |
| PR author under ordinary runner demand | Open a qualifying PR, compare time to the final required result and inspect runner consumption. | Adopt only with lower median end-to-end latency and documented cost. Proposed target is at least 30% lower median with no increase in summed runner minutes. If speed improves at higher cost, report the tradeoff before adoption. If queueing or cold builds erase the gain, keep the previous layout and revisit partition count. |

The target and sample size are working proposals. Three runs can support an initial decision but cannot reliably establish a tail percentile. Check subsequent PRs for sustained latency, runner usage and flakes. No visual coverage moves to a scheduled-only job in this trial. The immediate deliverable is an experiment plan; select the final partition from measurements.

## Independent planning input

Gemini 4 Neon High identified two costs worth isolating before adding runners. The [shared image comparator](../ios/TodayWeatherTests/ChartScreenshotTests.swift) blurs both inputs and builds a pixel mask. The [nation suite](../ios/TodayWeatherTests/NationScreenshotTests.swift) writes its render and diff before checking tolerances. Their individual share of elapsed time is unmeasured. Task A2 tests that hypothesis first. Measure the best single-runner layout against the split, retaining the simpler layout if it meets the latency and cost targets. For back-to-back pushes, separately trial cancelling superseded PR runs, keyed by workflow and PR number. Verify that a different PR and master pushes continue and the latest revision still requires a complete successful result.

## Local measurement result

iPhone 17 Simulator (iOS 26.5), Xcode 27.2. Three alternating pairs used the same Debug test binary. The sample contained 92 comparisons across nation, forecast, alarms and side-menu screens, with all declared test arguments in each selected test.

| Pair | Capture all (s) | Failures only (s) | Saved (s) |
| --- | ---: | ---: | ---: |
| 1 | 657.89 | 628.42 | 29.47 |
| 2 | 653.52 | 628.62 | 24.90 |
| 3 | 655.87 | 628.41 | 27.47 |

The median paired saving was **27.47s (4.2% of the median capture-all run)**. The larger repeat range was 4.37s. Median suite savings were 16.39s for Matrix and 11.07s for Nation. The experiment met the agreed repeatability rule. Capture-all used **94.7%** of test time for blur and pixel comparison and **4.2%** for diagnostic PNGs.

All six Xcode runs passed all 92 comparisons. Capture-all wrote 184 PNGs per run and failure-only wrote zero on the passing fixtures. The induced height mismatch produced one Swift Testing failure and both readable PNGs, with no PNGs for other cases. Xcode stalled while finalizing the induced-failure result bundle. The separately verified Swift Testing log and PNGs provide the failure evidence. One animated loading frame varied across runs and kept the same reference, dimensions and verdict. The other 91 inputs, metrics and masks matched exactly.

Prioritize an equivalent blur and pixel-comparison optimization. Failure-only output met the threshold for a CI trial. This measurement covers the simulator sample. The full standalone job and end-to-end PR latency require a separate macos-26 qualification.

## Local comparator optimization

The iOS test comparator reuses vertical sums for adjacent horizontal windows and divides once by the number of pixels in the clipped 3×3 box. It stores each blurred RGB channel as a byte. The comparison keeps its own source stride for each bitmap, the existing mean and height calculation, and the strict strong-difference threshold above 64. The synthetic regression in [ChartScreenshotTests.swift](../ios/TodayWeatherTests/ChartScreenshotTests.swift) covers narrow and short images, unequal dimensions, integer truncation and the threshold boundary using a direct box calculation.

On the same iPhone 17 simulator with iOS 26.5 and Xcode 27.2, capture-all mode passed all 92 comparisons and wrote 184 PNGs. The 91 comparisons with identical inputs matched exactly for strong, mean, height and mask. The loading spinner's rendered input varied and kept its passing verdict.

| Phase | Archived baseline median, three runs (s) | Optimized sample, one run (s) |
| --- | ---: | ---: |
| Simulator test elapsed | 655.87 | 276.57 |
| Blur | 567.77 | 187.98 |
| Pixel comparison | 53.08 | 53.82 |
| Diagnostic PNGs | 27.57 | 27.67 |

The forced height mismatch ran all 23 nationwide comparisons with one expected failure. Failure-only capture produced two readable PNGs at the expected dimensions. Xcode returned 65 and finalized the result bundle.

The local sample ran 379.30 seconds faster (57.8%). The sample uses the same test selection and original fixture bytes. Repeat the measurement on macos-26 and qualify the complete standalone job before judging PR latency or selecting a test partition. The [post-merge hosted baseline](https://github.com/WizardFactory/TodayWeather/actions/runs/45009810694) took 58m14s for the regular job and 86m34s for standalone, with simulator steps of 54m58s and 82m36s respectively.

## Release tier split (2026-11-23)

**Decision.** On 2026-11-23 AK set two tiers for every target ([PR CI and release CI](../docs/development/ci-tiers.md)): pull-request checks finish in minutes and boot no emulator or simulator; release CI verifies a named commit precisely, however long it takes. AK then approved moving the iOS simulator suites to release CI as the next step of this issue. This replaces the sentence above that no visual coverage moves out of the PR path in this trial. The partition trial (B–D) is no longer the route to minutes. After #3131 the simulator step alone took 37–57 minutes, plus macOS queueing.

**Change.**

- [iOS](../.github/workflows/ios.yml) is one macOS job. It runs the import and generator freshness check in the full checkout, removes the legacy directories, then runs `swift test` and `build-for-testing` of the app, its app-hosted test bundle and the UI tests. No simulator boots.
- [iOS release verification](../.github/workflows/ios-release.yml) reruns that job on the commit. It then runs the whole `TodayWeather` scheme on the simulator in the standalone checkout, the screenshot suites and the size and language matrix included, and uploads the comparison images on a failure.
- It runs on dispatch for a full SHA, started from a branch or tag at that commit, and nightly when an input of the iOS PR workflow changed. A pull request that can change what the app draws runs it on its head before merge.
- The earlier two-job layout stays in the history as the rollback: revert the commit that introduced `ios-release.yml`.

**Coverage.** Nothing is dropped. The freshness check, the standalone build, the macOS package tests and UI-test compilation stay in PR CI. The full checkout's simulator run was a subset of the standalone run: the same scheme without the matrix. Its only additional property was that the tests passed with `client/` present, and no test reads `client/`. Release CI runs the standalone superset. New tests run automatically, because the release job runs the scheme without selectors.

**Acceptance for this step.**

1. PR CI on this branch is one macOS job without a simulator: 12.3 min of job time and 22.3 min from creation with 10.0 min of macOS queueing (run 45197092056), compared with 43–51 min of job time per job before. This is still above the tier's 10 minutes; reducing the job's build and dependency time is the next step of this issue.
2. iOS release verification passes on the branch head, with every app-hosted suite and the matrix run (tests that need production access or a Cordova build skip without their variables, as before).
3. A stale generated asset fails the PR job. A build that reads a removed directory fails it. A screenshot mismatch fails release CI and uploads the images.
