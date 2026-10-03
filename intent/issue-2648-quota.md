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
