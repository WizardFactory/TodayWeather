# Intent: Android release runbook, target tags and notes, PR CI and release CI

- Task: `android-release`. Mode: implementation. Change kind: configuration (workflows, a release tool, operating documents). Endpoint: **pr**.
- Source and authority: AK, 2026-11-23, in conversation: define the Android deploy runbook; manage versions with GitHub Releases, tagged separately for Android, iOS, webapp and backend, with release notes; define PR CI and release CI separately, where release CI may take long and checks precisely.
- AK's decisions the same day: the release APK is built and signed on the operator's machine, and CI holds no secrets; release CI runs on manual dispatch and nightly; this task delivers the documents and the Android release CI. Refs #2898 (AN-19, stays open) and #3089 (iOS PR CI, stays open).

## Problem

The native Android app has no release procedure. Its CI runs JVM tests only (about 2–10 minutes): the 23 instrumented test files, release lint and the API 24 and API 36 behavior are checked by hand on local emulators. The release convention ([GitHub Releases](../docs/operations/github-releases.md)) names tags for the backend hosts, the Cordova apps and the webapp, and none for the native apps. No document says which checks belong to a pull request and which to a release, and the iOS and server2 pull-request runs take 43–54 minutes.

## Outcome

1. One convention for tags, GitHub Releases and release notes covering Android, iOS, webapp and backend, and a tool that drafts the notes of a scope from the merged changes.
2. An Android release runbook from the choice of a commit to the staged rollout and its rollback.
3. A written split between PR CI (minutes, required to merge) and release CI (long, exact, required to release) for the four targets, and the Android release CI running on GitHub.

## Scope and exclusions

In scope: `docs/operations/` and `docs/development/` documents, the `android/README.md` release section, `scripts/release-notes.mjs` with its tests, `.github/workflows/android-release.yml` and the files it runs under `android/tools/`, one line of agent guidance.

Out of scope: performing a release (tags, GitHub Releases, signing, Play Console, rollout: AN-19, AK's authority); GitHub secrets, environments or repository settings; changes to app behavior; the iOS and server2 CI splits (#3089 and the server2 owners; this task records their current state and the target); making release CI a required check.

## Constraints

- Private inputs (Firebase configuration, ad units, Places key, server URL, signing) stay out of Git, CI, documents and logs. The repository is public.
- The app gets no test, mock or dry-run mode; device tests inject doubles in test code.
- PR CI finishes in minutes (AK, 2026-11-23). Checks that need an emulator, a simulator or tens of minutes belong to release CI.
- The emulator checks run offline wherever the existing tools require it, and never against a physical device.

## Acceptance criteria

- **AC1** The release convention names a tag form for Android, iOS, webapp and each backend delivery, separates candidates from production releases for the store apps, and `scripts/release-notes.mjs` drafts and checks the notes of each scope; its tests run in PR CI.
- **AC2** The Android runbook orders every step from freeze to staged rollout, rollback included; each command it names exists in the repository or the Android SDK and was run where no private input or store access is needed; steps that need private inputs or AK's store access are marked as such.
- **AC3** `Android release verification` runs on manual dispatch and nightly, executes the instrumented suites that need no secret on API 24 and API 36 emulators and the large-screen checks, plus release lint and the full JVM suite, and has passed on GitHub for the PR's head. What it cannot check is listed in the runbook as a manual gate.
- **AC4** The CI tier document states the PR CI and release CI of each target with measured durations, and the Android PR CI still finishes within its measured 2–10 minutes.

## Risks and open points

- Hosted emulators (KVM on `ubuntu-latest`) can behave unlike the local AVDs; suites that fail there for reasons of the runner are listed with the evidence, not silently dropped.
- Halt criteria for the staged rollout are proposed values; AK confirms them at AN-19.
