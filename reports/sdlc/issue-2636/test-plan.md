# Test plan
AC1: synthetic supported station/sido JSON fixtures, service key raw/encoded equivalence, auth JSON/XML/plain errors, malformed/truncated pages, strict identity/time/number validation, transport timeout/late callback/5xx retry cap, zero invalid writes.
AC2: exact KST Date/24:00 in UTC/Seoul/Los Angeles; observation methods do not multiply retries; aggregate acknowledgement/errors and sanitized timestamped logs; collection no overlap.
AC3: valid urban observations -> latest province aggregate cityName empty -> nation PM10/PM25 and airkorea/us unit grades; existing coordinate freshness/fallback regression.
AC4: check source claims/links, diagram automated browser gates and visual captures, runbook rollback and post-rollout 17-province/station/device evidence template. Live production not run.
AC5: complete/missing/partial/stale/future/invalid/DB-failure AirKorea; shared global fallback source/attribution and representative-point metadata; concurrency <=4; one response deadline; no late result mutation; failure preserves air/weather; cache reuse in integrated smoke.

Offline: NODE_PATH=/tmp/issue2636-deps/node_modules node server/test/offline/airkorea-collection.test.js; nation-air.test.js; npm --prefix server run test:offline.
Smoke: NODE_PATH=... node server/test/offline/airkorea-nation-smoke.js with local loopback HTTP/Mongo, synthetic key/data, no production config/app startup. Failure: wrong stored Date/PM/grade, invalid writes, excessive calls, hanging process, mutated finished response. Cleanup: close sockets/Mongo and remove temporary local DB.
