# Implementation plan: #2618

Inputs: [intent](../intent/issue-2618.md), [spec](../specs/issue-2618.md).
Owner: /root. One task branch/worktree/PR; endpoint pre-merge.

1. Add regression coverage for sole-list source, startup legacy warnings,
   empty/malformed/duplicate lists and rejection/exhaustion per requester.
2. Add shared key-list parser; update config, warnings, UV/pollen, KASI,
   forecast-zone, Manager and gather/on-demand wiring. Keep forecast cycle
   rotation; do not restore health-day or retired life-index endpoints.
3. Migrate existing fixtures to list semantics. Run the full isolated offline
   suite plus a separate real loopback HTTP smoke through affected requesters.
4. Update configuration, operations, architecture and Archify source/HTML;
   validate artifacts, browser execution and visual captures separately.
5. Reconcile evidence, check staged/outgoing artifacts, commit/push and create PR.
   Obtain independent review using the configured provider fallback, fix selected
   findings, rerun affected checks, inspect CI and exact head/base/automation.

Scenarios:
- S1 (AC1): operator sets only the JSON list, imports config and sees no legacy
  fields. Legacy env presence warns by name only and cannot supply credentials.
- S2 (AC2): collector/requester gets auth/quota rejection on key A, succeeds on
  B, and preserves its result contract. If every key rejects, each is tried once
  and the request/cycle ends. Empty lists never send HTTP; 5xx/transport failures
  do not rotate. Existing pagination/date/storage regressions remain covered.
- S3 (AC3): AK approves at least one list key per required service, deploys with
  only DONGNAE_SECRET_KEYS, runs UV/KASI/warning/shortest and checks resulting
  storage. Missing approval or incomplete cycle blocks deployment acceptance.
  This production scenario is not executed by the pre-merge builder.
- S4 (AC4): reviewer consumes exact PR diff and verification evidence; CI passes
  and review findings resolve. Merge remains disabled. Missing live acceptance
  is explicitly reported and cannot be labeled passed.

Riskiest changes: bounded rotation and key URI encoding. Could break old fixture
contracts and unapproved service subscriptions. Rejected alternative: retaining
legacy keys as fallback. Rollback: restore prior revision and private previous
config under AK's deployment authority. No database migration. Manual PDF is
not applicable: this is a configuration/refactor repair, no new user feature/UI.
