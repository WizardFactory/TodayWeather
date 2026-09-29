# AirKorea collection and nationwide air recovery
Owner: AK; builder: Codex/OpenAI. Status: authorized through pre-merge.

The legacy AirKorea request contract cannot collect observations. Nation maps also require province aggregates derived from urban stations, not merely city-level statistics. Recover the supported provider integration while preserving storage, KST and unit conversion.

Authority: user's issue #2636 pre-merge instruction and subsequent instruction to use the domestic global-air collection flow when AirKorea has no stored air. This dated 2026-09-29 amendment includes nation fallback; the issue's earlier exclusion no longer applies. Implement these as distinct flows. Configured GitHub hwanjjang and Paseo Claude reviewer may receive scoped source/tests/evidence. No credentials, permission changes, merge, auto-merge, merge queue or production deployment are authorized.

Acceptance: AC1 supported station/sido success/error fixtures and no invalid writes; AC2 bounded collection and sanitized timestamps, KST/storage stability; AC3 station-derived province aggregates and nation values/grades, unchanged coordinate contract; AC4 controlled deployment/rollback and explicit remaining live/device/entitlement evidence; AC5 nation fills missing/unusable AirKorea provinces through the shared global-air chain with provenance, budgets/cache and bounded response, retaining weather on partial air failure.

Live acceptance remains after separately authorized rollout: scheduled success and fresh station/aggregate readback; Seoul coordinate and all 17 nation labels accounted for; physical iOS/Android values/colors. Offline proof cannot close these conditions.

Out of scope: changing coordinate fallback order, new air providers, silent paid-provider activation, changes to retired TodayAir or native builds, DB migration/backfill, forecast/station-metadata API migration except preventing secret leakage in shared logging.

Risks: API entitlement differs across observation/statistics services; province representative-point fallback is not a province average; stale station metadata; partial provider availability; external DB failure; increased bounded per-nation call fanout.
