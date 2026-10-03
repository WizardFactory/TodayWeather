# Pollen risk summary and detail (#2599)

AK requested implementation of [#2599](https://github.com/WizardFactory/TodayWeather/issues/2599), then explicitly requested completion through **pre-merge** on 2026-10-03. Authorized scope includes local implementation, tests, commits, branch push, PR and issue updates, independent review/corrections and CI observation through already configured GitHub and Paseo accounts. Merge, auto-merge, queue entry and production deployment are excluded.

Domestic users need one glanceable pollen risk grade and popup detail for official oak, pine and weeds categories. Existing #2650 supplies the V3 collector and individual response grades through lifeIndexKma2; its prior healthday removal is retained rather than reinstated. The issue's legacy healthDayKma/schedule acceptance wording is superseded by that base change. Existing flowerWoody/flowerPine/flowerWeeds response names remain compatible.

- AC1: Valid grades 0–3 from all three V3 operations are stored with existing index types; blank/malformed/no-data values create no grade. Provider availability determines season. Runs align to 06/18 KST and retry failures.
- AC2: Daily/current representative pollenGrade is the maximum available grade with localized pollenStr; absent types and no-data summary stay absent.
- AC3: Both client/www current-conditions templates show the risk label and popup present types, including zero; all six client/server locales define labels; no concentration or finer species.
- AC4: Offline unit and functional/browser evidence, updated collection/API docs and regenerated/checked Archify HTML, editable screenshot manual and PDF, independent PR review and CI complete before readiness.

Native widgets, retired health indices and production provider/database/mobile rollout are outside scope. Main risks are publication/day-field compatibility and absent data being coerced to zero. Rollback reverts this task's additive fields/UI and collector timing while preserving #2650.

UX amendment: AK requested an Ionic popup instead of an inline disclosure on 2026-10-03. Renewed popup unit/browser/manual checks replace the earlier disclosure captures.

Precaution amendment: AK requested type-specific explanations and precautions in the popup. Each available type shows its seasonal description and KMA-based advice for its own grade (0–3), plus a source attribution, translated in all six client/server locales. Missing types have no explanation or advice. Verify long content remains scrollable with Close visible.
