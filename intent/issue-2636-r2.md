# AirKorea collection: usable key selection and remaining legacy endpoints
Owner: AK; builder: Claude (Anthropic). Task ID: `issue-2636-r2`. Status: authorized through pre-merge.
Follows [issue-2636](issue-2636.md) and PR #2643 (merged 2026-09-29).

## Problem
#2636 remains open. On 2026-10-13 (KST) a read-only re-verification found two causes for the legacy `server/` collection failure:

1. Station and sido collection send every request with only the last configured `AIRKOREA_SECRET_KEYS` entry. In the local operator configuration that key returns `DEADLINE_HAS_EXPIRED_ERROR` (HTTP 401). Three other entries return `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` (HTTP 403). One entry (the fourth), the key AK identified, returns `resultCode 00` for all supported operations. Collection therefore fails although a valid key is configured.
2. Station metadata (`getMsrstnList`, at gather startup), the dust forecast (`getMinuDustFrcstDspth`, scheduled `kecoForecast`) and the nearby-station lookup (`getNearbyMsrstnList`, `_appendFromKeco`) still call `http://openapi.airkorea.or.kr/openapi/services/rest`. That host timed out on 2026-10-13.

AK supplied the current AirKorea API documents (Air pollution information v1.4, statistics v1.3, station information v1.2 and related services) and instructed: re-verify #2636, use the key AK identified, and proceed with the fix.

AK described the key as part of `KAKAO_SECRET_KEYS`. The local `server/.env` has no such key in `KAKAO_SECRET_KEYS`; the same key is in `AIRKOREA_SECRET_KEYS` (and `DONGNAE_SECRET_KEYS`). This task uses the `AIRKOREA_SECRET_KEYS` entry and reports the discrepancy.

## Outcome and acceptance
- **AC1** Every AirKorea operation selects a usable configured key. A key that the provider rejects as an invalid credential (not registered, expired, unregistered IP, access denied, HTTP 401/403) is skipped and the next configured key is tried. The working key is reused for later requests. A quota error, timeout or invalid payload does not move to another key. Key text never appears in logs, errors or archived payloads.
- **AC2** Station metadata, dust forecast and nearby-station requests use the supported `https://apis.data.go.kr/B552584/` operations with envelope, pagination and size validation. Existing consumers receive the same shapes: MsrStn `geo [lon, lat]`, Frcst documents and the nearest station name. No runtime request to `openapi.airkorea.or.kr` remains.
- **AC3** Real verification with the configured keys: all five operations return valid data through the new code, and an isolated local collection run (real AirKorea API, local Mongo, no production writes) stores fresh station, sido, province aggregate, station metadata and forecast rows that the existing read path returns.
- **AC4** The handoff states the gather-host configuration requirement, rollout and rollback. Production configuration, deployment and live scheduled readback are not executed.

## Scope and limits
In scope: `server/lib/airkoreaObservation.js`, `server/lib/kecoRequester.js`, related offline tests/fixtures and smoke, `docs/architecture/weather-collection.md`, the #2636 operations runbook, this task's intent/spec/plan.
Out of scope: new air providers, changes to nation/coordinate fallback, DB migration, `DB_DATA_VERSION`, client/native changes, other AirKorea services in the documents (CAI, alarm, ozone/yellow dust, statistics other than sido hour, 50-over forecast), changes to `server/.env` or production configuration, server2.

Authority: AK's 2026-10-13 instruction in this conversation; the earlier #2636 pre-merge contract (scoped commits, push, PR, CI, review/correction). No merge, auto-merge, merge queue, production configuration change, deployment or secret disclosure. Live AirKorea calls are limited to read-only verification and the isolated local smoke.

## Risks
- Development-account quota (the documents list 50 tps; the daily quota is account-specific and unverified). The smoke uses a bounded number of calls.
- The gather host's actual key list is unobserved. If it lacks a valid key, the fix cannot recover collection until an operator adds one.
- Skipping invalid keys must not become quota rotation; quota code `22` stops.
