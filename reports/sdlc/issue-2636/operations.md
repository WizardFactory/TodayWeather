# Controlled operation and rollback

## Current evidence and boundaries
User confirmed 2026-09-29: the AirKorea operating key has expired and will be renewed separately. This is an operator-confirmed cause, not a live entitlement probe. This environment has no repository SSH key or operator environment file. No real provider request, production write, collection endpoint, restart, deployment or physical mobile build was performed by this task. The prior failure evidence is [issue 2581 operations](../issue-2581/operations.md).

Pre-merge scope includes offline implementation and global-air request recovery. It does not close live/device acceptance or authorize rollout. The nation fallback is independent of AirKorea key renewal and never calls AirKorea. Global providers must already have valid keys and sufficient budget; absence of these leaves explicit coverage gaps.

## Before separately authorized rollout
1. Record candidate and known-good revisions, target process/runtime, rollback package and current non-secret configuration names through the existing private operator process. Never put keys, SSH details, raw logs, provider request URLs or connection strings in public evidence.
2. Renew the operating key and verify entitlement for both observation service (`15073861`) and statistics service (`15073855`) privately. `AIRKOREA_SECRET_KEYS` retains its JSON-array format; collection uses the last array element, not quota-bypass rotation. Keep exactly one valid key after renewal; the compatibility URL helper reads the first element, so multiple keys can give misleading manual checks. Bound validation to a single Seoul request for each service; record timestamp, result code, observation time and count only. Invalid/expired key response is a stop condition for claiming AirKorea recovery.
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

## Review dispositions and rollout stop signals
- Shared Google budget: with all 17 AirKorea labels missing, continuous cold-cache demand at the existing 30-minute cache TTL could consume 17 × 48 × 30 = 24,480 calls/month. The default 10,000 cap with 5% reserve admits about 9,500, roughly 11.6 days at that upper demand rate. This is a policy calculation, not measured traffic or a provider-price claim. Existing shared caps and provider order remain unchanged; no extra paid access or quota is authorized. Before rollout, the operator must accept the shared-budget effect on domestic/overseas callers. Monitor projected monthly consumption and fallback-provider availability; a projection above the usable cap or loss of required coverage stops the canary pending a separate budget/TTL decision or request-path rollback.
- A missing Mongo write acknowledgement keeps the scheduled overlap lock held. Do not blindly expire that lock: a buffered write may still finish and allowing new runs would overlap writes. Alert on repeated `ALREADY_RUNNING` or a missing expected periodic success record. A five-minute missing-completion alarm requires externally instrumented scheduling; there is no dedicated start log. Diagnose Mongo connectivity/buffering and quiesce the affected worker through the private procedure before an authorized restart. This limitation is explicitly retained; it does not affect the bounded request-time fallback.
- Stored AirKorea status distinguishes `missing`, `stale`, `future`, `invalid`, and `database-error`; provider/deadline failure is separate. Accepted shared global observations retain the exact domestic freshness policy, including the eight-hour/minute-truncation boundary.
- Air lookup precedes the existing weather stage and can add up to the default four-second air deadline on a cold/failing cache. Accept or reject this latency during canary measurements; route sequencing is unchanged in this change.
- After key renewal, explicitly verify response labels for all 17 provinces, particularly 강원 and 전북. A changed full provider label must be investigated against the supported contract before adding an alias; do not silently mix provinces.
- Different observation hours for the same station are intentional history keys. The province aggregate selects only the newest urban-station time.

## Map compatibility and attribution release gates (review 5357566512)
The existing nation-map clients do not render `coverage`, `representativeCity`, or provider `attribution`. Server metadata alone therefore does not establish correct user-visible provenance: a Suwon point can look like a Gyeonggi province average. Before production rollout, the operator must explicitly decide whether existing clients may receive representative-point fallback values, or require a client release that labels those points first. This PR does not silently decide that release policy or claim the old map displays it.

Before enabling this path in production, verify each reachable provider's attribution/display requirements against the actual iOS/Android nation screens (including WAQI), implement any required client attribution, and record device evidence. Returning attribution in JSON is not proof of on-screen compliance. No provider-terms conclusion or device verification was performed in this server change. An unresolved provenance or attribution decision stops rollout; it does not require a live AirKorea call during request recovery.
