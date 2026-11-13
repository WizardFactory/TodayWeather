# Plan: App Tracking Transparency for personalized AdMob requests on iOS (#2945)

Consumes [intent](../intent/issue-2945.md), [spec](../specs/issue-2945.md) and the design record
(`reports/sdlc/issue-2945/design/design.md`, local). Builder and integration owner: Claude Code root session.

## PR boundary

One PR from `snotty-mule` to `master`: the ATT flow is one behaviour, and its rule, purpose strings, guards, tests,
disclosures and measurement describe each other. The PR references #2945 without a closing keyword, because the
release, App Review and the before/after report stay open.

## User scenarios

| ID | User and goal | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- |
| S1 | New iOS user outside the EEA wants weather; allows tracking | Install, open, read explainer, continue, tap Allow | Explainer, then system prompt, then the first banner request; console `att_status: authorized, personalized: true` | Message unpublished: no prompt, `not_determined`, `npa=1` | AC2, AC3 |
| S2 | New iOS user declines tracking | Install, open, continue, tap "Ask App Not to Track", relaunch | Request keeps `npa=1`; console `denied, personalized: false`; no second prompt | Same as S1 | AC2, AC3 |
| S3 | New EEA user | Open, answer GDPR message, answer ATT prompt | GDPR message first; personalized only when ATT is allowed and purposes 1, 3, 4 are consented | GDPR refused: `npa=1` whatever the ATT answer | AC2, AC3 |
| S4 | Existing user upgrades from 1.1.x | Update, open | No banner request before the explainer or prompt is answered | Consent update fails with cached consent: ads continue, `npa=1` while not determined | AC2, AC3 |
| S5 | Release engineer builds iOS | Run `cordova prepare ios` and build | Bundle holds the purpose string for ko, en, ja, zh-Hans, zh-Hant | A missing or empty string, or plugin drift, stops the build with a named cause | AC3, AC4 |
| S6 | Operator measures the effect | Run the AdMob report and the Analytics query | iOS match rate, show rate, impressions and eCPM by app version and personalization; opted-in users by ATT status | Analytics not opted in: no ATT rows; AdMob split still available | AC6 |
| S7 | Store reviewer or user reads the disclosures | Read the policy, the store answers worksheet and the manual | Documents describe tracking after permission and how to change it | Manual screenshots missing until the IDFA message is published | AC1, AC5 |

Machine-readable copy: `reports/sdlc/issue-2945/user-scenarios.json`.

## Tasks

| ID | Outcome | Files | Checks | Depends |
| --- | --- | --- | --- | --- |
| T1 | Request rule in plain C | add `client/scripts/ios-ad-request-rule.h`, `client/test/ios-ad-privacy.test.cjs` | compile and run every ATT status and consent case | - |
| T2 | Hook applies the rule, the state action and the purpose-string guard | rename `client/scripts/ios-no-tracking.js` to `ios-ad-privacy.js`; `client/config.xml`; move the hook test out of `privacy-consent.test.cjs` | hook output, idempotence, each drift guard, each missing locale | T1 |
| T3 | Purpose strings in five locales | add `client/resources/ios/tracking/<locale>.lproj/InfoPlist.strings`; `client/config.xml` resource files | strings parse, state the use, no placeholder | - |
| T4 | Adapter waits for consent and logs the request mode | `client/www/js/service.admobemi.js`; `client/test/monetization.test.cjs` | fresh, upgraded and failed-consent order; no `requestIDFA` call | T2 |
| T5 | ATT status in measurement | `client/www/js/service.monetization.js`, `client/analytics/ios-att-monetization.sql`, `client/analytics/events.md`, tests | allowlist, consent gate, later opt-in | T4 |
| T6 | Disclosures and runbooks | `client/fastlane/privacy/privacy*.html`, `docs/operations/store-privacy-review.md`, `store-policy-evidence.md`, `cordova-store-release.md`, `monetization.md`, `docs/architecture/mobile-api.md`, diagram, `.github/workflows/client-offline.yml` (test list) | link and artifact-policy checks; statements match code | T2-T5 |
| T7 | Integrated smoke | none (clone at `~/tw-release-build/att-2945`) | `cordova prepare ios`, simulator build, bundle inspection, simulator run with test ads and console line | T2-T5 |
| T8 | Device evidence and manual screenshots | `docs/user/cordova-app/` | S1-S4 on the iPhone | AK approval to publish the IDFA message |

Order: T1, T3, T2, T4, T5, T7, T6, then T8 when approved. No parallel lanes.

## Verification

- Existing checks reused: `node --test` suite in `client-offline.yml`, `ruby client/test/store-release.test.rb` if the
  runbook structure is touched, `python3 scripts/check-artifact-policy.py --staged` and on the outgoing range.
- New tests first (Red before implementation) for T1, T2, T4 and T5. Expected Red causes: missing rule file, hook still
  removes the purpose string and forces `npa=1`, adapter reports ready before the consent answer, unknown method.
- Smoke T7 is separate from the unit tests and uses the real generated Xcode project.
- T8 not run is reported as a gap, not as a pass.

## Migration, rollback and blast radius

- No stored data changes. Rollback: revert the PR; the next build forces `npa=1` again. Operational kill switch without
  a release: unpublish the IDFA message; the status then stays not determined for users who have not answered.
- Blast radius: the iOS ad start order, every iOS ad request, the iOS bundle's localizations and system dialog language.
  Android code paths change only where the adapter is shared; the gate is iOS-only.

## What could break

- Riskiest part: the ready gate. A missing `initialize` answer would stop iOS ads. The plugin answers on every branch,
  and tests cover success, error and repeated answers.
- A plugin update changes an anchor: the build fails by design.
- The rule misreads consent storage: the default is non-personalized.
- Rejected alternative: prompting with `requestIDFA` from JS (see the design record).
- Proof: compiled rule tests, hook tests against plugin-shaped source, the simulator build, and device evidence (T8).

## Cleanup and retention

Tracked: source, tests, docs, diagram JSON and HTML, intent/spec/plan. Ignored: `reports/sdlc/issue-2945/`, `.planning/`,
Archify sidecars, the build clone outside the repository. Selected device evidence goes to
`docs/evidence/tasks/issue-2945/` when T8 runs.

## Remaining decisions

- AK: approve publishing the IDFA explainer message (needed for T8), the App Store answers, the page upload and release.
