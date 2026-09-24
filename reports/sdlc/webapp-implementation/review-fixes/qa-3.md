# QA-3 independent verification of PR corrections

Verdict: **PASS**. Proposed HOTL decision: **PROCEED** within the existing PR-correction publication scope. This is independent same-provider verification, not PR approval, cross-provider review, merge readiness or release completion.

Candidate `sha256:6622fcebea6e0b0a6c8ea6f370da2856b256afe18618a5cbd19f96cd47533d73`, 65 files; base `01eb787b10cc2694ea52642b8b24ad8c5426503e`, pre-correction head `d85960e0b7078a35b6ce5d370d3552a81dbd1bc0`. All candidate and delegation input hashes match before/after verification. No changed non-report source is outside the manifest. Main staged files during review but candidate bytes remained unchanged. QA did not edit source, tests, docs, shared state or notebook.

Verifier `/root/webapp_qa` is the separate non-builder OpenAI context; builder `/root`. Exact inherited model ID and effort were not independently exposed. Assignment, repository/policy guidance, artifact index, correction intent/spec/plan/test-plan/build/self-verification/results/candidate/patch and original feedback assessment were consumed. Input digests are in `qa-3.json`.

## Dispositions

| Item | Result and independent evidence |
| --- | --- |
| C1 | RESOLVED — Root no longer declares ESM; independent suite loads all three actual native version modules with isolated Q stub. Native builds were not executed. |
| C2 | RESOLVED — Real dialog browser regression passed independently; handlers await completed accept/dismiss and assert exactly two dialogs. Main ten-run repetition evidence reviewed, not independently repeated. |
| C3 | RESOLVED — Actual browser capability-error, enabled-cleanup-error and enabled-success transitions passed; code establishes fresh capability and deletes matching rules before local removal. Disabled flow also passes. |
| C4 | RESOLVED — VM worker test, shell digest tests and actual two-version browser cache upgrade passed: new manifest/icon and offline shell, retained previous chunk. |
| C5 | RESOLVED — Deferred send, state responsiveness, dedupe, catch-up, queued revisions and stale-410 tests pass. Additional independent six-installation probe confirms global send limit and cancellation across scheduler/test sends. |
| C6 | RESOLVED — Warning URL tests reject unrelated/deceptive hosts, credentials and unexpected ports; trusted KMA HTTP upgrades to HTTPS. UI remains an external link. |
| C7 | RESOLVED — Actual server/worker regex compatibility matrix passes, including coordinate decimals and unknown API/assets. Definitions remain duplicated with explicit regression coverage. |
| C8 | RESOLVED — Validator tests reject malformed/mismatched IDs and accept known catalog/canonical coordinates. Source compares rounded valid coordinates with catalog or canonical identity. |
| C9 | RESOLVED — Missing/null/sentinel/zero rain, source-period, explicit snow conversion and old snapshot regressions pass; browser hides unavailable interval and renders snow. Independently traced KMA three-hour adjustment and cm-to-mm upstream normalization in legacy source without execution. |
| C10 | RESOLVED — Launcher spawn probe aligns explicit Origin and Vite host/port. Independent handler probe accepts configured localhost/numeric-loopback/HTTPS origins and rejects unrelated origins with 403. |
| FIRST-CLAIM | RESOLVED — Actual delayed registration followed by first controller claim preserves edited weekday; App only reloads replacement controllers. |

## Executed checks

- `npm test`: **39 passed, 8 files**, exit 0 (`qa-3-tests.txt`). Actual isolated HTTP is used where required; external providers/push are mocked.
- Actual Chromium through installed Playwright, dedicated config and loopback demo BFF port 4190: **12 passed**, exit 0 (`qa-3-browser.txt`). This includes first claim, actual two-version cache upgrade, dialog completion, favorite cleanup errors/success, rain/snow UI and previous QA regressions. All browser artifacts use `/tmp`; main screenshots and reports were not overwritten.
- Added isolated verifier probe with **six independent installations**: maximum four simultaneous sends, settings read remained responsive, queued jobs cancelled after subscription replacement/rule deletion, queued test cancelled after unsubscribe with `SUBSCRIPTION_CHANGED`, repeated tick deduped. Exit 0 (`qa-3-notification-probe.txt`). Sender is an injected deferred promise, with no network.
- Added independent Origin probe: configured localhost, custom numeric-loopback port and production HTTPS Origin accepted; unrelated Origin rejected with 403 for each. Six cases, exit 0 (`qa-3-origin-probe.txt`).
- `npm run typecheck` and `git diff --check`: exit 0 (`qa-3-typecheck.txt`).

No mandatory or recommended defect was established in this bounded assessment. The initial automatic permission review timed out before execution; its allowed retry succeeded. No host permissions were changed and nothing remains blocked. Vitest emitted a future config-loader compatibility warning; the current pinned toolchain passed.

## Evidence limits

The current main-built production bundles were independently hashed and used; QA did not rebuild them. Main's repeated dialog, build and Archify visual evidence was reviewed/reused rather than relabelled as independently rerun. Native tools were loaded with an isolated Q stub; no native build ran. Development spawn configuration and strict handler Origin checks were exercised, but no new external HTTPS deployment was created. Push delivery used injected promises, not provider/device receipt. No remote CI rerun, PR mutation, merge, deployment, credential access or legacy collector/server startup occurred.

The documented single-process store, five-minute-slot recovery, current-minute startup and persisted-claim preference can still miss deliveries after a crash; the correction does not promise durable exactly-once receipt. Full parity/device/provider freshness/conditional-alert/production gates remain open under issue #2558.
