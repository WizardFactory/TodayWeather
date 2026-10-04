# Spec: administrative-area life-index fallback (#2183)

Input: [intent](../intent/issue-2183.md). The domestic `getLifeIndexKma` middleware resolves an address through `areaNoList`, then calls `appendData2`. Missing records, missing publication metadata, or stored rows that add no valid index to any requested day produce `LIFE_INDEX_NOT_FOUND`; other database errors preserve their identity.

On that typed no-data result, use the existing nearest query with `[longitude, latitude]`, `$maxDistance: 0.3` and limit three. Prefer request coordinates, then exact-address metadata coordinates. Exclude the failed exact code and walk candidates serially. Use the first successful store result, update `req.params.areaNo`, and retain current/daily UV, pollen and valid zero values. Do not write metadata or call providers.

Empty/exhausted candidate lists leave optional indices absent. Store failures stop the walk and produce one final structured warning. MFDS and `next` continue independently. Structured fallback outcomes include the session ID, requested/resolved or attempted codes, cause and result. Existing schema, routes, DB_DATA_VERSION handling, unit conversion and geographic order are unchanged.

The query limit intentionally bounds work even when obsolete metadata crowds the list. Historical alias replacement was rejected because the issue's 2018 mapping does not prove current administrative authority. General freshness, malformed-metadata repair and request-time expiry are outside scope.

Verify with isolated real controllers, supported runtime tests, real local Mongo/HTTP smoke and existing integrated weather/pollen routes. Failure cases include missing address/code/candidates/publication metadata, exact and nearby store failures, absent coordinates, and unavailable optional data. Relevant response documentation and editable/generated diagram must match. No app UI behavior changes, so a new screenshot PDF manual is not applicable.

Review clarifications: address-metadata errors also stop the optional search. Final failure warnings carry the exact/nearby attempted area codes without mutating the original error. These are the existing AC2/observability contract, not a new feature.

Review clarification R2183-3: success means at least one valid UV or pollen value was applied to a requested day, not merely that rows exist. A retired code holding only past-date or invalid rows is no-data for both the exact and nearby candidates.
