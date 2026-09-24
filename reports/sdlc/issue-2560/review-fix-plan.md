# PR review correction plan

User authorized correction and push to PR #2561 after review 5302701507. Continue task issue-2560, build iteration 2; no merge or deployment. Earlier review-only investigation is preserved under ../review-2561-5302701507/.

Acceptance: fresh short RSS can supply tomorrow when primary short publication is missing/expired; both age (0–24h inclusive) and target ceiling (KST publication date+4) follow the contributing RSS source. Only actually matched/copied fields may qualify. Partial wind-only/no-match feeds cannot revive stale primary extrema or weather. Preserve valid primary precedence, both DB formats, seven-day observation history, units and public field compatibility.

Design: record accepted per-slot fields and their RSS publication in a request-local snapshot during getShortRss. Validate RSS publication before overlay. An unusable primary permits valid RSS replacement; older RSS cannot override a fresh primary. For daily fallback, select the independently validated RSS snapshot before the existing normalization and complete-row summary. Later hourly/current extrema mutations cannot contaminate it. Missing explicit extrema or weather leave a day unavailable; no replacement publication for the mixed hourly array. Existing valid-primary summarization continues.

Regression: short-rss-daily.test.js executes real RSS DB adapters and real Town methods for both DB versions at 2026-09-24 16:27 KST. First recorded run fails the expected positive fallback assertions; partial/no-match and primary controls remain passing. Full route smoke adds stale/missing/partial/nonmatch × DB × C/F scenarios via synthetic XML and stubbed persistence. Run all offline regressions and existing RSS response smoke as compatibility checks. Independent verifier challenges the corrected code and records its own report.

All fixtures added here are synthetic. No server/app startup, actual provider HTTP, DB, timers, keys or /gather actions. Node/dependency versions and exact commands will be recorded with outcomes before commit.
