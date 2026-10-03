# Issue 2618: One data.go.kr key list

Source: [#2618](https://github.com/WizardFactory/TodayWeather/issues/2618).
AK authorized implementation through pre-merge on 2026-10-03 in this task-owned
worktree/branch. Scoped commits, push, PR, issue updates, CI and independent
review/corrections are authorized. Merge, auto-merge, queue entry, production
execution, credentials disclosure and account/permission changes are excluded.

The four legacy key slots obscure which service approvals are needed. Existing
forecast, warnings, UV/pollen, KASI and forecast-zone consumers must use
`DONGNAE_SECRET_KEYS` in configured order, with bounded rejection rotation.
Health-day collection was removed in #2650 and must remain removed. AirKorea
retains its separately configured list; opt-in ASOS history retains its own
explicit subscription/rollout contract, outside this issue's enumerated services.

- AC1: No retired slot references in non-test JavaScript; startup warns on
  legacy environment names without printing values. Examples omit those names.
- AC2: Each affected requester rotates on authorization/quota rejection, uses
  each configured key at most once per logical request/cycle, and terminates on
  exhaustion. Empty lists make no provider requests. Non-key errors do not rotate.
- AC3: Required subscriptions and migration/rollback are documented; AK-owned
  gather-host UV, KASI, warning and shortest runs use only the unified list.
  Historical approval observations do not count as candidate live verification.
- AC4: Offline regressions and a separate loopback HTTP smoke pass; reviewed PR
  and CI pass before claiming merge-ready, with merge disabled.

Risks: missing subscriptions, double-encoded keys, quota retries, stale single-key
call sites, and the retired forecast-zone endpoint. No endpoint migration or
storage/API contract change is authorized by this key consolidation.
