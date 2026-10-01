# Specification: LifeIndex data (#2650)

Consumes [intent](../intent/issue-2650.md). Current source decisions and operation details are maintained in [external providers](../docs/rewrite/external-providers.md).

## Service behavior

- Continue UV collection from KMA `LivingWthrIdxServiceV5/getUVIdxV5`.
- Collect oak, pine and weeds risk using KMA `HealthWthrIdxServiceV3` operations during their published seasons. Request the current KST hour so each three-hour poll can see later issuances, then query all pages with the same request time. Require a consistent total, page number, row count, unique area and issuance time before marking a batch complete. Retain valid integer grades 0–3 and align each day with the service's KST calendar date. A missing publication or malformed grade creates no field; an incomplete batch retries without a completion marker.
- Remove the retired food poisoning and legacy health collectors, routes and schedules. Do not synthesize health values from unrelated forecasts. Keep food poisoning source investigation in #2600.
- Do not offer activity suitability until the product accepts a derivation rule. Existing forecast fields remain available for a later proposal.

## Response and clients

The existing daily/current weather objects may include `ultrv` and `flowerWoody`, `flowerPine`, `flowerWeeds`. Associated `*Grade` and localized `*Str` values are optional. Missing values are omitted, never an error sentinel. Existing fields and route versions remain supported; no consumer must use the additions.

`@todayweather/core` exposes optional numeric `uvIndex`, `pollenOak`, `pollenPine`, `pollenWeeds`. UV accepts finite nonnegative values; pollen accepts integer 0–3. The web detail list displays only present values using localized labels. Zero is a real value.

## Verification

Use current-shape provider fixtures and an isolated collector/response test, core normalization tests, existing fixture regression, web scenario test, root tests, typecheck/build and a distinct live-key smoke. Check UTC/KST and month boundaries. Document only what the live key actually returned. Preserve no key material in files or logs.
