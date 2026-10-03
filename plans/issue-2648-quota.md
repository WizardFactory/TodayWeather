# Execution plan
Task issue-2648-quota; root; revision1, 2026-10-03.
Inputs: [intent](../intent/issue-2648-quota.md), [spec](../specs/issue-2648-quota.md).
1. Record sanitized investigation and budget; publish material issue findings.
2. Design current collection flow. Add test-first exact-hour DB1/DB2 coverage, failure/overlap, current quota day/cross-product isolation and HTTP page counters.
3. Implement current coverage helper + Manager wiring/cooldown and collector attempt observer. Preserve schedules and legacy save/storage contracts.
4. Run regressions, then independent loopback HTTP + temporary Mongo integration on Node16/22. Verify real pinned query construction separately from Mongo5.13 smoke adapter. No app startup or live provider.
5. Update architecture, operations, offline README and Archify JSON/HTML; validate diagrams, browser and visual captures. Preserve selected dated evidence in docs/evidence/tasks/issue-2648-quota. Generated logs/state stay reports/.planning/.archify.
6. Stage intended files; run python3 scripts/check-artifact-policy.py --staged, commit, check actual outgoing range and push; open scoped PR referencing #2648. Obtain independent reviewer1 then reviewer2 (alternate provider), fallback independent OpenAI when both unavailable. Apply Required/selected Recommended; refresh tests/docs/CI/exact head/base and stop unmerged.
Scenarios:
S1/AC2: gather operator; DB1/DB2 exact hour with 2,032 grids, complete zero/negative rows and sentinel/partial/mismatched rows; poll repeatedly, complete only pending rows; every grid covered without repeated successful fetches. DB query/storage failures remain incomplete.
S2/AC3: operator; two synthetic keys; first key quota, second finishes; another cycle skips rejected key; both blocked produces zero HTTP; next KST day probes again. Other products retain existing independent selection. Overlapping same publication joins; different publication busy/error and eligible later.
S3/AC1: operator; local HTTP gateway and temporary Mongo; collect/read back current hours and inspect sanitized stdout/page attempts, KST midnight and pending coverage. No real key/provider; test URLs remain loopback/proxy.
Blast radius: current collection and forecast metrics; no API/schedules/credentials/native changes. Risk: valid rows mistaken for missing or partial rows for complete, process-local guard limits, unverified quota scope. Proof: pinned-query unit + real HTTP/Mongo smoke, failed-read/no-HTTP assertions. Rollback: revert scoped changes; no migration.
