# S3 push delivery design — issue 2626

Status: **proposed, not implemented or deployed**. Revision 2, 2026-09-28; inspected code `477b9f6a158346ad2ea39ff0cbf180b035ddea8a`. [Intent](../../intent/issue-2626.md#revision-2--s3-and-burst-delivery-design-2026-09-28), [spec](../../specs/issue-2626.md), [implementation plan](../../plans/issue-2626.md), [issue](https://github.com/WizardFactory/TodayWeather/issues/2626), [interactive diagram](diagrams/push-s3-proposal.html), [diagram source](diagrams/push-s3-proposal.json).

This proposal supersedes the push SQLite choice in PR #2629. It does not change that PR's runtime or #2623's operator-written notice database. Existing implementation behavior remains documented in [push notifications](push-notifications.md).

## 1. Decisions and boundaries

Registration writes are sparse. Small synchronization inconsistencies and repair by re-registration are acceptable; strict multi-object transactions are not a goal. Scheduled sends and urgent regional warnings are the demanding workload. S3 stores durable data; a single coordinator on tw-svc owns mutable memory, indexes and dispatch admission. Existing HTTP workers forward mutations over a Unix-domain socket. The coordinator performs many asynchronous provider requests concurrently.

No Redis, SQS, SQLite or MongoDB is required for **push state** in the first version. The weather provider/collector may still depend on existing databases. There is one active coordinator, not an automatically elected multi-host service. Stop/start replacement and exclusive socket binding prevent local overlap; a second host must not be started as an active writer. This consciously trades failover availability for a simpler design. Horizontal sharding is a measured-capacity follow-up, not an assumption.

S3 holds one device registration object, not one global JSON/SQLite file rewritten on every send. Diagram arrows show logical dependencies: the KMA adapter-to-coordinator edge represents the S3 warning feed described in section 7, not a direct network callback.

The hot send path reads only memory; no per-recipient S3 GET/PUT, geocoding, or translation call. Registration objects and dispatch checkpoints have separate prefixes and mutation schedules.

## 2. Source facts affecting compatibility

- `client/www/js/service.push.js:_makePostObj` supplies `uuid`, package, token, `cityIndex`, `id`, category, units, language header, location/town, UTC seconds-of-day and timezone offset. Existing paths remain `/v000902|v000903/push-list` and mounted `/*/push` routes.
- `updateCityInfo` posts only the changed city's registrations. POST is a merge/upsert, **not replacement of all device records**. Explicit DELETE removes the requested records; index/id zero are valid.
- `service.weatherinfo.js` invokes that update after weather refresh. No GPS capture sequence or timestamp is provided. “Latest” means last accepted coordinator command, not the geographically newest observation or live background GPS.
- For this legacy client contract `cityIndex === 0` identifies current position; other indices are fixed saved cities. Keep an internal location mode; validate this adapter against shipped client variants before enabling it for unknown versions.
- The current provider call is `messaging().send(message)` in `controllerPush.js`, already using the SDK send API. Do not assume sendToDevice/legacy HTTP merely from the old SDK pin. SDK 5.13.1, connection reuse and the actual transport still need target-runtime verification.

## 3. Durable data model

Logical key layout (bucket and prefix are configuration, never public):

```text
push/v2/
  registrations/{product}/{shard}/{deviceKey}.json
  delivery-state/{product}/{shard}.json
  campaigns/{date}/{campaignId}/manifest.json
  campaigns/{date}/{campaignId}/parts/{partId}.json
  warning-feed/events/{eventId}.json
  warning-feed/head.json
```

`shard` is a deterministic hash prefix used for bounded recovery partitions, not a claim that S3 needs random keys. `deviceKey = sha256(product + platform + valid UUID)` for clients with UUID; otherwise use the token identity with a distinct namespace. Hash input components with an unambiguous encoding. UUID/Device-Id is a locator, **not authentication**. Never expose tokens, UUIDs, coordinates or keys in logs/URLs. Separate TodayWeather and TodayAir identities and provider budgets.

Each object and each mutable settings/location/endpoint field group records `acceptedSequence`, assigned by the single coordinator. On full recovery initialize the next sequence above the maximum persisted value across restored records. This provides a comparable order across devices for a token merge; per-device `revision` alone is not comparable. Deleted history is not used to choose among surviving values.

A registration object contains:

```json
{
  "schemaVersion": 2,
  "deviceKey": "<opaque hash>",
  "product": "todayWeather",
  "platform": "ios",
  "revision": 42,
  "acceptedSequence": 10500,
  "updatedAt": "2026-09-28T06:59:00Z",
  "endpoint": {"fcmToken": "<private>", "generation": 3, "disabled": false},
  "currentLocation": {
    "version": 8,
    "acceptedSequence": 10498,
    "receivedAt": "2026-09-28T06:59:00Z",
    "lat": 37.5,
    "long": 127.0,
    "town": {"first": "<province>", "second": "<city>", "third": "<town>"}
  },
  "registrations": {
    "alarm:0:1": {
      "category": "alarm", "cityIndex": 0, "id": 1, "enabled": true,
      "acceptedSequence": 10500,
      "locationMode": "current", "pushTimeUtcSeconds": 79200,
      "timezoneOffsetMinutes": 540,
      "daysOfWeek": [false, true, true, true, true, true, false],
      "lang": "ko", "units": {"temperatureUnit": "C"}
    }
  }
}
```

Example time is 07:00 KST (22:00 UTC previous date). The complete schema retains all existing unit fields, package/source, names, alert windows, thresholds and fixed coordinates/town. `registrationKey` is `(category, cityIndex, id)`, scoped by device; never use only cityIndex. Current location is device-scoped so one accepted city-0 update affects its alarms and alerts together. Fixed entries carry their own position. Last-location age is observable but **never an exclusion criterion**.

Derived region mappings (`weatherKey`, `warningZoneIds`, `mappingVersion`, `locationVersion`, resolution status) live in memory and may be checkpointed for faster recovery. Raw location is authoritative. Every asynchronous resolution captures `(deviceKey, locationVersion, mappingVersion)`; before publication compare all three to current state, including tombstone/merge status. A mismatch discards the result and only the current unresolved version may be requeued. The removal/addition of index memberships occurs in one synchronous step with no await. In particular, slow resolution for position A must never replace the completed index for later position B. A supplied stale `town` must not override new coordinates; resolve coordinates through the existing geocoder off the send path. Town-only legacy records use the existing town mapping. Missing or unresolved position is marked pending, not assigned the previous region or a global broadcast.

`delivery-state` stores conditional-alert state, cooldowns and invalid endpoint generations separately from registration settings. Dirty partitions flush every 5 seconds (proposed default), with a single in-flight flush per partition. Store changed registration revision/token generation with state so old disable results cannot disable a new token. This state is best effort across a crash; a checkpoint failure raises a metric and does not stop first-attempt warning delivery.

### Identity and token changes

On normal POST resolve product/platform/UUID, then token aliases. `PUT {oldToken,newToken}` may contain no UUID: use `token -> deviceKey` memory lookup reconstructed from S3. Updating an endpoint changes every registration of that device. Token-only devices retain their generated internal key on rotation. A full POST with a new token and no linking UUID/oldToken can create another record; document this accepted legacy ambiguity rather than guessing identity.

If the new token already resolves to a separate record, process the entire merge as one command in the global registration-mutation FIFO, covering both device records and all affected token aliases. Merge deterministically into the UUID-backed record when present (otherwise a stable key order), keep the highest persisted `acceptedSequence` for each duplicate settings/location/endpoint field group (stable record key breaks ties), and disable the superseded object. These are multiple S3 writes, **not a transaction**. Include a `supersededBy` marker and recover aliases/deduplicate by `(product, token)` in memory. Persist the merged target before the marker. A crash can leave stale/duplicate registration data, which recovery and re-registration repair. Never discard unrelated city settings. Do not require a new app ID field.

## 4. Mutation and latest-location ordering

1. Existing API workers validate and forward a normalized command to the coordinator's local socket (private permissions; no public management endpoint).
2. Coordinator uses one bounded FIFO for all registration mutations, including token merges and aliases, because writes are sparse. Assign a globally comparable acceptedSequence and a device revision, then stage the complete update. Only one registration command mutates durable state at a time; other commands wait within their request budget. Provider requests, warning ingestion and checkpoint writes continue asynchronously. This is in-process ownership, not a distributed transaction or lock service.
3. For a location-changing command, hold **new send admissions for this device only** while its S3 result is pending. Persist with bounded timeouts inside the app's existing 10-second HTTP budget; a proposed total server budget is 8 seconds.
4. On successful S3 PUT, publish raw state and reverse-index removals/additions in a short synchronous memory step, then reply to the API. A successful HTTP response therefore refers to durable state already visible to future send admissions. Zone resolution may still be pending; old-region entries are already removed.
5. S3 or coordinator failure returns a retryable 5xx; do not swallow store errors and return success as the current batch helper does. Previously accepted state remains authoritative for an uncommitted update. A timeout after an S3 write may be ambiguous; reconcile that device object before admitting further mutations/sends. A client retry is idempotent for the same values.

The ordering boundary is **accepted registration vs provider submission**. An accepted location change affects every request admitted afterwards; a request already submitted cannot be recalled. There is no await between the final memory version/eligibility check and handing the payload to the provider adapter. App POSTs do not carry GPS event order, so later-arriving old samples can still become the accepted latest position. This limitation is not fixed by a database transaction.

A failed update was not accepted; continuing to use the previous accepted position is explicit behavior, not an assertion that a failed report was reflected. API availability depends on the coordinator; return 503 during restart rather than letting API workers write directly and create divergent caches.

## 5. In-memory indexes and complexity

```text
Devices: deviceKey -> device record + endpoint + currentLocation
Tokens:  (product, tokenHash) -> deviceKey
Registrations: registrationRef -> normalized settings + derived location
ByDevice: deviceKey -> Set<registrationRef>
ByMinute: utcMinute[0..1439] -> Set<alarmRef>
ByWeather: weatherKey -> Set<conditionalAlertRef>
ByWarningZone: zoneId -> Set<eligibleWarningRef>
Membership: registrationRef -> {minute, weatherKey, warningZoneIds}
ActiveWarnings: zoneId/type -> latest normalized event state
```

Use maps/sets and reference IDs, not duplicated JSON trees. Zone hierarchy comes from `kmaWarningZones.js`; the recipient index is an inverted index, not a recursive user tree. A version-fenced location update removes recorded memberships and inserts replacements in O(number of this device's affected registrations × zone count), without scanning all users. A minute selection is O(due registrations), warning selection O(registrations in affected zones); union/deduplicate repeated memberships by endpoint and event.

Minute buckets deliberately do not cache weather groups permanently: regroup the due references by the current resolved location, source, units and language when preparing a campaign. UTC seconds from the client and its timezoneOffset/dayOfWeek semantics are preserved. Do not infer a new time zone from coordinates and silently change alarm time. A future app contract may improve DST/time-zone updates separately.

Current-location change during a campaign invalidates unsent prepared jobs by version. For an alarm, regenerate its template/group for the latest location within the campaign deadline. For a warning, remove it when it no longer intersects; if it moves into an affected zone, enqueue once for an active, unexpired campaign when eligible. The final send check repeats current state, enabled/consent flags, token generation and warning release/revision checks. Retries also repeat these checks.

After the campaign expires, do not send its old warning just because someone later moves into that region. First rollout has no automatic “entered an already-active warning area” notification; that would be a separate product policy.

### Region precision

Reuse #2609's `zonesForTown` and versioned KMA table. It includes ancestors/shared zones and conservative matches; some metropolitan towns map to multiple subzones. Therefore “affected region” initially means that mapping's region set, not exact GPS polygon membership. Record mapping quality (`exact-code`, `town-table`, `ambiguous`, `unresolved`); disclose ambiguous-zone over-targeting in activation review. A requirement for precise subzone recipients needs an authoritative finer mapping dataset. Never match by substring of bulletin text or send unknown positions nationwide.

## 6. Scheduled and conditional delivery

Build each scheduled campaign from the UTC date/minute and product. A minute heap/cursor admits the slot once; do not launch overlapping timers for the same slot. On a delayed tick, catch up unprocessed slots only within a proposed 5-minute freshness window. No sends before the requested time.

Prepare shared weather responses/templates 30–60 seconds before a popular slot where data is available. Cache keys include source, normalized weather query region or exact provider query coordinates, data publication/version, units and language. Do not round unrelated overseas coordinates merely to inflate cache hits. Preserve endpoint-specific `cityIndex` as a small payload overlay; add `eventId`/kind only as backward-compatible fields. Apply #2612's supported language/fallback rules; no per-recipient translation.

Conditional precipitation/air alerts remain a separate normal-priority evaluator using the existing time windows, thresholds and 6-hour rules. Evaluate shared weather once per compatible region/query, then per-registration state. State writes are batched; they are not an extra S3 write for every check/send. Preserve the existing coupled 6-hour prefilter until deliberately revised. Severe warnings do **not** inherit that cooldown or wait for the 7/17/35/50-minute polling loop.

## 7. KMA warnings: producer, events and policy

The existing #2609 collector normalizes `getPwnCd` events and polls at three-minute intervals. Add a small **post-normalization event exporter** to that collector, not a second full collector in the push process. Export recent normalized rows even when human-readable bulletin text is lagging; create a fallback message from structured type, level and zone names. Do not wait up to MAX_PENDING_CYCLES for push. Export only successfully parsed and ordered event data, including releases.

Persist immutable event bodies under `warning-feed/events/`, then update one `head.json` manifest containing references for a rolling 24-hour window, sequence and bootstrap-complete metadata. The single producer serializes manifest updates. Failed publication retries next cycle; event PUT precedes head PUT, so an unpublished event is harmless and a reader never follows a not-yet-written body. The coordinator polls head every 5 seconds (proposed), caches its version and reads only new referenced events. This is a few S3 reads per warning cycle, not per recipient. Retaining a window avoids missing intermediate bulletins if several arrive between polls. S3 event notifications/another queue are unnecessary in this first version.

Event identity hashes normalized source fields: `tmFc`, `tmSeq`, type, command, level, affected zone set and effective-time/revision content. Preserve the raw event identity per zone; group compatible rows into one campaign. Use a zone/type high-watermark plus the #2609 release-before-issue rank to reject stale arrival. A genuinely corrected payload under the same timestamp/sequence must be explicitly normalized as a new content revision, not deduced from delivery order.

- New issue/change/escalation: candidate campaign for the affected eligible region set.
- Repeated identical row or cancelled row: no new send.
- Release: cancel unsent jobs for that zone/type immediately; an optional release notification is a separate policy, off initially.
- Extension/correction: persist the state/revision; a new notification only for a material level/region/effective-time change under a tested rule, not every polling replay.
- Historical 60-day bootstrap: rebuild active state without broadcasting old events. On first activation establish a baseline; on restart resume recent campaigns within their expiry, not all currently active warnings.

**Audience selected by AK:** existing enabled regional alert registrations (`category=alert`, `enable=true`). Alarm-only registrations are excluded. Preserve the existing alert time window as the initial compatibility rule; each candidate must be within that window at admission. Severe warnings ignore the precipitation/air six-hour cooldown. A matching current-position or fixed-city alert is sufficient. No app update or separate per-type switch is required for this selection. All supported KMA warning types for the mapped region are considered. `WARNING_PUSH_ENABLED` remains false until implementation and rollout verification; this is a release safeguard, not an unresolved audience decision.

Proposed campaign freshness is 5 minutes after coordinator detection, bounded by any known effective end/release. On recovery, source publication age and persisted detection time prevent turning an old event into a new five-minute campaign. These are candidate policy values, not approved product deadlines.

One notification per `(product, endpoint generation, campaign revision)` across overlapping subscribed regions. For tap navigation choose a matching current-position registration first, otherwise the lowest matching cityIndex, deterministically. Distinct warning revisions may notify again. This does not guarantee exactly-once device display.

### Detection latency

Measure `sourcePublishedAt -> collectorObservedAt -> coordinatorDetectedAt -> FCM acceptedAt -> deviceReceivedAt` separately. The provisional 30-second fan-out target starts at coordinator detection; the existing three-minute collector cannot guarantee 30 seconds from publication. A faster 30-second status poll is only an optional rollout change after checking provider quota and isolating it from slow collector tasks. At that interval status polling alone is 2,880 requests/day, versus 480 at three minutes; detail requests are additional. Existing event readiness and source publication delay remain outside a send-worker optimization.

## 8. Bounded priority dispatch

One coordinator has three logical admission queues: urgent warnings, scheduled alarms, conditional alerts. It chunks reference iteration (initial candidate: 256 references per event-loop slice), yields between slices, and never pre-materializes all full payloads for a million recipients. Weather preparation also has its own bounded concurrency. Jobs carry references, campaign ID, expected revision and attempt metadata.

Use per-Firebase-project token-bucket rate limits plus a global in-flight cap. Proposed arbitration reserves 20% of concurrency/rate headroom for immediate warnings while only regular work exists. When warnings are backlogged, allocate 80% to warnings and 20% to regular work; multiple warning campaigns round-robin within that lane. In-flight regular requests cannot be preempted. The next admissions enforce the changed allocation; retain immediate reserved slots and a send timeout so stalled normal requests cannot occupy all capacity. Percentages are experiment defaults, not fixed capacity guarantees.

Every first attempt and retry consumes the same project budget. Do not assume a bulk SDK method is one quota request, nor that 500 input tokens represent one network operation. The existing `.send()` can be scheduled concurrently. Keep OAuth credentials/connections warm and use measured transport reuse; actual legacy-runtime HTTP/connection behavior is a prerequisite check, not an assumed HTTP/2 benefit.

Implementation note (#2677): weather preparation is retried before FCM submission. A retryable weather failure backs off with jitter, is limited to a count of failed preparations that is checkpointed with the campaign job (so restart and re-admission cannot reset it), and never runs past the campaign deadline; the registration revision and eligibility checks run again before preparing and before sending. Preparation attempts are separate from transport attempts, and ambiguous sends are still not retried. Persisted job outcomes use a closed list of reason codes with a `preparation` or `transport` stage; the manifest `summary` counts statuses, `stage:reason` failures and attempts.

Provider guidance requires controlled ramp-up, not unbounded bursts. Retry transient failures with jitter and a bounded lifetime; honor Retry-After, use a 60-second fallback for 429 without it, and avoid immediate retry loops. Authentication/payload errors stop the affected campaign/project for diagnosis rather than retrying every token. Invalid tokens disable that endpoint generation. Uncertain timeouts may have been accepted; retries can duplicate a notification. A send timeout/retry policy must remain consistent with current FCM guidance. [FCM scaling guidance](https://firebase.google.com/docs/cloud-messaging/scale-fcm)

A regular backlog does not block the warning queue, but shared provider quotas still do. Capacity reservations cannot bypass FCM limits. [FCM quotas](https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas)

## 9. Checkpoints, recovery and failures

Campaign manifest is persisted once before fan-out, then work proceeds without waiting for per-token storage. This is one campaign-level durability cost. If initial manifest persistence fails, keep the campaign pending and retry within its freshness window; report S3 as a dispatch-start dependency. Existing running campaigns may continue while checkpoint storage is unavailable.

Each part holds compact recipient references and outcome bitmaps/failed-retry metadata, not full duplicate settings. A completed/dirty part checkpoints at most every 5 seconds or when finished (serialize writes so old snapshots cannot overwrite new progress). Track accepted, invalid, superseded, expired, deferred and transient outcomes separately; “all processed” is not “all accepted”. Expire and remove campaigns by an explicit retention policy (proposed 7 days), independent of registration lifetime. No per-send mutation of registration objects.

On crash, reload registration objects using bounded parallel LIST/GET, rebuild all indexes and token aliases, restore recent campaign checkpoints, reconcile warning releases/revisions, then admit sends. Do not send from a partially rebuilt global recipient index. Health distinguishes alive vs ready; readiness stays false until restored. Missing one corrupt device object is quarantined with a count and degraded readiness report, never silently counted as complete restoration. The default activation policy requires no unaccounted failed objects.

A five-second checkpoint cadence bounds the normal **time interval**, not an absolute duplicate count: possible repeats are approximately accepted rate × uncheckpointed interval plus in-flight requests, and can be larger during S3 outages. Recovery may repeat uncheckpointed sends; exactly-once is not promised. Expired campaigns are recorded as missed/expired, not replayed indefinitely. If the coordinator is unavailable longer than the freshness window, alarms/warnings can be missed. Registration repair tolerance is not a claim that those misses are acceptable at any scale; measure/report them and decide on availability separately.

Cold-start baseline: D device objects require about D GETs plus LIST pages. At an assumed 2,000 successful GET/s, 100k devices take at least 50s and 1m at least 500s, excluding parsing/indexing/retries. These are arithmetic examples, not measured S3 rates. In-memory size is O(registrations + zone memberships + campaign references); measure V8 overhead rather than equating JSON bytes to heap bytes. If recovery misses the agreed readiness budget, add a compressed snapshot plus ordered mutation journal or partitioned coordinators as a separately justified phase. Do not build them before measurements. [S3 performance design patterns](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance-design-patterns.html)

S3 offers atomic single-object replacement and strong read/list consistency; it does not make the manifest, multiple device objects and FCM submission one transaction. The single-owner design and acknowledged failure boundaries are deliberate. [S3 consistency model](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)

## 10. Capacity model and proposed verification profiles

Let N be unique eligible endpoint submissions, T dispatch seconds, L measured mean request service time, C in-flight concurrency, u chosen utilization (<1), Q allowed project request rate and W effective bandwidth. Required mean rate is N/T; approximate C requirement is `(N/T) × L / u`. Actual ceiling is the minimum of project quota, C/L, CPU, bandwidth, socket pool and any content-preparation bottleneck. Tail latency, warm-up and retries need extra budget.

At L=0.2s and u=0.8 (assumptions, not measurements):

| Profile | Unique recipients | Dispatch window | Mean required rate | Approx. concurrent requests |
| --- | ---: | ---: | ---: | ---: |
| AK-selected provisional target | 10,000 | 30s | 334/s | 84 |
| Exploratory | 100,000 | 60s | 1,667/s | 417 |
| Stress only | 1,000,000 | 60s | 16,667/s | 4,167 |

These figures apply to warning capacity; with an 80% warning reservation total capacity must be larger. With a linear ramp from zero over the entire window the final rate must be roughly twice the mean. AK selected 10k/30s as the **provisional load-test target, not a production SLA**. 100k/60s and 1m/60s remain exploratory. Verify the actual project quota: a commonly documented default cannot establish that the stress profile is feasible. Device delivery has additional FCM/APNs/network/OS latency and is not guaranteed by successful submission.

Required implementation checks:

| Scenario | Observable condition |
| --- | --- |
| Region fan-out | All eligible unique endpoints and no unrelated endpoints selected using golden zone fixtures; ambiguous mapping explicitly classified |
| Overlapping location change | Accepted move before send blocks old-region payload; new region receives during open campaign; fixed cities stay fixed; old location never expires by age; resolve A slowly and B quickly, then complete A and assert only B memberships remain |
| Sparse writes during burst | POST merge/delete/token changes remain responsive; zero per-recipient S3 calls; current-location admissions reflect accepted revisions; token merge concurrent with POST/DELETE/rotation loses no newer accepted fields |
| Warning during 100k regular backlog | First warning admission within provisional 1s; no waiting for normal queue drain; per-project cap never exceeded |
| 10k/100k send profiles | Controlled synthetic peer with declared L/error distribution; p50/p95/p99/final completion and missed deadlines measured; AK-selected no-throttle 10k target final accepted <=30s |
| Throttle/outage | 429 retry timing and jitter respected; auth error pauses; accepted/failed/expired/deferred sum to targeted count; deadline failure reported, not hidden |
| Recovery | Kill before/after PUT and before/after FCM acceptance; no raw-state rollback; duplicate window documented; partial/failed rebuild not called ready |
| Warning revisions | Repeated pages, release/issue same announcement, correction, historical bootstrap and delayed publisher tested; no 6-hour suppression of new severe warning |
| Memory/CPU | Measure RSS/heap for 10k/100k/1m registrations and skewed zone memberships; event-loop p99 <=50ms provisional; no unlimited queue growth |
| Controlled device test | Authorized iOS/Android receipt/tap tests; separate provider acceptance from receipt; no real bulk send during synthetic tests |

No load tests, S3 writes or FCM sends were executed for this design. The 10k/30s target is user-selected but provisional; capacity on the target host and larger exploratory figures remain unverified.

## 11. Security, runtime and rollout prerequisites

Keep the S3 bucket private with public access blocked, encryption and prefix-scoped IAM roles; registration tokens/location are private. API workers need no S3 write permission if all commands use the coordinator. The collector writes only warning-feed; the coordinator writes registrations/state/campaigns and reads that feed. Do not add new credential files to the repository. Minimize retention of old token/location versions; set approved lifecycle/versioning policy rather than keeping a tracking history by accident.

Preserve existing client authentication limitations without treating UUID/token as an authorization upgrade. Input limits, local socket permissions, no raw token/position logs and removal of existing full-body logging apply to touched paths. CloudFront public data caching must never cache registration bodies/management IPC.

Historical Node 10.15.3 host observations are not current deployment facts. Before implementation, verify actual Node/OS and a compatible, supported AWS/Firebase transport path. Do not silently pin a modern SDK that cannot load on that host or upgrade the whole service as a design side effect. If current SDKs cannot support required connection/timeout behavior, isolate an approved push runtime or make runtime modernization an explicit dependency; do not claim existing smoke tests settle it.

Activation blockers: actual device/token population; host resource budget and provider quota; collector export/read path and mapping precision; compatible sender/runtime; credential/device tests; migration choice. Fixed vs current-position compatibility must be exercised with real app request fixtures. No infrastructure activation is authorized by this document.

## 12. Alternatives and tradeoffs

| Alternative | Decision |
| --- | --- |
| MongoDB as push store | Easier server-side queries, but not the requested baseline; does not itself solve fan-out or FCM limits |
| sql.js whole-file writes | Existing PR retained as history; not the new direction for burst-related state changes |
| Every API worker writes S3 + S3 notifications/SQS | Avoid initially: adds cache synchronization, duplicate/order handling and more moving parts for sparse writes |
| Single coordinator owns S3 + memory | Selected: explicit last-location order and no distributed registration lock; startup/availability is the tradeoff |
| FCM region topics | Not selected initially: location subscription changes, per-city payload and warning latency need direct control; topics optimize throughput over latency ([Firebase](https://firebase.google.com/docs/cloud-messaging/topic-messaging)) |
| Durable queue plus horizontally scaled senders | Capacity/availability expansion if measurements require it; must preserve priority budgets and last-location fencing, not blindly run two existing schedulers |

Detailed migration, rollback and implementation order are in [plan r2](../../plans/issue-2626.md). The first phase is a synthetic performance prototype, not a production cutover.

## Implementation amendment — pre-merge scope (2026-09-28)

AK authorized implementation through pre-merge after the design-only record above.
The opt-in implementation is [pushCoordinator](../../server/lib/pushCoordinator/),
[entrypoint](../../server/bin/push-coordinator), and the existing push-route adapters.
The [operations contract](../operations/push-s3.md) specifies the implemented configuration,
failures and activation prerequisites. Mongo remains the default and notice SQLite is unchanged.

Refinements based on tests/review:
- Use a global registration FIFO, version-fenced resolver (eight active lookups), and
  merged-UUID aliases. POST also merges a colliding token when its prior PUT was missed.
  Initial resolution failure prevents ready; later unresolved changes remove old indexes.
- Direct FCM HTTP v1 attempts retain raw HTTP status/Retry-After. Authorization happens
  before admission; the actual Firebase project ID owns the rate budget. A timed-out
  unfinished send cannot free a slot or be retried immediately.
- Late regions join the same warning campaign. Old source publications update region
  state but cannot start fresh broadcasts. Retain source and detection freshness of five
  minutes and a 24h feed; poll/cache event bodies rather than refetching all each time.
- Raw weather uses the existing endpoint/formatter contract and a 60s shared cache;
  no geocoding is performed during fan-out. The initial version prepares on demand,
  rather than prewarming a minute ahead. Domestic requests share the resolved town; overseas exact-coordinate keys preserve weather
  semantics. Warning text uses Korean terms and English fallback; expanded reviewed
  translations, finer regional polygons and production quota/cold-start profiles are
  activation follow-ups, not verified features of this PR.
- Runtime was read-only verified as Node 16.20.2, x86_64/glibc 2.17 on 2026-09-28.
  Existing dependencies are retained; no host runtime upgrade is included.

A local synthetic run selected and submitted 10,000 warning targets while 100,000
normal jobs waited: 20.8s final acceptance, 257ms first admission, 14ms event-loop p99,
about 302MiB RSS, no recipient-level S3 reads. Configuration: 128 active slots,
500 attempts/s/project, 200ms simulated transport, 3ms simulated object PUT.
This replaces the earlier statement that no load tests ran, but is neither a live FCM
measurement nor a production SLA. Final validation/CI are recorded with the PR candidate.

### Review amendment — 2026-09-29

Review5345324410 tightened five failure boundaries: conditional ETag writes and unique
nonces fence delayed registration PUTs; restore conditionally reseals all registrations
before ready (one extra PUT per device). First-feed baseline suppression is independent
of multi-cycle KMA backfill. FCM429 creates a project-wide cooldown; separate80/20
warning/normal token buckets prevent starvation while retaining the total project cap.
Conditional state checkpoints require the captured current revision and generation.
These supersede the earlier read-only reconciliation/cold-start cost descriptions;
see the [operational details](../operations/push-s3.md). The revised synthetic10k
warning run took25.366s, rather than the earlier20.8s without an enforced normal-rate
reservation. No production deployment or real provider sends are implied.
