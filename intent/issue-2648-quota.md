# Prevent recurring current-grid quota gaps
Task issue-2648-quota. Owner AK; builder root/Codex/OpenAI. 2026-10-03, revision 1.
Source: https://github.com/WizardFactory/TodayWeather/issues/2648
AK requested implementation through pre-merge. Authorized: scoped code/tests/docs/evidence, test/smoke, commit/push, PR/issue comments, CI and configured independent reviewers. Forbidden: merge/auto-merge/queue, production deployment/configuration/key changes, backfill, credential transfer, permission changes/new accounts.
Already merged: #2656 invalid comparisons/exact-hour fallback, #2665 Mongoose compatibility. This task addresses primary TOWN_CURRENT traffic; it does not close production readback acceptance.

AC1-budget: compute source/host scheduling budget and record actual HTTP attempts (including pages) by product, configured key index, KST hour, coverage and first quota rejection without secrets. Record public portal policy separately from unverified account approval.
AC2-coverage: on both DB_DATA_VERSION 1.0/2.0, request every current grid without a complete exact-hour grid observation; retain zeros/negative temperatures, missing/invalid fields and storage failures as pending; overlapping callers do not duplicate a full walk.
AC3-no-storm: preserve #2604 bounded concurrency/rotation; remember rejected current-product keys across cycles until the observed KST daily reset and retry on the next day. Deterministic full-grid tests and distinct real loopback provider/Mongo smoke must pass.
Constraints: no station/ASOS substitution in grid coverage, no request-time provider calls, no schema migration or dependency upgrade. Other forecast schedules stay as existing behavior; telemetry covers their collector attempts.
Risks: unknown quota entitlement, process-local cooldown/locking and multi-worker/restart request totals; database read failures must not trigger an unchecked full-grid walk. New deployment and production coverage need separate approval.
Gate: proceed within delegated scope; unmeasured entitlement/onset remain explicitly unverified.

## 2026-10-03 revision 2 — resumed correction
AK requested reopening2648, publication of the investigation and renewed issue resolution. Reopened with [findings](https://github.com/WizardFactory/TodayWeather/issues/2648#issuecomment-5966946329). Continue existing2670 through pre-merge; merge/deployment/configuration/key changes/backfill remain excluded. Preserve original issue acceptance: source correctness does not establish historical quota onset, actual entitlement or successive-day production recovery. Keep2648open.
Incomplete wind/REH rows intentionally remain pending; writer success does not imply complete coverage. Correct the indefinite active-run failure: bounded current-run cancellation must stop new provider requests, retries and writes, allow later publication recovery and fence stale callbacks. An already submitted Mongo operation cannot be cancelled by this process-local mechanism and must remain explicitly disclosed. Preserve hourly storage identity and other-product behavior. Integrate current master without losing MFDS or prior rotation/receipt corrections.
