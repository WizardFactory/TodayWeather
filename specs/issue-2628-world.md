# Spec: overseas air chain (#2628 PR2)
Revision 1, 2026-09-28. Consumes intent issue-2628-world r1 and #2628 D1-D20.

Replace the WAQI-only request branch in active new-form overseas weather with the shared air service (lib/AQI/airFallback). Retain geographic argument order {lat,lon}. Shared Mongo air.observation.caches, budget counters, timeouts, once-per-provider attempts and D20 paid admission are unchanged. Weather and air may load concurrently but missing/failed air is nonfatal.

The service may expose the accepted normalized observation as an optional fourth callback value while preserving its existing getArpltn callback contract for domestic callers. Preserve UTC observation time from normalization rather than interpreting the domestic KST dataTime as a local overseas timestamp. Rendering converts the timestamp exactly once using the response timezone. Cache entries stay request-unit/timezone independent.

Integrate normalized concentrations directly into the current overseas air response: do not convert them into rounded WAQI sub-indices and back. Derive per-pollutant indexes/grades/strings and integrated index with existing airkorea/airkorea_who/airnow/aqicn conventions. Retain compatibility aliases (aqi/khai) used by summary and clients. Set source on arpltn/airInfo to the actual adapter id. Do not invent mCity/stationName for modeled providers. Missing pollutants remain missing; attach no air observation to historical yesterday/forecast rows. Existing legacy AQI data paths outside the active new-form route remain compatible, but cannot trigger a second WAQI fetch on the converted path.

If all providers fail, weather completes without usable air or summaryAir. Catch optional air failures without hiding weather errors. Do not add polling or background collection. Existing policy and cache failure behavior are reused, including conservative paid reservations, failure cache and per-process in-flight sharing.

Verification: test-first request/merge regressions, actual overseas middleware/units/summary through synthetic loopback HTTP providers, positive and negative/fractional timezones, missing pollutants, budget fallback/order, repeated cache hit, timeout/no-key/all-fail; domestic and overseas existing offline regression plus Node10. No live credentials required.
