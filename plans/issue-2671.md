# Graft integration plan (#2671)

Owner/date: Codex root / 2026-10-03. Read [intent](../intent/issue-2671.md) and [specification](../specs/issue-2671.md); base e0b126c8. Status: PROCEED to explicit pre-merge endpoint.

1. Add offline behavioral tests before the missing focused build wrapper; record intended Red. Exercise registry-style executable symlinks, local-package resolution, missing tool and canonical host links. Preserve the upstream skill snapshot.
2. Implement wrapper and bounded shim fallback; consolidate root-checkout features.hooks into versioned Codex config. Keep host commands portable and scope-aware. Run Green and post-refactor checks; add repository-artifact CI coverage for deterministic adapter checks.
3. Run separate real smoke in a fresh isolated checkout: focused graph build, freshness, server/client search, MCP RPC and hook context output. Verify linked-worktree discovery separately using an isolated CODEX_HOME with no production or global setting changes.
4. Update the setup guide and README pointer; create an editable manual with actual CLI result captures and a rendered/visually checked PDF. Retain only selected sanitized evidence in docs/evidence/tasks/issue-2671; raw outputs stay ignored.
5. Check staged artifact policy and source identity, commit and push scoped branch, open PR against master. Run an independent latest-GA alternate-provider review (medium/auto), apply selected findings, renew checks/review and observe CI. Fallback according to SDLC; never invent PASS.
6. Check final docs, exact head/base, auto-merge/queue absence and production coupling. Post concise issue/PR readiness evidence and stop without merging.

Scenarios:

- **S1 / AC1:** contributor with Graft 0.21.1 and Node 20+ opens a fresh checkout, runs build wrapper, checks freshness and finds server/client symbols. Expected: relevant code and ignored graph. Failure: absent CLI produces a clear nonzero error; no automatic install or runtime startup.
- **S2 / AC2:** Codex/Claude contributor follows canonical skill links and invokes hooks with registry/local package fixtures and installed Graft. Expected: one upstream skill copy and context output; no installed package -> no-op. A linked-worktree Codex user trusts original-checkout hooks, whose commands select the current worktree; worktrees without shims are skipped.
- **S3 / AC3:** maintainer runs adapter tests and real smoke, reads setup/limits and inspects proposed Git files. Expected: reproducible checks, sanitized docs and no graph/user trust or weather runtime diff. Failure: unsupported parser coverage is stated, not presented as complete.

Rollback: revert repository adapters/wrapper/docs; leave user-installed Graft and local graph bytes intact. Personal trust has no authority after hook definition hashes change. Root-checkout local adapter remains local until this branch is integrated; do not merge to synchronize it.

Architecture/design excluded: no service structure/flow changes. Product tests, provider calls, mobile builds and deployment excluded. Review and behavioral adapter verification retained because agent configuration affects behavior. User scenarios are also recorded in the task scenario artifact for verification/review.

Paseo follow-up: retain the existing private-file shell setup byte-for-byte as a prefix, append a guarded build, and expose `scripts.graft-build.command`. First add isolated behavioral regression cases for setup invocation, missing wrapper/tool, failure propagation and manual refresh; record Red. Implement, rerun Green and final regression, exercise a real focused build with isolated HOME, update manual and selected evidence, then push and ask the same independent reviewer for the new exact head.

- **S4 / AC1, AC3:** a contributor creates a Paseo worktree with installed CLI. Expected: focused graph built before agent launch, preserved private-file behavior, no user host configuration writes. Missing CLI/old target branch warns and skips; build failure is visible. Existing workspace uses `graft-build` on demand. Reopening an existing workspace does not run creation setup again.

Review4 selected corrections: export DO_NOT_TRACK=1 in the wrapper, explicitly disclose accepted npm registry check and HOME update cache, and move build before private-file copying. Keep private-file body unchanged. Add fixture assertions for the opt-out and no private inputs at invocation. Remove creation-smoke's inherited opt-out/cache preseed; fake npm and closed local telemetry host prevent actual external probes, while the test allows only update-check.json and verifies no telemetry state. Renew manual, real smoke, source identity and exact-head review.
