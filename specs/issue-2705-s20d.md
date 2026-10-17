# S20d acceptance

- WIDGET: native GET/HEAD /ww/010000/current/2 with gcode=lat,lon serves the current raw legacy contract; OPTIONS retains public CORS. No unused WW categories/routes are ported.
- PARITY: frozen legacy wire bodies, status, Content-Type, ETag, cache absence, conditional304 and HEAD length; request units metadata without weather conversion; invalidversion and missing/malformedcoordinates terminate locally. Preserve 503 EWEATHERUNAVAILABLE/retryAt/no-store and provider error class.
- RESTORE: cold, warm and empty-memory S3 restoration reuse the same funded weather/air engine; no unnecessary acquisition.
- NATIVE: no legacy request, geocode request, live provider or push. The dsf family switch explicitly enables this native route. No legacy forwarding implementation for /ww.
- PLACEMENT: exact S20d declaration, named S02 recorder only outside implementation, no runtime legacy imports/assets.

The 19 historical groups remain unchanged; add a required native supplement with unknown historical volume. Production remains ineligible until all S20 gates including shadow, host/quota and full previous bundle are proven. No client binary modification,2805 or2724 work.
