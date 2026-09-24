# Implementation plan
Owner: main; notebook: .planning/2026-09-24-issue-2560.
1. Add regression against captured item and synthetic malformed/legacy/temp inputs before production edits.
2. Centralize mid field lists, numeric/publication validation and KST date arithmetic in a side-effect-free module. Update parser and both schema/controller projection paths, including day-10-independent typing.
3. Apply freshness per source in getMid and merge by target date. Guard formatters and short overlay; retain seven-day history. Add a reusable daily-health check.
4. Retire mid RSS entry points; retain bounded HTTP/XML rejection tests without network.
5. Execute isolated parser/storage/service/date tests and actual route smoke with stubbed HTTP/DB/timers; independent verification. No app loading.
6. Document behavior, consumer compatibility and operator checklist; deliver and visually verify Archify source/HTML.
Rollback: restore prior code revision after operator review; no schema migration/destructive cleanup. Warn that rollback reintroduces stale RSS/parser failures.
