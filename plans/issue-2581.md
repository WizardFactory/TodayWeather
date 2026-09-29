# Implementation plan
Owner: main Codex. Named notebook: .planning/issue-2581; no competing plan.
1. Record timestamped investigation separately from sanitized public operations follow-up. Do not deploy or trigger collection.
2. Add isolated timezone predicate and detail-route regression tests (new air-freshness test/harness), register in offline runner; correct existing timezone-local test fixtures to explicit KST. Preserve getKeco guard and verify async failure.
3. Replace _checkDateTime with validated KST parsing and elapsed-ms comparison. Add a shared detail input filter to ControllerTown24h; preserve explicit non-AirKorea fallback rows, forecasts, empty placeholder chart shape and unit conversion.
4. Run intended Red, focused Green, full suites on exact Node 16/22; separate loopback HTTP smoke; update mobile API and domestic air diagram.
5. Independently verify with authenticated Anthropic reviewer, latest GA Sonnet 5.5 (released 2026-09-28, official model overview), medium/auto observed. Keep builder tree read-only and reviewer tests isolated. Commit only after local verification, push task branch, create PR, inspect CI/protections and obtain distinct actual PR review.
6. Stop at current readiness receipt; never merge/auto-merge/queue/deploy.
Risks: fewer chart observation points; exact 8h remains excluded; preserve fallback source semantics. Rejected: broad provider migration in this read-contract PR (requires API entitlement and separate operations validation), marking stale values without client support (could still present them as current). Rollback is revert of code/docs; no migration.

## Review 5348629541 correction
Extract the already validated KST timestamp parser for reuse. Generate the 25 hourly chart slots by elapsed milliseconds and format them with UTC getters after adding the fixed KST offset. Normalize 24:00 with that same parser/formatter. Add cross-timezone spring-gap, autumn-fold, leap/year rollover regression coverage and a separate HTTP DST smoke. Preserve the existing workflow and runner test sets. No rebase is necessary against unchanged master d4858b59. Renew both exact Node offline suites and independent verification/review before pushing readiness.
