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

Four batches per variant, in two alternating rounds:

| Variant | p90 mean (ms) | p99 mean (ms) | Frames ≥ 50 ms | ≥ 75 ms | ≥ 100 ms | Slow UI thread |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Base, verify | 97 (89–105) | 123 | 39 | 19 | 13 | 64 |
| After, verify | 70 (65–73) | 76 | 38 | 5 | 0 | 64 |
| Base, its library profile | 99 (93–105) | 115 | 41 | 21 | 12 | 64 |
| After, app profile | 65 (57–73) | 79 | 34 | 5 | 0 | 64 |

Every batch rendered 36–38 frames (about two per switch). The first frame of every switch exceeds 16.7 ms in all variants, so the slow-UI-thread count stays at one per switch (64 for 64 switches).

First visits right after `compile --reset`, with no warm-up. Each run is one cycle of four switches; three runs per variant:

| Variant | Worst frame per run (ms) |
| --- | --- |
| Base, verify | 125, 125, 125 |
| After, verify | 97, 109, 109 |
| After, app profile | 57, 81, 48 |

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
| Base | 14,002 bytes | 10,738 | 70 |
| After | 17,341 bytes | 18,753 | 845 |

## Ads

With real AdMob units on the emulator (test creatives fill), main-thread CPU per switch was about 50 ms, against about 12 ms without fill. `gfxinfo` frame counts then depended on whether a creative was animating (36–335 frames per batch). This change does not address that cost.

## Limits

- One phone, one place, one weather state. The emulator's absolute numbers do not carry over to devices.
- The measurement builds differ from store builds in their application ID, their debug signature, the `profileable` flag and the dummy ad units.
