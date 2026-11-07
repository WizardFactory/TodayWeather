# Intent: Android-native TodayWeather app (#2877)

## Source and authority

- #2877 and its sub-issues #2880–#2898 (AN-01..AN-19) are the requirements authority.
- AK, 2026-11-07: decisions 1–5 recorded in #2877 (iOS later, one API path version, widgets later, legacy server with client-only changes, code in `android/` with copied assets).
- AK, 2026-11-08, `/sdlc 구현완료까지 진행`, with two answers: implement through AN-18 using the recommended defaults for the AN-06 decisions ("권장안으로 끝까지"), and merge each sub-issue PR after an eligible review PASS and passing CI ("리뷰 PASS·CI 통과 후 병합").

Mode: implementation. Endpoint per sub-issue: **main** (merge after review PASS and CI). Authorized: scoped code, tests and docs under `android/` (and `client/` only for AN-17), the shared workflow `.github/workflows/android.yml`, local builds and emulator runs, commits, pushes, PRs, CI, cross-provider review, corrections, merges, and updates of #2877 and its sub-issues. Excluded: AN-19 (release signing, physical-device gate, store tracks and rollout), deployments, store or production actions, production push writes, secrets in Git, new accounts and permission changes.

## Problem

The Android app is the Cordova 13 / Ionic 1 build in `client/`. #2877 replaces it with a Kotlin/Jetpack Compose app that behaves and looks the same and ships as an update of `net.wizardfactory.todayweather`, so installed users keep their places, settings, alarms and push registration.

## Desired outcome

An `android/` Gradle project that reproduces the Cordova 1.1.1 app on the legacy server API, proven against the Cordova code (golden corpus), the Cordova user manual (`docs/user/cordova-app`) and an emulator upgrade from the Cordova build, and ready for the release work of AN-19.

## Acceptance criteria

Each sub-issue's completion criteria are its acceptance criteria. Per-task IDs (`AC1`…) in `reports/sdlc/android-an-NN/` map to them. Program-level outcomes:

- **P1** — Every sub-issue AN-01..AN-18 is merged with its criteria met or a recorded, reviewed limitation.
- **P2** — The Android build never reads `client/`; CI builds and tests `android/` in a checkout without `client/`.
- **P3** — No production writes or private inputs in Git, logs or docs.

## AN-06 decisions (recommended defaults, AK 2026-11-08)

Recorded in #2877 when AN-06 closes: go; API path `v000903` for every call (option A); keep the Cordova behavior for documented anomalies except where the recommendation is a fix (A01: tie each response to the place that requested it); follow the system font scale and verify layouts up to 1.3; Cordova Android receives fixes only; place search follows the Cordova app's current provider.

## Scope

In scope: AN-01..AN-18. Out of scope: AN-19, widgets, iOS, the #2651 restyle, server changes.
