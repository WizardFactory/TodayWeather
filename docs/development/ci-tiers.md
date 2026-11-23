# PR CI and release CI

Checks run in two tiers. **PR CI** answers "may this change merge?" within minutes. **Release CI** answers "is this exact commit fit to release?" and may take as long as that needs. AK set both rules on 2026-11-23: pull-request checks finish in minutes, and the release checks are precise even when they are slow.

| | PR CI | Release CI |
| --- | --- | --- |
| Question | May this change merge? | Is this commit fit to release? |
| Runs on | Every pull request that touches the target's paths, and the push to `master` | A named commit on manual dispatch, and nightly on `master` when the target changed |
| Time | About 10 minutes of wall time per workflow at most | No budget; job timeouts only |
| Contents | Source and snapshot consistency checks, unit and JVM tests, a build | Everything PR CI runs, on the same commit, plus emulator, simulator and browser suites, release-variant lint and builds, size, language and OS-version matrices |
| Needs | No emulator, simulator, device, provider network or secret | Hosted emulators and simulators; still no secret unless the target's release document names a protected environment |
| A failure stops | The merge of that pull request | The release: no candidate is tagged from a commit without a passed run |

`master` has no branch protection (2026-11-23), so neither tier is enforced by GitHub. The merge rule is the [SDLC policy](../../AGENTS.md)'s, and the release rule is each target's runbook.

## Placing a check

1. A check goes to PR CI when it is hermetic and fast: it reads the checkout, needs no device and no network beyond dependency downloads, and keeps the workflow within the time above.
2. A check goes to release CI when it needs an emulator, a simulator, a real browser session against a deployed site or a matrix of sizes, languages or OS versions, or when it would take the workflow past the PR time.
3. Moving a check out of PR CI requires its place in release CI in the same change. No coverage is dropped to save time.
4. Release CI reruns the PR checks on the commit it verifies. PR CI is path-filtered, so it may never have run on that exact commit.
5. When release CI keeps finding one kind of defect, add a fast check of that kind to PR CI (a JVM or unit test of the same rule) and keep the slow one.
6. A nightly failure is fixed on `master` before the next candidate. A nightly run is early notice and no substitute for the run on the release commit.
7. Release CI workflows build no store binary, sign nothing and publish nothing unless the target's release document says so. Actions from outside GitHub and Gradle are pinned to a commit SHA.

A check that needs a private input, a physical device or store access belongs to neither tier. It is a manual gate of the target's runbook, with its evidence referenced in the release notes.

## Targets

Durations are the wall time of successful pull-request runs read from GitHub Actions on 2026-11-23 (the last 12 to 20 runs of each workflow), queueing included.

| Target | PR CI | Measured | Release CI | State |
| --- | --- | --- | --- | --- |
| Android app (`android/`) | [Android](../../.github/workflows/android.yml) | median 1.8 min, longest 9.4 min | [Android release verification](../../.github/workflows/android-release.yml) | Split as described below |
| iOS app (`ios/`) | [iOS](../../.github/workflows/ios.yml) | median 99.7 min, longest 202.1 min with macOS runner queueing; 43 and 51 min of job time after [#3131](https://github.com/WizardFactory/TodayWeather/pull/3131) | None yet: the simulator suites and the size and language matrix run in PR CI | Over the PR time. The split is [#3089](https://github.com/WizardFactory/TodayWeather/issues/3089)'s. Until then the [App Store release](../../ios/README.md#app-store-release-in-19) steps are the release checks |
| Webapp (`web/`, `packages/`) | [Web app](../../.github/workflows/web.yml), [Design system](../../.github/workflows/design-system.yml) | median 3.0 and 3.6 min | [Webapp guarded release](../../.github/workflows/web-release.yml) checks the Release, the artifact and the live site after upload; [Web live smoke](../../.github/workflows/web-live-smoke.yml) | Split |
| Backend server1 (`server/`) | [Gather offline](../../.github/workflows/gather-offline.yml), [RSS offline](../../.github/workflows/rss-offline.yml) | median 16.9 and 2.2 min | None in Actions: an operator rollout per host ([GitHub Releases](../operations/github-releases.md)) | Gather offline is over the PR time |
| Backend server2 (`server2/`) | [Server2](../../.github/workflows/server2.yml) | median 54.0 min, longest 169.1 min | The same workflow builds and verifies the musl candidate | Over the PR time; not split |
| Repository | [Repository artifacts](../../.github/workflows/artifact-policy.yml) | median 0.7 min | — | PR CI only |

This document defines the tiers for all targets and delivers the Android split. The other rows record where each target stands; their splits are separate work.

## Android

PR CI is unchanged: the JVM suites of every module, the imported-asset, corpus, route-table and reference consistency checks, and the build without `client/`.

Release CI is [Android release verification](../../.github/workflows/android-release.yml). It holds no secret, builds debug and test APKs only, and installs them on hosted emulators that stay offline while the app is installed.

| Job | What it checks |
| --- | --- |
| PR checks on the commit | Both jobs of the PR workflow, on the verified commit |
| Release lint | `./gradlew lintRelease` for every module |
| Device suites, phone API 36 | `device-tests`, `parity`, `window-fit` |
| Device suites, phone API 24 | `device-tests` |
| Device suites, tablet API 36 | `shell-fit`, `window-fit` |
| Device suites, foldable API 36 | `shell-fit`, `window-fit` with the fold steps |
| Verified commit | Fails unless every job above passed, and names the commit |

| Suite | Runner under `android/tools/` | Tests |
| --- | --- | --- |
| `device-tests` | `release-ci/run-device-tests.sh` | `CoreOnDeviceTest`, `PullRefreshDeviceTest`, `ForecastInterstitialDeviceTest`, `EntryIntentTest` with the migration held. A skipped test fails the suite |
| `parity` | `parity-reference/run-native-smoke.sh` | `ParityDeviceTest` in Korean and English |
| `shell-fit` | `large-screen/run-shell-fit.sh` | `ShellFitDeviceTest` with gesture and three-button navigation, on the tablet and the foldable |
| `window-fit` | `large-screen/run-window-fit.sh` | `WindowFitDeviceTest`: split screen, rotation, fold, font scale 1.0 and 1.3 |

`release-ci/run-suites.sh` runs a job's suites in turn and reports each, so one run shows every failure.

Start a run for a commit and read its result:

```sh
gh workflow run android-release.yml --ref master -f ref=<full SHA>
gh run list --workflow android-release.yml --limit 5
gh run view <run id> --json conclusion,jobs --jq '.conclusion, (.jobs[] | "\(.name): \(.conclusion)")'
```

The run's title and its `Verified commit` job name the commit. `ref` must be the full SHA: the run of a branch name would not say which commit it verified. The nightly run starts at 02:30 Asia/Seoul and does nothing when `android/` and both workflows are unchanged since the last passed nightly run.

The suites that need a Cordova APK, the Firebase configuration, the production server, a Play Store image, an emulator of the reference captures' type, a physical device or the signed release APK are not in release CI. They are the manual gates of the [Android release runbook](../operations/android-release.md#manual-gates).
