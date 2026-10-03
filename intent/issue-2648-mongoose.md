# Issue 2648: Mongoose query compatibility

Owner: AK. Builder: Codex/OpenAI, root context. Endpoint: pre-merge.
Source: https://github.com/WizardFactory/TodayWeather/issues/2648#issuecomment-5963300354
Authority: AK requested issue analysis and implementation through pre-merge on 2026-10-03. Scoped code/tests/evidence, commit, fork push, PR, CI and independent review are authorized. Merge, auto-merge, queue enrollment, production changes, deployment and backfill are excluded.

The pinned mongoose 5.1.2 Query has no maxTimeMS method. Station enrichment and optional ASOS metadata reads fail at query construction. Replace the three Mongoose chains while preserving the 2000 ms server option, filters, projection, sorting, limit, lean and callbacks. Preserve native Mongo cursor.maxTimeMS in history/store. No dependency upgrade.

AC1-query-compatibility: Real pinned queries construct in all three paths and retain maxTimeMS=2000, filters and other options, with no database connection.
AC2-route-enrichment: The real KMA route and station controller preserve historical station data/provenance with actual query construction and report database failures without TypeError.
AC3-pinned-ci: CI runs the regression on Node 16.20.2 and 22.22.2 using mongoose 5.1.2, with additional route smoke and maintained verification instructions.

The broader quota prevention and production historical recovery criteria remain unfinished under #2648. This PR references rather than closes it. Existing untracked graft/ is preserved.
