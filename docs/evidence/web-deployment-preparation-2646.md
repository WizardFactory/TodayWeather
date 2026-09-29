# Web deployment preparation verification (#2646)

Local verification on 2026-09-30 (Asia/Seoul), based on `a5fdde1f`, for the change linked from [issue #2646](https://github.com/WizardFactory/TodayWeather/issues/2646).

- Canonical origin: `https://app.todayweather.ai`; old release origins and mismatched distribution aliases are rejected by hosting tests.
- `npm test`: 151 tests passed across 21 files. Recovery regression first failed against a no-op activation handler, then passed with scoped cleanup/unregistration/navigation.
- `npm run typecheck` and `npm run build`: passed using Node 24.19.0.
- `npm run test:e2e`: 95 tests passed with the Playwright-pinned Chromium (browser revision 1243). The recovery test uses a real service worker and isolated local HTTP origin: installed/offline app, two existing windows, recovery to a placeholder, preserved preferences/unrelated cache and a fresh browser. Public API data is intercepted with fixtures; no live-provider success is implied.
- An earlier system-Chrome run passed 93 tests and failed existing focus/clipboard cases. The pinned browser passed clipboard; a narrow test synchronization fix waits for the settings heading and the `main-content` focus effect before forcing focus/back navigation. That focus scenario passed three repetitions, followed by the complete 95-test passing run. Application navigation code was not changed.
- Archify 3.0.1 generated the hosting diagram from JSON. Artifact, real-browser and capture checks passed; the builder inspected the dark 2048×1320 capture after the recovery annotation. Generated viewer whitespace is retained as emitted; no manual HTML patching.

Production upload, live-domain browser validation and actual AWS rollback are separate authorized operations. The recovery worker is an operator-only artifact and is not shipped in normal `web/dist`. Offline clients can only recover after reconnecting and checking for a worker update. Environment identifiers and local operational backups are excluded from this record.

The existing repository has no discovered unified artifact-retention checker wired to pre-commit/pre-push/CI. Scoped content and generated-file exclusions were inspected manually; no hook enforcement is claimed. PR CI and independent review records should bind their conclusions to the final commit on GitHub.
