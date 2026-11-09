# Plan: user manual for the current Cordova TodayWeather app

Consumes [intent](../intent/cordova-user-manual.md) and [spec](../specs/cordova-user-manual.md). Design stage skipped: no system structure or flow changes (Archify not applicable). Test-design stage skipped: non-executable documentation; document checks replace TDD.

## User scenarios

| ID | User and goal | Prerequisites | Steps (manual sections) | Expected | Failure path | ACs |
| --- | --- | --- | --- | --- | --- | --- |
| US1 | New user: see today's weather against yesterday | App installed, location allowed or a city to search | First launch → Hourly weather | Finds the current value, the "어제보다" comparison and the two chart lines | Location denied or off: the manual shows how to search instead | AC1, AC2, AC3 |
| US2 | User: keep several places | At least one city | Locations: search, add, swipe, edit, delete; overseas city; current location | Can add, reorder or remove a city and switch between cities | Search finds nothing or the overseas request fails: the manual names the retry path | AC1, AC3 |
| US3 | User: plan the week and check air | A city selected | Daily weather → Air quality | Reads past and coming days, the air grade, pollutants and the station | Air data missing: the manual says the section can be empty | AC1, AC3 |
| US4 | User: adjust the app | App open | Menu → Settings (units, startup, refresh, theme) → Nationwide, warnings, guide | Changes take effect on the forecast screens | — | AC1, AC3 |
| US5 | User: get a daily alert and control privacy | Notification permission | Notifications; Privacy choices | Saves an alarm for a city; changes the analytics choice | Permission denied: the manual says how to allow it in Android settings | AC1, AC3 |
| US6 | Maintainer (#2877 builder): trust and reproduce the manual | Repository checkout, Android SDK, private build inputs | Entry page → provenance → reproduction commands | Identifies revision, device and capture time per image; can rebuild the PDF from the JSON | Missing build inputs: the entry page lists them by name | AC2, AC4, AC5 |

The machine-readable copy is `reports/sdlc/cordova-user-manual/user-scenarios.json` (local SDLC evidence).

## Files

| Operation | Path | Purpose |
| --- | --- | --- |
| Add | `intent/`, `specs/`, `plans/cordova-user-manual.md` | Task records |
| Add | `docs/user/cordova-app/manual.json` | Editable manual source |
| Add | `docs/user/cordova-app/screenshots/*.png`, `provenance.json` | Selected captures and their provenance |
| Add | `docs/user/cordova-app/manual.pdf` | Rendered manual |
| Add | `docs/user/cordova-app/README.md` | Entry page |
| Change | `client/README.md`, `docs/rewrite/README.md` | Links to the manual |
| Change (only if needed) | `scripts/verification/rewrite/native/tw-harness.js`, `README.md` | A capture mode for states the existing scenarios do not reach, such as the analytics choice dialog |

`client/www`, app code, server code and store metadata stay unchanged.

## Steps

1. Build the harness APK from the base revision (`build-harness.sh android full`). Run the `full` scenarios on a dedicated API 36 emulator (Korean locale, Asia/Seoul) with `ANDROID_SERIAL` pinned to the emulator.
2. Review every capture. Add a minimal harness mode only for required states that are missing. Rerun that mode.
3. Select the screenshots, copy them to `docs/user/cordova-app/screenshots/` with their SHA-256 and capture names in `provenance.json`, and inspect each for private content.
4. Write `manual.json` (one step per page) and the entry page. Map each step to its screen ID.
5. Build the PDF with the screenshot-manual skill (`--font` with a Korean-capable TTF). Check its text with pypdf, render every page, inspect the renders and iterate.
6. Add the links, run the link check and `python3 scripts/check-artifact-policy.py --staged`, then commit, push and open the PR.
7. Run the independent review and corrections until PASS. Post the readiness result, and record merge-ready with `merge_authorized: false`.

## Checks

| Check | Command or procedure | AC |
| --- | --- | --- |
| Capture run | `run.mjs` summary: scenarios finished, unclassified errors listed | AC2 |
| Private content | Visual inspection of each selected image | AC2 |
| Spec mapping | Each step's screen ID exists in the rewrite package; current-source differences listed | AC3 |
| PDF build | `build_manual.py` exit 0, one page per step | AC4 |
| PDF text | pypdf: page count and each step's title and expected result present | AC4 |
| Visual | `render_pages.py`, then inspection of every page | AC4 |
| Links | Relative links in changed Markdown resolve | AC5 |
| Artifact policy | `python3 scripts/check-artifact-policy.py --staged`, then `--range origin/master HEAD` before push | AC5 |
| CI, review | PR checks green; independent reviewer PASS | AC5 |

## Risks and alternatives

- Riskiest part: harness steps that depend on live data or the locale (for example the Korean search result or empty air data). Mitigation: review the captures and rerun with a narrower mode.
- What could break: nothing at runtime; the change is documentation plus, at most, a test-only harness mode. Large binary additions are bounded by selecting about 30 images.
- Rejected: browser-rendered captures with fixtures (the precedent for the PWA). They do not show the actual Cordova app, ads, status bar or native layout. Also rejected: iOS captures, which are outside the Android parity scope.
- Rollback: revert the PR; nothing else depends on these files.

## Cleanup and retention

Build outputs (`client/platforms`, `node_modules`, `www/lib`, generated config, Firebase files and `client/.env`) are ignored and stay local. Raw harness runs and SDLC records stay in ignored `reports/`. Only the selected screenshots, their provenance, the source, the PDF and the entry page are committed.
