# Pollen risk contract

Source: [intent](../intent/issue-2599.md). Baseline e0b126c8; local implementation began before AK expanded the endpoint to pre-merge. These persisted artifacts reconcile the existing investigation/design and do not claim an earlier PR-stage execution.

Use existing HealthWthrIdxServiceV3 operations getOakPollenRiskIdxV3, getPinePollenRiskIdxV3, getWeedsPollenRiskndxV3 and lifeIndexKma2 storage. Official data.go.kr dataset 15085289 Swagger checked 2026-10-03 specifies blank areaNo for all areas, time YYYYMMDDHH, dataType JSON and pagination. Map today/tomorrow/dayaftertomorrow/todaysaftertomorrow to issuance date plus 0/1/2/3 days; retain legacy theDayAfterTomorrow only when current dayaftertomorrow is absent. Preserve full-page validation, key rotation and atomic full-batch preparation.

No month gate. Startup catches up; successful/no-data calls schedule next 06:10/18:10 KST. Error or unchanged issuance leaves due time for hourly manager retry. Pure publication predicate uses UTC+9 modulo 24. No-data is an empty result, never Low.

Add daily/current pollenGrade (maximum of present valid integer type grades) and request-local pollenStr. Existing flower* and Grade/Str values remain. UI uses a native button and shared TabCtrl Ionic alert popup: show the button only when summary exists, pass today to showPollenInfo, bind present type labels/grade strings in an isolated child scope and destroy it on close. Tap and keyboard activation open it; translated Close dismisses it. Use LOC_POLLEN_RISK/OAK/PINE/WEEDS in six locales on both sides.

Verify spring oak=2/pine=1, autumn weeds=1, grade zero and no-data in production v000903 middleware with isolated stores, then compile both actual Angular tables in Chromium. Verify collector fields, no-data, pagination, due times and UV regressions offline. No provider writes, app startup or gather endpoints are used as probes. Update architecture and manual; maintain screenshot provenance. Production deployment remains separate.

UX amendment: AK requested an Ionic popup instead of an inline disclosure on 2026-10-03. Renewed popup unit/browser/manual checks replace the earlier disclosure captures.

Precaution amendment: AK requested type-specific explanations and precautions in the popup. Each available type shows its seasonal description and KMA-based advice for its own grade (0–3), plus a source attribution, translated in all six client/server locales. Missing types have no explanation or advice. Verify long content remains scrollable with Close visible.
