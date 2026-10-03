# Issue 2598 implementation plan
Owner root; consume [intent](../intent/issue-2598.md) and [spec](../specs/issue-2598.md). One branch ideal-pug, PR against master, endpoint pre-merge.

1. Add core regression tests for coverage, placeholders, observations, shortest flags, units and legacy fallback; add production-browser label/offline checks. Confirm intended Red.
2. Normalize metadata using source selection, optional approximation flags; update Weather/Charts formatting and storage validator. Keep category formatting distinct from summed approximate forecasts.
3. Run root typecheck/test and build:web; separately exercise rendered hourly/daily/shortest/legacy/offline scenarios with no live API. Update architecture prose and maintained manual with actual screenshots/PDF, inspect rendered pages.
4. Clean/stage scoped files, artifact-policy checks, validate SDLC pre-commit, commit/push/PR. Independent Claude review (latest catalog GA, medium, auto), corrections and CI. Refresh head/base/protections and leave merge disabled.

Scenarios: S1 Korean PWA user opens Hourly with D45 rain/snow: six-hour exact rain/snow, three-hour approximate sum, placeholder probability. S2 opens Daily with full/partial coverage and approximate snow/rain, then a legacy response: reported hours or old unqualified forecast. S3 opens Hourly with shortest exact/approximate/absent flags: exact numeric amount or category label; converts to inches. S4 reloads offline after each new metadata response: same valid labels, no snapshot rejection. Observed historical/partial rows remain unchanged. See scenario JSON in local artifact index for mapped actions and failures.

Risk: observed/forecast source confusion and old offline snapshots; rejected reusing approx basis for all forecasts because it hides periods and misformats sums as categories. Proof: failing targeted regression, full suite/typecheck, browser assertions and offline reload. Rollback: revert task commit; no migration/deployment. Diagrams unchanged because request/data flows and server contract are unchanged.
