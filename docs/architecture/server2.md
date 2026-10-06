# server2: memory and S3 origin design

Status: **proposed design, not implemented or deployed**. This 2026-10-06 amendment
to [#2614](https://github.com/WizardFactory/TodayWeather/issues/2614) replaces the
SQLite proposal with memory → S3 → provider. The source baseline inspected for
this PR is `182f4fd745fdfebe95092d186cead8f8a17242ab`; deployment and traffic
observations keep their own dates. Runtime code will live under `server2/` in
later PRs, after the remaining decisions are recorded on the issue.

[Overview diagram](diagrams/server2.html) · [Editable diagram](diagrams/server2.json)
· [Intent](../../intent/issue-2614.md) · [Specification](../../specs/issue-2614.md)
· [Plan and scenarios](../../plans/issue-2614.md)

## 1. Scope and authority

AK selected removal of local SQLite, raw provider storage, a Rust evaluation,
Spot scale-up first, investigation of raw-object fan-out, and a plan for later
multi-instance operation. No MongoDB, SQLite, persistent disk cache, Redis,
shared instance cache or distributed runtime is introduced by this PR.

The selected design keeps immutable canonical raw objects and adds versioned
identity catalogs plus optional immutable raw packs. Catalog overwrites and pack
duplication explicitly amend the original blanket write-once/object-count rule;
raw records remain write-once with no deletes. S3 becomes the serving store,
not merely backup. Synchronous S3 publication before a successful response is
the proposed replacement for SQLite commit plus the 60-second uploader.

Directions selected in conversation are distinct from operational decisions:
history capture (O-1/O-11), outage policy, lifecycle costs and state migration
still need issue decisions before runtime implementation. No approved-difference
list silently relaxes compatibility for an active API.

### Implementation placement

AK's binding direction is broader than Rust source placement: **all new assets
equivalent to `server/` responsibilities or assets belong under `server2/`**.
The new runtime must not depend on files in `server/` through imports, includes,
symlinks or runtime file reads. Explicit HTTP forwarding to legacy remains the
coexistence mechanism. Port required assets with provenance/license preserved;
this does not require copying unused APIs or the legacy directory layout.

| Asset | Required placement |
| --- | --- |
| Entrypoints, routes/controllers, providers, response assembly, cache/storage, jobs, push/notice state | `server2/` (normally Rust source under `server2/src/`) |
| Configuration/defaults, static lookup data, templates and runtime resources | `server2/` |
| Rust workspace/manifests/lockfile, toolchain, dependency and build settings | `server2/`; run workspace commands there, without a repository-root server2 Cargo workspace |
| Server2 tests, golden consumer/fixtures, provider stubs, benchmarks and smoke verification | `server2/tests/`, `server2/benches/` or `server2/` verification subdirectories |
| Export/import/migration tools, deployment/operations scripts, container and service configuration | `server2/` (for example `server2/tools/` and `server2/deploy/`) |
| Maintained architecture/API/operations documents and selected durable evidence | Existing `docs/` paths |
| Intent/spec/plan and canonical agent instructions | Existing `intent/`, `specs/`, `plans/` and root `AGENTS.md` |
| Shared CI and infrastructure entrypoints | Existing shared paths only for explicitly declared wiring; invoke logic/configuration under `server2/` |

The legacy golden recorder at `server/test/offline/golden-record.js` may remain
in `server/` because it executes the legacy parity target. A named legacy export
or coexistence change is likewise permitted when a task explains why it must run
in legacy. These exceptions do not permit placing the new runtime, fixtures or
server2-specific tooling in legacy. Legacy retirement is a separate authorized
task after cutover. Existing unrelated assets need not be moved by this rule.

Every implementation task must declare paths, enumerate necessary outside
changes with reasons, and include the placement completion criterion from the
[common task contract](../../plans/issue-2614.md#common-contract-for-every-implementation-task).
The Rust foundation task must implement a local/CI placement check before later
implementation tasks proceed. Until then, task completion requires a recorded
manual path/dependency review. This design specifies the gate; it does not claim
that the checker or remote merge enforcement is already installed.

## 2. Compatibility inventory

AK accepted the existing [30-day CloudFront investigation](../evidence/aws/api-traffic-2026-09-22.md)
and [route CSV](../evidence/aws/api-traffic-2026-09-22-routes.csv); a fresh AWS
investigation is not required for this design. Its window is
`2026-08-23T19:53:45Z <= time < 2026-09-22T19:53:45Z`.
It includes hits, revalidation, errors and disconnects, with 220,583 product
requests in 19 method/path groups. All 19 groups remain compatibility targets,
including one-request routes and routes with only failures.

| Method | Public path template | Requests |
| --- | --- | ---: |
| GET | `/weather/coord/{location}` | 155998 |
| GET | `/weather/v000903/coord/{location}` | 39254 |
| PUT | `/v000902/push` | 18872 |
| POST | `/v000902/push-list` | 2525 |
| GET | `/v000901/kma/addr/{location}` | 1853 |
| GET | `/v000903/kma/addr/{location}` | 1320 |
| GET | `/geocode/v000903/coord/{location}` | 209 |
| GET | `/v000803/town/{location}` | 205 |
| GET | `/v000903/nation/KR` | 139 |
| GET | `/weather/v000901/coord/{location}` | 51 |
| GET | `/weather/v000902/coord/{location}` | 47 |
| GET | `/geocode/v000903/addr/{location}` | 39 |
| GET | `/v000903/kma/special` | 36 |
| GET | `/v000705/town/{location}` | 12 |
| POST | `/v000705/push` | 12 |
| OPTIONS | `/v000902/push` | 7 |
| DELETE | `/v000902/push` | 2 |
| GET | `/geocode/v000901/addr/{location}` | 1 |
| GET | `/v000901/nation/KR` | 1 |

Zero observed usage within the report's product-path scope excludes the
corresponding public method/path/version from mandatory porting. For example,
`GET /weather/{version}/addr/...` is explicitly unobserved; direct versioned
KMA coordinate and DSF coordinate routes have no rows. Their *internal backend
behavior* can still be required by a used weather gateway path. Do not remove
world weather, a provider or a shared formatter merely because a direct public
route was unused. `/v000705/town` is used and cannot be retired under O-8.

The report excludes unversioned non-product paths such as `/ww` and health;
it cannot establish zero traffic there. Keep `/ww` a scoped evidence gap, with
legacy forwarding until separately classified. Operational health is required
regardless of product usage. Later-added notice and web contracts require a
separate inventory supplement before their cutover, rather than an invented
zero in a window before they existed. Existing payment retirement is described
in [mobile API documentation](mobile-api.md#server-payment-retirement-2642);
this proposal does not revive purchases or infer their usage from an absent row.

CloudFront logging is best-effort, as the report explains. Zero means **zero
observed in this accepted window**, not proof of no possible caller. Excluding
a route from Rust porting does not require deleting it from legacy during coexistence.

### Contract and cutover

For every included API preserve methods, versions/aliases, parameter decoding,
validation, coordinates, language, units, authentication, request bodies,
status, byte-equivalent bodies under frozen inputs, content type, CORS,
redirects, caching and conditional-request behavior. Include 304/ETag,
preflight, non-JSON errors, invalid sentinels, missing-vs-present fields,
publication times, yesterday comparisons and #2620 POP merging.

Failed-only traffic establishes inclusion, not an instruction to reproduce an
incidental outage forever. P1 captures the current legacy/deployed handler with
frozen successful dependencies, validation/auth failures and recorded provider,
database and gateway failures. Compare each corresponding status/body/header
fixture, including stable 5xx mappings. A source/deployment mismatch or proposed
repair of a legacy bug requires an explicit contract decision before that family
moves; do not synthesize a success fixture from CSV status counts alone.

The [gateway](../../server/routes/gateway.js) and its recorded fixtures are
the public-contract starting point. Preserve its nine-second limit, three-second
backend attempt cap (up to three attempts within the overall deadline), admission
limit, version defaults and geographic enrichment. Preserve the geocoder's
three-second provider attempt and five-second lookup caps. Weather success remains
`max-age=300`, geocode success `max-age=2592000`, errors `no-store`, and
`Access-Control-Allow-Origin: *`. Use deployed behavior and actual client
fixtures to reconcile the old `1ff466b0` baseline with subsequent changes;
the historical traffic report does not identify each request's backend version.

`/weather` and `/geocode` move together because legacy loopback bypasses nginx.
An explicit family/version switch retains unmigrated backends over loopback.
No family switches until exact fixture parity, seven-day paired shadow with
zero unexplained differences, measured cold p95 <= 2.5s, quota headroom and AK
cutover approval. Whole-gateway gates remain: 501 rate <= legacy, p95 <= legacy
+ 10%, >= 99.9% within 9s, and cache-aware rollback. This design executes none
of those cutover checks and asserts no production response parity.

## 3. Rust runtime and memory lookup

One API process per host uses Tokio's multithreaded runtime for HTTP/S3/provider
I/O. Bounded CPU jobs handle gunzip, SHA-256, JSON/XML/HTML parsing and assembly.
Use a fixed pool (for example Rayon), or semaphore-bounded `spawn_blocking`;
do not consume async workers with long CPU jobs. Share a core budget between
the pools. Started blocking jobs cannot simply be aborted; enforce input size,
decompression ratio, work limits and cooperative cancellation where possible.

| Memory layer | Key and structure | Lookup / invalidation |
| --- | --- | --- |
| Final response | Typed full request key, byte-weighted concurrent cache | Average O(1); TTL and dependency generations |
| Catalogs | Source/kind/entity/partition | Average O(1); ETag and bounded refresh |
| Raw and parsed bodies | Full RecordId and parser revision | Average O(1); immutable `Arc` values |
| Revision sets | Vector sorted by `(fetched_at_ms, sha256)` | O(log n) range start plus O(r) relevant fold |
| Domestic hours | Fixed KST date/hour slots | O(1); preserve legacy 00:00 attribution |
| World hours | Sorted UTC instants plus local date/offset | O(log n); DST 23/24/25 hours |

Response keys include route/version, exact relevant location/address semantics,
locale, units, air units and all output-affecting parameters. Share grid-level
raw data across locations, but do not cache final labels or coordinates by
grid alone. Preserve numeric zero, invalid sentinel and `hasOwnProperty` rules.

Moka is a candidate concurrent cache; store large values behind `Arc`, not deep
copies on every hit. No cache-wide lock may be held across network/CPU awaits.
Cache weights alone are not a hard RSS bound: add limits for in-flight bytes,
decompressed sizes, pinned values, queued CPU work and response buffers.
Use monotonic elapsed time for TTL/deadlines and provider-local wall dates for
period selection. Clock steps cannot reopen spent reservations or reorder rows.

Single-flight covers a whole resolution operation, not just a body GET. An
owned task can finish S3 publication after the initiating HTTP waiter cancels;
other waiters share it. Global I/O/CPU limits and per-request fairness prevent
many concurrent cold misses from multiplying the assumed 32-way fan-out.
Transform ordering from [the domestic pipeline](mobile-api.md#domestic-api-middleware-in-order)
stays intact even when its independent I/O is scheduled concurrently.

Independent API processes duplicate caches and provider/S3 work. If measured
crash-isolation needs justify them, compare a Unix-socket resolver/cache owner
against independent caches. IPC introduces serialization/copies and an owner
failure point. Shared `mmap`/`memfd` byte blocks require process-safe ownership,
offset addressing and reclamation; normal Rust `Arc`/heap pointers cannot be
used as interprocess pointers. This is an alternative, not initial implementation.
Pack builders or push jobs may be isolated without splitting all API workers.

## 4. S3 layout and catalog publication

Use a private bucket, TLS, encryption and prefix-scoped least privilege. Never
persist provider credentials, signed URLs, raw request logs or access tokens
in weather objects. General-purpose S3 in the origin's region is the baseline.

```text
raw/v2/{source}/{kind}/{YYYY}/{MM}/{DD}/{period}/{key_sha256}/
  {fetched_at_ms}-{raw_sha256}.raw.gz
index/v2/{source}/{kind}/{key_sha256}/{partition}.json
packs/v2/{source}/{kind}/{key_sha256}/{date}/{pack_sha256}.pack
summary/v2/{source}/{key_sha256}/{date}/{revision_sha256}.json
state/v2/...
budgets/v2/...
```

RecordId is `(source, kind, key, period, fetched_at_ms, sha256(raw bytes))`.
Use full hashes, canonical typed key serialization, normalized coordinate
order and a schema version. Kind/path encoding is fixed by the format schema,
not arbitrary slash concatenation. Preserve exact provider bodies with bounded
gzip decoding; data.go.kr uses `dataType=JSON`. Detect gateway XML/quota/auth
errors even when transport status looks successful, and never index them as data.
Paginated responses retain page bytes and order, with completeness metadata.
VC day placement uses the first provider-local date covered, not fetch UTC date.
World-provider keys, cache identities, locks and VC request coordinates use
legacy [DSF's 0.02-degree cell centre](../../server/controllers/worldWeather/dsf.controller.js),
including integer-microdegree rounding, negative coordinates and pole/dateline
clamps. Persist that cell's provider body; never substitute the original user
coordinate in an S3 key, metadata or request body. The exact client label remains
a separate volatile geocoding result. P1 includes within-cell sharing and boundary
fixtures so privacy coarsening preserves the already deployed weather semantics.

An identity catalog contains schema/generation, source/kind/key/partition,
coverage and fetch identities, ordered page references, completion and raw
length/hash. Optional pack references hold key/offset/compressed length.
It contains **no normalized weather values or stored field-merged view**.
The actual API result is derived in memory. Partition identities distinguish
requested/covered periods from fetch time; revision selection never relies on
S3 object arrival or ETag as a raw-content hash.

Daily catalogs bound common history lookup. Forecast publication partitions,
address-geocode catalogs and warning type catalogs have deterministic keys.
Large catalogs split into deterministic time partitions with a bounded root;
the extra root hop must enter latency measurements. Keep catalogs hot in S3
Standard. Enable bucket Versioning for mutable catalogs and do not delete their
old versions. Canonical raw data remains `If-None-Match: *`, with content
integrity checked; an ambiguous/412 result is reconciled by metadata/body verification.

Retained catalog versions also have growing-copy cost. With 512-byte identity
entries and one append per write, 192 revisions retain about 9.05MiB across
versions versus 96KiB in the final catalog; 1,000 retain about 244.4MiB versus
500KiB. Headers, page lists and pack updates add more. In general retained bytes
are `sum(version_header + entry_size * entries_in_that_version)`, not just final
catalog size. These are sizing examples, not observed traffic. P2 measures write
cadence, revision count and serialized size per partition; deterministic finer
time partitions bound growth but can add root/lookup hops. O-5 must assess these
costs alongside packs. No noncurrent-version deletion is authorized here.

### Publication and recovery

1. Validate all pages, compute their group declaration, persist any required
   identity descriptor and PUT canonical raw objects with immutable IDs.
2. Read/create the authoritative partition catalog and union the new identities.
3. Publish it using ETag `If-Match` (or `If-None-Match` on creation). Retry a
   conflict by re-reading and unioning; never overwrite concurrent revisions.
4. After all partitions of each required fetch group are published, verify its
   completeness, expose it in memory and send success. There is no all-request
   cross-object transaction across independent provider fetches.

One validated provider acquisition, including all its pages, is a **fetch group**.
Prefer one owning publication partition per acquisition (VC's complete range in
its first local date; KMA by service/entity/base publication). When identities
must appear in several catalogs, each carries the immutable group ID, full
expected partition list, ordered member-identity digest and expected member/page
counts. The group ID hashes this declaration. Readers pin and obtain *all* sibling
catalogs, check matching declarations and the complete member union/digest, and
only then admit that group's revisions. No normalized view is persisted.
Raw-object metadata retains the bounded identity-only group declaration, or an
immutable identity-descriptor reference if it exceeds metadata limits, so orphan
repair can validate the expected set rather than blessing only the pages found.
Descriptor acquisition adds a measured lookup hop where needed.

Thus A published plus B old/missing is an incomplete group, not an independently
usable new A revision: retain the preceding complete group, or use the existing
error/fallback. Packs and summaries apply the same eligibility rule. A concurrent
write can cause conservative exclusion until a bounded refresh, never acceptance
of a partial group. Fetches declared independent by their kind remain independent;
P1 validates this boundary rather than assuming whole-request snapshot semantics.

S3 CAS remains atomic **per catalog**; reader eligibility supplies group-wide
visibility. A crash before group completion leaves archival/pending identities
that cannot be served as a complete fetch. A crash after completion but before
response is restored from the complete catalog set. An unknown PUT outcome
requires reading the actual catalogs before retrying. Multi-partition discovery
can require an additional sibling-catalog wave and bytes; single-owner groups
avoid it, and the latency table explicitly assumes required catalogs fit one wave.

On missing/inconsistent catalogs, reconstruct the relevant identity set by
bounded, fully paginated prefix LIST plus validated bodies. Group completeness
must be established before publishing recovered pages. On an existing catalog,
orphan reconciliation separately examines recently written partitions at startup
and during maintenance; a healthy catalog alone cannot prove no unindexed raw
objects exist. Recovery keeps all valid revisions and cannot invent a complete
result from a timed-out partial LIST. The hot serving path uses published records;
it is not a claim to discover every interrupted upload instantly.

A normal catalog hit directly provides all required revisions. Select earliest
fetch for immutable kinds; use `(fetched_at_ms, sha256)` for revisable kinds;
fill only absent fields for current-like kinds and replace list kinds. Do not
skip earlier revisions until parity tests prove they cannot affect the result.
A request pins its catalog generations while assembling. Late inputs invalidate
dependent memory results on bounded catalog refresh; open periods have short
refresh intervals. Missing index is not automatically missing provider data:
attempt bounded repair before deciding whether a quota-funded provider fetch
is needed. Incomplete repair returns the existing error contract or legacy
fallback; it must not hide a history gap behind a new successful response.

## 5. Exact-raw packs to reduce fan-out

Retain the canonical object per record and optionally create serving duplicates
for closed day/source/kind/entity partitions. Each pack concatenates independently
compressed original bodies; the catalog identifies every member's offset,
compressed length, raw length/hash and canonical fallback key. Members decode
to the exact same raw bytes. No merged weather projection is stored in a pack.

Build packs from already durable S3 records, after the response or on maintenance;
this is storage compaction, not provider pre-collection. Upload and validate the
pack before conditionally publishing its catalog references. A changed catalog
must retain late revisions and other writers' entries. Missing/corrupt pack or
member falls back to the canonical object, verifies it and records a repair signal.

Closed-day base packs plus bounded additional blocks handle late revisions.
Today's open period can keep individual objects. Avoid repeatedly uploading a
growing day pack: it creates quadratic duplicate storage when old packs are
retained. Content-addressed pack IDs make identical retries idempotent.
Original no-delete retention applies unless a separate pack-only lifecycle is
approved; cost estimates must include every retained pack generation.

Read a whole small pack or coalesce nearby needed members into a contiguous
Range GET. One range request per record would not reduce GET fan-out. S3 does
not combine multiple disjoint ranges into one GET. Bound over-read bytes and
decompression memory. Do not bundle unrelated cities into a huge mandatory
download; global provider pages retain their natural shared identity.

## 6. Geocoding, warnings, summaries and state

The [privacy requirement](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-5857575721)
is an explicit exception to permanent raw archiving: precise coordinate-keyed
reverse-geocode bodies, coordinates and a reversible archive of their lookup
history must not be stored in S3 catalogs, packs or metadata. A hash alone is
not anonymization. Keep legacy-key lookup results only in bounded volatile memory
with at most the legacy 30-day validity. Address-keyed records may persist under
the issue's policy. Coarsening must not silently change an active API's label.

Consequently an empty-memory reverse-geocode request can need the geocoder
provider even when all *persistable weather records* are in S3. The two-wave
S3-geocode example below applies to persistable address lookups, not this case.
Provider-free cold restoration cannot be promised for precise coordinate labels.
Weather/geocode contracts still require parity: legacy forwarding stays available
until privacy-safe acquisition and its deadlines are validated. Cross-process
IPC and operational logs must not turn volatile coordinate history into a disk log.

| Reverse-geocode alternative | Cold behavior and compatibility |
| --- | --- |
| Volatile legacy-key cache (selected initial design) | Preserves provider/label semantics and raw-only storage policy; replacement loses the legacy Mongo cache's restart survival and incurs provider cost |
| Two-decimal/KMA-cell persistent key permitted by the privacy comment | Can reuse coarse identities, but cannot archive raw coordinate-lookup bodies. A stored label projection needs an explicit persisted-data exception; address-record pointers alone do not prove identical labels within a cell |

Coarse reverse-geocode serving is not selected without that decision and P1
proof across administrative boundaries, both sides of cell edges, locales,
country/KMA-address and returned-coordinate fields. Same grid weather does not
imply the same display name. Preserve the volatile alternative and legacy
forwarding if parity, latency or quota gates fail; do not silently trade label
accuracy for S3-only restoration. #2619's later client grid protocol is separate.

The four observed `/weather/.../coord` groups total **195,350 requests (88.56%
of product traffic)**. They geocode before backend dispatch. These counts include
CloudFront hits, not 195,350 origin/provider calls. Their non-Hit categories sum
to 162,206 (Miss + RefreshHit + Error), an upper workload proxy rather than proof
that each reached the origin. Exact distinct lookup keys, peak rate, cache-hit
rate and retry/fallback multiplicity were not measured in the accepted report.

For a replacement's interval W, let `U_W` be distinct uncached legacy
coordinate/locale keys that reach server2. Single-flight requires at most one
lookup operation per such key while alive; reserve the maximum configured
provider-chain cost `a_max` up front, and charge actual provider HTTP units.
Successful one-provider acquisitions cost approximately `U_W`; a two-provider
chain approximately `2 * U_W`; failures/key rotations can use up to
`a_max * U_W`. Each chain has the legacy five-second lookup cap and the overall
nine-second request cap. Discarded/ambiguous reservations stay spent.

As arithmetic only, the 30-day non-Hit proxy averages 5,407 coordinate-weather
requests/day, 0.0626/s or about 19 in five minutes. If a five-minute replacement
window sees that average and every key is uncached, one/two-provider chains cost
about 19/38 calls. This is not a peak estimate. An all-unique month costs up to
162,206/324,412 calls under those assumptions, before direct geocode calls,
retries and incomplete logging; these coordinate-weather paths average 6,512/day
when CloudFront Hits are included. This is not the average of all product traffic.
Daily quota headroom must cover `a_max * U_day` plus background/other demand;
peak admission must cover `a_max * U_W / W`, not the monthly average.

P2b measures aggregate key counts/hit rates and chain attempts without persisting
precise key histories, tests replacement under peak recorded arrival rates and
multiple replacements, and limits geocoder concurrency within gateway admission.
There is no guaranteed safe peak from this CSV. Do not activate volatile-only
geocoding unless the actual quota, p95 and error gates pass against the legacy
restart-surviving cache. Warm-up cannot restore its precise-coordinate entries.

Warning type catalogs publish raw bulletin references and announcement identities
as their authoritative partition: do not add a separately required latest marker
that can disagree with the serving commit. Preserve types 1–3's greatest
announcement without age expiry and type 4's legacy +19h actual-instant rule.
Missing type catalogs repair from bounded announcement/year partitions or seeded
legacy exports; cold latency is not bounded by one GET during catalog repair.

Summary objects are the authorized derived-data exception. Preserve grid's
legacy input sources/00:00 rule and >=18 valid hours, ASOS ordered valid min/max
with optional rain, and VC >=75% of actual local hours. Record the exact input
catalog generations and revision sets. A fully read catalog is not proof that
future late records cannot arrive. Recompute when later inputs become published;
do not finalize a summary after partial repair. Last-year lookup remains same
date, then nearest +/-1..3 days; at each date grid → ASOS → VC. ASOS missing
data may require on-demand provider calls, so that path is outside the no-provider
latency examples. Product exposure remains O-13.

Push/purchase/notice state is separate from weather raw bodies. Follow the
[S3 notice handoff](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-5882199479)
and [push coordinator design](push-s3-design.md) rather than porting superseded
SQLite proposals or resurrecting retired payment routes. Mutable state uses
conditional revision writes and durable task/attempt identities. An accepted
mutation must be durable before acknowledgment. External push acceptance and
S3 checkpoint cannot be one transaction; document the possible duplicate-send
window. Migration, notification ownership and reverse rollback need their own
P8 design before activation. Never broadcast on startup recovery.

## 7. Budgets, deadlines and failures

Reserve provider-unit budgets synchronously in S3 before sending HTTP. Reservation
IDs and spend windows survive replacement; ambiguous or abandoned reservations
are conservatively spent, not refunded/reused. Retry/key rotation follows #2604,
with at most one retry only where permitted and funded inside the request deadline.
Canonical records, catalog updates and state writes also have bounded retries;
unbounded AWS SDK retry defaults cannot extend the nine-second gateway deadline.

The three-second gateway backend-attempt cap includes resolution and durable
publication for an in-process family as well as loopback. Retries share the
owned resolution/publication and reservations; a new waiter does not blindly
refetch providers. Keep current error/503 retry classification and at most three
backend attempts; the provider's own allowed retry count remains separate.
Do not extend these timeouts to make synchronous S3 publication appear faster.

For a new-data miss, bound the chain explicitly:

```text
total <= geocode_lookup + backend_attempts + final_response_work <= 9s
backend_attempt = budget_reservation + weather_provider
                + raw_PUT_batches + catalog_GET + catalog_CAS_PUT
                + conflict_reconcile + verification/assembly <= 3s per waiter
```

For illustration, a single-owner miss with reservation 0.1–0.2s, weather
provider 0.5–1.5s, three S3 waves 0.3–0.6s and CPU 0.2s needs 1.1–2.5s backend
work before transfer/queues. One CAS conflict adds GET + PUT (0.2–0.4s).
Adding a one-provider geocode acquisition/reservation of 0.4–1.4s gives
1.5–3.9s total before those excluded costs; one backend attempt still caps at
3s. These inputs are assumptions, not a timeout guarantee. Multiple provider
dependencies, raw batches, sibling catalogs and geocoder fallbacks add their
actual waves. Budget remaining time before every stage; if raw/group publication
cannot finish, the new result is not acknowledged. Work ownership, interruption
and later waiters do not grant extra HTTP time. P2b measures this miss path
separately from the all-records-present cold examples.

| Failure | Serving behavior |
| --- | --- |
| S3 down, valid complete memory result | Serve within its existing freshness contract |
| S3 down, no usable memory result | Existing route error/fallback; no invented success |
| Provider succeeded, raw or catalog PUT failed | No acknowledgment of the new result; bounded reconcile/retry |
| Body/pack hash mismatch or decompression limit | Reject member; verified canonical fallback or route error |
| Memory pressure | Evict and bypass optional caching; admission/backpressure before OOM |
| Partial paginated fetch/repair | Never label it complete; preserve legacy absent/error semantics |
| Cancelled HTTP request | Other waiters survive; owned publication job bounded by shutdown policy |
| Spot loss without notice | Published data survives in S3; cache starts empty; unacknowledged work may be lost |

Rejecting a new success on S3 failure is a proposed availability/durability tradeoff,
not an already measured legacy behavior. If it changes an active contract, the
family stays on legacy until the decision is recorded and compatibility gates
are satisfied. No claim of RPO zero is made for an unacknowledged provider reply.

## 8. Cold-memory latency model

These are arithmetic scenarios, **not measurements, p95 values or a service SLA**.
They begin when server2 receives a request and end when its response is assembled.
Client/CloudFront transit, process launch, queues, retries, index repair, fresh
provider calls and reverse-geocoder acquisition are excluded. Required catalogs
and bodies are present/usable, same-region S3 is healthy, and sufficient I/O slots
exist. AWS's broad latency guidance is not a guaranteed request duration.

```text
waves = location dependency waves + catalog waves + ceil(body GETs / concurrency)
T = waves * assumed_wave_latency + compressed_MiB / effective_MiB_per_sec
    + decompression/verification/parsing/assembly allowance
```

Use 100–200ms per wave and 50MiB/s effective bandwidth for comparison. A wave
means a batch's completion, not a claim that parallel GET tails equal one GET.
Transfer and CPU allowances simplify overlap into an illustrative additive model.
The 240-object case assumes 12MiB and 0.20s CPU/router work, plus two persistable
location-lookup waves and one catalog wave (all needed catalogs fit that wave).
Counts are scenarios, not a deployed inventory: 8x24 hourly grid slots alone
are 192 identities; sky/station/minute inputs, revisions and pages can add more.
The superseded 19-wave case is two persistable location waves + one LIST wave
(all prefixes/pages assumed to fit) + `ceil(240/32)=8` per-record commit-reference
GET waves + eight body waves. It is a previous model, not the current group
protocol; paginated LISTs or more prefixes would increase it.

| Scenario | GET bodies/blocks | Parallelism | Waves | Estimated seconds |
| --- | ---: | ---: | ---: | ---: |
| Prior LIST + per-record commit + body design | 240 | 32 | 19 | 2.34–4.24 |
| Direct catalogs + individual bodies | 240 | 32 | 11 | 1.54–2.64 |
| Direct catalogs + individual bodies | 240 | 64 | 7 | 1.14–1.84 |
| Prepared raw packs, compact scenario | 16 | 32 | 4 | 0.84–1.24 |
| Prepared raw packs plus open/late data | 48 | 32 | 5 | 0.94–1.44 |
| Individual bodies, constrained concurrency | 240 | 16 | 18 | 2.24–4.04 |
| Many revisions: 40MiB, 0.45s CPU/router | 1000 | 32 | 35 | 4.75–8.25 |

Pack scenarios assume the same total bytes/CPU as 240 bodies and packs already
exist; over-read, decompression and unfinished current-day blocks can worsen
them. Thread count alone does not increase bandwidth or guarantee this speed.
Under independent identical GET distributions, p95 of the maximum of 32 GETs
corresponds to the individual p99.84, not p95. Measure full request percentiles.

### Empty-memory coordinate weather, including the geocoder

For the 88.56% coordinate-weather group, replace the two persistable location
waves with actual volatile-cache-miss geocoder acquisition. Assume only for
comparison 0.3–1.2s per successful provider call and 0.1–0.2s per synchronous
quota-reservation wave. One provider is 0.4–1.4s; a sequential Kakao/Google chain
is 0.8–2.8s. The per-call/lookup/gateway caps still apply; retries and queues are
excluded. No geocoder raw body is durably published. These assumptions are not
provider measurements and cannot establish the cutover p95 gate.
The two-provider case conservatively counts two sequential provider-specific
reservation writes, both completed before the first HTTP call as part of maximum
up-front admission. Parallel reservations or pre-reserved blocks can reduce that
term; failed admission must prevent unreserved provider calls.

| Coordinate-weather case | Geocoder + weather waves | Estimated seconds |
| --- | --- | ---: |
| One provider; 240 individual weather bodies at concurrency 32 | 1 geocode acquisition + 9 weather S3 waves + 0.44s allowance | 1.74–3.64 |
| Two sequential providers; same individual bodies | 2 geocode acquisitions + 9 weather S3 waves + 0.44s | 2.14–5.04 |
| One provider; 16 prepared weather blocks | 1 geocode acquisition + 2 weather S3 waves + 0.44s | 1.04–2.24 |
| Two sequential providers; 16 prepared weather blocks | 2 geocode acquisitions + 2 weather S3 waves + 0.44s | 1.44–3.64 |

An acquisition above includes its reservation wave. The prior table remains
conditional on usable persistable location lookups; it is not the dominant
public path's replacement performance. All tables exclude client/CloudFront
transit and multi-partition sibling discovery. The latter adds waves/bytes when
needed, with complete-group eligibility retained. Measure actual request tails
and timeout/error rates before switching this route family.

P2 measures body counts/bytes and catalog sizes from P1 fixtures, concurrency
8/16/32/64, empty-cache and warm latency, CPU/RSS, actual same-region GET/PUT
tails, cancellation, Spot replacement and catalog/pack repair. Measure public
coordinate requests including geocoder time separately. Report origin transit
and CloudFront hit/miss cases separately from assembly and provider time.

## 9. Spot scale-up and future scale-out

Initially one Spot host runs the shared-cache API process. Increase resources
only against observed CPU, bandwidth, cache eviction, cold fraction and queue
delay. A larger CPU count cannot remove S3 round trips; pack fan-out reduction
and parsed-data reuse precede instance enlargement. Compare total compute,
canonical/pack/catalog/version storage, PUT/GET, retrieval and load-balancer
costs per served request; earlier SQLite/zstd capacity prices are not this model.
No live AWS prices or instance-size recommendation were measured for this PR.

Shutdown on Spot notice removes readiness, rejects new work and drains bounded
in-flight publication. Replacement readiness follows essential initialization;
optional warm-up reads a bounded recent working set from S3 only. Correctness
never depends on receiving a notice or copying memory to another host. One Spot
host can leave an origin availability gap; CloudFront does not guarantee a cached
answer to every request. An On-Demand minimum is an optional later availability
decision, not infrastructure added here.

Before multiple instances, add: load-balancer readiness/drain; globally durable
provider budgets; per-resolution fetch ownership with expiry/fencing and unknown
HTTP-outcome handling; unique push/compaction ownership; concurrent catalog CAS
tests; and bounded S3-only replacement warm-up. Each instance keeps its own
memory cache and reads the same S3 records. No shared cache is required initially.
Optional key-affinity routing can improve reuse but cannot be correctness-critical.
Cross-instance exactly-once external provider/push calls are not promised by a
lease. Select coordination primitives in that phase, before turning it on.

## 10. Issue decision reconciliation

| Original item | Amendment / remaining decision |
| --- | --- |
| D2/D7/D8, C6–C8 | S3 serving publication, memory reconstruction; no local store/uploader/synced rows |
| O-1, O-11 | Still open; history/raining-now capture exceptions or proven equivalent acquisition are needed before affected active API cutover |
| O-2 | Rust conditional go; P2 executable checkpoint and post-v000903 time-box remain |
| O-3 | S3-authoritative state proposal; exact migration/outbox/ownership is a P8 prerequisite |
| O-4, O-12 | gp3/15-day floor/ENOSPC policy removed; replace with memory admission and S3-failure policy |
| O-5 | Keep canonical raw data; re-evaluate hot catalogs, pack versions and retrieval costs; no Flexible/Deep Archive objects on synchronous serving paths |
| O-6 | Coordinate-lookup export is incompatible with privacy policy; optional address-only export requires review |
| O-7 | No blanket removal of health-index/KAQ behavior that current active API fixtures contain |
| O-8 | v000705 town is active; exclude only zero-observed in-scope public APIs; /ww evidence gap remains |
| O-9 | Proposed raw PUT + catalog publication before success; drain assists but is not the durability boundary |
| O-10 | Separate server2 key set during coexistence remains |
| O-13 | Store summaries; product exposure remains a separate decision |

Record the chosen catalog/versioning, pack duplication, privacy, outage and state
policies alongside O-1…O-13 in #2614 before runtime work. This PR documents the
amendment; it does not rewrite the issue body or claim those decisions completed.

## 11. References and limitations

- [Current mobile API and domestic assembly](mobile-api.md); the architecture
  index's older AWS/Lambda snapshot is historical, not a new deployment assertion.
- [AWS S3 consistency](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html),
  [conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html),
  [LIST pagination](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html).
- [AWS performance design patterns](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance-design-patterns.html)
  and [same-region/range guidelines](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance-guidelines.html).
- [Tokio CPU/blocking guidance](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html),
  [Moka concurrent cache](https://docs.rs/moka/latest/moka/future/struct.Cache.html),
  [Rust Arc](https://doc.rust-lang.org/std/sync/struct.Arc.html).
- [Spot interruption notices](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-instance-termination-notices.html)
  are best-effort; hibernation does not provide the normal two-minute drain window.

The PR verifies documentation, diagrams and arithmetic. It runs no weather server,
provider request, S3 integration, live traffic refresh, mobile build or deployment.
