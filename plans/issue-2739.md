# issue-2739 execution plan

Owner: builder (Claude); base 44d76a0f; 2026-10-14.
Inputs: [intent](../intent/issue-2739.md), [spec](../specs/issue-2739.md).

Files:
- `server/controllers/kma/kma.forecast.zone.controller.js`: getFcstZoneCd paging/validation, retirement, active-row filter, 군위 mapping, land-zone list and `findMidTempZones`.
- `server/models/kma/kma.forecast.zone.model.js`: `retired`, `retiredAt`.
- `server/utils/data/kma_forecast_land_zones.csv` (new): 176 land zones from the 240715 guide list.
- `server/controllers/controllerManager.js`: `getMidTempByForecastZone` uses `findMidTempZones`; `unsupportList` removed.
- Tests: new `server/test/offline/forecast-zone.test.js` (runner `run.js`); adapt `data-go-kr-keys.test.js` and `data-go-kr-keys-smoke.js` to the new key parameter and loader dependencies; new real-Mongo/live smoke `server/test/offline/forecast-zone-live-smoke.js` (manual, needs keys and network).
- Docs: `docs/rewrite/external-providers.md` K5, `docs/operations/data-go-kr-keys.md`, `server/CONFIGURATION.md`, `docs/architecture/weather-collection.md`, diagram JSON/HTML (done in design).

Order: Red (new offline tests against the unchanged controller/manager) → Green (controller, model, data file, manager) → adapt key tests → full `test:offline` → loopback HTTP smoke (`data-go-kr-keys-smoke.js`, zone paging scenario) → live smoke with isolated mongod → docs → artifact policy → commit/push/PR/CI → cross-provider review (Codex) and corrections → pre-merge readiness. No merge.

Rollback: revert the PR. Retirement only adds fields; the reverted code ignores `retired` and reads every row again, including retired ones. No data migration.

Risks: a self-consistent but truncated single page cannot be detected and would retire the missing zones until the next complete refresh (rows are kept, so a later refresh restores them). The land list is static per guide edition.

## User scenarios

### ZONE-1 (AC1, AC3)
User: gather operator. Goal: zone codes refresh at startup. Prerequisites: `DONGNAE_SECRET_KEYS` with the FcstZoneInfoService approval. Steps: 1. start gather; 2. the refresh pages getFcstZoneCd; 3. inspect `kmaforecastzonecodes`. Expected: every provider zone stored, absent zones retired, a summary log without key/URL. Failure: a 3xx/non-00/malformed/incomplete page leaves the collection unchanged and logs the failing page and check.

### ZONE-2 (AC1)
User: gather operator. Goal: survive a rejected key. Steps: first list key unregistered (403/30) or over quota (22). Expected: the next key is used; exhaustion fails without writes. Failure: the same key repeats or a write happens.

### ZONE-3 (AC2)
User: app user near a retired zone code. Goal: mid-term temperatures use current zones. Prerequisites: stored `11H10603` from newsky2. Steps: complete refresh without it; request weather for 군위. Expected: `11H10603` retired and never returned; `11H10707` used. Failure: lookup returns duplicate 군위 rows.

### ZONE-4 (AC3)
User: app user in 대구광역시 군위군 or 경상북도 군위군. Goal: 군위 mid-term temperatures. Steps: request town weather with either address. Expected: zone `11H10707`. Failure: 대구 `11H10701` is used.

### ZONE-5 (AC4)
User: gather operator. Goal: no wasted getMidTa calls. Steps: run `/gather/midtemp` (Manager `getMidTempByForecastZone`). Expected: requests only for the 176 listed, non-retired zones. Failure: an unlisted city zone such as `11A00102` is requested.

### ZONE-6 (AC5)
User: maintainer. Goal: understand the zone source. Steps: read K5, the key operations guide, CONFIGURATION and weather-collection. Expected: getFcstZoneCd, per-page totalCount, retirement and the land list are described; no newsky2 runtime claim remains. Failure: a document still calls the endpoint newsky2 or unverified.
