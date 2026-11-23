# Plan: Android release runbook, target tags and notes, PR CI and release CI

Consumes [intent](../intent/android-release.md) and [spec](../specs/android-release.md). One pull request; Refs #2898 and #3089, which both stay open. User scenarios: [android-release.scenarios.json](android-release.scenarios.json).

## Work

| # | Change | Files | Check |
| --- | --- | --- | --- |
| 1 | Release notes tool, test first | `scripts/release-notes.mjs`, `scripts/verification/release-notes.test.mjs`, a step in `.github/workflows/artifact-policy.yml` | `node --test scripts/verification/release-notes.test.mjs`; a draft from this repository's history |
| 2 | Release convention | `docs/operations/github-releases.md`, a pointer in `README.md` | Links; the template and the tool's output name the same fields |
| 3 | Device test runner for the classes without one, and the suite runner | `android/tools/release-ci/run-device-tests.sh`, `run-suites.sh` | Local AVDs: API 36, API 24, tablet, foldable; a skipped and a missing class must fail |
| 4 | Release CI workflow, reusing the PR workflow | `.github/workflows/android-release.yml`, `workflow_call` in `.github/workflows/android.yml` | The workflow's own run on the pull request; a manual dispatch is possible only after merge |
| 5 | `lintRelease` passes | Two lint annotations: `WeatherTab.kt` (`RememberReturnType`), `values/widget_display.xml` (`MissingTranslation` of an alias) | `./gradlew lintRelease`; JVM suites unchanged |
| 6 | APK check | `android/tools/release/check-apk.sh` | A release APK built with placeholder ad IDs, signed with throwaway keys: each failing check, and every passing check that needs no private input |
| 7 | Runbook and tiers | `docs/operations/android-release.md`, `docs/development/ci-tiers.md`, `android/README.md`, one bullet in `AGENTS.md` | Links (`check-artifact-policy.py`), commands run where no private input is needed |

| 8 | Robolectric's runtimes through Gradle, read offline (added after the hosted runs: the download during the tests failed the reused PR job in two of three runs, and on master on 2026-11-22) | `android/app/build.gradle.kts` | `./gradlew test`; a build without the SDK 24 runtime fails the SDK 24 tests on the missing jar |
| 9 | One result check for every release CI suite (review R5): adb's status and the raw status per test, not `OK (N tests)` | `android/tools/emulator/offline.sh`, the three existing runners, `test-instrumentation-passed.sh` and `release-ci/test-runners.sh` (adb test double) in PR CI | Recorded outputs (12 cases); every suite through `run-suites.sh` with the double (12 cases); the four local AVDs again |

Order: 1 and 2 are independent of 3–7. 3 precedes 4. 5 precedes the first green run of 4.

## Verification mode

Alternative evidence for the workflow, the shell runners and the documents (no practical test-first path: their behavior is the hosted run and the emulator); TDD for the release notes tool (red: the test without the tool; green: six tests). Integrated smoke: the suite runner on four local AVDs, and the workflow's run on GitHub for the pull request's head.

## Release CI contents and what stays manual

The device classes were sorted by what they need (source reading, then local runs on 2026-11-23):

- In release CI: `CoreOnDeviceTest`, `PullRefreshDeviceTest`, `ForecastInterstitialDeviceTest`, `EntryIntentTest` (migration held), `ParityDeviceTest`, `WindowFitDeviceTest`, `ShellFitDeviceTest` (tablet and foldable).
- Manual gates of the runbook, with the reason: Cordova APK (`CordovaUpgradeTest`, `PushTokenWorkTest`, `HandBackDeviceTest`, the Cordova half of `BackupRestoreTest`, the notification check); Firebase configuration (`AdsDeviceTest`); production server and keys (`Production*Test`, the manual captures); a Play Store image (`SettingsHandoffTest` with `store`); an emulator of the reference captures' type (`ChartDeviceTest`: on the hosted x86_64 emulator the chart heights differed by 9 px, first hosted run of 2026-11-23); a phone and the signed APK (the device gate).

## Risks, rollback

- Hosted x86_64 emulators with software rendering differ from the local arm64 AVDs. A suite that fails there for a reason of the runner is recorded with its log and either fixed in the runner or moved to the manual gates in the same pull request; it is not left failing.
- `workflow_call` in `android.yml` changes a pull-request workflow: its pull-request and push triggers and both jobs are unchanged; `inputs.ref` is empty outside a call.
- Rollback: revert the pull request. Nothing outside the repository is created.

## Blast radius

PR CI of Android (reusable trigger added), the repository-artifacts workflow (one test step), agent guidance (one bullet), two Android source annotations without a behavior change. No app behavior, no secrets, no repository settings.
