# Plan: iOS tracking-permission row and page notice with a Settings shortcut (#2990)

Consumes [intent](../intent/issue-2990.md) and [spec](../specs/issue-2990.md). Builder and integration owner: Claude Code
root session. Status: approved by AK on 2026-11-15 with the notice text set in the spec; endpoint pre-merge.

## PR boundary

One PR to `master` from `ios-tracking-settings-shortcut-2990`: the overlay, its hook, the tests and the documents
describe one behaviour. The PR references #2990 without a closing keyword, because the release and App Review stay open.
No file under `client/www`, `client/scss` or `android/` changes.

## User scenarios

| ID | User and goal | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- |
| S1 | iOS user who refused tracking wants to see the choice | Open the menu | Row "Tracking permission · Not allowed" below "Ad privacy choices" | Status read fails: no row | AC1 |
| S2 | Same user reads a weather page | Open hourly, daily and air; scroll to the end | Each page ends with the notice and "Open Settings"; no popup; banner and content not covered; no way to close it | Status read fails: no notice | AC2, AC3 |
| S3 | Same user decides to allow tracking | Tap "Open Settings", switch "Allow Tracking" on, confirm, reopen the app | Settings opens on the app's page; after reopening no page shows the notice and the row says "Allowed"; console `att_status: authorized` | `switchToSettings` fails: nothing changes, one warning in the console | AC1, AC2, AC6 |
| S4 | New iOS user who has not answered the prompt | Install, open, before answering | Neither row nor notice | - | AC1, AC2 |
| S5 | iOS user with the device-wide tracking switch off | Open the menu and the pages | Behaviour recorded by the T0 probe; texts follow AK's decision on it | - | AC2, AC3 |
| S6 | Android user | Open the menu and the three pages | Neither element; Android references unchanged | - | AC4 |
| S7 | Release engineer builds iOS after a template change | Run `cordova prepare ios` | Build stops and names the file whose insertion point is missing | - | AC5 |

Machine-readable copy: `reports/sdlc/issue-2990/user-scenarios.json` (local).

## Tasks

| ID | Outcome | Files | Checks | Depends |
| --- | --- | --- | --- | --- |
| T0 | Facts about the device-wide switch and the Settings page | none (simulator, notes in `reports/sdlc/issue-2990/`) | With "Allow Apps to Request to Track" off and on: reported status, and whether the app's Settings page shows "Allow Tracking" | - |
| T1 | Visibility rule, directives and texts | add `client/resources/ios/tracking-settings/tracking-settings.js`, `.css`, `strings.json`; add `client/test/ios-tracking-settings.test.cjs` | Every status on iOS and the Android case; five keys in six locales, none empty; no ATT request, popup, modal or alert in the overlay | T0 when it changes the texts |
| T2 | Hook merges the overlay into the iOS bundle | add `client/scripts/ios-tracking-settings.js`; one hook line in `client/config.xml`; extend the test of T1 | Run on a copy of the real `client/www`: tags, row, three notices and thirty keys present; second run identical; each missing anchor, locale or text and each duplicate key fails with its name; Android platform untouched | T1 |
| T3 | CI runs the new test | `.github/workflows/client-offline.yml` (test list) | The workflow command passes locally | T2 |
| T4 | Integrated smoke | none (build clone outside the repository) | `cordova prepare ios`, simulator build and run for `not_determined`, `denied` and `authorized`; small-screen check that the banner does not cover the notice; `cordova prepare android` output holds no overlay; `node android/tools/emulator/check-sources.mjs` passes with unchanged references | T2 |
| T5 | Device evidence | `docs/evidence/tasks/issue-2990/` | S1 to S3 on the iPhone, which has 1.1.2 with tracking refused today | T4 |
| T6 | Documents | `docs/user/cordova-ios/` (manual source, screenshots, PDF), `docs/operations/cordova-store-release.md`, `store-privacy-review.md`, `docs/architecture/mobile-api.md`, advertising diagram if it shows the status flow | Manual PDF rendered and looked at; links and `python3 scripts/check-artifact-policy.py` | T5 |

Order: T0, T1, T2, T3, T4, T5, T6. No parallel lanes. Critical path: T0, because its result can change the texts.

## Verification

- New tests first (Red before implementation) for T1 and T2. Expected Red causes: missing overlay files, missing hook.
- Reused checks: the `node --test` list of `client-offline.yml`, `client/test/ios-ad-privacy.test.cjs` (no ATT request
  stays true), `check-sources.mjs`, `python3 android/tools/import_client_assets.py` leaves no diff, the artifact policy
  check on the staged content and on the outgoing range.
- Smoke T4 uses the real generated Xcode project and is separate from the unit tests.
- Review: Codex at high effort as the required reviewer; Grok and Gemini 4 Argon (high) as additional reviewers when
  available.
- T5 not run is reported as a gap, not as a pass.

## Migration, rollback and blast radius

- No stored data and no native code change. Rollback: revert the PR; the next iOS build has neither element.
- Blast radius: the iOS bundle's `index.html`, three templates and six locale files as generated at build time. Android
  and the web sources are untouched.

## What could break

- Riskiest part: the hook's anchors. A later edit of `index.html` or a tab template can remove one. The build then
  fails by design, and the unit test fails earlier because it runs the hook on the real `client/www`.
- The row or notice shows for a status where the Settings page has no switch (device-wide switch off). T0 decides.
- App Review reads the permanent notice as pressure. The fallback is a new decision by AK, not part of this plan.
- Rejected alternative: editing the shared `client/www` sources (see the spec).

## Cleanup and retention

Tracked: overlay, hook, test, documents, intent/spec/plan, selected device evidence. Ignored: `reports/sdlc/issue-2990/`
and the build clone. Simulators and the Cargo target are not used; the build clone's derived data is removed at the end.

## Remaining decisions (AK)

1. Whether #2990's body may be updated with the decisions of 2026-11-15 and this design.
2. Merge, then a new iOS version (1.1.3) and its App Review submission, as separate approvals.
