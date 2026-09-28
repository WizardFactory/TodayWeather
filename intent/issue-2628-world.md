# Intent: request-time overseas air provider chain (#2628 PR 2)

Revision 4, 2026-09-28. Source: AK requested "해외도 날씨 요청이 왔을때 동일한 방식으로 대기정보를 적용하는 것으로 수정" after PR2630 was merged. Existing #2628 pre-merge implementation/commit/push/PR/CI/independent-review contract continues for this follow-up; no new merge or production deployment is authorized. Repository WizardFactory/TodayWeather, branch feat/2628-world-air-chain, base dd2a5d8e093d4ab96add0c6777310f004ce1e36e (includes defe27ed and three subsequent dependency merges). Author/code account: configured Claude; independent reviewer account: configured Codex. Only code/tests/evidence transfer, no secrets or account/permission changes.

Problem: current overseas routes still use the old WAQI-only AQI cache, bypassing the merged four-provider chain. Outcome: an overseas weather request obtains usable air via the same ordering, shared budgets (including D20 paid reservation), cache and failure policy as domestic fallback.

- AC1: Active overseas DSF coordinate routes v000901/v000902/v000903 and the widget route using the same new-form query invoke the shared chain/cache; a weather-cache hit still permits air retrieval. No duplicate legacy WAQI fetch on these paths.
- AC2: Repeated requests reuse air.observation.caches; policy/free/paid budgets and provider order remain shared with domestic calls, not duplicated or reset.
- AC3: Actual provider source and normalized concentrations appear in current.arpltn and airInfo; requested airUnit determines indexes/grades/summary. Preserve missing pollutant semantics and station-name shortening. Observation time reflects the requested region, with no double conversion or invented station for modeled data.
- AC4: No provider/key/usable observation or a provider failure must not break the weather response or invent air/history; do not copy one current observation into yesterday or forecasts.
- AC5: Prove relevant route/unit/timezone regressions (including UTC-negative/fractional offsets), offline Node16/22 and production Node10 compatibility; update architecture/policy and validated diagram; independent verification/review and current CI before pre-merge handoff.

Out: deployment, changing provider prices/limits, client UI redesign, new history forecasts, rewriting unused legacy collectors, changing D20 paid policy. PR1 historical artifacts remain unchanged. This separate stable task is the previously deferred PR2, not a reset of PR1 iterations.

## Review amendment D22
Source: PR review 5344219425 and AK server-source/client-display instruction. AC3 additionally requires backward-compatible source ids plus normalized attribution text (WAQI and original agencies) in accepted responses, ready for client display. AC4 additionally requires a total optional-air deadline (4 seconds default, 500–8000 ms configurable), timely no-air continuation, late cache fill without response mutation or duplicate continuation. Existing provider budgets/order remain unchanged. Client UI work and licensing approval are outside this server correction.

D23 (AK follow-up): AC4 also exposes top-level airStatus={state:"pending",retryAfterSeconds:3} only when the air deadline expires with work outstanding. Client alone decides whether to retry; no automatic retries. Completed no-air/error/success responses do not imply collection in progress.
