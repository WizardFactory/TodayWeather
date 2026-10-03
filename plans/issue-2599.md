# Issue 2599 — Pollen summary and detail
Owner: /root. Endpoint: pre-merge, explicitly authorized by AK on 2026-10-03. Merge and deploy excluded.

## Intent / specification
Expose the maximum available KMA oak/pine/weeds grade as pollenGrade/pollenStr on domestic dailyData and current; keep individual flower* fields and omit missing values. Use existing #2650 V3 collector and lifeIndexKma2 storage rather than restore removed healthday code. Request all three types year-round; provider no-data governs availability. Align due times to 06:10/18:10 KST with retries for unavailable publications/errors. Official spec must be checked before mapping changes.

## Phases
1. Inspect code, official spec and superseding work — complete.
2. Add failing regression tests; implement collection timing, enrichment and six-locale UI — complete.
3. Offline tests plus actual Angular template browser smoke; update docs/JSON/HTML/manual — complete.
4. Final diff/artifact checks, commit/push, PR review and CI — in progress.
5. Fresh remote readiness and handoff at pre-merge — pending.

## Scenarios / acceptance
S1 Korean-location user opens current conditions in spring: oak=2 and pine=1 gives High summary; opens item and sees only Oak High / Pine Normal. Unit + browser; AC response/UI/locales.
S2 Autumn user opens pollen: weeds=1 only gives Normal with only weeds; low=0 remains visible. Unit + browser.
S3 No-data user: no pollen item or fields. Collector fixture + response + browser.
S4 Gather operator: both 06 and 18 KST due, other hours not due after successful collection; all three operations map 0–3, malformed/empty omitted; off-season no-data is normal. Offline tests and integrated stub smoke.

## Risks / decisions
#2650 removed legacy health jobs, healthDayKma reads and writes before this task. Preserve that baseline; do not reinstate retired paths. No production provider/database or native build is required for offline verification. Current issue acceptance storage/scheduler wording needs reconciliation in final report.

Canonical inputs: [intent](../intent/issue-2599.md), [spec](../specs/issue-2599.md). Implement requester/enrichment, both shared templates and twelve locale files; tests first, then route/browser smoke and documentation, commit/push/PR, independent review, CI, final readiness. Reject restoring retired healthday and numeric concentration UI. Riskiest change is publication scheduling; offline boundary tests and provider-shape compatibility tests prove it.

UX amendment: AK requested an Ionic popup instead of an inline disclosure on 2026-10-03. Renewed popup unit/browser/manual checks replace the earlier disclosure captures.

Precaution amendment: AK requested type-specific explanations and precautions in the popup. Each available type shows its seasonal description and KMA-based advice for its own grade (0–3), plus a source attribution, translated in all six client/server locales. Missing types have no explanation or advice. Verify long content remains scrollable with Close visible.
