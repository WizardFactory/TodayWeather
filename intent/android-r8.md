# Intent: R8 shrinking and obfuscation of the Android release

- Task: `android-r8`. Mode: implementation. Change kind: build configuration, a release tool and operating documents. Endpoint: **pre-merge** (no merge, no signing, no upload, no Play Console).
- Source and authority: AK approved enabling R8 for release builds on 2026-11-24, after Google Play flagged `net.wizardfactory.todayweather` 2.0.1 (`versionCode` 200010) with "DEX code optimization below threshold: obfuscation 0%", deadline February 2027 (visibility and publishing may be affected). The task brief came through the coordinating agent the same day.

## Problem

`android/app/build.gradle.kts` sets no minification, so the release APK ships unshrunk, unobfuscated dex (28.3 MB without private inputs). Play's check fails, and the release tools neither expect nor verify a mapping file.

## Outcome

1. Release builds run R8 with resource shrinking; debug builds are unchanged.
2. The shrunk app behaves as before: every name the app or a library reaches by reflection, the manifest or resource name lookup still resolves.
3. The release keeps R8's `mapping.txt`, proves it belongs to the uploaded APK, uploads it to Play, and Crashlytics receives it when the Firebase configuration is present; builds without private inputs still work.

## Scope and exclusions

In scope: `android/app/build.gradle.kts`, keep rules, the release tools under `android/tools/release/`, the release-notes field, the runbook, README and spec lines, PR CI wiring of the new tool test.

Out of scope: a release, signing, Play Console or Firebase actions; a minified instrumented-test build type; R8 in CI builds.

## Constraints

- Private inputs stay out of Git and logs; the build and unit tests run without them.
- No test, mock or verification mode in the app or build (`-x` on the command line is allowed for local checks).
- Only keep rules that a reproduced failure or a reflective entry point requires.

## Acceptance criteria

- **AC1** `assembleRelease` without private inputs (placeholder ad IDs) runs R8 and writes `mapping.txt`; the APK's dex carries only R8 markers and the app's classes are renamed except manifest and library-kept entry points.
- **AC2** The minified APK, installed over an unminified build with saved state, keeps the state and shows start, place search, hourly, daily, AQI, nationwide and warning pages, settings, notification settings, sharing and a widget without `ClassNotFound`, `NoSuchMethod`, serialization or missing-resource errors; a build with the Firebase configuration initializes Firebase.
- **AC3** `check-apk.sh` refuses an unshrunk APK and a mapping that is not the APK's or is incomplete, and prints the mapping's SHA-256; its tests run in PR CI.
- **AC4** The runbook states that the release writes `mapping.txt`, that it is kept with the APK and uploaded to Play as the deobfuscation file, and how the Crashlytics upload behaves with and without the Firebase configuration.
