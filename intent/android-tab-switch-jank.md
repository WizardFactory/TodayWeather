# Intent: remove Android tab-switch jank

- Task: `android-tab-switch-jank` (issue #3224, sub-issue of #2877). Mode: implementation. Change kind: behavior (performance, no visible output change). Endpoint: **pre-merge** (no merge, release, store or Remote Config action).
- Source and authority: AK, 2026-11-27: "Sub issues로 만들고 premerge까지 진행", after the 2026-11-26 report "페이지 변경이나, 새로고침, 차트 스크롤이 매끄럽지 못함" on the Play 2.0.1 build.

## Problem

Tab switches drop frames: on the phone (2.0.1, gfxinfo) 46-69% of tab-switch frames were janky with 77-117 ms p90; vertical and chart scrolling were mostly smooth. Two causes: the app ships no app baseline profile, so app code runs interpreted or JIT-compiled after an install, and each tab visit does heavy main-thread work.

## Outcome

Tab switches do less main-thread work and app code is compiled ahead of time from an app baseline profile shipped in the release, with the screens' output unchanged.

## Scope and exclusions

In scope: `android/app` main-thread work on tab visits (image decoding first, per the investigation), an app baseline profile and the module/tooling that generates it, android/README.md, CI wiring needed for the new module to build in PR CI without an emulator.
Out of scope: keeping tabs composed across switches (changes navigation and #3212 ad-slot semantics), AdMob SDK behaviour, iOS, server, releasing.

## Acceptance criteria

- **AC1** The PR records profiling evidence from before the change: a trace summary that names the hot functions.
- **AC2** On the same emulator and R8 release build setup, before/after `gfxinfo` runs of the same scripted tab-switch journey show fewer slow UI-thread frames and a lower 90th-percentile frame time after the change; raw numbers in the PR.
- **AC3** The release APK contains an app baseline profile with app classes (`assets/dexopt/baseline.prof` larger than the library-only 14 KB), generated from a repeatable journey outside PR CI, and the generation command is documented in `android/README.md`.
- **AC4** `./gradlew assembleDebug test` (the PR CI command) passes, including the existing screenshot/parity JVM tests, so the screens' output is unchanged.

## Amendment 2026-11-27: measuring device (AK)

On the emulator (`tw_perf_review`) every variant's tab-switch frames stayed about 30 ms, so AC2 could not discriminate. Asked how to judge AC2, AK chose "휴대폰에서 측정": measure on the Galaxy S21+ with locally signed builds. AK's installed app is release-signed and not debuggable (no data backup), so the builds use a separate application ID (`.perf`, profileable) installed beside it and removed afterwards, as #3033 did; that build change is local and not committed.

- **AC2 (amended)** On the phone, with the same R8 release setup for both builds and the same scripted journey, `gfxinfo` after the change shows a lower 90th-percentile frame time and fewer long frames than before. The slow-UI-thread count is reported too; on the phone it was 16 per batch of 16 switches before and after, so this change does not reduce it.
