# server2: memory and S3 origin design

Status: **design under implementation; not deployed**. S01 decisions and the S04
Rust/CI/placement foundation are integrated; weather/S3/provider routes remain
future work. This 2026-10-06 amendment
to [#2614](https://github.com/WizardFactory/TodayWeather/issues/2614) replaces the
SQLite proposal with memory → S3 → provider. The source baseline inspected for
this PR is `182f4fd745fdfebe95092d186cead8f8a17242ab`; deployment and traffic
observations keep their own dates. Runtime code will live under `server2/` in
task-owned PRs after their named decision and dependency gates. AK's core
S01 decisions are [recorded on #2614](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6009156640).

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
the approved replacement for SQLite commit plus the 60-second uploader.

AK approved demand-limited history/rainfall capture and S3 publication/outage
policy on 2026-10-06. [Later AK directions](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6015980608)
resolve push send failures, fresh registrations and useful memory/S3 geocoding
caches. Storage schema and update ordering are implementation decisions inside
the initial single-process design, not a separate writer service or AK decision.
Privacy/label proof, measured costs, keys and cutovers keep their named gates.
The approved legacy push-registration continuity difference is limited to that
state; used API contracts and weather-history compatibility still hold.

### Implementation placement

AK's binding direction is broader than Rust source placement: **all new assets
for server2 equivalent to `server/` responsibilities or assets belong under `server2/`**.
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

S02 may create the planned legacy golden recorder at
`server/test/offline/golden-record.js` solely to execute the legacy parity target;
this file does not exist at the inspected head/base. Its output fixtures and
consumer belong under `server2/tests/golden/`. Existing gateway fixtures can be
used as legacy oracle inputs without relocating their maintained legacy copies. A named legacy export
or coexistence change is likewise permitted when a task explains why it must run
in legacy. These exceptions do not permit placing the new runtime, fixtures or
server2-specific tooling in legacy. Legacy retirement is a separate authorized
task after cutover. Existing unrelated assets need not be moved by this rule. Ordinary legacy
maintenance, including new modules/tests for legacy behavior, remains allowed
in `server/`; it is outside server2 work, not a placement exception.

Every implementation task must declare paths, enumerate necessary outside
changes with reasons, and include the placement completion criterion from the
[common task contract](../../plans/issue-2614.md#common-contract-for-every-implementation-task).
S04 [PR #2708](https://github.com/WizardFactory/TodayWeather/pull/2708) introduced
the local/CI placement check and Rust foundation before later implementation tasks.
Its literal-path checks supplement dependency review; they are not a sandbox. S02 golden assets and S03 configuration/deployment
assets depend on S04; only inventory and infrastructure planning may precede it. Until then, task completion requires a recorded
manual path/dependency review. The checker exists after S04; this does not claim remote branch protection
or route-porting compatibility has been established.

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
coordinate in an S3 key, metadata or request body. The exact client label remains a separate geocoding result governed by the
privacy/label cache contract in section 6. P1 includes within-cell sharing and boundary
fixtures so privacy coarsening preserves the already deployed weather semantics.

An identity catalog contains schema/generation, source/kind/key/partition,
coverage and fetch identities, ordered page references, completion and raw
length/hash. Optional pack references hold key/offset/compressed length.
It contains **no normalized weather values or stored field-merged view**.
The actual API result is derived in memory. Persisted weather content remains
raw provider bodies, legacy exports, authorized daily weather summaries and
identity/index rows. Separate accepted push state follows D01–D03. D04 permits
a narrowly scoped **geocoding cache** exception: a privacy-safe coarse-identity
projection containing only necessary response label/location-classification
fields, locale, source/provenance and bounded validity. No precise user coordinate,
user/device/IP/token, raw reverse-geocode lookup body or reversible lookup history
is eligible. S07/S10 must define the projection schema and expiry (at most the
legacy 30-day geocode validity), prove every reused label/response field against
legacy across cell/administrative boundaries, and fall back on a miss or failed
proof. This cache exception is not a normalized weather store or an indefinite
precise-coordinate archive.

Partition identities distinguish
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

The [complete-group sequence](diagrams/server2-catalog-publication.html)
([editable JSON](diagrams/server2-catalog-publication.sequence.json)) explains
the S06 internal publication, eligibility and repair contract. Its source links
are pinned to the merged `4864c936` contract, rather than claiming deployed
weather routes or production S3 verification.

1. Validate all pages, compute their group declaration, persist any required
   identity descriptor and PUT canonical raw objects with immutable IDs.
2. Read/create the authoritative partition catalog and union the new identities.
3. Publish it using ETag `If-Match` (or `If-None-Match` on creation). Retry a
   conflict by re-reading and unioning; never overwrite concurrent revisions.
4. Before writing, check that the new acquisition fits the operation bounds.
   After all its partitions are published, verify only that acquisition's
   declared siblings and exact bodies before acknowledging it. Do not re-read
   unrelated historical acquisitions to acknowledge a new group. There is no
   all-request cross-object transaction across independent provider fetches.

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

S05's internal raw-record wire contract is documented in its
[operator manual](../operations/server2-records.md).
`x-amz-meta-s2-record` carries the base64 canonical identity/envelope JSON, and
`x-amz-meta-s2-gzip-sha256` identifies the compressed bytes. An optional immutable
`FetchGroupRef` is prepared before the raw PUT and contains identity-only group,
member and partition hashes plus the `members` count; its descriptor key is
`index/v2/groups/{group_sha256}.json`. S06 owns descriptor/catalog publication and
completeness validation, including the expected partition/page sets. A successful
raw PUT acknowledges that body only: it is
not a catalog/fetch-group commit or permission to cut over a serving route.

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

A normal catalog hit provides the identities of retained revisions. Materialize
only the requested complete acquisitions within a bounded page, rather than
downloading every historical body on each lookup. Keep all archival revisions
and catalog identities. A checked page is not proof that the whole revision
range has been read. Its continuation pins the target catalog generation and
ETag and revalidates previously checked sibling dependencies; a changed
dependency requires a restart, not continuation into another snapshot. Pages preserve whole acquisitions and their complete member/page
sets. Select earliest fetch for immutable kinds; use `(fetched_at_ms, sha256)`
for revisable kinds; fill only absent fields for current-like kinds and replace
list kinds. A full-history merge must consume the required revision range before
returning its result. Do not skip earlier revisions until parity tests prove
they cannot affect the result.
A request pins its catalog generations while assembling. Late inputs invalidate
dependent memory results on bounded catalog refresh; open periods have short
refresh intervals. Missing index is not automatically missing provider data:
attempt bounded repair before deciding whether a quota-funded provider fetch
is needed. Incomplete repair returns the existing error contract or legacy
fallback; it must not hide a history gap behind a new successful response.

### S06 boundary for resolver and provider budgets

S06 returns pinned, verified identity sets and catalog dependency tokens to the
later S07 resolver. A complete fetch group requires the full declared member,
page and sibling-partition sets; neither a raw PUT acknowledgement nor a stored
`complete` flag is sufficient. Hashing the descriptor must use the declaration
before its own group reference is attached, avoiding a circular hash dependency.
An already published raw identity retains its original group affiliation;
reconciliation cannot rewrite immutable metadata to join another group.

Repair must distinguish a fully exhausted, validated scan from a pending or
failed scan. A timeout, continuation failure or missing declared member cannot
turn partial discovery into a proven empty result. Healthy catalogs can still
have orphaned bodies and therefore remain eligible for explicit bounded repair.
Keep every eligible revision in deterministic order; field merges and list
replacement remain in-memory operations, not persisted catalog payloads.

A bounded page contains checked complete acquisitions and an explicit continuation;
it never masquerades as a full-history set. Exhausting a healthy read budget is
a capacity outcome, not evidence of corruption. The full-history convenience
lookup can report capacity or a deadline failure. A targeted lookup by an
archived member identity validates only that complete acquisition and its
siblings, keeping old and new acquisitions accessible without traversing
unrelated history. Targeted coverage is explicit: no continuation does not
mean that all historical revisions have been consumed. Cross-page dependency
revalidation can itself reach capacity or the caller deadline; that blocks the
full-history snapshot, while a targeted acquisition remains independently
readable within its own bounds. Publication checks the new group only and
avoids historical-body materialization; its declared group, catalog and
operation bounds still apply. Structural catalog/object limits fail closed
without pruning identities.

Revision coverage distinguishes a full-history set from a newly published
group, a targeted acquisition and an individual page. Only a full-history set
can use the whole-history fold helper. Callers must explicitly parse a published
or targeted group instead of treating it as the complete merge input.

Retained control bytes are bounded within each phase, rather than advertised
as one cumulative transfer-byte limit across all phases. Preflight drops each
processed catalog/union before continuing; descriptor/raw/CAS buffers are
released before final verification starts. The final check reserves room for
the new group's descriptor and the maximum permitted size of each declared
sibling catalog, so later index growth does not invalidate that group's read
admission. This can reject a group before any PUT even when its declaration
fits the wire format's partition-count bound. Actual request work, conflict
attempts and the caller's overall deadline remain bounded; a sent write whose
outcome cannot be confirmed remains uncertain. These are per-operation/phase
limits, not a global process RSS guarantee or a promise that a full-history
snapshot fits the serving deadline.

A fully exhausted repair can complete identity indexing without materializing
all historical bodies at once. This nonempty indexed outcome is distinct from
a checked serving set and from `CompleteEmpty`; callers must read checked pages
before using its records. A partial scan, missing member or invalid object cannot
produce a complete indexing or empty result. Repair retains identity envelopes
rather than duplicate raw bodies during group validation. Each repair scope must
map its periods to the declared owning partition; a caller cannot file another
partition's records into that scope.

The initial S06 lookup/repair utility reads selected descriptors and raw members
sequentially within one operation. Its `io=16` admission bound permits concurrent
operations; it does not supply sixteen-way fan-out inside one lookup. The wave
counts in section 8 describe the proposed bounded-parallel resolver strategy,
not measured S06 latency. S07/S09 must verify or improve this path before the
existing feasibility/cutover gates; loopback smoke timings are not AWS estimates.

The caller's monotonic deadline covers the whole operation: descriptor/body
writes, catalog conflicts, sibling reads, credential waits and repair pages.
Independent three-second transport calls cannot extend the existing backend
attempt budget. S07 owns cache admission, single-flight and refresh policy;
S08 owns `budgets/v2/` reservations and provider admission. Weather catalogs do
not contain quota arithmetic, and unresolved repair does not authorize an
unreserved provider request.

Conditional catalog publication uses the returned opaque ETag with `If-Match`,
or `If-None-Match: *` for creation. Conflicts require a bounded read-and-union
retry. Prefix repair follows every `ListObjectsV2` continuation page before
claiming scan completion. These are protocol requirements from the
[AWS conditional-write documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
and [ListObjectsV2 API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html);
loopback verification does not establish actual IAM, SigV4 or AWS latency.

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
not anonymization. [D04](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6015980608)
authorizes useful memory and S3 geocoding caches within that privacy requirement.
The implementer selects layout, validity and admission; legacy-key precise results
may remain in bounded volatile memory with at most the legacy 30-day validity.
Address-keyed records and privacy-safe persistent cache projections may persist
under the authorized cache strategy. Do not archive raw precise-coordinate bodies
or reversible lookup history. Coarsening must not change an active API label.

Consequently an empty-memory reverse-geocode request can need the geocoder
provider even when all *persistable weather records* are in S3. The two-wave
S3-geocode example below applies to persistable address lookups, not this case.
Provider-free cold restoration cannot be promised for precise coordinate labels.
Weather/geocode contracts still require parity: legacy forwarding stays available
until privacy-safe acquisition and its deadlines are validated. Cross-process
IPC and operational logs must not turn volatile coordinate history into a disk log.

| Reverse-geocode alternative | Cold behavior and compatibility |
| --- | --- |
| Volatile legacy-key cache (available fallback) | Preserves provider/label semantics and raw-only storage policy; replacement loses the legacy Mongo cache's restart survival and incurs provider cost |
| Two-decimal/KMA-cell persistent key permitted by the privacy comment | Can reuse coarse identities, but cannot archive raw coordinate-lookup bodies. D04 permits privacy-safe persistent caching; store only the necessary coarse cache projection after exact-label proof, not raw precise-coordinate lookup history. Address-record pointers alone do not prove identical labels within a cell |

The concrete persistent-cache layout is an implementation choice after D04;
coarse reverse-geocode serving still requires P1 proof across administrative boundaries, both sides of cell edges, locales,
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
There is no guaranteed safe peak from this CSV. Validate the selected memory/S3
cache strategy against actual quota, p95, error and exact-label gates before
activation. A precise-cache miss may still need a provider; warm-up cannot restore
forbidden precise-coordinate archives. The cold-provider calculations remain
applicable to that path even when privacy-safe S3 cache entries exist.

Warning type catalogs publish raw bulletin references and announcement identities
as their authoritative partition: do not add a separately required latest marker
that can disagree with the serving commit. Preserve types 1–3's greatest
announcement without age expiry and type 4's legacy +19h actual-instant rule.
Missing type catalogs repair from bounded announcement/year partitions or seeded
legacy exports; cold latency is not bounded by one GET during catalog repair.

Daily weather summaries are the authorized derived-weather exception; D04
geocoding cache projections below do not permit normalized weather views. Preserve grid's
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
conditional revision writes and durable delivery identities. Newly accepted
state must be S3 durable before acknowledgment. D02 selects **no automatic retry**
of a failed or unknown push delivery, including recovery after replacement;
disable hidden adapter send retries. Record sanitized errors/uncertain outcomes
so operations can fix the next independently scheduled send. Never broadcast or
resend on startup recovery. Weather-provider retry rules are unchanged.

D03 starts with **new registrations** through existing APIs. Do not export/import
or reverse-migrate legacy push registrations. This is an approved registration
continuity difference, not permission to alter payload/status/header/auth behavior
or discard weather history. Preserve/restore newly accepted S3 state during
rollback; a route switch alone cannot undo accepted mutations. S18 owns schema,
ordered concurrent state updates and ownership in the single Rust process,
subject to S02 contract proofs and publication/deadline gates.

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

Rejecting a new success on S3 failure is an AK-approved availability/durability tradeoff,
not an already measured legacy behavior. If it changes an active contract, the
family stays on legacy until actual compatibility gates
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

O-1/O-11 amend request-only acquisition to preserve used APIs: hourly capture is
limited to cells requested in the last 8 days plus push-subscribed cells, and
rainfall capture runs every 2 minutes only for cells with demand. There is no
all-grid timer. S14 must define durable demand discovery, expiry, startup
reconstruction and single-host ownership under the same provider budgets and
raw/group publication policy. Later multi-instance capture requires the
coordination gate in section 9. Capture alone cannot fabricate unavailable
history; golden parity and history catch-up still precede dependent cutover.

A **cold cell** has never been requested, resumes after more than 8 days without
demand, or has only partial archived history. Demand-limited capture cannot
recover all older hourly slots from KMA's roughly 23-hour window. Read verified
S3 revisions, legacy-export records and only recovery transformations proven
equivalent to legacy. ASOS may participate only where the existing handler uses
it with proven parity; it is not a substitute for missing grid-hour values. No
invented history or approved missing-history difference is introduced here.

If the response cannot be reconstructed with the same history, status, absent
fields and comparisons as legacy, keep that route behavior on legacy or forward
the request to legacy during coexistence. A family switch must preserve this
cold-cell fallback and its deadline/error contract. After a nominal family
cutover, the unsupported cell behavior still requires legacy. S21 cannot retire
legacy/MongoDB until cold-cell parity is proven for every retained behavior.
If no equivalent acquisition becomes available, retirement remains blocked;
this design does not promise that demand capture alone makes it possible.
Continuing the needed legacy collectors also retains their quota and operating
cost (#2604); S03/S08/S14/S20 must measure and budget that coexistence cost.

Durable acquisition demand records live under `state/demand/grid/` and contain
only KMA grid identity, last-demand time and expiry. Push demand is aggregated
to the same grid identity without copying subscription details. No precise
coordinate, IP address, device/user/subscriber ID, token or per-request log is
stored in these records or added to weather archive identities/metadata. Exact
demand update/reconstruction and capture ownership are S14 acceptance work;
S18 follows the accepted D01–D03 push policy and its route/state verification gates.



| Original item | Amendment / remaining decision |
| --- | --- |
| D2/D7/D8, C6–C8 | S3 serving publication, memory reconstruction; no local store/uploader/synced rows |
| O-1, O-11 | Approved: hourly capture only for cells requested in the last 8 days plus push-subscribed cells; rainfall capture every 2 minutes for cells with demand. S14 specifies demand/expiry/ownership and proves 8-day/20-minute behavior before dependent cutover |
| O-2 | Rust conditional go; P2 executable checkpoint and post-v000903 time-box remain |
| O-3 | D01–D03 recorded: implementer owns state schema/ordering; new registrations only, no legacy registration migration; no automatic failed/unknown push resend; new accepted state remains S3 durable |
| O-4, O-12 | gp3/15-day floor/ENOSPC policy removed; replace with memory admission and S3-failure policy |
| O-5 | Approved: immutable canonical raw gzip; versioned identity catalogs with CAS; no lifecycle deletions now. Packs require measured benefit; S09 assesses version growth/retrieval costs before transitions. No Flexible/Deep Archive on synchronous serving paths |
| O-6 | D04 authorizes useful memory/S3 caches; layout/validity/admission are implementation choices under exact-label and coordinate privacy proof. No precise lookup-history export or indefinite archive |
| O-7 | No blanket removal of health-index/KAQ behavior that current active API fixtures contain |
| O-8 | v000705 town is active; exclude only zero-observed in-scope public APIs; /ww evidence gap remains |
| O-9 | Approved: raw PUT + complete fetch-group catalog publication before new success. S3 outage uses valid complete memory or existing route error/fallback; no undurable new success. Drain assists but is not the durability boundary; no route switch before actual compatibility gates and approval |
| O-10 | Separate server2 key set during coexistence remains |
| O-13 | Store summaries; product exposure remains a separate decision |

The [S01 record](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6009156640)
contains actual AK authority and the O-1…O-13 dispositions. Core acquisition and
storage/publication choices and D01–D04 are resolved. S18 no longer requires the
superseded registration-migration/retry decision; its dependencies, state tests
and durable acceptance still apply. Privacy/label activation, measurements, key
provisioning and cutovers keep their prerequisites. S03 provides only isolated
local infrastructure and a staging plan; it does not provision or deploy.

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

The original design PR verified documentation, diagrams and arithmetic without
runtime/provider/S3 execution. S04 subsequently added the foundation. S03 checks
a local test S3/provider peer and foundation only; no live provider, real AWS,
traffic replay, mobile build or deployment is claimed.


## 12. Infrastructure implementation status

S01 and S04 are complete; [S03 operations](../operations/server2-infrastructure.md)
describe the isolated local test peer and approval-ready infrastructure worksheet.
The peer is a bounded volatile S3 HTTP subset, not real AWS authentication,
durability, performance or production deployment evidence. The release foundation
starts locally and serves health/loopback metrics; it has no weather/provider/S3
runtime routes yet. S02 goldens and S05 raw storage proceed in separate PRs.

Actual account/region/bucket/role/provider-key owners, spending limits, host
provisioning and routing remain separately approved resource actions. Proposed
2-vCPU/4-GiB compute classes are candidates only; S09 chooses a measured target
from musl compatibility, RSS/CPU, cold latency, throughput and quota headroom.
One Spot host and one multithreaded API process are the default; future instances
retain independent caches and require the coordination gate in section 9.
