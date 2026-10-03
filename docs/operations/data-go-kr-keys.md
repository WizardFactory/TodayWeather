# Unified data.go.kr key migration (#2618)

Configuration and approvals: [server configuration](../../server/CONFIGURATION.md).
This procedure is AK-owned. Pre-merge implementation does not authorize production
runs, deployment, process restarts or provider subscription changes.

1. In data.go.kr, approve at least one `DONGNAE_SECRET_KEYS` entry for every
   enabled service listed in configuration. Approvals belong to keys/accounts,
   not historical normal/test/cert names. Prefer approving every list entry.
2. Keep a private backup of the prior environment and deployed revision. Configure
   only the JSON list for the migrated services; remove the four legacy key env
   settings from `.env` and process-manager overrides. Never paste values into
   issues, PRs, logs or verification records. AirKorea/ASOS settings are separate.
3. Deploy/restart only under explicit production authorization. Check for the
   legacy-name warning; its presence means ignored settings still exist.
4. On the gather host, execute one UV task, one KASI task, one warning task and
   one complete shortest cycle using the deployed candidate. `/gather/*` writes
   data and calls providers; it is not a health probe. For each run retain the
   candidate SHA, UTC time, task, request outcome/count and resulting publication
   or storage count, with no key/URL/body disclosure. Confirm UV area/day records,
   rise/set results, valid warning/no-data outcome, and complete shortest grids.
5. If all keys reject, stop acceptance and inspect service approvals/quota. Do
   not loop the same rejected keys. Transport/server errors do not prove key
   rejection. An empty list must send no requests.
6. Roll back by restoring the private previous configuration and code revision,
   then restart under the same deployment authorization. No DB migration is
   involved; accepted weather records remain compatible.

The issue's 2026-09-27 operator comment reports successful forecast, mid, warning,
UV and KASI approvals on the first list entry; AirKorea approval was missing.
That historical observation does not verify this candidate or today's approval.
Forecast-zone still uses its existing newsky2 endpoint; endpoint migration and
live availability are outside this key-only repair. Health-day remains removed.

Offline verification from the repository root with isolated dependencies:

```sh
NODE_PATH=<isolated>/node_modules node server/test/offline/data-go-kr-keys.test.js
NODE_PATH=<isolated>/node_modules node server/test/offline/data-go-kr-keys-smoke.js
NODE_PATH=<isolated>/node_modules node server/test/offline/gather-quota-smoke.js
NODE_PATH=<isolated>/node_modules npm --prefix server run test:offline
```

The first command uses synthetic VM fixtures. The two smokes use real HTTP on
loopback and in-memory model adapters; they make no live provider/production DB
calls. Missing production verification remains an unmet live acceptance item.
