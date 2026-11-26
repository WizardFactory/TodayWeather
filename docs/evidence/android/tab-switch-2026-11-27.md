# Android tab-switch measurements

[Issue #3224](https://github.com/WizardFactory/TodayWeather/issues/3224) · 2026-11-26/27

## Builds and journey

- **Base:** master `e3bcbe9a7`. **After:** this change (shared decoded-image cache and app baseline profile).
- Both are R8 release builds signed with the debug key. On the phone they use a local-only application ID suffix (`.perf`) with `profileable`, installed beside the store app and removed afterwards. The suffix and the profileable flag were never committed. Unless noted otherwise, the AdMob unit IDs are dummies, so no creative fills (see "Ads" below).
- Compile states:
  - **verify**: JIT only. This is what the phone showed for the Play 2.0.1 install.
  - **profile**: each APK's own packaged profile, installed through the profileinstaller broadcast, then `cmd package compile -f -m speed-profile`.
- Journey: one saved place (서울, production weather). Tap Daily → Air → Locations → Hourly, 1.6 s apart. Two warm-up cycles, then four measured cycles, which is 16 switches per batch.

## Before the change: where the time goes (profiling)

Emulator `tw_perf_review` (API 36, arm64, root), `simpleperf record -e cpu-clock --call-graph dwarf -f 1000`, 20 switches, on a release build with `-dontobfuscate -dontoptimize` for attribution:

- Main-thread share, inclusive:
  - draw (`AndroidComposeView.dispatchDraw`): 32%
  - recomposition: 19%
  - measure and layout: 12%
  - AdMob WebView frames (`ExternalBeginFrameSourceAndroid.doFrame`): 12.5%
  - initial composition: 3%
  - `BitmapFactory.decodeStream`: 2.3%
- Long frames (24 ms or more of main-thread CPU) repeat per tab:
  - **Hourly entry, 47–88 ms:** recomposition 22–45, draw 19–38, measure 14–27, `ChartImages.get` 10–16 (of which decode 8–13).
  - **Air entry, 25–64 ms.**
  - **Daily entry, 26–32 ms.**
- Cause of the decoding: `rememberChartImages()` made a new cache in each composition, so every `ThemeImage` (and the Places, attribution and national images) opened and decoded its PNG again on each visit.

## Phone: Galaxy S21+ (SM-G996N), Android 15, 60 Hz, `gfxinfo`

The final candidate against master. A, B and C alternate in each round, with four batches per variant over two rounds. [phone-gfxinfo.txt](tab-switch-2026-11-27/phone-gfxinfo.txt) holds the per-batch statistics and histograms. The long-frame columns sum the histogram buckets labelled 53 ms, 77 ms and 101 ms and above:

| Variant | p90 mean (range), ms | p99 mean (ms) | Buckets ≥ 53 ms | ≥ 77 ms | ≥ 101 ms | Slow UI thread |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A: base, JIT only | 91 (85–93) | 116 | 42 | 24 | 9 | 64 |
| B: after, JIT only | 67 (61–77) | 80 | 38 | 6 | 0 | 64 |
| C: after, app profile compiled | 65 (61–69) | 75 | 36 | 4 | 0 | 64 |

Every batch rendered 36–38 frames, about two per switch. The slow-UI-thread count was 16 in every batch of every variant (64 per variant), so it did not change. The first-visit runs below had 4 per cycle of four switches.

First visits right after `compile --reset`, with no warm-up. Each run is one cycle of four switches; three runs per variant:

| Variant | Worst frame per run (ms) |
| --- | --- |
| A: base, JIT only | 117, 150, 129 |
| B: after, JIT only | 113, 89, 101 |
| C: after, app profile compiled | 53, 53, 57 |

An earlier run on the first PR head (`9246478bc`) gave the same picture: p90 97 → 70 (B) and 65 (C) ms; 101 ms buckets 13 → 0; first-visit worst frames 125 → 97–109 (B) and 48–81 (C) ms.

## Emulator `tw_perf_review`: no visible difference in `gfxinfo`

Without ad fill, three alternating rounds produced exactly 36 frames per batch. Every variant shows 9–14 slow UI-thread frames and a p90 of 29–34 ms: on this fast host a tab switch's first frame takes about 30 ms whatever the build. Main-thread CPU from `simpleperf` (20 switches, run twice) still shows the change:

| Variant | Main thread per switch (ms) | doFrame runs ≥ 16 ms | Decode on main (ms) |
| --- | ---: | --- | ---: |
| Base, verify | 12–14 | 6, 1 | 23–30 |
| After, verify | 9–12 | 0, 0 | 0 |
| Base, library profile | 12–14 | 5, 1 | 25–28 |
| After, app profile | 10–12 | 1, 0 | 0 |

## Packaged profile

`assets/dexopt/baseline.prof` of the R8 release:

| Build | Size | Rules (`profgen dumpProfile`) | App rules (`net/wizardfactory`) |
| --- | ---: | ---: | ---: |
| Base (master `e3bcbe9a7`, R8 release) | 14,002 bytes | 10,738 | 70 |
| After (final candidate, R8 release) | 17,260 bytes | 18,732 | 838 |
| After (the `.perf` R8 build of the final phone run, before the journeys checked content) | 17,291 bytes | 18,750 | 847 |

## Ads

With real AdMob units on the emulator (test creatives fill), main-thread CPU per switch was about 50 ms, against about 12 ms without fill. `gfxinfo` frame counts then depended on whether a creative was animating (36–335 frames per batch). This change does not address that cost.

## Limits

- One phone, one place, one weather state. The emulator's absolute numbers do not carry over to devices.
- The measurement builds differ from store builds in their application ID, their debug signature, the `profileable` flag and the dummy ad units.
- The committed profile was regenerated twice after the phone runs began, when review rounds 1 and 2 tightened the journeys' checks. The app code did not change in the second regeneration. The final phone run used the profile from the first regeneration (847 app rules); the committed one has 838.
