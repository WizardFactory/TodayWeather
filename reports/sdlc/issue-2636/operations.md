# Controlled operation and rollback

## Current evidence and boundaries
User confirmed 2026-09-29: the AirKorea operating key has expired and will be renewed separately. This is an operator-confirmed cause, not a live entitlement probe. This environment has no repository SSH key or operator environment file. No real provider request, production write, collection endpoint, restart, deployment or physical mobile build was performed by this task. The prior failure evidence is [issue 2581 operations](../issue-2581/operations.md).

Pre-merge scope includes offline implementation and global-air request recovery. It does not close live/device acceptance or authorize rollout. The nation fallback is independent of AirKorea key renewal and never calls AirKorea. Global providers must already have valid keys and sufficient budget; absence of these leaves explicit coverage gaps.

## Before separately authorized rollout
1. Record candidate and known-good revisions, target process/runtime, rollback package and current non-secret configuration names through the existing private operator process. Never put keys, SSH details, raw logs, provider request URLs or connection strings in public evidence.
2. Renew the operating key and verify entitlement for both observation service (`15073861`) and statistics service (`15073855`) privately. `AIRKOREA_SECRET_KEYS` retains its JSON-array format; one selected key is used, not quota-bypass rotation. Bound validation to a single Seoul request for each service; record timestamp, result code, observation time and count only. Invalid/expired key response is a stop condition for claiming AirKorea recovery.
3. Check existing global provider configuration and free/paid policy. No new paid tier is enabled. Check Mongo observation-cache/budget indexes and representative-point interpretation with the operator.
4. Inspect actual deployment coupling before any later merge/deployment. GitHub workflows here test code; legacy `.travis.yml` contains a master-only Elastic Beanstalk deployment recipe whose current activation is unverified. This task neither triggers master nor assumes that legacy integration is disabled.
5. Scope deployment to an agreed canary process. No schema migration or record deletion is required. Preserve private host configuration and previous release. Do not use `/gather/*` as health probes; `/health` is basic health only.

## After authorized canary and scheduled collection
- Observe a normal scheduled station and city collection. Record UTC startedAt/finishedAt, successful or failed provinces, safe codes, saved counts, unavailable stations, KST observationTime, revision and runtime. Success stdout is intentional because production Winston console suppresses info/warn. A provider response alone is not success; station and aggregate writes must be acknowledged.
- Read back expected station documents and `SidoArpltnKeco` province documents with `cityName: ""`. Compare BSON UTC Date to KST dataTime. Report missing station metadata/closed stations separately; expired keys do not establish a metadata cause.
- Read Seoul coordinate weather and `/v000903/nation/KR?airUnit=airkorea`. Record returned sources, observation times, PM10/PM25 values/grades and every unavailable label against all 17 map labels. Empty `air` is not recovery. A Google/WAQI/etc point result proves fallback, never successful AirKorea collection. DB read errors must remain distinguishable from no records.
- Repeat nation read and check shared-cache reuse; inspect provider budget increments and ensure no AirKorea API call originates from client recovery. Provider chains may finish after the response deadline; later requests can use cache, but completed responses must remain immutable.
- Test physical iOS and Android nation maps for readings/colors on available provinces, retain sanitized screenshots and versions. Do not equate a browser/controller fixture with physical-device verification.
- Link remaining coverage failures to this issue or specific causes (key renewal, provider unavailability/budget, station metadata/closure, malformed provider data, DB error). Record honest partial coverage.

## Rollback
Rollback the exact canary service/collector revision using the private release procedure; preserve environment and Mongo records. No automatic data migration or new AirKorea fallback records need reversal. If a valid stored value is wrong, stop and investigate before deleting or rewriting production data. Legacy provider rollback does not restore AirKorea service; it returns the known failure behavior until renewal/migration is resolved.

For request-path rollback, restore the nation route/service revision; shared global-air cache remains valid for domestic/overseas weather. For collector rollback, restore the requester revision and review scheduled activity with the operator; existing gather flags do not include station/sido kill switches, so do not claim one exists. Stop only the agreed collection process/schedule through the private procedure with separate production authority. Do not disable unrelated weather ingestion.

## Evidence checklist (not yet executed)
- [ ] New key validity and both service entitlements, no key values published.
- [ ] Authorized deployed revision/runtime and normal scheduled successful timestamp.
- [ ] Fresh station and province-aggregate DB readback, unavailable stations accounted for.
- [ ] Seoul coordinate and 17-label nationwide response, source and partial gaps recorded.
- [ ] Physical iOS and Android values/grade colors.
- [ ] Canary/rollback outcome and remaining causes linked.
