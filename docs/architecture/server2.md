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

AK selected removal of local SQLite, raw provider storage, Rust (adoption subsequently confirmed by AK),
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

S02 [PR #2713](https://github.com/WizardFactory/TodayWeather/pull/2713) created
`server/test/offline/golden-record.js` solely to execute the pinned legacy parity target.
Its output fixtures and consumer belong under `server2/tests/golden/`. Existing gateway fixtures can be
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

S09's [named host-read amendment](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6054300695)
admits four exact literal source/operation/path pairs in
`server2/tools/benchmark/aws.rs`: `Path::new` for `/opt/server2-s09` and
`/opt/server2-s09/run`, and `read_to_string` for `/proc/self/status` and
`/proc/self/stat`. These support private-manifest ownership checks and process
metrics. They do not exempt a file or widen the literal checker to accept compiler
includes, encoded paths, writes or other literal host paths. The
[dynamic-I/O clarification](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6055549129)
separately declares the private manifest read, exclusive `worker.claim` write,
frozen source/lock and current-executable hash reads, and caller-owned config and
report/state I/O. These benchmark provenance and evidence operations require manual
containment/ownership review; computed and aliased paths are outside the static
checker's complete coverage. They do not permit legacy serving-data access.
The one-use recovery additionally reads the caller-owned original configuration and
explicit recovery authority, and writes an exclusive predecessor snapshot, recovery
claim and attempt-specific watchdog receipts beside the original private state.
These are declared controller evidence operations, not new literal-path exemptions.
Later whole-tree audits retain the four validated literal roles without a new waiver.

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

S19 ([#2704](https://github.com/WizardFactory/TodayWeather/issues/2704)) provides
the local tooling that these gates consume, one family module at a time; the
gateway/geocode family is first. `server2/deploy/smoke.sh` runs the actual release
binary against recorded providers, a frozen legacy origin and the local S3 peer. It
asserts aggregate gateway/geocoder counters on the loopback metrics listener.
Offline paired replay classifies every difference as declared or unexplained
and records revision, workload and cold/warm percentiles. The rollback rehearsal
switches `/weather` and `/geocode` together while checking the cache and deadline
contracts. These are local fixture results, not seven-day shadow, production
latency or quota evidence. Live shadow configuration and traffic mirroring
need separate operational authority. S10b
([#2730](https://github.com/WizardFactory/TodayWeather/issues/2730)) closed gap
S19-GAP-1, where the 9-second foundation connection lifetime closed the socket before
the gateway's 9-second deadline `501` was written. With the gateway enabled, the
connection lifetime defaults to 12 seconds, and a lifetime of 9 seconds or less fails
startup. The rehearsal expects the legacy `501` under that default. See the
[smoke/shadow guide](../operations/server2-smoke-shadow.md).

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

### S07 resolver implementation contract

After S06 merge [PR #2719](https://github.com/WizardFactory/TodayWeather/pull/2719),
[S07 #2692](https://github.com/WizardFactory/TodayWeather/issues/2692) implements
the internal resolver and bounded volatile cache; no public route is migrated.
Its [request sequence](diagrams/server2-resolver.html) and
[editable source](diagrams/server2-resolver.sequence.json) describe the internal implementation; they do not establish deployed route
behavior or measured AWS latency. The [operations manual](../operations/server2-resolver.md)
describes finite scopes, cache accounting and the local release example.

Typed request keys retain every output-affecting field. Cache values share byte
leases whose charge survives eviction until the last pinned value is dropped.
Raw and parsed retention is optional; response admission can reclaim their mapped
entries across tiers. Parsed inputs used by assembly move into bounded operation-owned
buffers, so optional cache pressure cannot strand otherwise valid responses.
External response pins retain their charge; genuine retained-byte exhaustion still
fails closed. Network, CPU, queued work and retained results have separate bounded
admission; cache weights alone do not claim a process RSS limit. No lock remains
held across I/O or CPU awaits. Exact record/parser identities and monotonic TTLs
govern reuse.

An unchanged dependency refresh reuses the same immutable response payload and
byte lease; only its next refresh time is rearmed under the retention gate.
It never extends the original creation time or expiry. Reusing that payload
does not create a second charge, while external pins on displaced or distinct
payloads remain charged. After dependency I/O, refresh rechecks expiry and epoch
under the brief gate. If the response expired, it drops the internal old pin and
re-enters checked cold resolution within the original deadline, or returns a
typed timeout; it cannot return the expired response as success.

Owned single-flight jobs survive cancellation of one HTTP waiter, share their
original bounded deadline and drain policy, and never extend a later waiter's
HTTP deadline. Resolver reads retain S06 coverage: a page or targeted acquisition
is not full history. Only a complete finite caller-owned repair scope can prove
a provider miss; Incomplete, Capacity and Timeout cannot authorize acquisition.

An acquisition callback must obtain S08 funding before provider HTTP and return
ordered raw pages plus their declaration. New response assembly follows S06
complete-group publication. Undurable new data cannot enter a successful result
cache. Excluded groups prevent response-cache admission, including descriptor
absence that could change without a target catalog ETag. Published local revisions
invalidate known dependencies; external changes use bounded revalidation.
Conservative global invalidation affects cache reuse, not the validity of an
already checked request snapshot. Epoch drift returns that result uncached.
A brief retention gate coordinates epoch checks with response admission, without
holding a lock across asynchronous work. Concurrent durable publications on
unrelated keys remain successful.

Current defaults account for 128 MiB retained cache and four owners reserving
64 MiB each, separately from 128 waiter admission. Concrete insertions charge
keys, envelopes, dependency metadata and payload; generic cache callers must
supply truthful total weights. These are logical leases, not hard RSS limits.
The two-permit pool covers view builders; dependency parsing and S05/S06 codecs
have separate bounded pools. Started view and dependency jobs retain operation
leases after owner timeout. Drain reports unfinished owners and view jobs,
not every storage codec worker.

Cold reads first select whole complete acquisitions from pinned published
catalogs, preserving ordered pages and the caller's period scope. An absent,
incomplete or corrupt read requires finite-scope recovery before any provider
miss can be proved. Foreground recovery marks a possible mutation before each
catalog write; dirty cancellation or uncertain completion invalidates response
reuse, and an owner timeout after a possible send is Ambiguous. Existing typed
integrity and definitive rejection errors remain fail closed. A read-only failure
does not invalidate reuse. Capacity and Timeout are not absence. FullHistory must finish
the private cursor; targeted reads cannot authorize absent-field history folds.

A positive cold read can schedule one bounded owned repair for its scope, with at
most one repair active overall. This
maintenance shares operation/temporary admission, the three-second bound and
drain accounting; it never calls a provider. Admission denial increments a skip counter and retries only on a later positive
cold-read opportunity, without creating an unbounded queue. The index-only repair entrypoint
omits a redundant full-history fold only after all owned-scope discovery, group
verification and identity indexing complete. Incomplete, Timeout or ambiguous
maintenance never proves prefix synchronization or empty data. Any attempted
foreground or background catalog write invalidates response reuse, including ambiguous or cancelled work;
a read-only maintenance failure does not invalidate a healthy result.

The raw cache does not bypass S06 raw GETs. Parsed views reuse immutable
acquisitions; a warm foreground response starts no S3 or provider work. Background
maintenance may still be active, so zero-I/O checks explicitly wait for its idle
milestone and report its counters separately. Page-size-one full-history traversal
still repeats descriptor normalization; large scopes remain bounded rather than
guaranteed to finish. S09/O01 must measure remaining cold and recovery costs.

S07 meets the geocode portion of AC1 only for volatile key identities and
archive rejection. Geocode value caching and exact-label/boundary parity remain
S10 work; they are not delivered by this resolver. A funded-acquirer callback and bounded view builder are trusted
integration seams; S08 wiring, concrete provider schemas and public API assembly
remain later tasks.

The geocode cache remains within section 6 privacy and exact-label constraints.
A coarsened key alone does not prove label equivalence or provider-free precise
reverse-geocode restoration. Cold/warm fixtures and owned-task failure scenarios
are internal checks; used-API parity and activation remain later route gates.

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
Every discovered raw envelope must match its descriptor's exact member, owning
partition and full immutable group reference, including later envelopes for an
already seen group. Only verified whole-group reload and catalog publication may
be deduplicated. A mismatched envelope keeps repair incomplete; it cannot be
ignored to produce a complete scan. Invalid discoveries do not block indexing
independently verified complete orphan groups in the same scope. Such indexing
does not prove complete scope coverage: the mixed scope remains `Incomplete`.
A group with only invalid claims is not eligible for publication. Keep every
eligible revision in deterministic order; field merges and list replacement
remain in-memory operations, not persisted catalog payloads.

A bounded page contains checked complete acquisitions and an explicit continuation;
it never masquerades as a full-history set. Before choosing a page, resolve unique
groups through verified identity-only descriptors and validate all target-catalog
member references. Order acquisitions by the descriptor's first ordered member
using the same fetch-time/full-hash key as full-history lookup, then apply read
direction and the private group-offset cursor. Reversing raw members before
deduplicating groups is not an equivalent latest-acquisition order. Ordered pages
remain together even when their fetch times differ or full hashes break a tie.
The private cursor also binds the normalized acquisition cohort. Rebuild and
compare that cohort before continuing: a formerly missing immutable descriptor
can appear without changing the target catalog ETag, so target tokens alone
cannot prove a stable group offset. A changed cohort requires restart.
This normalization reads unrelated group descriptors but does not materialize
unselected raw bodies. Its upfront control reads count toward the existing byte
and whole-operation deadline limits; a small output page need not be a cheap
S3 read. Targeted exact-member lookup avoids this whole-catalog normalization. Exhausting a healthy read budget is
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

The initial S06 lookup/repair utility reads ordering descriptors and selected raw
members sequentially within one operation. Its `io=16` admission bound permits concurrent
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

S12 ([#2697](https://github.com/WizardFactory/TodayWeather/issues/2697),
[spec](../../specs/issue-2697.md)) implements this in `server2/src/warnings/`, not yet
wired into the server2 process or any route switch. Source `kma-warning` uses kinds
`bulletin-1`…`bulletin-4` (getPwnStatus plus getWthrWrnMsg pages for type 1;
getWthrPwn, getWthrInfo and getWthrBrkNews for types 2–4), `pwn-cd` and `zone-seed`.
Each provider acquisition or exported legacy document is one single-owner fetch group in
the partition of its announcement KST date (`pwn-cd`: requested day). The latest bulletin is
derived in memory by walking day partitions newest first: types 1–3 have no age
expiry (recent days probed, older days discovered from complete per-year raw LISTs);
type 4 reads only partitions on or after the KST date of now − 19 h and is omitted when
stored KST time + 10 h < now. Days larger than one read are paged by whole acquisition. Equal announcements keep
the earliest fetch. A missing day catalog is repaired from that exact period's raw
prefix; an incomplete or failed repair skips the day because an acknowledged group
always has its catalog and catalogs are never deleted. Catalog read errors fail with
the legacy 501. Zone state for `specialInfo` is the newest zone seed plus every
`pwn-cd` revision published since the seed's legacy sync point (every published day
without one), replayed in memory by an owned refresh task; cold replay cost grows with
time since the seed. Discovery scans back to 1970, so no stored bulletin ages out. Seeds come from the
offline `server2/tools/migration/` converter and an importer that uses the shared
`SERVER2_S3_*` settings (S10c). Newly
collected documents use the S02 seed key order, which S19 shadow comparison must
confirm against production bytes; the Express session cookie and the shared S08
classification of status-200 JSON gateway envelopes are recorded differences.

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

### S08 provider admission implementation contract

Following S06 merge, [S08 #2693](https://github.com/WizardFactory/TodayWeather/issues/2693)
implements internal quota admission and rejection primitives. Its
[sequence](diagrams/server2-provider-admission.html) and
[editable source](diagrams/server2-provider-admission.sequence.json) show the
committed internal execution; no provider route, live quota or production policy is activated.

Each trusted provider/quota-owner/window has a separate versioned
`budgets/v2/{provider}/{opaque_quota_key_id}/{window_id}/authority.json`.
Its immutable policy contains the provider-local window, limit and block size.
A conditional creation or opaque-ETag CAS advances the checked high-water by
`min(block_units, limit-used)` without exceeding the ceiling. Only an acknowledged
200 grants the writer that unique range. The writer then creates a write-once
`blocks/{start}-{end}.json` witness before privately issuing request units.
Neither weather catalogs nor client-supplied IDs control quota arithmetic.

Each funded executor admits at most four concurrent executions and two JSON
validation jobs. An admitted execution retains its guard while funding,
downloading and validating; a started blocking validator retains it after caller
cancellation until completion. HTTP bodies are capped at 8 MiB. These are
per-executor bounds, not a process RSS measurement or a global worker limit.
The budget wire adapter fully consumes a bounded 200 acknowledgment before
granting either authority or witness success. Clock observation and its local
backwards-time fence are serialized; replacement still requires trusted clocks.

The high-water and witness are two separate writes, not an S3 transaction.
Unknown authority outcomes grant no provider permission; a committed floor is
never refunded or reused. Failed witness publication and abandoned issued units
remain spent. Replacement reads the authority but never recovers leftover blocks.
A write that never committed and left no durable record cannot be discovered
after replacement; the guarantee is no HTTP without confirmed durable funding.
Policy mismatch, overflow, observed floor decrease and invalid/backwards time
fail closed. Stable window/owner configuration, trusted clocks and no external
delete/reset/version rollback remain deployment prerequisites.

The funded executor sends at most two actual provider HTTP attempts. VC reserves
98/50/2 records for two attempts of the 49/25/1-record modes. data.go.kr reserves
two units on the initial candidate and, if configured, one on the next key before
any HTTP. Three conservative reserved units never mean three actual attempts.
A trusted injected validator checks JSON in this primitive; concrete provider
schemas, pagination/group composition and the S07 funding adapter are later
ports. Credential-to-quota-owner, window and endpoint mappings are operator
configuration. The library does not infer their correctness from a key hash.

Any candidate funding denial stops the chain; quota/auth responses stop retries
on that key, while only the permitted funded retry or key rotation can consume
the remaining attempt within the original deadline. Exhausting the bounded CAS
conflict attempts is contention, distinct from exhausted quota. Duplicate rotation
keys or quota-owner identities are rejected before funding or provider HTTP.

If response headers have arrived but encoding, header/body size or download
validation fails, a typed body failure preserves the received HTTP status.
HTTP 429 and 401/403 still stop that key and allow only a distinct pre-funded
rotation; other 4xx terminate without retry. An incomplete body is never Data
or NoData. Status-less transport failures and incomplete transient responses
retain the original bounded retry and absolute deadline.

A successful data.go.kr response with result code 03 returns a distinct terminal
no-data outcome and its original body without a second provider call. Deterministic
request/service codes 10 and 12 are rejected without retry. HTTP quota/auth,
other 4xx and transient status precedence remains intact. No-data bytes are held
in memory; they are not weather records or permission to publish an error envelope
as data. The later provider port owns the compatible empty/no-data response and
any allowed persistence. Only the data outcome remains subject to complete S06
raw/group publication before a new data response. Error bodies are not data.

Obtaining a new block requires authority GET, CAS PUT and witness PUT: three
dependent S3 waves before HTTP, with bounded conflict work added when needed.
Two cold data.go.kr candidates are funded sequentially, so they add six
dependent funding waves. Funding from an already acknowledged live memory
block adds no S3 request.
The reservation timings in section 7 remain illustration assumptions, not a
measurement of this new-block path. S09 measures block waste, cold latency and
quota headroom before provisioning or route activation. No lifecycle deletion
is introduced. [AWS conditional-write semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
support the individual object preconditions; the high-water/witness protocol is
our design and requires its own crash, cancellation and concurrency proof.

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

### S09 measurement scope and decision gate

#### Current contract (2026-10-11)

AK fixed Rust adoption and requested maximum local verification with minimal EC2
work; [issue #2694](https://github.com/WizardFactory/TodayWeather/issues/2694)
is the governing scope. Rust go/fallback/time-box reconsideration is removed.
S09 completes on the scoped local/Linux-CI checks and resolution of Required PR
findings. S09 live measurements no longer block S10/S13 implementation. Other
S01 decisions, S02 route goldens, placement, API parity and cutover gates remain.

Build the intended Linux x86_64 musl release artifact in isolated Linux CI and
run its startup smoke and synthetic loopback matrix there. The portable local
runner also works with a native release artifact. Cover cold, warm and simulated
provider Data/NoData/denied/error outcomes at 8/16/32/64 offered clients without
raising the existing owner/I/O/CPU or fixture limits. Retain overload and timeout
outcomes, sample limitations, whole-process RSS/CPU, foreground throughput and
operation/version-byte cost inputs. Local timings and byte counts do not establish
AWS latency, physical S3 storage or invoiced cost. Unit prices remain explicitly
unset until a dated price assumption is supplied; no dollar estimate is inferred.

Before production, use a separately authorized minimal EC2 smoke: transfer the
prebuilt artifact, verify startup/health/runtime resources/TLS/credentials, then
a tiny isolated same-region S3 GET/HEAD/PUT/LIST and exact readback. No on-host
build, full concurrency sweep or provider traffic is required by S09. Actual API
performance/cost acceptance belongs to pre-cutover work. Raw packs remain disabled
until actual route measurements demonstrate a need against an agreed target.
Existing AWS campaign tools/grants and their failure/cleanup records are retained
as historical evidence. They are not the minimal smoke procedure or renewed
execution authority. No AWS execution, retry, budget renewal, merge or deployment
is authorized by this amendment.

#### Historical benchmark campaign and evidence

The prior campaign requirements and decisions below are historical. The current
contract above controls S09 completion and downstream implementation; resource
authority and historical outcomes are not renewed or rewritten.


[S09 #2694](https://github.com/WizardFactory/TodayWeather/issues/2694) prepares a
release benchmark under `server2/`, as declared before edits in its
[path contract](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6052017682).
The [measurement workflow](diagrams/server2-feasibility.html) separates isolated
protocol evidence from a separately approved intended-host/same-region run.

Measure cold requests with a new resolver for each trial; warm requests begin
with a verified assembled response. A benchmark-only miss adapter exercises local
S08 funding/execution and complete S06 publication. NoData remains RAM-only and
cannot count as an archived weather success. Synthetic assembly is not a legacy
weather response or geocoder measurement. An eight-day hourly workload must use
actual synthetic day/slot identities and valid group/catalog ownership; retained
revisions of one slot are a different stress case.

Offered clients at 8/16/32/64 are distinct from admitted owners, actual I/O and CPU
limits. Existing runtime bounds and deadlines stay in force. Report every outcome,
including Capacity, Timeout and rejected work, in request counts and elapsed-time
quantiles; success-only quantiles are labeled separately. Targeted, Latest and
FullHistory measurements must expose sequential descriptor/page costs rather than
claim the parallel-wave model is implemented. Record foreground and background
work, body/group/catalog counts and bytes, assembly elapsed time, whole-process CPU/RSS and catalog
rewrite bytes; logical cache charges are not RSS. Local rewrite-byte totals are
cost inputs, not observed versioned S3 storage. Local provider-data verification
requires exact durable bytes for successful clients and separately records finite-scope
storage observations for every failed or rejected client. A Capacity outcome alone
does not prove that no durable write occurred. Warm waves through one retained
resolver are not independent empty-memory trials and are counted separately.

Actual Linux release/musl execution, same-region GET/PUT/LIST tails and throughput,
real authentication/conditional-write behavior and version-storage/cost inputs
remain required evidence. AK [approved the bounded measurement scope](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6052596161)
on 2026-10-08, valid until 2026-10-10T04:49:59Z. The [31-path amendment](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6053018487)
and [33-path host-read amendment](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6054300695)
keep the worker, operator, configuration, tests and placement checks under `server2/`.
The first approved execution created the task's bucket, IAM role/profile and
security group, but produced no worker measurement. QA4 identified unsupported
EC2 CLI options (`--min-count`/`--max-count`); the corrected invocation uses
`--count 1`. Current offline rejection does not reconstruct discarded stderr
from the original attempt. A metered 2026-10-08T12:40:57Z inventory found no
instance for either the original client token or run tag, no tagged root volume,
and no S3 versions. The task-owned IAM and security-group resources remained.
This is a timestamped current-state observation, not proof that an earlier AWS
request was never sent.

AK subsequently authorized code correction, result reconciliation, one recovery
execution if needed, and owned cleanup. The [recovery amendment](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6060200508)
keeps this exception within the original task and aggregate limits. Before any
recovery launch, verify the frozen source/configuration with independent QA and
validate the complete launch argument list through the installed CLI's offline
output-skeleton path. A fake CLI that accepts arbitrary flags is insufficient.

The [one authorized recovery](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6061547104)
launched an EC2 host at 2026-10-08T13:48:27Z using reviewed revision `87148f36`,
but stopped before guard proof or worker admission with `console encoding`.
AWS CLI already decodes `get-console-output.Output`; treating that text as
Base64 again was an operator defect. The CLI boundary must accept only bounded
UTF-8 text, without guessing an alternate encoding, and preserve the existing
guard identity and readiness checks. Native CLI response transformation needs
a separate regression check; an output-skeleton input check cannot prove it.
Automatic cleanup completed at 13:54:50Z. A metered readback beginning 13:56:40Z
confirmed the instance terminated, its root volume and IAM/profile/security-group
resources absent, and the retained S3 bucket empty. No measurement ran. The
recovery allowance is consumed; further launch or measurement requires a new
explicit execution decision. The workflow's pinned source checkpoint describes
the reviewed tooling lifecycle, not successful AWS measurement. The external watchdog
charges every call before dispatch and retries call failures within its existing
50-call reservation. Each termination attempt requires a fresh ownership read;
exhausted or unverifiable work leaves an unresolved diagnostic, never proof of absence.

The proposed run uses one dedicated nonproduction Seoul `c6i.large` for at most
two hours and at most 60 minutes of synthetic load. Worker and controller share
one aggregate limit: 400,000 GET/HEAD attempts, 20,000 PUT/LIST attempts,
30 GiB download and 64 MiB all-version stored charge. Worker allocation is
390,000/18,000/26 GiB/63 MiB; controller allocation is 10,000/2,000,
3 GiB bootstrap plus 1 GiB administration/SSM/IMDS/log traffic, and 1 MiB storage.
Each potential PUT permanently charges body length plus 16 KiB conservative
metadata/system/bookkeeping allowance, including retries, denied and uncertain
writes. This is a safety margin, not measured physical storage or an invoice.
Requests, bytes and stored versions require end-of-run reconciliation; partial
or uncertain evidence cannot be labeled compliant.

After the worker claims its allocation, a failed or uncertain run must still emit a
bounded report containing completed cases, partial-case observations, consumed and
reserved counters, a sanitized abort reason and explicit non-compliance. The
operator preserves the worker report and bounded error diagnostics before rejecting
the result and cleaning up the owned resources. A missing report is recorded as
missing evidence, never as an empty successful run. Preservation does not permit
further measurement, a second host or reuse of the allocation.
Before entering a new case, uncertainty must be checked before estimates,
fixture seeding or resolver creation. Existing bounded reconciliation within the
owned operation may finish; an uncertain preceding case cannot admit the next one.

Actual execution follows independent review of the frozen tooling/configuration,
a private one-use manifest, a separate watchdog, an absolute host expiry and
pre-bootstrap network metering. The worker deadline must leave 15 minutes before
the earlier host or approval expiry for bounded export and cleanup. It is the
minimum of that fence and 59 minutes 30 seconds from the worker start; a remaining
worker window below five minutes is refused. Recheck the window before dispatch.
Command timeouts include at most 30 seconds for report completion within the
reserved tail, leaving at least 14 minutes 30 seconds for export and cleanup;
the SSM command cap remains 60 minutes. This reserve provides finite headroom,
not a guarantee that every SSM export or cleanup will finish.
Missing guards, ownership uncertainty or budget
exhaustion stop work. An ordinary restart permits cleanup only and never refreshes
a grant. The explicitly approved pre-worker recovery is a narrow exception:
retain the original state, client token, nonce, resource ownership, counters and
approval expiry; preserve the predecessor snapshot and deadline before activating
one recorded recovery attempt. No previously issued worker allocation can be
reused or replaced. The recovery host deadline is at most two hours from recovery
and never later than the original approval expiry. Reserve its watchdog from the
remaining aggregate controller allowance.

Recovery reconciles current instances by both token and run tag before dispatch.
A unique existing owned instance suppresses creation; unresolved or multiple
matches stop execution. If both inventories prove current absence, at most one
corrected launch may reuse the original token, subnet and region. An idempotency
parameter mismatch must not trigger a new token or another launch. Recheck actual
ownership and dependent resources before cleanup. Keep historical uncertainty
separate from a newly observed local CLI rejection or current absence; neither
rewrites the original record. Explicit recovery authority may also permit cleanup
of the acknowledged IAM/profile/security-group resources after fresh token, run-tag
and volume inventories all prove current absence. This branch is unavailable after
a newly uncertain dispatched recovery; it does not settle historical uncertainty.

Kernel delivery quotas and application reservations do not mathematically cap
physical NIC arrivals or retransmissions. Use stricter thresholds, measured
headroom and a USD 5 operator stop; no absolute billing guarantee is claimed.
The kernel's 2 GiB bootstrap and 24 GiB measurement receive quotas intentionally
stop below the 3 GiB bootstrap and 26 GiB worker reservation grants. The different
accounting layers cannot be equated; hitting a kernel backstop can interrupt a
request and leaves uncertain counters and a failed report for review. Outbound
security-group access is TCP/443 to `0.0.0.0/0` after guard verification, not an HTTPS
destination allowlist. Reviewed worker/bootstrap inputs and IAM restrictions carry
the endpoint scope. The live gate requires stock SSM Agent version `3.3.40.0` or later
before the first Run Command under the `ssmmessages`-only policy. Missing, older or
malformed version metadata stops work without installing an agent or widening IAM.
At the checked Seoul prices, the fixed compute, IPv4, root, request and 48-hour
storage caps total about USD 0.436101 before taxes and unknown bootstrap/log-transfer
charges. This static operator admission estimate is not a live billing monitor;
permanent retained storage continues after the run. Price provenance and the
component arithmetic belong in the operations record.
Only the newly owned host/root volume, IAM and necessary network artifacts are
cleaned up; synthetic S3 objects and versions are retained without deletes or
lifecycle. Existing production hosts and real weather/geocoding providers are
excluded.

Reusable fixtures distinguish Targeted/Latest/FullHistory and hot versus distinct
response keys over explicitly counted physical data. The local synthetic eight-day,
16-scope sequential batch took 14.054289 s; it is a preserved feasibility risk,
not a CloudFront/API result or an AWS percentile. Warm trials require a verified
successful cold result and idle maintenance; insufficient capacity/sample counts
stay visible rather than implying successful feasibility. Warm observation waves
reuse one case-owned resolver after prewarming. Offered client observations are
reported separately from independent RAM-empty trials. Shared HTTP/TLS pools
remain warm after protocol and seeding; these trials do not measure the entire
fresh-Spot network path. The bounded template does not establish 300 independent
cold trials per offered level.
O-2 conditional Rust feasibility and O-5/optional-pack disposition are made from
those results. Until the required evidence and decisions exist, S09 stays open
and S10/S13 remain blocked. No benchmark alone grants route cutover or retirement.

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
| O-2 | Rust adoption settled by AK; S09 validates locally/Linux CI. No Rust go/fallback/time-box reconsideration; runtime correctness and pre-cutover performance checks remain |
| O-3 | D01–D03 recorded: implementer owns state schema/ordering; new registrations only, no legacy registration migration; no automatic failed/unknown push resend; new accepted state remains S3 durable |
| O-4, O-12 | gp3/15-day floor/ENOSPC policy removed; replace with memory admission and S3-failure policy |
| O-5 | Approved: immutable canonical raw gzip; versioned identity catalogs with CAS; no lifecycle deletions now. Packs require measured route benefit; S09 records local operation/version-byte inputs, with actual API serving/lifecycle cost validation before cutover. No Flexible/Deep Archive on synchronous serving paths |
| O-6 | D04 authorizes useful memory/S3 caches; layout/validity/admission are implementation choices under exact-label and coordinate privacy proof. No precise lookup-history export or indefinite archive |
| O-7 | No blanket removal of health-index/KAQ behavior that current active API fixtures contain |
| O-8 | v000705 town is active; exclude only zero-observed in-scope public APIs; /ww evidence gap remains |
| O-9 | Approved: raw PUT + complete fetch-group catalog publication before new success. S3 outage uses valid complete memory or existing route error/fallback; no undurable new success. Drain assists but is not the durability boundary; no route switch before actual compatibility gates and approval |
| O-10 | AK clarified 2026-10-13: reuse the existing injected Kakao/Google `.env` keys for S10; actual geocoder quotas and activation evidence remain required. The separate data.go.kr coexistence-key policy is unchanged |
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
runtime routes yet. S02 goldens, S05 raw storage, S06 catalogs, S07 memory resolution and S08 budget
reservation are merged. Their isolated verification and independent reviews do not
establish live AWS conformance, used-route parity or the S09 feasibility gate.

Actual account/region/bucket/role/provider-key owners, spending limits, host
provisioning and routing remain separately approved resource actions. Proposed
2-vCPU/4-GiB compute classes remain candidates. Local/Linux CI verifies musl
compatibility and bounded resources; actual route performance and quota headroom
are assessed before cutover without reopening Rust adoption.
One Spot host and one multithreaded API process are the default; future instances
retain independent caches and require the coordination gate in section 9.

## 2026-10-09 focused PR correction after actual AWS execution

One separately authorized host attempt failed before guard readiness and measurement. At 13:06:08Z, AWS readback confirmed host termination, owned root/SG/IAM/profile removal and zero retained S3 versions. Egress stayed closed; no SSM/bootstrap/worker/provider work ran. The live console exposed both a multibyte console bound mismatch and a bootcmd timer/sysinit ordering cycle inferred from logs plus upstream unit definitions.

The focused correction moves all stock guard setup to final-stage runcmd, retains closed egress/watchdog/expiry, accepts complete CLI text within 65,536 characters and 131,072 UTF-8 bytes, and removes the host workspace test invocation per AK. The [operations manual](../operations/server2-feasibility.md#2026-10-09-actual-execution-and-focused-correction) records direct evidence, cleanup and limitations. The eight unfinished preparation15 files are preserved separately, not shipped. No further AWS launch, merge or budget reset is part of this correction. QA6 remains historical; new live readiness and independent review are not claimed. Tests are not added or run under AK's instruction. S09/O-2/O-5 and downstream S10/S13 remain pending.

### S10 local-first gateway implementation (2026-10-13)

[S10](../../plans/issue-2695.md) adds an opt-in public gateway with default
legacy geocoder/weather HTTP adapters. No production route is switched by
startup defaults. Explicit library registration permits a native weather handler
for one family/version and preserves legacy rollback. The
[request sequence](diagrams/server2-gateway.html) and
[operations guide](../operations/server2-gateway.md) describe this staged path.

S10 restricted native geocoder acquisition to a loopback `mock` mode; S10c
([below](#s10c-real-runtime-configuration-2026-10-13)) replaced it with the real
configuration. Existing injected `GEOCODER_KAKAO_KEYS`
and `GEOCODER_GOOGLE_KEY` names and the Google fingerprint restriction are
preserved. Present Kakao key lists must be JSON arrays of nonempty strings;
malformed entries reject the configuration. S08 adds Kakao/Google budget identities; the geocoder funding bridge
reserves/consumes every possible key attempt before owned work, while the
weather-only executor rejects those identities. Configured limits are not measured quotas (#2724).

Exact coordinate/locale single-flight and results remain bounded volatile RAM.
The optional address-only S3 adapter stores a bounded 16-KiB projection with
30-day freshness, verifies complete PUT acknowledgment and exact readback, and
never exposes a reverse-geocode persistence method. It is a permitted derived
address-cache exception, not a weather raw/catalog publication shortcut. It is
not automatically wired to runtime credentials. Coarse coordinate serving,
live native providers, seven-day shadow, measured real quotas and cutover remain
gated. Local fixture timings do not satisfy production latency or quota gates.

### S13 domestic provider acquisition (2026-10-13)

[S13](../../plans/issue-2698.md) ([spec](../../specs/issue-2698.md)) adds the internal
`server2::domestic` acquisition library. It returns checked `resolver::Acquisition` groups
for S06 publication (O-9); it wires no route, scheduler or response assembly, and it never
stores normalized weather values. S14 owns capture timing and S15 owns assembly.

| Source / kinds | Request contract | Raw format |
| --- | --- | --- |
| `data-go-kr`: `ultra-srt-ncst`, `ultra-srt-fcst`, `vilage-fcst` | VilageFcstInfoService_2.0, `base_date/base_time/nx/ny`, 999 rows, ≤5 pages | JSON (`dataType=JSON`) pages |
| `data-go-kr`: `mid-fcst`, `mid-land-fcst`, `mid-ta`, `mid-sea-fcst` | MidFcstInfoService, `stnId`/`regId`, `tmFc` 0600/1800 | JSON |
| `data-go-kr`: `uv-idx-v5`, `{oak,pine,weeds}-pollen-v3` | `areaNo=` (all), `time=YYYYMMDDHH`, 1000 rows, ≤8 pages | JSON pages |
| `kma-web`: `town-rss` | `wid/queryDFS.jsp?gridx&gridy` | XML bytes (root `wid`) |
| `kma-web`: `aws-minute`, `aws-hourly`, `city-obs` | `nph-aws_txt_min[?YYYYMMDDHH00&0&MINDB_60M&0&m]`, `currentweather.jsp?tm=` | EUC-KR or declared UTF-8 HTML bytes |

Publication helpers port the legacy KST query-time rules (short HH10, ultra-short HH45,
current HH40, mid 08/20, 23 past-current slots, UV three-hour slots, RSS latest). A
multi-page result becomes records only after every page repeats `totalCount`, echoes
`pageNo`/`numOfRows` (mandatory for multi-page sets and the life index), has the expected row
count and no duplicate row, and all pages share one publication. Records then carry
`Pagination{complete: true}` in one owning partition (publication `YYYYMMDD-HHMM`; AWS/city by
KST day). Forecast rows must echo the requested grid, carry their slot fields and one accepted
publication; ultra-short HH30 requests answered as HH00 or HH30 of that hour are stored under
the canonical HH00 period (#2676). UV and pollen rows must carry their own scalar index
fields with at least one numeric value. RSS rows need every field the legacy parser reads.
HTML pages must be complete (`</html>`) with a closed observation table holding data rows;
the EUC-KR city label does not hide its timestamp. Callers may pass a minimum publication for
RSS and the AWS minute page (`WebRequest::not_before`) so an older page is `Stale`.

Rejections never become records. S08 `classify` now also reads the JSON-form gateway
envelope `OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode`, so JSON quota/auth answers
rotate or stop like the XML form (#2604). A per-call validator turns `03`, an empty `00`,
life-index `99` and a page whose rows all echo another publication into terminal NoData after
one funded attempt (legacy notPublished/previousPublication), reported as `NotPublished`,
`NoData` or `Stale`. Any later-page failure discards the whole set. A per-service key ring
keeps the #2604 sticky position: each call offers the current key plus the next distinct
quota owner; the ring moves to the key that answered or past every rejected key. Keys follow
`dataGoKrKeys.parse` and are percent-decoded once; the transport encodes once.

KMA web pages use a keyless transport with the S08 body/header bounds, HTTPS or literal
loopback, same-host redirects only, and at most two attempts (transport failure, incomplete
body or 5xx) inside the caller deadline. Legacy unbounded RSS retries and 10×1 s scrape loops
are capture scheduling for S14, not acquisition. Aggregate `server2_domestic_*` counters cover
funded calls, acknowledged reserved and consumed units, per-outcome attempts, funding denials,
public attempts and complete/incomplete groups; they are not yet exposed on `/internal/metrics`.
Each consumed unit is recorded before HTTP, so a caller cancelled after funding or sending is
still counted (`attempts_unsettled`); concurrent calls cannot move the key ring back onto a key
another call saw rejected.

Recorded differences: HTTPS instead of HTTP for apis.data.go.kr and KMA web hosts (live KMA
web HTTPS reachability is unverified), JSON instead of XML, at most one funded retry per page
instead of later whole-pass retries, and codes 10/12 terminal. AirKorea/KECO, KASI rise/set and
forecast-zone requests (`returnType`, `_type`, `type=json`) were not ported by S13; S13a adds
them ([below](#s13a-provider-formats-and-live-world-air-2026-10-13)); warnings remain S12. Verification uses recorded and synthetic fixtures with loopback provider and S3
peers only; no live provider, quota or AWS behavior is claimed.

### S11 native world weather and air (2026-10-13)

[S11](../../plans/issue-2696.md) adds `server2::world`, a native `Family::Dsf`
handler for the S10 dispatcher. Registration keeps legacy HTTP selected; only
an explicit `set_backend` (or `dsf` in the `SERVER2_NATIVE_FAMILIES` routing list since
S10c) switches a version, and switching back is the rollback.

Visual Crossing Timeline bodies are the only persisted world weather input:
source `vc`, kind `timeline`, `ProviderKey::WorldCell` of the legacy cell centre,
period `{first local date of days[], range}`, `fetched_at_ms` equal to the request
instant used for conversion, and one single-member fetch group per acquisition in
partition `{first date}-{range}`. A new success requires complete S06 publication
(O-9). Reads cover every range for first dates D-5..D+1, which contains every fetch
that can affect the legacy 48-hour decision window; an absent catalog needs a
complete one-period repair before a provider miss is accepted. DsfForecast records,
the twoDaysAgo/yesterday/today/current/stale classification, the no-yesterday
marker and the response are derived in memory and never persisted. Per-cell memory
keeps only records that can still affect a later request.

The legacy chain is preserved: combined/recent/forecast selection, the no-yesterday
marker, 10-minute provider-down after a VC 401/403 or a daily/usage-limit 429, one
retry after 300 ms of a concurrency 429 or a reset socket (`ECONNRESET`/`EPIPE`, including
a connection closed before the response), the 8-second VC call budget with a 4 MiB raw
(16 MiB decoded) gzip-capable body, 2-second failure backoff and a 15-minute backoff after a
billed 200 body that is unusable (both measured from failure handling), waiters behind
an active fetch that use stored current/today or fall back, stale serving up to 6
hours and 503 `EWEATHERUNAVAILABLE` retry times. VC HTTP is funded through S08 before
sending (98/50/2 units reserved for two attempts of a 49/25/1-unit range) in one S08
window per UTC day, the legacy usage day; a range that cannot be funded follows the
legacy daily-budget path (forecast-only, then stale or 503 with the window end).
Funding steps of a window are serialized: unconsumed units of a reservation return to
the window's pool and fund later fetches of any range before a new S08 reservation,
and a denied amount marks larger needs exhausted for that window. As legacy
`_selectRange` checks the budget before the lock, a request that would fail behind a
busy or backed-off cell first establishes funding eligibility without HTTP: pooled
funds or a new pooled reservation prove eligibility, a denial answers 503 with the
window end, and concurrent checks share that outcome. The check is awaited until the
response deadline without cancelling the owned S08 step, and exhaustion is decided only
by the ledger (returned units make a window fundable again the same day). Busy cells are never evicted
from the bounded cell map, so one owner fetches per cell; idle cells are trimmed back
to capacity when a request or a detached owned load/fetch finishes. VC requests, S3 keys, catalogs, metadata and
bodies carry only the cell centre; the response still echoes the requested `location`.

Byte parity is tested against pinned Node v16.20.2 legacy-oracle recordings
(`server2/tests/world/fixtures`), the S02 world goldens and the S10 gateway world
goldens, including negative coordinates, cell boundaries, date line, poles, DST,
half-hour zones, missing fields, malformed route inputs, provider failures and WAQI
air rendering. Restore tests rebuild every recorded 200 weather response from the S3
test peer with empty memory and a provider double that fails every fetch; the air observation is supplied
by the same recorded WAQI fixture. S13a adds air raw persistence and an S3-only restore of
the recorded air scenarios ([below](#s13a-provider-formats-and-live-world-air-2026-10-13)).

Known differences and gates: the S10 dispatcher gives a native family one attempt of
at most 3 seconds, so the world waiter uses that attempt deadline instead of the
legacy 2.5-second answer plus gateway retry; a VC fetch slower than the attempt
returns the provider error while its owned fetch still publishes for the next request
(legacy could succeed on a gateway retry). A slow air branch is released as
`airStatus` pending just before the attempt deadline rather than at 4 seconds. S08
reserves both attempts where legacy counted billed records; unused units are pooled
for later fetches, except a final single unit that cannot fund two forecast attempts,
and S08 abandons a store block's remainder when a larger reservation needs a new
block, so a window can be declared exhausted somewhat earlier than legacy. IANA offsets come from bundled
`chrono-tz` data rather than Node 16 ICU data, and the process zone is UTC as in the
S02 oracle. Live air acquisition (Google, OpenWeather, WAQI, VC air), its S08 funding
identities and air raw persistence were moved to [#2729](https://github.com/WizardFactory/TodayWeather/issues/2729)
by AK (2026-10-13), with air raw records keyed by provider station or grid, never by
precise user coordinates. S13a implements the free-phase chain (VC air and the paid phase
excluded); with no configured air provider key the native output remains the legacy
no-provider air output. AK accepted the single native
S10 attempt described above as an intended difference. Cold loads
read 21 catalogs (at most four at a time) and, for busy cells, up to seven days of
forecast fetches; this remains a pre-cutover measurement item. No production route,
AWS resource, live provider or shadow comparison is changed by S11.

### S13a provider formats and live world air (2026-10-13)

[S13a](../../plans/issue-2729.md) extends the S08 transport and ports the remaining domestic
provider inputs and the overseas air chain. Native families stay off by default.

The funded transport now takes a per-call `ResponseFormat`: `DataType` (`serviceKey`,
`dataType=JSON`; the S13 default, unchanged), `ReturnType` (`serviceKey`, `returnType=json`;
AirKorea B552584), `UnderscoreType` (`_type=json`, `ServiceKey`; KASI) and `Type` (`type=json`,
`ServiceKey`; newsky2). The transport appends these parameters in the legacy order and
rejects a family query that already carries a credential or format parameter. Success codes
are per format; only newsky2 also accepts `0000`. `classify` and `execute` keep their S13
behavior. `budget::Provider` adds `GoogleAirQuality`, `OpenWeather` and `Waqi` funding
identities, which the shared data.go.kr/VC transport and executor reject.

`server2::domestic` adds AirKorea station (`getCtprvnRltmMesureDnsty`, `ver=1.3`) and sido
(`getCtprvnMesureSidoLIst`, `searchCondition=HOUR`) observations for the 17 legacy sido
names (100 rows per page, at most 20 pages and 2,000 rows, one selected key and no rotation),
KASI `getAreaRiseSetInfo` for the 102 legacy areas, and the newsky2 forecast-zone code list.
KASI and the zone list rotate keys as #2604 does. A page becomes a record only when
the legacy checks pass: AirKorea `00`, an `items` array, echoed page numbers, row counts, a
valid KST data time, a nonblank identity, the requested sido, no duplicate across pages and at
least one numeric concentration; KASI one item that echoes the area and day and has the 12
time fields; zone `resultMsg OK` and a complete, duplicate-free `regId` list. Records use
source `data-go-kr` and kinds `airkorea-station`, `airkorea-sido`, `kasi-area-rise-set` and
`forecast-zone`. AirKorea `getMinuDustFrcstDspth` and `getMsrstnList` were not ported, because
legacy then called them on the retired `openapi.airkorea.or.kr` host. [S13b](#s13b-legacy-airkorea-and-forecast-zone-sources-2026-10-14)
follows legacy #2737/#2740: it ports both operations, gives every AirKorea operation the legacy
`withKeys` key selection, and replaces the newsky2 zone request and the `Type` format with
data.go.kr `getFcstZoneCd`.

`world::LiveAir` is the air source of the native world (S10c removed the S13a
`SERVER2_WORLD_AIR=live-local|restore-local` settings; a provider takes part when its key is
configured, and restore from S3 is ordinary behavior). The air cell is the legacy
`toFixed(2)` cell, and providers are requested at that cell, never at the user's precise
coordinate. A request uses an unexpired memory row, then the S3 records of the cell, then
the chain. One owned task resolves each cell; the 4-second air release does not cancel it.
The chain follows legacy `FREE_ORDER` (Google, OpenWeather, WAQI, then WAQI again if it was
not tried). Each provider gets at most one 3-second attempt with no retry. Before HTTP, one
S08 unit is reserved and consumed in the provider's monthly UTC window.
OpenWeather also has a rolling-minute cap. A provider is marked down for 10 minutes after
401, 403 or 429. The first observation that passes `evaluate` for the first requester wins;
otherwise the last unusable observation is kept. That provider body is published as one
raw record (sources `air-google`, `air-openweather`, `air-waqi`; kind `current`; key
`air-<p|n><lat*100>-<p|n><lon*100>`; UTC-day partition) before it serves a request. A row
lasts 30 minutes from its fetch; a failure or an unpublished body is cached for 2 minutes.
Each request evaluates the observation with its own coordinate and time and renders it with
the S11 code. The OpenWeather minute slot is taken together with its check, before funding.
The runtime gives weather, air and budget S3 requests one shared admission of 12
in-flight requests (`BoundedS3`), and an air store reads at most two catalogs at a time. The S11 oracle air scenarios match the legacy bytes through the live chain and
again from S3 after a restart with empty memory and the configured provider down.

Recorded differences: the cell coordinate replaces the first requester's precise coordinate;
an S08 reservation that fails closed replaces the legacy Mongo counter, which allowed calls
after a read failure. Down markers and the OpenWeather minute window are kept per process
instead of in shared Mongo. A body that is not published is not a success. KASI and newsky2
use HTTPS. The paid phase (legacy default off) and Visual Crossing air are not ported. Live
HTTPS reachability of KASI and newsky2, real quotas and live provider shapes beyond the
recorded or synthetic fixtures are unverified.

### S14 legacy history and demand-gated capture (2026-10-13)

[S14](../../plans/issue-2699.md) ([spec](../../specs/issue-2699.md)) adds the internal
`server2::history` library. It wires no route and starts no task; S15 consumes its inputs and
the runtime owner starts `CaptureRunner::run`.

- **Demand** (O-1/O-11): `state/demand/grid/request/{nx:03}-{ny:03}.json` holds exactly
  `schema`, `grid`, `lastDemandMs` and `expiresMs = lastDemandMs + 8 days`;
  `state/demand/grid/push.json` aggregates push-subscribed grid cells with the same fields, an
  expiry of at most 8 days and the aggregate's observation time as top-level `lastDemandMs`; an
  older snapshot never replaces a newer one. Any other field, a repeated member name or another
  key shape is rejected and never counts as demand. Writes are conditional, coalesced to one per 10 minutes per cell, and the active set is
  rebuilt from S3 after a replacement.
- **Capture**: only active cells. Every 10 minutes the runner requests the latest
  `ultra-srt-ncst`, `ultra-srt-fcst` and `vilage-fcst` publications per cell and, while any cell
  is active, the national AWS hourly and city pages; the AWS minute page every 2 minutes. Per-cell
  backfill (23 current, 23 ultra-short, 7 short publications) and national pages (192 hours) are
  attempted at most once per KST hour each; backfill left by a cap or funding stop carries over
  to the next tick. Calls stay under S08 budgets and per-tick HTTP attempt caps (2,560 funded,
  64 keyless; each acquisition is charged its worst case of two attempts per page before it
  starts), four acquisitions run at a time, a funding error stops further data.go.kr launches,
  present publications are skipped, and a publication counts only after S06 publication. One owner per scope per process;
  multi-host capture still needs the section 9 gate. RSS, mid-range and life-index inputs are
  latest-only and stay request-time acquisitions.
- **Coverage**: a required publication is covered by a captured group or by a legacy export
  snapshot taken after it (the export reproduces the legacy store, gaps included). Lookbacks are
  the legacy 192 hourly slots, 195 hours of short publications, 192 hours of national pages and
  the `(anchor - 20 min, anchor]` minute window with continuous pages. Anything missing returns
  `Legacy` with the gaps named (`NeverCaptured`/`Partial`); only a missing newest per-cell
  publication returns `NeedsLatest`. A station-minute export counts only if taken at or after
  the anchor and within its one-day retention. Station data and ASOS never cover a grid hour; a
  legacy deployment with `ASOS_HISTORY_READ_ENABLED` keeps every request on legacy. The capture
  index is rebuilt from published S06 catalogs only (per-key monthly catalog listings and the
  national day catalogs, each catalog read and validated), so an interrupted raw upload or an
  empty or corrupt catalog never counts (a corrupt one marks its date incomplete, so no export
  can hide it); an incomplete listing of
  any required capture, minute or export kind forwards to legacy.
- **Legacy export**: `server2/tools/migration/export_history_seeds.py` converts one offline
  `mongoexport` file (one document per line) of `kma.town.current|shortest|short`,
  `current|shortest|short` (v1) or `KmaStnHourly2|KmaStnMinute2` into a seed whose documents are
  the original lines byte for byte, with manifest provenance; the converter and the importer accept
  the same documents (differential edge-case test). Import stores one `legacy-mongo`
  record per collection and key and export instant, so every export is a separate revision.
  `history::legacy::current_rows` reproduces the legacy read projection of current rows
  (verified against the legacy functions over the fixtures). Exporting production data is a
  separately authorized operator action; no `server/` file changed.

Estimated cost (derived from legacy code, not measured): legacy collectors kept during
coexistence call data.go.kr about 24N current, 48N ultra-short and 16N short per day plus
past-current refills (N about 2,033 grids). server2 adds about 64 funded calls per demand cell per
day (24 + 24 + 16 pages), at most 53 backfill acquisitions when a cell becomes active (about 60 page calls with two-page short forecasts; worst-case charge 530 attempts), and about 768
keyless KMA pages per day while any demand exists. D = 1,000 demand cells adds about 64,000 funded
calls and about 200,000 S3 PUT per day (raw, descriptor and catalog versions). The AWS-minute day
catalog grows to 720 entries, so its retained catalog versions dominate version storage. Real
quotas, demand counts and prices remain to be measured before cutover.

Capacity: at the default caps one tick funds at most 256 data.go.kr acquisitions (worst case
10 attempts each; usually one page), about 36,800 per day, while regular capture needs about
56 acquisitions per demand cell per day. The defaults therefore sustain roughly 600 demand cells
plus backfill; D = 1,000 needs larger caps and the matching quota. Work beyond the caps is
reported as capped and stays missing, so the affected cells remain on legacy; sustained capping
is a cutover blocker, not an accepted gap.

### S10c real runtime configuration (2026-10-13)

[S10c](../../plans/issue-2736.md) ([spec](../../specs/issue-2736.md)) applies AK's 2026-10-13
decision that server2 has no runtime mode that legacy lacks. It removes the geocoder `mock`
mode and its built-in 10,000-unit counter (`MockQuota`), `SERVER2_WORLD_MODE=native-local`,
`SERVER2_WORLD_AIR=live-local|restore-local` with `LiveAir::restore_only`, and the
loopback-only endpoint checks of the world runtime and both seed importers. The transport rule
stays everywhere: HTTPS, or plain HTTP only to a loopback address. No replacement mode,
flag or dry-run path exists; tests and smokes give the real settings values that point at
task-owned test peers, and test doubles (quota, transport) live inside the tests.

| Concern | Setting | Default / rule |
| --- | --- | --- |
| Routing | `SERVER2_NATIVE_FAMILIES` = comma list of `geocode`, `dsf`, `kma` (S15; reads `SERVER2_S3_*` since S15b-1) | Unset: every family on legacy; an unlisted family reads none of its native settings. Unknown or repeated entries fail startup. |
| World versions | `SERVER2_WORLD_VERSIONS` | `v000901,v000902,v000903` |
| S3 (shared) | `SERVER2_S3_REGION`, `SERVER2_S3_ENDPOINT`, `SERVER2_S3_BUCKET`, `SERVER2_S3_ACCESS_KEY_ID`, `SERVER2_S3_SECRET_ACCESS_KEY` | `ap-northeast-2`; `https://s3.<region>.amazonaws.com/`; bucket and static credentials required when any family is native. One 12-request admission for weather, air and budgets. The importers use the same settings. |
| Geocoder keys/endpoints | `GEOCODER_KAKAO_KEYS`, `GEOCODER_GOOGLE_KEY`, `GEOCODER_KAKAO_BASE_URL`, `GEOCODER_GOOGLE_BASE_URL` | Existing legacy names; `https://dapi.kakao.com`, `https://maps.googleapis.com`; the Google fingerprint rule applies to the production endpoint, as in legacy. |
| Geocoder quotas | `SERVER2_GEOCODER_KAKAO_DAILY_UNITS` (per key), `SERVER2_GEOCODER_GOOGLE_DAILY_UNITS` | Required with that provider's key. One S08 window per key and UTC day, owner = domain-separated SHA-256 of the key. |
| World weather | `VC_SECRET_KEY`, `SERVER2_WORLD_VC_DAILY_UNITS`, `SERVER2_WORLD_VC_QUOTA_ID`, `SERVER2_WORLD_VC_URL` | URL defaults to the legacy Timeline root `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/`. |
| World air | `SERVER2_WORLD_AIR_<GOOGLE\|OPENWEATHER\|WAQI>_KEY`, `_MONTHLY_UNITS`, `_QUOTA_ID`, `_URL` | A provider takes part when its key is set (units and owner then required); URLs default to `https://airquality.googleapis.com/`, `https://api.openweathermap.org/`, `https://api.waqi.info/`. No key: legacy no-provider output. |
| KMA AirKorea (S15b-3a) | `AIRKOREA_SECRET_KEYS` (legacy name), `SERVER2_AIRKOREA_DAILY_UNITS`, `SERVER2_DATA_GO_KR_URL` | Read only with `kma`. No usable key: stored AirKorea records only. A key needs its S08 units per key and KST day; the root defaults to `https://apis.data.go.kr/`. The `kma` air fallback uses the world air settings above through the same process air chain. |

`FundedQuota` now opens one S08 budget store per key and UTC day from configured limits,
claims at most 50 units per authority block, and still funds every possible attempt of a
lookup before HTTP without refunds. Without a quota the geocoder denies every acquisition.
S08 keeps one policy per owner and window, so a changed limit applies from the next UTC day;
a restart with another limit inside the same day denies that key until the day ends. A
provider day that is not the UTC day overlaps two windows; the #2724 limits must account for
that. The air source is always `LiveAir`: memory, then the S3 records of the cell, then the
funded chain; with no provider key it returns the legacy no-provider output.

Verification (local, test peers only): a Red test failed on the base because the geocoder
refused configured HTTPS endpoints without `mock` and the world runtime required
`SERVER2_WORLD_MODE`. The gateway built from real-format settings serves the S02
`geocode-v000903-coord` bytes with budgets in the S06 S3 test peer; the S11 oracle air
scenarios restore from S3 with the production WAQI configuration and its transport down;
`gateway_smoke.py`, `world_smoke.py` and `deploy/smoke.sh` pass on the release binary. Live
provider reachability, real quotas, runtime credential rotation and AWS behavior remain
unverified; production routing still needs the #2724 limits and the cutover gates.

### S15 KMA v000903 assembly and Rust checkpoint (2026-10-13)

[S15](../../plans/issue-2700.md) ([spec](../../specs/issue-2700.md)) adds `server2::domestic::kma`,
a native port of the 37-step [v000903 router list](mobile-api.md#domestic-api-middleware-in-order)
and a `Family::Kma` handler for the S10 dispatcher. Legacy stays selected by default.

- **Boundary.** The port starts where legacy controllers receive store answers. `KmaStore` has one
  synchronous method per dependency call (town list, short/current/shortest/RSS documents for
  DB 1.0 and 2.0, mid forecast/land/temp, forecast zone, station minute and hourly rows, area
  numbers, life index, MFDS rows, AirKorea current air, dust forecasts, the air-provider fallback,
  station air forecasts, KASI rise/set and warning zone rows). Answers are ordered JSON; Dates are
  `{"$date": ms}`. A key-sorted JSON map would change the response, so the answers keep property order.
- **Semantics.** A JavaScript value model keeps shared object references, property order (array
  indices first), `undefined` in memory and the legacy `try`/`catch` boundaries. A legacy exception
  is a `Thrown` unwind that only a ported `catch` stops. Store reads are asynchronous callbacks in
  the deployed service, so an exception after a store answer escapes a `catch` entered before the
  read and forwards (the S02 harness answers synchronously; no recording depends on this). Any
  other Rust panic is a port defect: the backend forwards that request to legacy.
  Precipitation bounds stay beside rows and never reach JSON, as in the legacy `WeakMap`. Shared
  logic is reused: S12 `zonesForTown`/`specialInfoFor`, the S11 `AqiConverter`, weather strings,
  locale selection and number/date helpers. KMA strings missing from the S11 locale subset are in
  `domestic/kma/locales.json`. ASOS history reads are off, as on the observed production checkout.
  `manager.MAX_CURRENT_COUNT` is 192; since S15b-1 (D4) the oracle is recorded with 192 as well, and
  all 76 recordings are identical to the earlier 200 recording.
- **Forwarding.** `BackendHandler` gains a defaulted `fetch_or_forward`. When the source cannot supply
  inputs (for example, S14 coverage `Legacy`), the handler returns `Native::Forward`. It also forwards
  when legacy would redirect a non-Korean coordinate, geocode and save a new town, remap a `KR` region
  remotely or throw past every handler. The dispatcher then runs the unchanged legacy hop within the
  remaining deadline. Nothing is invented. The legacy 400 region guard maps to the legacy hop's
  dependency error.
- **Air.** The goldens show no AirKorea dust forecast or station list, and no AirKorea forecast or
  station-list endpoint is called during a request. The 2026-10-13 decision (#2729) not to port
  `getMinuDustFrcstDspth` and `getMsrstnList` rested on the retired host; after legacy #2737,
  [S13b](#s13b-legacy-airkorea-and-forecast-zone-sources-2026-10-14) acquires both as raw records
  (`airkorea-dust-forecast`, `airkorea-station-list`) for S15b. In S15 the station list arrives inside the `arpltn` store answer. Stored dust forecasts and the provider fallback are
  store answers.

Parity uses a pinned Node 16.20.2 oracle recording ([provenance](../../server2/tests/domestic/fixtures/PROVENANCE.md)):
76 requests through the real router and harness, with every store answer and its arguments recorded in order. They
include the 15 S02 direct-route v000903 goldens (bodies and Express ETags), the 5 gateway domestic
v000903 backend inputs, and supplementary DB 1.0, RSS, station, rain-category, air-list, KAQ
forecast, fallback, life-index/MFDS/rise-set, warning, temperature, error, clock-boundary and invalid
DB 1.0 RSS/current publication, Boolean station-time, hexadecimal area-number, malformed-escape,
interpolated string current and signed radix cases. 74 recordings match byte for byte, with the dependency calls in legacy order. Two are declared
forwards: a station time `0001-09-24 09:03`, which V8's legacy parser reads as 2026-01-09, and a query
with a malformed escape, for which legacy `decodeURI(req.originalUrl)` throws before its `try` (500). `Date.parse` is reproduced for the strict ISO, space and dotted forms (years from
100 for the legacy forms) and digit-only strings, checked against the pinned V8; any other date
string forwards to legacy. Numeric Date constructors map years 0-99 to 1900-1999, `parseInt` without a radix reads `0x`
hexadecimal (power-of-two radix strings round once, ties to even, as in V8), and `Number`/`parseInt`/`parseFloat` skip JavaScript whitespace only, as in JavaScript. A store string
with an unpaired UTF-16 surrogate (which a Rust string cannot hold) forwards instead of being replaced. The 5 gateway goldens match on
the wire with the native switch (status, body and headers except `date`/`connection`). The legacy
default, forward and rollback paths are tested. The recorded store is a test double: it checks each
call's method, order and complete arguments and that every recorded call was used, forwarding on
any difference.

Routing uses the S10c list only: `kma` in `SERVER2_NATIVE_FAMILIES` registers and selects the
v000903 KMA handler; removing it and restarting is the rollback. S15 adds no other setting or mode.
Since S15b-1 ([below](#s15b-1-kma-s3-input-source-2026-10-14)) a listed `kma` builds the S3
input source from the shared `SERVER2_S3_*` settings, which are then required; inputs owned by
later S15b slices still forward. `tools/kma_smoke.py` checks legacy -> `kma` -> legacy on the release
binary (identical bytes, the legacy KMA hop in every phase, the native phase reading the S3 test
peer, unknown or repeated entries and `kma` without S3 settings refused before binding).

O-2 checkpoint (Rust adoption is settled; this records correctness and cost). `kma_checkpoint`
assembles every recorded request from memory, and `tools/kma_checkpoint.py` reads process rusage.
On an Apple M4 release build (3,040 assemblies) the mean per assembly is 3.55 ms (p50 3.75, p95 4.04,
p99 4.50, max 8.15 ms, including JSON encoding and store-answer conversion), CPU is 3.6 ms per request
and peak RSS is 165 MiB, 162 MiB of which is the decoded fixture (both test views). The server2 CI entrypoint records
the Linux values. The legacy oracle took about 7 ms per request on the same host, including loopback
HTTP and Express. These are local fixture measurements, not production latency, concurrency or
memory evidence. The S10 3-second native attempt and the 9-second gateway deadline are unchanged.

### S13b legacy AirKorea and forecast-zone sources (2026-10-14)

[S13b](../../plans/issue-2741.md) ([spec](../../specs/issue-2741.md)) follows two legacy master
changes in the `server2::domestic` library: [#2737](https://github.com/WizardFactory/TodayWeather/pull/2737)
moved the AirKorea dust forecast and station list to data.go.kr B552584, and
[#2740](https://github.com/WizardFactory/TodayWeather/pull/2740) moved the forecast-zone list to
data.go.kr `getFcstZoneCd`. It wires no route, scheduler or setting; S14 owns capture timing and
S15b reads the records.

| Request | Path below `https://apis.data.go.kr/` | Family query (transport adds format and key) | Pages |
| --- | --- | --- | --- |
| `AirKoreaRequest::dust_forecast(YYYYMMDD)` | `B552584/ArpltnInforInqireSvc/getMinuDustFrcstDspth` | `searchDate=YYYY-MM-DD`, `pageNo`, `numOfRows=100`, `ver=1.1`; `serviceKey`, `returnType=json` | ≤20, total ≤2,000 |
| `AirKoreaRequest::station_list()` | `B552584/MsrstnInfoInqireSvc/getMsrstnList` | `pageNo`, `numOfRows=100` (no `ver`); `serviceKey`, `returnType=json` | ≤20, total ≤2,000 |
| `ZoneRequest::new()` | `1360000/FcstZoneInfoService/getFcstZoneCd` | `numOfRows=1000`, `pageNo`; `serviceKey`, `dataType=JSON` | ≤10 |

`publication::dust_forecast_announcement(now)` ports `_checkDataTime`: the expected announcement is
05, 11, 17 or 23시 of the KST day, or the previous day's 23시 before 05:00; its date is the search
date. The newsky2 root, `Endpoints::with_newsky` and the `ResponseFormat::Type` format (with its
`0000` success code) are removed.

**Keys.** All four AirKorea operations follow legacy `withKeys`: the key that last completed an
operation (`KeyRing::preferred`), otherwise the last configured key. Each page call offers one key.
A credential rejection (HTTP 401/403 or codes 20/30/31/32) moves to the previous key and restarts
from page 1 within the same deadline; after every key is rejected the call fails with
`Provider(Auth)`. Since [S13c](#s13c-airkorea-quota-key-rotation-2026-10-14) a quota answer
(429 or code 22, also inside a 401/403 body) does the same and marks the key exhausted until the
end of its KST day. Other provider codes, transport failures, unread 401/403 bodies and invalid
bodies stop without changing the key. For
`ReturnType`, a 401/403 whose body carries an explicit code other than a credential or quota code
is `Rejected`, as in legacy `rejectionCode`; a 401/403 or 200 gateway body without a 1-3 digit code
other than `00` is read for the legacy `DEADLINE_HAS_EXPIRED_ERROR`/`SERVICE_KEY_IS_NOT_REGISTERED_ERROR` (credential)
and `LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR` (quota) markers. This replaces the S13a
single key without rotation. The zone list keeps the S13a #2604 ring: each page call offers the
current key and the next one, and the ring moves to the key that answered or past every rejected
key. Legacy instead tries every configured key once per request and, after a final failure,
returns to the key it started with.

**Checks.** AirKorea pages need `resultCode "00"`, an `items` array of objects, a digit `totalCount`
≤ 2,000 that is equal on every page, echoed `pageNo`/`numOfRows`, the expected item count and no
repeated item; `totalCount 0` or `03` on page 1 is terminal NoData. An item with a non-empty
`serviceKey` is not stored: legacy deletes this echo, but a raw record keeps the provider bytes. A
forecast item needs nonblank `dataTime`, `informCode`, `informData` and a string `informGrade`; a
station item needs a nonblank `stationName`, `dmX`/`dmY` as a string (empty allowed) or number and
`addr` absent, null or a string. Zone pages need `resultCode "00"`, an `items.item` array whose length
equals `totalCount` (the provider counts only the returned page), echoed `pageNo` and
`numOfRows=1000`, unique `regId`, and items that legacy `normalizeZone` accepts. A full page
continues; a shorter page, or a regular JSON `response.header.resultCode "03"` after a full page,
ends the list (a gateway or XML `03` fails it); a full tenth page fails.

**Records for S15b.** Source `data-go-kr`; every page of one acquisition is one record with the
exact provider bytes and `Pagination{page, pages, complete: true}` in request order, published as one
group.

| Kind | Key (`ProviderKey::Named`) | Period (`local_date`/`slot`) | Catalog partition | Body (each page) |
| --- | --- | --- | --- | --- |
| `airkorea-dust-forecast` | `dust-forecast` | newest `YYYY-MM-DD HH시 발표` announcement on the search date (`HH00`) | search date `YYYYMMDD` | `response.body.items[]` with `dataTime`, `informCode` (for example `PM10`, `PM25`), `informData` (`YYYY-MM-DD`), `informCause`, `informOverall`, `informGrade` (`"서울 : 좋음,제주 : 좋음,..."`), `actionKnack`, `imageUrl1`-`imageUrl9`; `totalCount`, `pageNo`, `numOfRows` |
| `airkorea-station-list` | `stations` | KST fetch day / `0000` | `YYYYMMDD` | `response.body.items[]` with `stationName`, `dmX` (latitude), `dmY` (longitude), `addr`, `item` (`"SO2, CO, ..."`), `mangName`, `year`, optional `map`, `oper`, `photo`; `totalCount`, `pageNo`, `numOfRows` |
| `forecast-zone` | `forecast-zones` | KST fetch day / `0000` | `YYYYMMDD` | `response.body.items.item[]` with `regId`, `regName`, `regSp`, optional `regEn`, `regUp`, `stnWn`, `stnF3`, `stnFd`, `stnFw`, `tmEd`, `tmSt`, `seq`, `ht`, `lat`, `lon`; per-page `totalCount`, `pageNo`, `numOfRows`, `dataType` |

Legacy consumers to port in S15b: `_parseFrcst` keeps only items whose `dataTime` equals the expected
announcement and splits `informGrade` at `,` and ` : `; `completeGeoMsrStnInfo` swaps `dmX`/`dmY` when
`dmX > 100` and geocodes an empty coordinate from `addr`, and `parseMsrstnList` stores
`geo = [dmY, dmX]`; `normalizeZone` converts the zone fields and sets
`geo = [lon, lat]` only for nonzero coordinates, and zones missing from a complete refresh are
retired, never deleted.

Recorded differences: at most one funded retry per page (legacy: one transient AirKorea retry,
three attempts per key for the zone list); a zone 3xx is retried once and another 4xx stops; a
zone page tries at most two keys and the ring does not return to its starting key after a
failure (legacy: every key once, then back to the start). An
empty zone list (legacy would retire every zone) and a forecast without an announcement on the
search date are not recorded. Verification uses the legacy offline fixtures `frcst.json` and
`msrstn.json` (copied byte for byte), a labelled synthetic `getFcstZoneCd` page, loopback provider
stubs and the S3 test peer; the release smoke publishes and reads back each kind. Live HTTPS
behavior of the three services, real quotas and key lists are unverified.

### S13c AirKorea quota key rotation (2026-10-14)

[S13c](../../plans/issue-2745-s13c.md) ([spec](../../specs/issue-2745-s13c.md)) applies AK's
2026-10-14 [#2745](https://github.com/WizardFactory/TodayWeather/issues/2745) decision to the
S13b AirKorea key selection, as legacy [#2746](https://github.com/WizardFactory/TodayWeather/pull/2746)
does. A quota answer (`Disposition::Quota`: HTTP 429 or code 22, including the JSON gateway
envelope and 401/403 bodies) on the selected key marks that `KeyRing` entry exhausted until the
first instant of the next KST day (`KeyRing::exhausted(index, now_ms)`), and the acquisition
restarts from page 1 with the previous entry, in the S13b order. Exhausted entries are skipped
without funding or HTTP by every AirKorea operation of the acquirer until the KST day ends; the
next day probes them again. Each page call rechecks its key, so an acquisition that is paging
when a parallel acquisition marks the key exhausted restarts with the next key instead of
funding another page. When no entry completes and at least one was exhausted the call fails with
`Provider(Quota)`; an all-credential failure stays `Provider(Auth)`. The last working key is still
remembered (`preferred`). Code 23 (per-second limit) is not a daily quota and keeps stopping.
The forecast-zone and KASI rings (#2604 rotation) are unchanged, and an S08 `Funding` denial still
stops the call.

Funding is unchanged: every page call offers one key and reserves two units on that key's S08
budget before any HTTP (one attempt plus one transient retry); an exhausted key reserves nothing.
With *n* keys and *P* pages the worst case is *n·P* page calls, *2·n·P* attempts and *2·n·P*
reserved units, the same bound as the S13b credential failover (at most 20 pages; for example
3 keys and the 7-page station list: 21 calls, 42 units). The usual case, quota on page 1, costs
one extra call and two extra units per exhausted key and day per acquirer (parallel acquisitions
already sending to the key can each receive one quota answer). Exhaustion is held in memory per
acquirer, so after a restart each exhausted key costs one more quota answer per acquisition that
reaches it before the first answer is recorded. Only a provider quota answer marks a key: a page
recheck that finds the key already exhausted never moves the end of that exhaustion.

Verification: the formats suite replays the exact provider body recorded live on 2026-10-14 23:56
KST (`fixtures/airkorea-quota-429.json`, HTTP 429, `returnReasonCode "22"`) and covers rotation and
memory, every quota form, all keys at quota until KST midnight with no funding, quota on page 2,
a key exhausted by a parallel acquisition, and code 23. A live run at 00:08 KST on 2026-10-15 sent
one 서울 station request through `DomesticAcquirer` with the operator key list and the local S3
peer: the third key's quota had reset at KST midnight, so it completed on that key with one funded
call (2 units), and the page was published and read back. Live rotation was observed through the
legacy client in the same KST day as the quota answer, not through server2.

### S15b-1 KMA S3 input source (2026-10-14)

[S15b](../../plans/issue-2742.md) ([spec](../../specs/issue-2742.md)) answers the S15 `KmaStore`
calls from server2's own data. AK decided on 2026-10-14 that there is no MongoDB migration and no
pre-collection before cutover, and that server2 must not depend on legacy, which is shut down at
cutover. S15b is split into four PRs ([split and decisions](https://github.com/WizardFactory/TodayWeather/issues/2742#issuecomment-6167282481)):

| Slice | Content |
| --- | --- |
| S15b-1 | Source framework, town list, region code, forecast zone, grid/RSS/mid documents, warning zones, D4 |
| S15b-2 | Station observations, `KmaStnInfo` from KMA pages, the legacy #2564/#2648 ASOS history composition with on-demand ASOS records |
| S15b-3 | AirKorea stations, `arpltn`, dust forecast, area numbers, life index, KASI, MFDS, air fallback, KAQ/AirKorea image forecasts |
| S15b-4 | Request-time acquisition, unknown-town geocoding, warm memory and exact-raw packs, the S15 declared forwards, zero legacy forwards |

**Source and snapshot.** `domestic::kma::source::S3Source` implements `KmaSource` over the shared
`BoundedS3` admission (12 in flight, below the 16-connection test peer; S14 index LISTs now hold a
permit too). For a request it resolves the town with the legacy `_findTown` rule, loads the town's
grid, RSS and mid inputs, the forecast-zone list and the S12 zone state, and returns a `Snapshot`,
an in-memory DB 2.0 `KmaStore`. Only published catalogs count; listings are per key and KST month.
An acquisition is dated by its last page.

- **Grid and RSS** read the publications that can still own a retained slot: 216 h plus the
  horizon and a trailing day.
- **Mid** walks months back to 2026-01 until a saved document is found, as legacy keeps the last
  saved one.
- **Forecast zones** fold every list since 2026-01 in completion order. A 10-minute refresh appends
  newer lists. A late list completed earlier triggers a refold, and a daily refold catches the rest.
The snapshot lists the matched town as `towns()`; the chain uses the list only for `_findTown`,
which finds that town first in the full list too.

**Reference data from the repository.** `part.csv`, `base.csv`, `region.csv` and
`kma_forecast_land_zones.csv` are byte-identical copies with provenance. The town list follows
`initTownDataToMongo` then `updateTownDataToMongo` (4,652 documents; grids by a `coordinate2xy`
port). `region_code` is `getRegIdByTown`. Forecast zones fold every complete S13b `forecast-zone`
acquisition with the legacy `getFromKma` rules (`_parsePage`, `normalizeZone`, upsert with `$unset`,
retirement); `forecast_zone` is `findForecastZoneByName` over active zones.

**Legacy documents from raw records.** In fetch order, the source applies the legacy collector to
each captured acquisition:

- **Grid:** the page checks, `rawItems`, the organizers, `_emitOrganizedData`, `within`, `batch` and
  the canonical publication; then the current merge or the fenced forecast write, and the 216-hour
  retention anchored on the family's latest requested slot.
- **RSS:** `parseShortRss`, last write wins per `fcsDate`, a Mongoose cast error skips a row, and the
  hourly wall-clock retention.
- **Mid:** `organizeForecastData` / `midForecastPolicy.parse` and `saveMid` with `saveOnlyLastOne`, in
  save order. Legacy and S15b-4 request only the non-decreasing wall-clock `tmFc`, so save order is
  publication order across months.
  Every region's stored document is read. Collection eligibility only decides whether a missing
  latest publication must be acquired, so a retired zone keeps its document.

Stored documents keep the Mongoose 5.1.2 form, including template defaults copied by its `for...in`
clone, `strict` stripping and `__v`. Legacy requested XML; server2 stores JSON, and an item field is
the string form of its JSON value. Documents are derived in memory; no normalized view is stored.
Applying server2's own captures with the legacy save rules is the intended native semantics after
cutover; it does not claim to reproduce legacy collection timing.

**Temporary forwards.** Until S15b-4, the snapshot forwards with a named reason in these cases:

- A latest publication is not in S3: current, ultra-short, short, RSS, mid, or the zone list.
- The town is unknown.
- A method owned by S15b-2 or S15b-3 is called.

Older gaps are not a forward reason; S15b-2 fills history from ASOS. The `kma` family stays off until
S15b-4.

Verification (local, test peers only):

- A pinned Node 16.20.2 oracle with Mongoose 5.1.2 and an in-memory collection double
  ([provenance](../../server2/tests/domestic/fixtures/SOURCE-PROVENANCE.md)) runs the legacy
  scripts, organizers, savers and readers on synthetic inputs.
- The rebuilt towns, 400 grid points, region table and cases, five zone scenarios, grid outcomes and
  documents for four scenarios, two RSS scenarios and six mid answers match byte for byte.
- The same scenarios published to the S06 S3 test peer and read back with empty memory equal the
  oracle as well (grid, RSS, mid, zones).
- An S3 snapshot test returns the same documents and forwards each missing input with its reason.
- Focused tests pin completion-time dating, retired-zone documents, the last saved mid document
  across months and zone fields inherited from older lists.
- The release `kma_smoke.py` passes.

Live provider shapes and timing, the cold-cell latency (S15b-4) and production quotas are unverified.

### S15b-3a AirKorea inputs and the air fallback (2026-10-15)

S15b-3 is split into three PRs (scope): **3a** AirKorea (`arpltn`, `dust_forecast`) and the
air-provider fallback (`air_fallback`); **3b** area numbers, life index, KASI rise/set and MFDS food
poisoning; **3c** the KAQ/AirKorea image forecasts (`air_forecast`). The `kma` family stays off until
S15b-4; the store methods of 3b/3c still forward with their named reason.

**National datasets (AK, 2026-10-14).** AirKorea answers are built from datasets shared by every
request, never per request, cell or station. Each is one owned, single-flight acquisition keyed by
dataset and period (S13b `DomesticAcquirer`, funded through S08, published through S06 before use):

| Dataset | Provider operation (B552584 기술문서 v1.4) | Record kind / key / partition | Freshness rule |
| --- | --- | --- | --- |
| Real-time observations | `ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty`, `sidoName=전국`, `numOfRows=1000`, `ver=1.3`, `returnType=json` | `airkorea-station` / `sido-nationwide` / the dataset's most common data hour `YYYYMMDD-HH00` | the request's KST hour; at most one attempt per hour every 10 minutes |
| Station list | `MsrstnInfoInqireSvc/getMsrstnList`, 100 rows per page, no `ver` (S13b) | `airkorea-station-list` / `stations` / KST fetch day | the newest list older than 7 days (legacy: only at process start) |
| Dust forecast | `ArpltnInforInqireSvc/getMinuDustFrcstDspth`, `searchDate`, `ver=1.1` (S13b) | `airkorea-dust-forecast` / `dust-forecast` / search date | the announcement `_checkDataTime` expects; only for `airForecastSource=airkorea` |

Legacy collected real-time observations per sido (`kecoRequester._collectProvinces`, 17 calls at UTC
minutes 3, 13, ... 53). The technical document lists `전국` among the `sidoName` values; on
2026-10-14 one `numOfRows=1000` call returned all 672 stations in 1.85 s (`sidoName` `전남광주` for
Jeonnam and Gwangju stations). Seven of the 672 rows had `dataTime: null`: legacy `parseRows` would
have rejected that sido's whole batch; server2 skips such a row and keeps the dataset. AirKorea
requests per hour: one page per national fetch, normally one to three fetches per hour while
requests arrive (at most six), about 24-72 a day, plus 7 station-list pages a week and at most 24
forecast pages a day (only for `airkorea` forecasts). The development quota is 500 requests a day per
operation; legacy used about 2,450 observation calls a day. Keys follow the S13b/S13c acquirer as
is: the last working key, otherwise the last key; a quota answer (429 or code 22) exhausts that key
until KST midnight and the call continues with the next key (#2745). The acquirer and its S08
windows are rebuilt per KST day. On 2026-10-14 the last configured key answered 429.

**Legacy documents and readers.** In fetch order the source applies the legacy save rules:
`completeGeoMsrStnInfo` (swap `dmX > 100`), `parseMsrstnList` and `saveMsrstnList` for `MsrStnInfo`
(a station without coordinates is not stored: legacy geocodes its address; no live station lacked
coordinates); `parseRows` (station operation, `Arpltn.getKeyList()`) and `saveRLTMCtprvn` for
`ArpltnKeco` (upsert by station and data time); `_checkDataTime`, `_parseFrcst` and `_saveFrcst` for
`MinuDustFrcst` (search dates `date-2..date` hold every document `getDustFrcst` returns). Documents
keep the Mongoose 5.1.2 update form. The readers are the tw_svc ones: `getArpLtnInfo` (2d `$near`,
`$maxDistance` 1, six stations, rows of the last 24 hours, `_mergeArpltnList` with the 8-hour check,
the first three stations ordered by the legacy comparator with the V8 short-array sort) and
`getDustFrcst` with `_convertDustFrcstRegion` over `region.csv`. `air_fallback` is the shared world
`LiveAir` chain (memory, S3 records, providers) for the town coordinate, evaluated per request
(`observation.evaluate`); the world family and the KMA fallback share one instance.

**Request time (AK, 2026-10-14).** A request waits for an owned acquisition only until its own
deadline (100 ms before the native attempt ends). Otherwise it answers with what S3 holds: the
legacy answer for missing data (no merged observation, an empty station list, the forecast error,
no fallback value), never 503 or a forward. The acquisition keeps running with the legacy AirKorea
bound (30 s per call) and serves the next request; joined requests share it. Data a request waited
for is visible to it although it completed after the request instant. While a request arrived in the
last 24 hours, a process capture checks every 10 minutes and acquires the current nationwide hour
once if it is not stored, so the 24-hour station rows have no hourly gaps (legacy collected every
10 minutes regardless of demand); that is at most 24 nationwide calls a day.

Verification (local; test peers only): a pinned Node 16.20.2 + Mongoose 5.1.2 oracle
([provenance](../../server2/tests/domestic/fixtures/AIR-PROVENANCE.md)) records the legacy
documents and 48 `getArpLtnInfo` answers, 156 comparator orders and 84 `getDustFrcst` answers;
the Rust fold and readers match byte for byte, directly and from the S06 S3 test peer with empty
memory. A loopback AirKorea stub shows one acquisition for concurrent requests, publication
before use, a request released before a slow acquisition and served by the next one, and the
fallback answer and its deadline. Live calls on 2026-10-14 confirmed the three AirKorea operations,
WAQI and Google Air Quality (200); the OpenWeather key answered 401. Production quotas, the
cold-cell latency (S15b-4) and an end-to-end KMA response (after S15b-2) remain unverified.
