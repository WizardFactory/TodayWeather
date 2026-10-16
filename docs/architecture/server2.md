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
HTTP deadline. Since [S13d](#s13d-legacy-provider-timeouts-and-the-request-waiter-2026-10-14),
the acquisition stage is one shared owned task per repair scope with the legacy
provider timeouts, and a waiter returns after at most three seconds. Resolver reads retain S06 coverage: a page or targeted acquisition
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
summary/v2/{source}/{key_sha256}/{date}/{latest_fetched_ms}-{count}-{revision_sha256}.json
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
shared S3 settings (S10c; the S10e names since 2026-10-15). Newly
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
latency examples. Product exposure remains O-13. S16 implements this contract
([below](#s16-daily-summaries-and-the-last-year-lookup-2026-10-15)).

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

D03 as first approved started with new registrations only. **AK superseded it on
2026-10-14**: legacy push/alarm registrations are copied once into server2 before
cutover (a read-only export; legacy MongoDB is not changed) and users keep
registering through the existing API contract. There is no reverse migration;
legacy is retired at cutover. Preserve/restore accepted S3 state during rollback;
a route switch alone cannot undo accepted mutations. S18 owns schema, ordered
concurrent state updates and ownership in the single Rust process, subject to S02
contract proofs and publication/deadline gates; see the
[S18a section](#s18a-push-registration-state-2026-10-15).

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
AK amended this on 2026-10-14 ([S13d](#s13d-legacy-provider-timeouts-and-the-request-waiter-2026-10-14)).
A provider acquisition that does not finish inside the attempt continues as owned
work with the legacy provider timeout. The request answers with the data that is
ready and omits the rest with legacy's absent-data output. The next request uses
the published record. The attempt cap itself is unchanged.

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
body or 5xx) inside the caller deadline. Since S13d each attempt has the legacy per-service
timeout instead of a fixed 3 s (KMA web pages 30 s; data.go.kr services in the S13d table).
Legacy unbounded RSS retries and 10×1 s scrape loops
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
  starts), four acquisitions run at a time (each until two legacy-timeout attempts plus a 3 s
  publication allowance since S13d), a funding error stops further data.go.kr launches,
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

S10e (2026-10-15) replaced the settings in this table with the legacy `server/.env` names, built-in
endpoints and quotas, and `server2/.env`; see [S10e legacy settings](#s10e-legacy-settings-and-server2env-2026-10-15).
The table records the S10c state.

| Concern | Setting | Default / rule |
| --- | --- | --- |
| Routing | `SERVER2_NATIVE_FAMILIES` = comma list of `geocode`, `dsf`, `kma` (S15; reads `SERVER2_S3_*` since S15b-1), `kma-v000901`, `kma-v000902` (S17a), `town` (S17b) | Unset: every family on legacy; an unlisted family reads none of its native settings. Unknown or repeated entries fail startup. |
| World versions | `SERVER2_WORLD_VERSIONS` | `v000901,v000902,v000903` |
| S3 (shared) | `SERVER2_S3_REGION`, `SERVER2_S3_ENDPOINT`, `SERVER2_S3_BUCKET`, `SERVER2_S3_ACCESS_KEY_ID`, `SERVER2_S3_SECRET_ACCESS_KEY` | `ap-northeast-2`; `https://s3.<region>.amazonaws.com/`; bucket and static credentials required when any family is native. One 12-request admission for weather, air and budgets. The importers use the same settings. |
| Geocoder keys/endpoints | `GEOCODER_KAKAO_KEYS`, `GEOCODER_GOOGLE_KEY`, `GEOCODER_KAKAO_BASE_URL`, `GEOCODER_GOOGLE_BASE_URL` | Existing legacy names; `https://dapi.kakao.com`, `https://maps.googleapis.com`; the Google fingerprint rule applies to the production endpoint, as in legacy. |
| Geocoder quotas | `SERVER2_GEOCODER_KAKAO_DAILY_UNITS` (per key), `SERVER2_GEOCODER_GOOGLE_DAILY_UNITS` | Required with that provider's key. One S08 window per key and UTC day, owner = domain-separated SHA-256 of the key. |
| World weather | `VC_SECRET_KEY`, `SERVER2_WORLD_VC_DAILY_UNITS`, `SERVER2_WORLD_VC_QUOTA_ID`, `SERVER2_WORLD_VC_URL` | URL defaults to the legacy Timeline root `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/`. |
| World air | `SERVER2_WORLD_AIR_<GOOGLE\|OPENWEATHER\|WAQI>_KEY`, `_MONTHLY_UNITS`, `_QUOTA_ID`, `_URL` | A provider takes part when its key is set (units and owner then required); URLs default to `https://airquality.googleapis.com/`, `https://api.openweathermap.org/`, `https://api.waqi.info/`. No key: legacy no-provider output. |
| KMA AirKorea (S15b-3a) | `AIRKOREA_SECRET_KEYS` (legacy name), `SERVER2_AIRKOREA_DAILY_UNITS`, `SERVER2_DATA_GO_KR_URL` | Read only with `kma`. No usable key: stored AirKorea records only. A key needs its S08 units per key and KST day; the root defaults to `https://apis.data.go.kr/`. The `kma` air fallback uses the world air settings above through the same process air chain. |
| KMA life inputs (S15b-3b) | none new | Read only with `kma`. UV V5, pollen V3 and KASI use the S15b-2 data.go.kr acquirer (its key and unit settings): one S08 quota owner per key and KST day across ASOS and these services, one key ring per service. MFDS is keyless at the production endpoint legacy hard-codes (`https://poisonmap.mfds.go.kr/api/risk.do`); per AK 2026-10-15 no new `SERVER2_*` provider setting is added (S10e converts the existing ones to the legacy names). |

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
forwards: a station time `0001-09-24 09:03`, which V8's legacy parser reads as 2024-01-09, and a query
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
input source from the shared S3 settings (S10e names), which are then required; inputs owned by
later S15b slices still forward. `tools/kma_smoke.py` checks legacy -> `kma` -> legacy on the release
binary, covering:

- identical bytes in the legacy phases;
- the native phase reading the S3 test peer;
- unknown or repeated entries, and `kma` without S3 settings, refused before binding.

Since S15b-4a the `kma` phase answers natively, with no legacy KMA hop. It acquires the missing
forecast inputs from the loopback provider roots.

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
  Since S15b-4a this is acquired at request time and no longer forwards.
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

### S13d legacy provider timeouts and the request waiter (2026-10-14)

[S13d](../../plans/issue-2747.md) ([spec](../../specs/issue-2747.md)) applies AK's 2026-10-14
decisions. Legacy collected in the background with long per-request timeouts. server2 serves user
requests, so a request never waits long, and a slow but working provider is still collected:

- **Waiter.** A request waits at most 3 s for an acquisition, or less when the remaining gateway
  attempt is shorter. It then answers with the data that is ready. A section whose acquisition has
  not finished is omitted with legacy's absent-data output. S13d adds no new 503: the
  `EWEATHERUNAVAILABLE` response stays only where legacy returns it today.
- **Owned acquisition.** The acquisition continues as owned work with the legacy provider timeout.
  S08 funds it before HTTP and S06 publishes its raw record, so the next request includes the data.
  Later requests join it instead of starting another acquisition.

**Timeouts per HTTP attempt** (`providers::attempt_timeout`, chosen from the service in the
request path; the connect bound is 3 s):

| Service | Timeout | Legacy source |
| --- | ---: | --- |
| VilageFcst 2.0, MidFcst, forecast zone | 10 s | `collectTownForecast.js:373`, `kma.forecast.zone.controller.js:123` |
| UV V5, pollen V3 | 30 s | `lifeIndexKmaRequester.js:1277`, `:1495` |
| Warnings | 30 s | `kmaWarningRequester.js:20` |
| AirKorea (four B552584 operations), KASI | 5 s | `airkoreaObservation.js:189`, `kasi.riseset.controller.js:92` |
| KMA web pages (RSS, AWS, city) | 30 s | `kmaScraper.js:206`, `:269`; legacy RSS had no timeout |
| Visual Crossing | 8 s | `dsf.controller.js:53` (S11 already used it) |

Another data.go.kr path keeps 3 s. World air providers keep the S13a 3 s (`config/air.js:49`).
An owned acquisition may spend two attempts for each page it can need
(`family::owned_provider_time`); five VilageFcst pages give 100 s. The S14 capture deadline is that
time plus the former 3 s, which becomes the publication allowance. The S07 resolver's owned
`acquisition` stage defaults to 63 s (one page of two 30 s attempts plus 3 s); callers set it per
family, at most 600 s. The response owner waits until the shared task ends, and `drain` waits for
running shared acquisitions and reports them (`DrainReport::unfinished_acquisitions`).

**Shared owned acquisitions.** `resolver::OwnedFlights` runs one owned task per key. A key is a grid
publication, or a national dataset and publication time. AirKorea, KMA scraper pages and ASOS answer
the whole country at once, so the requests of every cell wait on the same key; S15b-2 and S15b-3 use
this. `join` returns `Ready`, `Pending` (omit the section), `Expired`, `Failed` or `Busy` by
`min(ready_by, now + 3 s)`. A finished outcome answers later joiners for a short retention (the
stage bound in the resolver), so a request that read the store just before publication does not
start a second acquisition. At most 16 tasks run by default; a full pool starts nothing.

The S07 resolver uses it for its acquisition stage. The key is the repair scope (catalog and
periods), not the response key. Responses for different locations, locales or units therefore
share one provider call. Before S13d, every response key acquired separately: twelve locations on
one scope made twelve provider calls. The response owner waits for the shared task, reads the
published scope and assembles within a new stage bound. The request waiter is capped at 3 s
(`WAITER_BOUND`).

**World.** The S11 weather waiter ends 150 ms before the attempt deadline, so the legacy
`_fallback` answer (stored current, or a stale current up to 6 h, with stored days) is assembled
before the dispatcher's own attempt timeout. With no stored current the answer is still the legacy
error. A slow air branch still answers `airStatus` pending. The owned VC fetch (8 s) and air task
continue and publish.

**Pollen.** The [dataset 15085289](https://www.data.go.kr/data/15085289/openapi.do) Swagger names
the day+3 field `todaysaftertomorrow`; its manual lists no field names. Two live weeds calls on
2026-10-15 returned `twodaysaftertomorrow` instead. Validation accepts both. Raw records keep the
bytes, and the legacy client response is unchanged. Legacy reads only `todaysaftertomorrow`, so it
drops day+3. A derived pollen view (S15b-3) should carry day+3.

**Live check (2026-10-15 00:07 KST, one call per service, keys from the legacy configuration, never
logged).** Pollen V3: `twodaysaftertomorrow` present in the 18시 and 06시 issues. Response times:
VilageFcst 1.39 s (1,016 rows), MidTa 0.09 s, UV V5 1.30 s (1,000 rows), forecast zone 1.13 s,
KASI 0.13 s, KMA RSS 0.07 s, AWS minute page 0.10 s. AirKorea station data took 0.16 s with one key.
With another key, data.go.kr answered 504 after 30.07 s, which the legacy 5 s timeout bounds. These
are single samples, not latency distributions.

Verification (local, test peers only). These tests failed on the base tree:

- a town forecast and an RSS page answering after 4 s;
- a 4 s resolver acquisition that must publish after the waiter left;
- one acquisition for twelve locations on one scope (the base run made twelve; the test now starts six
  owners 150 ms apart so their cold reads stay inside the S3 test peer's connection slots);
- a pollen row with only `twodaysaftertomorrow`.

These functional tests use real loopback transports:

- 24 cell requests on the AirKorea station list: one provider call, then an S3 read-back;
- the gateway with the native world family: a 4 s VC fetch gives a 200 from stored records, then
  the legacy oracle bytes with one VC call;
- WAQI after 2.5 s under a 2 s gateway deadline: `airStatus` pending, then the oracle bytes with
  one WAQI call.

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
| Dust forecast | `ArpltnInforInqireSvc/getMinuDustFrcstDspth`, `searchDate`, `ver=1.1` (S13b) | `airkorea-dust-forecast` / `dust-forecast` / search date; the record period is the announcement chosen before the call (`AirKoreaRequest::dust_forecast_for`) | the announcement `_checkDataTime` expects; only when the request reads AirKorea forecasts (`airForecastSource=airkorea`, or absent or `(null)`, which legacy defaults to `airkorea`; the app sends `kaq`) |

Legacy collected real-time observations per sido (`kecoRequester._collectProvinces`, 17 calls at UTC
minutes 3, 13, ... 53). The technical document lists `전국` among the `sidoName` values; on
2026-10-14 one `numOfRows=1000` call returned all 672 stations in 1.85 s (`sidoName` `전남광주` for
Jeonnam and Gwangju stations). Seven of the 672 rows had `dataTime: null`: legacy `parseRows` would
have rejected that sido's whole batch; server2 skips such a row and keeps the dataset (a page of
such rows only is not fatal either). Each AirKorea attempt gets the S13d legacy timeout of its path
(B552584: 5 s, `airkoreaObservation` `timeoutMs`) within the 30 s call budget; legacy starts that
timer before `https.get`, so the AirKorea transport lets connecting (TCP and TLS) use the whole
attempt (`live::airkorea_transport`; other provider transports connect within 3 s). AirKorea
requests per hour: one page per national fetch, normally one to three fetches per hour while
requests arrive (at most six), about 24-72 a day, plus 7 station-list pages a week and at most 24
forecast pages a day (only for requests that read AirKorea forecasts). The development quota is 500 requests a day per
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
the first three stations ordered by the legacy comparator with the V8 short-array sort; a
multi-page nationwide dataset is dated by its most common data time over all pages) and
`getDustFrcst` with `_convertDustFrcstRegion` over `region.csv`. `air_fallback` is the shared world
`LiveAir` chain (memory, S3 records, providers) for the town coordinate, evaluated per request
(`observation.evaluate`); the world family and the KMA fallback share one instance.

**Request time (AK, 2026-10-14).** Owned acquisitions run on the S13d `OwnedFlights` (one task per
dataset and period; a finished outcome answers late joiners for 3 s); an acquisition that ended is
not started again for 10 minutes. A request waits for one only until its own deadline (100 ms
before the native attempt ends) and at most the S13d 3 s waiter bound; every read, lock and parse
is bounded by that deadline, and a re-read after the acquisition that cannot finish keeps the data read first. A
refresh that fails (S3 outage) answers with the last successful folds under the request's own
freshness bounds. The station list is re-read from one day before the last folded list every 10
minutes (a late list of an earlier day refolds) and refolded daily.
Otherwise it answers with what S3 holds: the
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
the Rust fold and readers match every one byte for byte directly. From the S06 S3 test peer with
empty memory they match all 48 `getArpLtnInfo` answers and 56 of the 84 forecast queries (those
for 10-14..10-17, replayed at noon KST of their date after every run; the 10-12 and 10-13
queries would need an instant before later runs); comparator orders are checked directly only. A
station row whose coordinate does not cast (`dmX` `-`) is rejected like the Mongoose CastError
and the stored station keeps its document. A loopback AirKorea stub shows one acquisition for concurrent requests, publication
before use, a request released before a slow acquisition and served by the next one, and the
fallback answer and its deadline. Live calls on 2026-10-14 confirmed the three AirKorea operations,
WAQI and Google Air Quality (200). The OpenWeather 401 came from the first of two
`OWM_SECRET_KEY` assignments in `server/.env`; legacy dotenv uses the last one, which answered 200
on 2026-10-15 (server2 reads `SERVER2_WORLD_AIR_OPENWEATHER_KEY`). Production quotas, the
cold-cell latency (S15b-4) and an end-to-end KMA response (after S15b-2) remain unverified.

### S15b-2 station observations and ASOS history (2026-10-15)

S15b-2 ([plan](../../plans/issue-2742.md#s15b-2-station-observations-and-asos-history), [spec](../../specs/issue-2742.md#specification-s15b-2)) sources `stn_hourly_and_min_rns`, `city_hourly` and the new
`KmaStore::history` (legacy `lib/history/service.loadForTown`). AK's corrections of 2026-10-14
and 2026-10-15 apply: no legacy forward and no pre-collection; recent current hours come from the
KMA backfill and older hours back to D-7 from the nearest ASOS city station within 100 km
(legacy #2564/#2648); a request waits at most 3 s and late data is answered as legacy answers
absent data; the nationwide AWS hourly page is the ongoing-hour ASOS source.

**Request-time acquisitions** (`domestic::kma::source::observe`) run as S13d `OwnedFlights`
tasks keyed by dataset and publication (or station run). They are shared by every cell,
survive the waiter, use the legacy timeouts (KMA pages 30 s, ASOS 10 s per attempt) and publish
to S06 before use. Each acquisition makes at most two HTTP attempts per page (S13). The bounds
below hold for failures too:

| Dataset | When | Acquisitions |
| --- | --- | --- |
| AWS minute page (`nph-aws_txt_min`) | newest stored page older than 2 minutes | at most one per 2 minutes, whatever the outcome: ≤ 30/h, ≤ 720/day (keyless) |
| AWS hourly page (`…?YYYYMMDDHH00&0&MINDB_60M&0&m`) | the latest KST hour from minute 15 and the hour before; one owned backfill pass over the missing hours of the 8-day `getCityHourlyList` window, three at a time (legacy `getStnPastHourlyWeather`) | latest/previous: each ≤ 6/h until acquired; backfill: each hour at most once per 6 h (≤ 190 per 6 h in an outage, 190 once at a cold start) |
| City page (`currentweather.jsp?tm=`) | the latest hour; the page serves only its latest hour | ≤ 6/h while missing |
| ASOS hourly/daily range (data.go.kr, per station) | one recovery run per mapped station at most once per hour (legacy lease and hourly job): the station's incomplete D-7..D-1 keys in contiguous ranges, as legacy `Recovery.run`; at most two stations' ranges in flight | cold 2 per station; then ≤ 2/day per mapped station, plus ≤ 1 run/h per station while ranges stay incomplete (≤ 8 pages per range) |

The data.go.kr ASOS form has no nationwide request (live 2026-10-14: no `stnIds` answers `11`,
`stnIds=0` answers `03`, two stations `02`); the KMA API허브 nationwide forms need an authKey that
is not configured. So rows of the city stations on the AWS hourly page fill ongoing hours
(`t1h`, `reh`, `rs1h`→`rn1` outside November–March, `wsd`, `vec`; marked `origin`). Only pages
fetched within two hours of their hour count; backfilled history pages never stand for ASOS
hours. The ranges are requested for the keys still incomplete. Replay applies records in fetch
order, and a range's allowed keys are those no earlier range completed. That is the legacy
plan-time set, because runs are serialized per station: a page row that arrived in between keeps
its values, and the range adds the fields the row lacks. A backfill pass claims each hour only
when that hour's acquisition starts, so hours left when its owned deadline expires stay due. Funding: the legacy `DONGNAE_SECRET_KEYS` list
(S10e; S15b-2 named it `SERVER2_DATA_GO_KR_KEYS`) with the built-in 10,000 units per key and KST day
(S08); provider roots are the built-in production HTTPS roots, and only tests build loopback roots.

**Legacy collections rebuilt in memory.** Pages are parsed as cheerio 0.20.0 / htmlparser2 3.8.3
read them (EUC-KR, entities, implied closes) and saved with the Mongoose 5.1.2 upsert rules of
`_saveStnHourly2`/`_saveStnMinute2`. `KmaStnInfo` starts from the imported legacy `kmastninfos`
seed (`tools/migration/export_station_seeds.py` + `station_seed_import`, offline; the production
export is a separately authorized action) and then follows `_saveStnInfo`: a new station is
registered once its address geocodes through the product geocoder, `isCityWeather` follows runs
with city data. `getStnHourlyAndMinRns` and `getCityHourlyList` are ported with the 2d `$near`
order. The ASOS store follows `Recovery.run`, `policy.normalize` and `Store.save` (first valid value
per field), and the assembly ports `mergeHourly`, `mergeDaily`, `status` and the `historyStatus`
response. S14 coverage no longer forwards: it lists what is fetched, what ASOS fills and what is
absent.

Verification (local, test peers only): pinned Node 16.20.2 oracles
([stations](../../server2/tests/domestic/fixtures/STATIONS-PROVENANCE.md),
[chain](../../server2/tests/domestic/fixtures/PROVENANCE.md)) for page parsing, savers, station
answers, ASOS recovery over the live station-108 bodies, and 9 chain scenarios with the history
read enabled (85 scenarios byte-identical); request-time tests over the S3 peer (single-flight,
3-second answer, completion for the next request, a fresh process served from S3, the seeded
registry); the release `kma_smoke.py` with provider roots on the loopback origin. Live calls are
listed in the PR. Not reproduced: legacy re-runs of the hourly page at minutes 4/9/15/30, station
rows of hours with no city page, `rnsHit`/`rnsCount` updates (legacy runs `_updateRnsHitRate` only
from `/gather` against the retired `KmaStnMinute`; the rules are ported but not wired, an open
decision), and the deployed `ASOS_HISTORY_STATIONS` allowlist (every registry city station is a
candidate).

### S15b-2s station registry seed (2026-10-15)

AK authorized a one-time read-only export of the legacy `kmastninfos` on 2026-10-15. It ran with
`find` only, and the connection URL was loaded in-process and never printed or stored. It returned
776 documents at `2026-10-15T00:34:30.549Z`. Converted by `export_station_seeds.py`, the seed is
carried as provenance-labelled static data (`domestic/kma/source/data/kmastninfos.seed.jsonl`;
public station facts only). The registry starts from it before any page arrives, so seeded
stations need no geocoding and keep `rnsHit`, `rnsCount` and `isMountain`. A repeated `stnId` is kept as legacy
holds it (`965` and `989` appear three times each in the export). A newer export published by `station_seed_import`
replaces the carried one.

Cutover steps (AK 2026-10-15):

1. A final read-only export is imported at cutover.
2. Once legacy is retired, server2 takes over updating `rnsHit`/`rnsCount` with the ported
   `_updateRnsHitRate` (`source/rnshit.rs`). It stays unwired while legacy runs, as legacy
   behaves on the v000903 path, with no runtime flag.

### S15b-3b life index, KASI rise/set, MFDS food poisoning and area numbers (2026-10-15)

The `kma` snapshot now answers `area_no`, `area_no_near`, `life_index`, `rise_set` and
`food_poisoning` from server2 data; with S15b-2 only `air_forecast` (S15b-3c, asked only for a
town with an AirKorea station) still forwards with its named reason, and the S3 snapshot test
assembles a native answer. Every input is a national dataset shared by all requests (AK,
2026-10-14), read through S06 and folded with the legacy save rules:

| Store call | Data | Legacy collection mirrored | tw_svc reader |
| --- | --- | --- | --- |
| `area_no`, `area_no_near` | Repository lists `20160704_AreaNoResutl` and `20180119_kma_lifeindex_areano.csv`, copied into `source/data` ([provenance](../../server2/src/domestic/kma/source/data/PROVENANCE.md)) | `utils/updateAreaNo.js` (2016 upsert by town), `utils/update.areano.to.db.js` (existing town: `$set {areaNo, updatedAt}`; a new town's Kakao geocode throws at `x.toFixed` on string coordinates, so none was stored) | `controllerTown.getLifeIndexKma` `findAreaNo` L2410 (`find({town}).limit(1)`) and `findNearAreaNo` L2451 (`$near`, `$maxDistance` 0.3, `limit(3)`) |
| `life_index` | S13 `uv-idx-v5` and `oak|pine|weeds-pollen-v3` (all areas) of the last 14 days | `lifeIndexKmaRequester` `convertUvItemsV5` L1209, `convertPollenItemsV3` L1446, `saveLifeIndex2` L1027, `_removeOldData` L1045, the per-kind `lastIssued` skip L1331/L1588 | `lifeIndexKmaController._fromLifeIndexDb2` L267 (`find({areaNo})`) via `appendData2` L336 |
| `rise_set` | S13a `kasi-area-rise-set` (one record per area and day) | `kasi.riseset.controller` `gatherAreaRiseSetFromApi` L771 (UTC days D-8..D+9, hourly at minute 55), `updateAreaRiseSetFromApi` L674 (a stored day is skipped), `_apiRaw2modelKasiRiseSet` L623, `_updateKasiRiseSet` L646 | `controllerTown.getRiseSetInfo` L3345 → `getRiseSetList` L582 (nearest stored document by `$near` without a bound, that location's days, `_model2RiseSet`; any error is `[]`, and legacy then computes rise/set) |
| `food_poisoning` | New keyless `mfds-food-poisoning` acquisition (`domestic::mfds`, one per 08:20/12:20/17:20 KST slot; its own keyless transport follows no redirect and stops reading at 1 MiB) | `lib/foodPoisoning.js` `fetchRisk` L60 (one GET, 10 s, 1 MiB, no retry), `slot`/`due` L127/L136, `parse` L22, `collect` L141 (`updateOne({_id, publication <= }, $set, upsert)`) | `foodPoisoning.append` L178 via `controllerTown` L2544 |

**Provider documentation and live shapes (2026-10-15).** UV is `LivingWthrIdxServiceV5/getUVIdxV5`
(3,851 areas, four pages of 1,000, `hN` strings); pollen is `HealthWthrIdxServiceV3`
(`getOakPollenRiskIdxV3`, `getPinePollenRiskIdxV3`, `getWeedsPollenRiskndxV3`). Outside a provision
period the service answers `99` ("자료제공기간 3월 ~ 6월" for oak and pine); legacy treats `03`/`99` as no
data and waits for the next publication, and server2 asks that issuance once. The pollen item
carries day+3 as `twodaysaftertomorrow` (empty in the 06 issuance, a grade in the 18 issuance);
legacy reads `todaysaftertomorrow` and never stores day+3. **Where the sources disagree:** the
fold keeps the provider's day+3 per area and kind (`LifeIndex::pollen_day3`) while the legacy
reader answer stays byte-identical. KASI `getAreaRiseSetInfo` answers one item per area and day
(`locdate` a number, times such as `"0640  "`, `------` for a missing event). MFDS `risk.do` is a
keyless web endpoint without a published API document; legacy `lib/foodPoisoning.js` is followed
(267 rows, `regDatetime` `YYYY-MM-DDHHMM`, a User-Agent is not required).

**Request time.** S3 reads run as owned tasks that update the process folds, one refresh of a
fold at a time (each starts from the committed fold and commits fold, applied set, cut and
consumed publication count together); a fold is read again after 60 s or as soon as an own
acquisition published, and a request waits for a read only until its deadline. A request whose
fold lacks the current three-hour UV slot, the latest 06/18 KST pollen issuance of a kind or the
current MFDS slot starts that owned acquisition (S13d `OwnedFlights`, 10-minute retry per key)
and waits only until its deadline; otherwise it answers with what S3 holds, the legacy output for
missing data. The life inputs are loaded only for a request the snapshot serves (after the grid,
mid and warning inputs), so a forwarded request starts no life acquisition. UV follows `taskUltrvV5`: the current slot, then each of the four earlier
candidates while a slot answers no data; no data keeps UV retryable. A UV acquisition takes about 9 s (four pages), so the request that starts it is
usually answered without the new issuance and the next request has it. A pollen issuance answered
with no data is not asked again; an MFDS slot is asked once (legacy `lastSlot`, a failure waits
for the next slot). KASI is captured while requests arrive (first pass at once, then hourly): one
S3 listing per area, then the missing area/days of the window, today's column first (legacy
iterates per area; the stored set is the same), an area stopping at its first failure; every S3
call of a pass has its own bound. The fold forgets days 30 days before the window but keeps every
location it ever stored with its coordinate (a cold read learns a location that has only older
days from its newest record), because legacy's unbounded `$near` still picks such a location. A
location's days are answered in day order (legacy's natural order: each gather appends its new
last day). `rise_set` answers `[]` until the first complete S3 read. Each fold keeps acquisitions completed
by the request instant; the cut never moves back. MFDS rows past `expireAt` are dropped (the TTL
index), which only affects dates before the reader's start.

Load: UV about 8 issuances a day of 4 pages (repeated within the 10-minute retry until an issuance
appears), pollen 2 calls a day per kind outside the season and 8 pages a day in season, KASI about
102 calls a day after the first window (1,836 for an empty S3), MFDS at most 3 calls a day.

Verification (local; test peers only): a pinned Node 16.20.2 + Mongoose 5.1.2 oracle
([provenance](../../server2/tests/domestic/fixtures/LIFE-PROVENANCE.md)) runs the legacy savers
and readers on synthetic inputs shaped like the live answers. The rebuilt `areaNoList` (3,703
documents), its 6 `findAreaNo` and 5 `findNearAreaNo` answers, the `lifeIndexKma2` documents and
28 `_fromLifeIndexDb2` answers over 12 days of issuances (crossing the 10-day removal, with
`_removeOldData` before each UV run as `taskLifeIndex2` orders it), the `kasiRiseSet` documents and 12 `getRiseSetList` answers, and
the MFDS rows and 7 reader queries match byte for byte; read back from the S06 S3 test peer with
empty memory the life answers, the 5 MFDS queries from the current date and the KASI answers match
too (KASI documents in another natural order: the capture reads areas in `getAreaList` order).
Loopback provider stubs show one acquisition for concurrent requests published before use, a slow
UV acquisition releasing the request and serving the next one, out-of-season pollen asked once,
an MFDS slot asked once after a failure, and the KASI capture continuing past failing areas. Live
on 2026-10-15 the server2 acquirer published UV (four pages), weeds pollen, KASI 서울 and the MFDS
table into the local peer, oak pollen answered no data, and the folds answered from them.

### S15b-3c AirKorea image hourly forecast (2026-10-15)

The `kma` snapshot now answers `air_forecast`, the last store call S15b-3 owed, so a request no
longer forwards for it. The KAQ source is gone (#2742), so only the AirKorea image forecast is
rebuilt. Its parity target is legacy master after #2757 ("Restore AirKorea image-derived hourly
forecasts", `91c77fcb`) and #2762 ("decode variable AirKorea forecast frames and cycle times",
`1d60f728`) (AK, relayed 2026-10-15); the `kaq` selection follows legacy #2771 (`915978bb`, S15b-3e)
below.

| Store call | Data | Legacy collection mirrored | tw_svc reader |
| --- | --- | --- | --- |
| `air_forecast("airkorea", station)` | New keyless `airkorea-image`/`airkorea-forecast-image` acquisition: the two GIFs of one announcement as one group (page 1 PM10, page 2 PM2.5, page 3 a JSON manifest of the two URLs, whose path dates the frames), dated by the announcement, from the first PM10 document's `imageUrl7` and the first PM2.5 document's `imageUrl8` of the stored dust forecast | `kecoRequester.getMinuDustFrcstDspth` L649-703 calls `AirkoreaHourlyForecastController.do` (L694): `_checkHourlyForecast` (`img.hourly.forecast.controller` L127), `_getImgPaths` (L67), `getDustImage` (`airkorea.dust.image.controller` L256: both paths through `airkoreaImageLayout.frameStart`), `getPixelMap` (`airkorea.finedust.image.parser`: `layout.validate`), `getDustInfo` (L89: `layout.station`), `_updateHourlyForecast`/`_makeHourForecast` (with the AirKorea date override)/`_updateDb`, `_removeOldData` (L116) | `controllerTown24h._getAirForecast` L1196 → `getForecast` (`img.hourly.forecast.controller` L149, `find({stationName}).sort({date: 1})`), `_insertForecastPollutants` L690 via `AirForecastList` L1264 |
| `air_forecast("kaq", station)` | none | — | `KaqHourlyForecastController.getForecast` L469 → `_findLatestMapCase` L231-239: no map case rejects with `Fail to get map case` |

**Decoder (`lib/airkoreaImageLayout.js`).** `source/gif.rs` ports (with omggif's MIT notice) the omggif 1.0.9 reader that
get-pixels 3.3.2 uses (every frame its own zeroed RGBA buffer, transparency and interlace as
omggif, index stores past a frame's buffer dropped as typed-array stores are). Unlike legacy, the
frame descriptors are bounded before any buffer exists (at most 120 frames, five days and about
twice the longest characterized animation, 4 Mi pixels in a frame
and 64 Mi in all), and an LZW code chain longer than the code table (a cycle, on which omggif never
returns) is an error; such a GIF stores nothing, as one legacy cannot decode.
`source/air_forecast.rs` ports the layout: only the characterized NIER 09km animation is accepted
(an 820×820 canvas equal to the size settings with any positive number of frames, the map and
geographic settings valid, and in every frame the 36 legend bands at x 680 opaque and inside each
characterized colour's neighbourhood: a largest-channel distance below half the distance to the
nearest other band); both image URLs must name a six-hour cycle
`/dustImage/YYYY/MM/DD/HH/09km/AQF.YYYYMMDD.NIER_09_01.{PM10|PM2P5}.2days.ani.gif` (HH 05, 11, 17
or 23, a real calendar date), whose first frame is HH + 1 KST, and each pollutant keeps its own
frame count and start (live: 48 frames for the 23-cycle, 54 for the 17-cycle). **Parity
exception (server2 safety bound, review S15b3c-R7):** an image whose first frame is after the
announcement's next day 00:00 KST is rejected before download and never folded (legacy accepts
any date relationship; live announcements name the previous day's 23-cycle or a same-day cycle,
which pass). The fold's eight-day read window relies on this bound. A station outside
the geographic box (`lat <= bottom`, `lon >= right` included) is skipped; otherwise its pixel and
then rings up to three pixels away inside the map rectangle are searched, and an opaque pixel
matching that frame's legend exactly, or nearest to one band inside that band's neighbourhood in
the frame's own legend, gives the band's lower threshold (the top band capped at 320 for PM10 and
200 for PM2.5, the bottom band 0); an hour without a match stores nothing. Rows
carry `dataTime` as the KST text and `date` as that hour's UTC instant, upserted by station, date
and code; rows older than one day are removed. A missing or rejected path, an image that does not
download or does not pass the layout stores nothing for the run (legacy no longer stores one
pollutant without the other).

**Calibration.** The legacy names `AIRKOREA_KOREA_IMAGE_COORDI_TOP_LAT`, `_BOTTOM_LAT`,
`_LEFT_LON`, `_RIGHT_LON`, `_SIZE_WIDTH`, `_SIZE_HEIGHT`, `_MAP_LEFT`, `_RIGHT`, `_TOP`, `_BOTTOM`
(master `config.js` L89-105) are read as legacy reads them: an unset or empty value takes the
default (39.3769/32.6942/123.9523/130.6741, 820×820, map x 77..663 and y 75..794, ends exclusive),
the map through `parseInt` and the box through `parseFloat` for the pixel arithmetic, and the
layout checks through `Number` (a size other than 820×820, a non-integer or out-of-canvas map or
a degenerate box rejects every image).

**Difference from the earlier S15b-3c decisions (reported 2026-10-15).** Before #2757 this PR
decoded with the deployed calibration (map 78/663/80/798), a colour table rebuilt from the live
legend with each band's upper label as its value (PM10 top band 600) and the legacy 48-hour
timeline from the processing day, and stored one pollutant when the other had no image. #2757 and
#2762 are followed instead: their map bounds, a per-frame legend validated against the
characterized colours, lower thresholds, dates and frame counts from the image (six-hour cycles),
KST hours as UTC instants and both paths required. With the legacy table the current images left 9.4% (PM10) and 19.4% (PM2.5) of a 0.1°
map grid without a value; that was the reason for the earlier decision and is resolved by #2757's
legend handling.

**`kaq` requests (legacy #2771, S15b-3e).** The app always asks `airForecastSource=kaq`
(`client/www/js/service.weatherutil.js:87`, `web/src/direct-api.ts:173`) and shows the source the
response names (`controller.forecastctrl.js:389`, `tab-forecast.html:350-356`,
`controller.tabctrl.js:1231-1250` with `LOC_AIRKOREA_DESCRIPTION`; `web/src/Weather.tsx:712-721`).
S15b-3c first answered it with an AK-approved difference: AirKorea when no KAQ forecast existed at
all. Legacy #2771 (`controllerTown24h._getAirForecast` L1225-L1274 at `915978bb`) now does more,
and server2 follows it exactly.
- A `kaq` request uses the KAQ rows only when one of them is usable: a listed pollutant, a finite
  number of at least 0 and a valid KST `dataTime` (`KecoController._parseDateTime`). The row must
  also be after now and after the last observation, and at most a day after that observation.
- Otherwise, including a KAQ read error, the stored AirKorea forecast is used under the same
  condition, labelled `forecastSource: "airkorea"`.
- Otherwise the request gets no forecast and no error. An AirKorea read error ends the list.
- Selected rows are copied with their time formatted (`_formatAirKstTime`).
- `_insertForecastPollutants` (L711) keeps the day window after the last observation as KST
  epochs, keys rows by the formatted time and keeps a pollutant's first forecast even without
  observation history. These changes also apply to explicit `airkorea` requests, which otherwise
  keep their selection (no rows: `Fail to get forecast`).
- On server2 the KAQ source is gone, so a `kaq` request always reads the AirKorea forecast. The
  per-day summary is KAQ-only, and `getKecoDustForecast` still runs only for `airkorea` requests.
- The S15 oracle covers these cases with 13 recorded scenarios (`air-kaq-*`, `air-airkorea-*`).

**Request time.** A request that reads the forecast (`airForecastSource` absent, `(null)`,
`airkorea` or `kaq`) loads the station list and the dust forecast and reads the image fold. The
fold replays the image acquisitions of the last eight KST days (an announcement of day D names an
image whose first frame is at the latest D+1 00:00 KST, enforced above, with at most 120 hourly frames, and a row
lives one more day) in completion order as legacy `do` runs; acquisitions completed in the same
millisecond are told apart by their fetch group. A refresh reads the eight day catalogs (small control objects, no record body) and downloads only the acquisitions it does not
know, one S06 lookup each (a whole-day lookup would pass the 32 MiB read bound with three
acquisitions), decoding each before the next is read so at most one pair of raw images is held;
each is decoded once per station list. Refreshes are owned
tasks, at most every minute, and at once when the station list changed or an image acquisition of
this process ended (a failed S3 write may still have committed). A late acquisition of an earlier
announcement or day is therefore folded in completion order within a minute, as a cold reader
folds it. A request whose fold lacks the expected announcement (or, while that one's documents
name no acceptable pair, the previous announcement, which legacy processed when it was expected)
starts one owned acquisition of its images (S13d `OwnedFlights`, 10-minute retry, 60 s call
budget, 8 MiB per image) and waits only until its deadline; until the images are published and
decoded it gets the legacy output for missing data. A pair `getDustImage` rejects is never
fetched. The provider-supplied URLs are never fetched as given: their validated path is fetched on
the built-in image root `https://www.airkorea.or.kr/` (`gateway::runtime::Builtins::
airkorea_images`; tests build a loopback root). The acquisitions are demand-gated like the other
S15b-3 inputs: an announcement no request asked for while it was expected (or previous, before the
next one's documents appeared) is never stored. The GIFs are raw records of about 5-6 MB: regional
S3 takes them within the S06 3-second operation bound, while the shared local stack's test peer
caps objects at 1 MiB and cannot hold one. Load: two GIF downloads per accepted announcement.

Verification (local; test peers only): a pinned Node 16.20.2 oracle
([provenance](../../server2/tests/domestic/fixtures/AIR-FORECAST-PROVENANCE.md)) records get-pixels
3.3.2 frames of nine synthetic GIFs (a global palette, a sub-rectangle, a local palette with
transparency, interlace, a short stream, two streams longer than their frame, a full code table
and an 820×820 offset frame); the legacy master controllers' `arpltnhourlyforecasts` documents,
errors and `getForecast` answers over ten runs of characterized synthetic animations (a store,
its skip, a second announcement, a 54-frame 17-cycle, the next images, a missing PM2.5 path, a
broken legend frame, a 47-frame image, a 12 cycle, a removal) for eight stations, with Mongoose
5.1.2 over the in-memory collection double; and the 46 #2757/#2762 regression cases with their
own harness, plus its cycle-start arithmetic. The Rust
frames, rows, errors and answers equal them byte for byte. Read back from the S3 test peer with
empty memory the answers are the same; loopback stubs show one image acquisition for concurrent
requests published before use, a slow acquisition releasing the request, another host's
acquisitions (also a late one of the previous day) folded in completion order equal to a cold read
without a publication count change, a 23시 announcement kept until its rows expire, two
acquisitions completed in one millisecond both read, a new station list decoded at once, rejected
paths (another host, a 12 cycle, a missing PM2.5 path) never fetched and a failed download storing
nothing, an image starting after its announcement's next day neither acquired nor folded, GIFs beyond the decoding bounds and a cyclic LZW stream refused, and the three
`kaq`/`airkorea` cases above. The request-time tests here and S15b-3b's slow life acquisition
start at fixed instants (S15b-3d, 2026-10-16), not on the system clock: their stubs, the
acquirers' clock and the inputs' wall clock (`AirInputs`, `ImageForecasts` and `LifeInputs`
`with_clock`, the system clock by default) read a test clock that starts at that instant
(by default 2026-10-16 00:00:30 KST; the life test also at 12:30 KST) and advances at the real
pace. The dust-forecast stub answers the announcement's day and the next ones as the provider
does (before 05:00 KST the expected announcement is the previous day's 23시), and a test's live
acquirer has at most 4 S3 requests in flight beside the inputs' 8, below the test peer's 16
connections. The image stub parses its oracle fixture before the run: parsed inside a stub
handler, it held a runtime worker for seconds and an S3 publication passed the 3 s client
timeout, so the acquisition failed and was retried only after 10 minutes. Ignored sweeps (`cargo test --test domestic -- --ignored across_kst_boundaries`)
start the image tests at 23:59:59 (the run crosses midnight), 00:00:00.5, 04:58, 05:00:00.5,
08:19:59, 08:20:00.5, 12:00, 17:21 and 23:00:30 KST, and the life test at 23:58, 00:00:00.5,
04:58, 05:00:00.5, 08:18, 08:20:00.5, 12:00, 17:21 and 23:00:30 KST with the MFDS slot expected
at each (a new UV or MFDS slot between its two requests would legitimately be asked again).

Live on 2026-10-15 (settings from the operator's `server2/.env` read in-process, never printed;
records only in a local S06 test peer with room for the GIFs): the server2 acquirer fetched the
pairs the `11시 발표` documents named
(`/dustImage/2026/10/14/23/…`, 48 frames, 5.1/4.9 MB, sha256 `d2193d68…`/`26dba4f5…`, the #2757
evidence hashes) and the `17시 발표` documents named (`/dustImage/2026/10/15/17/…`, 54 frames,
6.2/5.9 MB, sha256 `638105c1…`/`2fdc6c7c…`) and published them with their manifests; the server2
decoder and the legacy master controllers (real get-pixels, the #2757 smoke harness) stored the
same 384 rows (from 2026-10-15 00:00 KST) and 432 rows (from 2026-10-15 18:00 KST) for the four
smoke reference points (Seoul, Daejeon, Busan, Jeju). On the loaded test machine a 6 MB write
to the Python peer outlasted the 3-second S3 operation bound (an ambiguous write); the check used
the 9-second maximum for the peer.

### S15b-4a request-time forecast acquisition (2026-10-15)

S15b-4a ([plan](../../plans/issue-2742.md#s15b-4a-request-time-forecast-acquisition)) acquires at
request time the forecast inputs that S15b-1 still forwarded. A missing input is no longer a
forward reason. The snapshot answers what is stored, the same way legacy answers from a collection
that lacks the data.

**Acquisitions** (`domestic/kma/source/fetch.rs`). Each runs on S13d `OwnedFlights`, keyed by
dataset and publication, and publishes its raw records through S06 before any request uses them.
The provider calls, publications and warning cycles run in their own tasks, with the legacy
provider timeouts. An owned bound (at most 600 s) stops tracking them but never cancels them.

The retry bound is claimed by whoever creates the flight, under the flight map's lock, so a
concurrent request joins the real acquisition. Failures count against the same bounds. A grid publication counts as stored only when legacy
collection would keep it. The collector must save its rows (an `invalidForecast` stays pending), and
a current observation must carry no recovery sentinel (`t1h` -50 or `reh` -1 is collected again,
`PastConditionGather._isInvalid`). Any other stored record stays eligible for the bounded retries.

| Input | When the request acquires it | Retry bound |
| --- | --- | --- |
| Latest grid publication (`getUltraSrtNcst`, `getUltraSrtFcst` at HH30, `getVilageFcst`) | Not in S3 for the cell | 5 minutes |
| Grid backfill (earlier publications: 23 current, 23 ultra-short, 7 short; S14 `schedule`) | Missing publications, in one owned pass per cell, family and latest publication (3 acquisitions in flight, 8 passes in their own pool); the request does not wait | Each pass at most hourly. Each publication shares the latest acquisition's flight and 5-minute retry bound. |
| Latest short RSS (`wid/queryDFS.jsp`) | Not in S3 for the cell | 5 minutes |
| Latest mid publications (`getMidFcst`, `getMidLandFcst`, `getMidTa` at the 06/18 `tmFc`) | A region legacy collects lacks the latest publication | 5 minutes |
| Forecast-zone list (`getFcstZoneCd`) | Once per process, like legacy's `getFromKma()` at start; a published list replaces the memory | per process |
| Warning cycle (`WarningCollector.gather`, S12) | Once per 3 minutes, legacy's cadence; never two at once | 3 minutes |

Retry keys are bounded at 65,536. Expired keys are pruned when the map doubles. Beyond the bound,
new acquisitions are skipped and S3 answers as stored.

**Request wait.** A request waits once for every late input: these acquisitions, the S15b-2
station observations and the S15b-3 AirKorea and life acquisitions. The shared bound is
`REQUEST_WAIT` (3 s), and it ends 500 ms before the request deadline. The warning-state read and
the air and life reads stop 300 ms before the deadline. The gateway's native attempt
ends at most 3 s after the request starts (`gateway::backend`), so the reads that remain and the
assembly still fit. The mid regions start as soon as the zone list is read. The grids, RSS, warning
cycle, air and life inputs run concurrently.

An acquisition that finishes after the bound serves the next request. If no zone list is stored
yet, `forecast_zone` answers `[]`. If the warning state cannot be read, `special_zones` returns the
legacy store error, and `getSpecialInfo` skips the section.

**Keys and quota.** The acquisitions use the process data.go.kr acquirer of S15b-2: legacy
`DONGNAE_SECRET_KEYS`, one S08 quota owner per key and KST day, with built-in 10,000 units (per key
and API since S15b-4q). Its key
rings now include `VilageFcstInfoService_2.0`, `MidFcstInfoService` and `FcstZoneInfoService`.

The warning requests follow legacy `kmaWarningRequester.get`. They start at the key that last
answered and move once around the list on an auth or quota error, or when that key's S08 budget
refuses. Each attempt is funded by its own key.

The data.go.kr root is built in (`gateway::runtime::Builtins`). There is no new setting.

**Load baseline** (successful single-page answers): 56 units per active cell and KST day (24
current, 24 ultra-short, 8 short) and 8 keyless RSS acquisitions, one per RSS publication
(legacy polls hourly). A cold cell adds up to 53 backfill units
once. Mid regions, warning cycles, the zone list, other S15b consumers, retries and extra pages
spend the same budgets. The open quota decision is in the
[plan](../../plans/issue-2742.md#open-decisions-and-limitations-s15b-4a).

**Verification** (local test peers and doubles only):

| Check | Result |
| --- | --- |
| Every input missing | One request is served without a forward and uses the current publication acquired for it |
| Next request | Repeats no acquisition; the backfill asks for 23 earlier hours once |
| Six concurrent first requests | Share one acquisition |
| Every forecast acquisition takes 6 s | The request returns within the shared 3 s bound (before: 15.2 s) |
| Forecast, life and AirKorea acquisitions take 6 s under a 3 s gateway attempt | Answered natively before the attempt ends, also through `KmaBackend` under the gateway's timeout (before: forwarded on a mid read timeout) |
| Two unregistered keys | The warning requests reach the third key and keep it (before: the first two keys repeated) |
| New hour while the previous latest publication is still being acquired or just failed | The backfill pass joins or skips it; one acquisition (before: two) |
| Stored current hours with `t1h` -50 and an incomplete short publication | Acquired again; valid hours are not (before: none were) |

The release `kma_smoke.py` answers natively in its `kma` phase. The provider calls were confirmed
live on 2026-10-15; see the plan for the list. The remaining forward reasons (unknown towns, a grid
outside KMA, the S15 declared forwards) belong to S15b-4b. Cold-cell latency belongs to S15b-4c.

### S15b-4q data.go.kr quotas per API and key (2026-10-16)

AK decision 5 (2026-10-16): S08 accounts data.go.kr calls per API and key, the way data.go.kr
allocates its daily quota.

**Why.** Every dataset page lists its own "개발계정" allowance per key, and an operating account
can raise it after a use case is registered. Until this change, S08 kept one budget per key and
KST day across every service the key called. That budget never exceeded one API's allowance, but it
let one API's traffic block all the others.

**Accounting.** S08 now keeps one quota owner per key, API and KST day, for both key lists:

- `DONGNAE_SECRET_KEYS` (KMA source);
- `AIRKOREA_SECRET_KEYS`.

The owner is a domain-separated SHA-256 of the key list name, the API path and the key
(`domestic::quota::quota_owner`), so the key itself is never stored. The request URL selects its
API (`DataGoKrApi::of_url`: the API path right before the operation, under any root).

**Key rings are unchanged.** Rotation and legacy AirKorea `withKeys` still keep one key position
per service. Only the budget behind each key is per API (`KeyRing::per_api`).

| API (path) | data.go.kr | Built-in units per key and KST day |
| --- | --- | --- |
| `1360000/VilageFcstInfoService_2.0` | [15084084](https://www.data.go.kr/data/15084084/openapi.do) | 10,000 |
| `1360000/MidFcstInfoService` | [15059468](https://www.data.go.kr/data/15059468/openapi.do) | 10,000 |
| `1360000/FcstZoneInfoService` | [15057111](https://www.data.go.kr/data/15057111/openapi.do) | 10,000 |
| `1360000/WthrWrnInfoService` | [15000415](https://www.data.go.kr/data/15000415/openapi.do) | 10,000 |
| `1360000/AsosHourlyInfoService` | [15057210](https://www.data.go.kr/data/15057210/openapi.do) | 10,000 |
| `1360000/AsosDalyInfoService` | [15059093](https://www.data.go.kr/data/15059093/openapi.do) | 10,000 |
| `1360000/LivingWthrIdxServiceV5` | [15085288](https://www.data.go.kr/data/15085288/openapi.do) | 10,000 |
| `1360000/HealthWthrIdxServiceV3` | [15085289](https://www.data.go.kr/data/15085289/openapi.do) | 10,000 |
| `B090041/openapi/service/RiseSetInfoService` | [15012688](https://www.data.go.kr/data/15012688/openapi.do) | 10,000 |
| `B552584/ArpltnInforInqireSvc` | [15073861](https://www.data.go.kr/data/15073861/openapi.do) | 500 |
| `B552584/MsrstnInfoInqireSvc` | [15073877](https://www.data.go.kr/data/15073877/openapi.do) | 500 |
| `B552584/ArpltnStatsSvc` | [15073855](https://www.data.go.kr/data/15073855/openapi.do) | 500 |

The values are the documented development allowances, read on 2026-10-15/16. The approved
operating allowances plug into `domestic::quota::OPERATING_UNITS` (one `(DataGoKrApi, units)` entry
per API). That list is empty until AK supplies the values; an entry replaces that API's default.
There is still no setting: legacy has no data.go.kr budget variable.

**Effects of the new owners.**
- Earlier S08 budget objects (owner hashes v1) are not reused. No production server2 budget was
  live.
- With several keys, each key still spends at most its own allowance per API. Legacy spends the
  same keys while it runs.

**Verification** (loopback stub and S3 test peer):

| Check | Result |
| --- | --- |
| Exhaust one key's short-forecast API | A further call of that API is refused by S08 without reaching the provider, while the same key still funds a mid-forecast call |
| The same scenario on master `a9b3a23d` | The mid call was refused with `Funding(Exhausted)` |
| Unit tests | Every keyed operation maps to an API of its service; each key and API has its own owner; the defaults equal the development allowances; `KeyRing::per_api` refuses invalid rings and an API without a budget |
| The province-average API (`ArpltnStatsSvc`, `AirKoreaOperation::Sido`) | Funded by its own budget (before the review fix: refused before HTTP) |

### S15b-4b-1 legacy replies outside the router list (2026-10-16)

S15b-4b-1 ([plan](../../plans/issue-2742.md#s15b-4b-1-legacy-replies-outside-the-router-list))
answers natively what the KMA assembly still forwarded without needing a provider. Two paths
still forward and need a geocoder: an unknown town and the `KR` remap (S15b-4b-2).

**Express replies.** Legacy `app.js` (L167-197) defines its error handlers with three arguments,
so Express does not use them as error handlers: every error reaches Express's default handler.
That is finalhandler 0.4.1 (`express` 4.13.4 in `server/package-lock.json`), running in production.

| Path | Reply |
| --- | --- |
| An escaped exception, and `next(err)` from `makeResult` or `insertSkyIconLowCase` | 500 `Internal Server Error\n` |
| The end of the router list (the legacy 404 middleware), or a path no `/addr/:region[/:city[/:town]]` route takes | 404 `Not Found\n` |
| A path parameter `decodeURIComponent` rejects (Express `decode_param`) | 400 `Bad Request\n` |
| `getAllDataFromDb` for a coordinate outside Korea (`res.redirect(_getUrlWithCoord(...))`, `controllerTown.js:170-174`, `:5648`) | 302 |

Comparison boundary for these replies. server2's gateway (`gateway::backend`) treats any non-200
backend reply as a dependency failure, the same way it treats a failed legacy hop. The one exception
is a 503 `EWEATHERUNAVAILABLE`, which none of these replies is. So for the public request, the gateway
answers the native reply the same way it answered the legacy one.

An exception thrown inside an asynchronous callback is a deliberate containment difference, not an
equivalent answer. In legacy, Node 16 ends the whole worker process by default (`uncaughtException`).
The legacy gateway loops back to its own port (`server/routes/gateway.js:145`), so the outcome
depends on placement:

- If the gateway request and the backend request ran in the same PM2 worker, that worker's death
  also closes the client's connection. The client gets no HTTP reply, and the worker's other
  in-flight requests are lost.
- If they ran in different workers, the surviving gateway sees its backend connection fail and
  answers its usual dependency error.

server2 contains the exception to the one request: the backend answers the 500 above, and the
gateway answers its dependency error. server2 never ends the process and never loses other
requests. The oracle's `query-malformed-escape` reply (500, `Internal Server Error\n`) is now
matched natively.

**`req.query`.** `domestic::kma::qs` ports `qs` 4.0.0 `parse` with Express 4.13.4's options
(`allowDots: false`, `allowPrototypes: true`), so bracket syntax, array indices,
`Object.prototype` names and empty keys are parsed as legacy parses them, not forwarded.

The port includes `__proto__` assignment: an object value becomes the prototype that property reads
fall back to. A query field named `hasOwnProperty` shadows the method that `checkQueryValidation`
calls, so the call throws and the legacy `catch` skips the defaults. The source decides which air
inputs to load from the same validated `req.query`.

The port equals the pinned Express on a recorded corpus of 8,025 queries
([provenance](../../server2/tests/domestic/fixtures/V8-DATE-PROVENANCE.md)).

**`Date.parse`.** `domestic::kma::dateparse` ports V8's date parser as shipped in Node 16.20.2
(V8 9.4): the ES5 ISO form, then the permissive legacy parser, followed by `MakeDay`, `MakeTime`,
`MakeDate` and `TimeClip`, with the process zone UTC. The V8 BSD notice is kept in the module. It
replaces the earlier subset, which forwarded any form it could not read.

The port equals the pinned binary on a recorded corpus of 20,388 strings
([provenance](../../server2/tests/domestic/fixtures/V8-DATE-PROVENANCE.md)), and on the table of
earlier pinned values. The oracle's `stn-small-year-datetime` (`0001-09-24 09:03`, which V8 reads
as 2024-01-09 09:03) is now matched natively. The KMA page dates use the same parser.

**Unpaired surrogates.** A JavaScript string can hold an unpaired UTF-16 surrogate, for example
half of an emoji cut by `substr`. Property names are canonical: two halves made adjacent name
the same property as the paired character. The date formatters' lengths, the date ordering and the
source's AirKorea slices count stand-ins the same way. The port keeps one as a stand-in code point (U+10F800 + offset, the
upper half of Supplementary Private Use Area-B). A real character in that range, from a request
field or a provider string, is kept as the stand-ins of its own two surrogates. Stand-ins are
therefore never ambiguous. It
restores the code unit wherever code units matter: `length`, indices, comparison, `===` and
`JSON.stringify`. The gateway serializer escapes a lone surrogate the way well-formed
`JSON.stringify` does, and two halves that become adjacent form their pair again.

A string is put in that form exactly once, where it enters the value layer: a request parameter
or query value, or provider and repository text (`Val::str`, `js::canon_str`). A string already in
that form is reused as it is (`Val::canonical`), and text that never enters the value layer, such
as the world-air fallback's provider strings, is written out unchanged.

Limitation: provider JSON with an escaped lone surrogate is rejected by the source's JSON parser,
while legacy `JSON.parse` keeps it.

**Legacy comparisons.** Since `req.query` values can now be arrays and objects, each comparison
keeps the legacy operator:

| Legacy code | Operator | A non-string value |
| --- | --- | --- |
| `_getAirForecast`: `forecastSource === 'kaq'` / `'airkorea'` | strict | Selects no source and adds no forecast, as when the forecast is loaded |
| `convertUnits`: `from == to`, temperature `to == 'F'` / `'C'` | loose | `['F']` converts like `'F'` |
| `convertUnits`: wind and pressure `switch (to)` | strict | Converts to `undefined`, so the member is omitted |
| The rounding after temperature conversion: `toTempUnit === 'F'` | strict | Not rounded |
| `AqiConverter.value2grade` / `value2index`: `air_pollutants_breakpoints[airUnit]` | property key | `['airnow']` reads the `airnow` table |
| The same functions: `airUnit === 'airnow'` (ppm to ppb), `airUnit == 'aqicn'` | strict / loose | `['airnow']` skips the ppb conversion; `['aqicn']` converts |

An object converts to a primitive through `OrdinaryToPrimitive`. Own or inherited query data
properties are not callable and are skipped. An array assigned through `__proto__` retains its
inherited `Array.prototype.toString`/`join`; conversion reads length and elements from the original
receiver. Thus `temperatureUnit[__proto__][]=F` converts 21.5 C to 70.7 F without strict integer
rounding, and the `(null)` variant receives the default unit.
`Object.prototype.toString` gives `[object Object]`, and `Object.prototype.valueOf` returns the
object itself. When neither gives a primitive, the conversion throws the legacy `TypeError`.

For example, `temperatureUnit[toString]=F` makes the `== '(null)'` test in `checkQueryValidation`
throw. The legacy `catch` then skips the remaining defaults, and `convertUnits` stops at its own
`catch`. Node 16.20.2 confirms these conversions.

**Grids outside KMA.** A town whose `mCoord` is not a KMA grid cell gets empty grid and RSS
collections. Legacy's `find` by `mCoord` returns no row, so no acquisition starts.

Provider-independent parameter validation and the synchronous `decodeURI(originalUrl)` guard run
before snapshot acquisition, in legacy order. Unsupported regions and malformed query escapes
therefore never read S3, call a provider, or forward to legacy. The direct S17 routes share these
native error outcomes and never forward storage failures or Rust defects. finalhandler replies
carry `X-Content-Type-Options: nosniff`, no ETag, and the legacy Content-Length even for HEAD.
The standalone S17 router recording's unmatched-path `Cannot GET ...` is not the full app's
404: `app.js` passes an Error with status 404, so production finalhandler emits `Not Found\n`.

**Defects.** A store answer the snapshot cannot give (`unavailable`), a reply that leaves inputs
of a replayed recording unused, or a Rust panic in assembly is a port invariant failure, not
legacy behavior. An Express 5xx still ends the reply early, so its later inputs are allowed to go
unused. The backend answers it as a dependency failure
and counts it in `server2_gateway_native_defects_total`. It never forwards. `LegacyOnly` is now a
test-only source.

Maintained diagrams: [gateway ownership and terminal errors](diagrams/server2-gateway.html)
([source JSON](diagrams/server2-gateway.sequence.json)) and the
[server2 overview](diagrams/server2.html) ([source JSON](diagrams/server2.json)) pin code evidence
to `f5184d5a`. Native errors terminate without a legacy hop; the selected legacy HTTP adapter
retains its bounded retries during coexistence. Explicit unknown-town and KR-remap forwards
remain S15b-4b-2 work and must be removed before go-live. S3 is authoritative; disposable RAM
and local disk caches are allowed, while bounded disk caching, packs and EC2 sizing remain
S15b-4c work rather than an implemented capability of this increment.

S16 integration retains captured `getPastMid` rows and its post-response summary sink for
successful compatible JSON routes. Native preflight errors bypass both the source and summary
sink; source failures, invariant failures and Rust panics still terminate as counted dependency
errors. The summary capture does not turn errors into legacy forwards.

**Verification** (local, no provider):

| Check | Result |
| --- | --- |
| All 85 oracle scenarios and the S02 goldens | Match with no declared forward (previously two) |
| The V8 corpus | Equal to Node 16.20.2, including TimeClip and offset-wrap edges |
| Legacy comparisons | Array and object query values: response regressions (`source_s3`, `air_s3`) and unit tests |
| Unit tests | Reply/Defect outcomes, `_getUrlWithCoord`, surrogate semantics against Node 16.20.2 values |
| The store-callback exception (`replay`) | Now the Express 500 |

### S10e legacy settings and server2/.env (2026-10-15)

[S10e](../../plans/issue-2753.md) ([spec](../../specs/issue-2753.md), #2753) applies AK's decisions of
2026-10-15: server2 reads the same variables and values as legacy `server/.env` and
`server/config/config.js`, from a copy at `server2/.env`; values that legacy does not have may be
few, clearly named server2 variables there. The rules of S10c still hold: no runtime mode or
verification flag, and no endpoint override for tests. Tests and smokes build other endpoints in
test code (`gateway::runtime::Builtins`, `S3Settings::from_vars_at`, `GeocoderConfig::from_vars_at`
and the test-only `loopback_server` example, which takes them as arguments).

**Loading.** The `server2` binary and the seed importers read `.env` from the working directory
(start them from `server2/`) with the rules of the legacy loader, `dotenv` 10.0.0: one `KEY=value`
per line, comments and `export` lines ignored, matching quotes removed (`\n` expanded inside double
quotes), other values trimmed, with the JavaScript whitespace set (a byte order mark is skipped), the last duplicate wins (the production file lists `OWM_SECRET_KEY`
twice), and a variable present in the process environment wins over the file. A missing file means
environment only; another read error stops startup without file contents. server2 never reads
`server/.env` or another legacy file. [server2/.env.example](../../server2/.env.example) lists every
variable server2 reads. Paseo copies `server2/.env` from the source checkout into a new worktree
([paseo.json](../../paseo.json); symlinks refused, existing files kept, mode 600, Git ignore
ensured). Smokes and tests run processes in an empty working directory and never read a real
`.env`.

| Concern | Variable | Rule |
| --- | --- | --- |
| Listener | `OPENSHIFT_NODEJS_IP`, `OPENSHIFT_NODEJS_PORT`, `PORT` (legacy) | As `config.js`: address default `127.0.0.1`, port `OPENSHIFT_NODEJS_PORT`, else `PORT`, else `3000`; an empty value is unset. Give server2 another port than the legacy origin during coexistence. |
| S3 | `AWS_ACCESS_KEY`, `AWS_SECRET_KEY`, `TWA_S3_REGION` (legacy); `SERVER2_S3_BUCKET` (server2) | Region default `ap-northeast-2`; endpoint built in (`https://s3.<region>.amazonaws.com/`); bucket and credentials required when any family is native. The importers use the same settings. Superseded by [S10f](#s10f-instance-role-credentials-and-the-server2-s3-region-2026-10-15): `SERVER2_S3_REGION` replaces `TWA_S3_REGION`, and unset keys select the EC2 instance role. |
| data.go.kr | `DONGNAE_SECRET_KEYS` (legacy) | Required with `kma` (ASOS ranges; since S15b-3b also UV, pollen and KASI; since S15b-4a the grid and mid forecasts, the zone list and warnings). Built in since [S15b-4q](#s15b-4q-datagokr-quotas-per-api-and-key-2026-10-16): each API's documented development allowance per key and KST day (10,000 for the KMA and KASI APIs), replaced by `domestic::quota::OPERATING_UNITS` once AK supplies the operating values. |
| AirKorea | `AIRKOREA_SECRET_KEYS` (legacy) | Read with `kma`; no usable key: stored records only. Built in since S15b-4q: 500 units per key, AirKorea API (`ArpltnInforInqireSvc` 15073861, `MsrstnInfoInqireSvc` 15073877, `ArpltnStatsSvc` 15073855) and KST day. |
| AirKorea forecast images (S15b-3c) | `AIRKOREA_KOREA_IMAGE_COORDI_*`, `AIRKOREA_KOREA_IMAGE_SIZE_*`, `AIRKOREA_KOREA_IMAGE_MAP_*` (legacy) | Read with `kma` as master `config.js` L89-105 and `airkoreaImageLayout` read them; unset or empty: the characterized defaults (820×820, map 77/663/75/794). The image root is built in (`https://www.airkorea.or.kr/`); the images are keyless. |
| Geocoder | `GEOCODER_KAKAO_KEYS`, `GEOCODER_GOOGLE_KEY` (legacy) | Kakao keys parsed as legacy `keys.parseKeys` (nonempty strings of a JSON array; anything else gives no key). Endpoints built in; legacy's test-only `GEOCODER_*_BASE_URL` are not read. Built in: Kakao 100,000 units per key and UTC day (Kakao quota page, 100,000건 per day), Google 322 per UTC day (Google documents no daily quota; 10,000 free Geocoding events a month ÷ 31). |
| Visual Crossing | `VC_SECRET_KEY`, `VC_DAILY_RECORD_LIMIT` (legacy) | Read as JavaScript `Number` (`50.0`, `5e1` are 50); a positive finite limit admits `floor(limit)` records a day (at least 1). 0, unset, not a number or `Infinity` is "no budget" in legacy, here the documented free plan, 1,000 records a day. Quota owner derived from the key. |
| World air | `GOOGLE_SECRET_KEY`, `OWM_SECRET_KEY`, `WAQI_SECRET_KEY`, `AIR_GOOGLE_MONTHLY_CAP`, `AIR_OWM_MONTHLY_CAP` (legacy) | Legacy chain keys and free caps (defaults 10,000 and 1,000,000; whole numbers or startup fails, as `config/air.js`); a provider takes part with a legacy-valid key; calls stop at 95 % of the cap, so a cap of 0 leaves it out. WAQI: 1,000 requests a second over 31 days (aqicn.org/api). Quota owners derived from the keys; endpoints built in. |
| Coexistence | `SERVER2_GATEWAY_LEGACY_URL`, `SERVER2_NATIVE_FAMILIES`, `SERVER2_WORLD_VERSIONS` (server2) | Unchanged S10/S10c/S15 routing; temporary, removed with legacy retirement. |

Removed: `SERVER2_BIND`, `SERVER2_METRICS_BIND` (metrics listen on loopback at the public port + 1,
or an ephemeral port with port 0), `SERVER2_WORKER_THREADS`, `SERVER2_BLOCKING_THREADS`,
`SERVER2_CPU_LIMIT`, `SERVER2_INFLIGHT_LIMIT`, `SERVER2_CACHE_BYTES`, `SERVER2_CONNECTION_LIMIT`,
`SERVER2_CONNECTION_SECONDS` (built-in defaults 2, 4, 2, 40, 16 MiB, 128 and 9 s, 12 s with the
gateway; no documented operation needs another value), `SERVER2_S3_REGION` (read again since S10f as the server2 bucket region), `SERVER2_S3_ENDPOINT`,
`SERVER2_S3_ACCESS_KEY_ID`, `SERVER2_S3_SECRET_ACCESS_KEY`, `SERVER2_DATA_GO_KR_KEYS`,
`SERVER2_DATA_GO_KR_DAILY_UNITS`, `SERVER2_DATA_GO_KR_URL`, `SERVER2_DATA_GO_KR_BASE_URL`,
`SERVER2_KMA_BASE_URL`, `SERVER2_KMA_WEATHER_BASE_URL`, `SERVER2_AIRKOREA_DAILY_UNITS`,
`SERVER2_GEOCODER_KAKAO_DAILY_UNITS`, `SERVER2_GEOCODER_GOOGLE_DAILY_UNITS`,
`SERVER2_WORLD_VC_DAILY_UNITS`, `SERVER2_WORLD_VC_QUOTA_ID`, `SERVER2_WORLD_VC_URL` and
`SERVER2_WORLD_AIR_<P>_KEY|MONTHLY_UNITS|QUOTA_ID|URL`. The S10b rule that refused a configured
lifetime at or below the 9-second deadline has no input left; the built-in gateway lifetime is 12 s.

Quota owners changed with the settings: Visual Crossing and air owners are now domain-separated
SHA-256 values of the keys (`server2-world-quota-v1`), so an S08 window started under a configured
owner is not continued. The built-in quotas are documented provider limits, not measured demand
(#2724 still owns geocoder measurements).

Open questions for AK: whether `SERVER2_S3_BUCKET` should name a new server2 bucket or reuse the
legacy weather-data bucket `TWA_S3_WEATHER_DATA_BUCKET_NAME` (no legacy consumer; server2 keys use
their own `raw/v2/`, `index/v2/`, `budgets/v2/` prefixes, but mutable catalogs need bucket
Versioning); whether the legacy CloudFront credentials `AWS_ACCESS_KEY`/`AWS_SECRET_KEY` hold the S3
permissions server2 needs; and the Google geocoder and unset-`VC_DAILY_RECORD_LIMIT` built-ins,
which are stricter than legacy (no budget).

Verification (local, test peers only): a test builds every native family from legacy names plus
the coexistence entries and `SERVER2_S3_BUCKET`, and asserts no other `SERVER2_*` name is read; the
dotenv parser follows dotenv 10.0.0 cases; the release binary reads `.env` from its working
directory with process precedence; the release smokes run with the new names in empty working
directories; and the configuration built in-process from the operator's `server2/.env` resolved
every provider key without printing values.

### S10f instance-role credentials and the server2 S3 region (2026-10-15)

[S10f](../../plans/issue-2759.md) ([spec](../../specs/issue-2759.md), #2759) applies AK's decisions
of 2026-10-15: server2 has its own Seoul bucket with Versioning and signs S3 requests with an EC2
instance role instead of static keys. The account root created the bucket
`tw-server2-141248341265-apne2` (Versioning, SSE-S3 AES256, Block Public Access, BucketOwnerEnforced,
the [bucket policy template](../../server2/deploy/staging/bucket-policy.template.json)) and the role and
instance profile `tw-server2-runtime` (trust `ec2.amazonaws.com`; inline policy
`tw-server2-runtime-s3` = the [role policy template](../../server2/deploy/staging/role-policy.template.json),
which now includes `geocode/address/v1/*`). Both templates equal the live policies (read back
2026-10-15). The role is not attached to an instance yet;
[prerequisites.json](../../server2/deploy/staging/prerequisites.json) records the ARNs.

| Concern | Variable | Rule |
| --- | --- | --- |
| Credentials | `AWS_ACCESS_KEY`, `AWS_SECRET_KEY` (legacy) | Each is unset when absent, empty or the legacy `config.js` placeholder `You have to set key of AWS` (the value in the operator's `server/.env`). Both unset: EC2 instance role. Both set: static keys, as before. One without the other: configuration error before binding. |
| Region | `SERVER2_S3_REGION` (server2) | Default `ap-northeast-2`; selects `https://s3.<region>.amazonaws.com/`. The legacy `TWA_S3_REGION` (`us-east-1`, the 2018 `twa-weather-data` bucket) is not read. |
| Bucket | `SERVER2_S3_BUCKET` (server2) | Unchanged; `tw-server2-141248341265-apne2` in the operator's `server2/.env`. |

**Instance role.** The built-in IMDSv2 root is `http://169.254.169.254`. A refresh is three requests:
`PUT /latest/api/token` (`X-aws-ec2-metadata-token-ttl-seconds: 21600`), the role name from
`/latest/meta-data/iam/security-credentials/`, and that role's credentials document (`Code`
`Success`, key, secret, session token, `Expiration`). Credentials are fetched on the first S3
operation, not at startup, and cached; they are refreshed when they expire within five minutes (EC2
publishes new role credentials at least five minutes before expiry). A failed refresh keeps
unexpired credentials; refresh attempts after a failure (including one cancelled by a caller's
deadline), or after credentials that were not rotated yet, are at least 10 s apart. Each IMDS
request has a 1 s connect and 2 s total timeout, and one refresh takes at most 3 s. Without usable credentials an S3 operation fails as a storage transport
error before any S3 request; an IMDS status is never reported as an S3 status, so a missing role does
not look like a missing object. Every S3 caller (raw and catalog stores, budgets, warnings, world
weather and air, the KMA input source, demand state and the seed importers) draws credentials from
the transport's `RefreshableCredentials` handle; the gateway shares one transport, so the process
keeps one credential cache. The raw store and catalog publication and repair obtain credentials
before their first write (`ObjectTransport::ready`), so a credential failure there is a definite
`Transport`/`Timeout`, not an ambiguous write. Every PUT then signs with a cached credential
that outlives its 30-second signed URL by 5 s, without a refresh, so a started write does not
wait for IMDS (with nothing cached, it obtains credentials like a read). This supersedes the S05
[records guide](../operations/server2-records.md) statement that callers own instance-role
acquisition; `RefreshableCredentials::new` and `replace` remain the caller-managed static path.
Credential values have no Debug output and are never logged or printed.
Tests reach a loopback IMDS double only through the test-only builders
`S3Settings::from_vars_with` and `Builtins::instance_metadata`; no variable selects the IMDS root.

**Conditional writes.** Every server2 write already sends the conditions the bucket policy
requires: raw records `If-None-Match: *`; catalogs and group descriptors `If-None-Match` or
`If-Match`; `state/demand/grid` and `budgets/v2` documents `If-None-Match` or `If-Match`. Geocode
address projections (`geocode/address/v1/`) are unconditional PUTs; the bucket policy does not
require a condition there, and the runtime does not construct that store yet.

**Readiness check.** `cargo run --locked --release --example s3_readiness -- LABEL` (from `server2/`)
runs server2's real stores against the configured bucket: 404 for HEAD/GET of absent `raw/v2` and
`index/v2` keys, a conditional raw create and reconciled repeat, two catalog revisions and a cold
lookup, conditional create, refused repeat (412) and CAS update of `budgets/v2` and
`state/demand/grid` documents, and, with the instance role, 403 outside the server2 prefixes. It
writes under source/prefix `s10f-live/LABEL` (plus content-addressed group descriptors), prints
statuses and keys only, and deletes nothing.

Verification: the Red test `s3_credentials_and_region_follow_s10f` failed on the base (the endpoint
followed `TWA_S3_REGION`; absent keys were a configuration error). Unit tests run the IMDSv2 client
against a loopback double (token header, role listing, session token, refresh window, failure and
cancellation spacing, invalid documents); integration tests write and read a raw record and serve
the S02 geocode golden with budgets through the S3 test peers with role credentials, and show that
an IMDS 404 sends no S3 request and is not an absent object. The live check on 2026-10-15 ran
`s3_readiness` with the operator IAM user against `tw-server2-141248341265-apne2`: 404 for HEAD/GET of
absent `raw/v2` and `index/v2` keys, conditional raw create and repeat, two catalog revisions with
two retained versions, budget and demand create/412 repeat/CAS update, and 403 (explicit bucket
policy deny) for an unconditional `raw/v2` PUT; see the
[sanitized evidence](../evidence/aws/server2-s3-readiness-2026-10-15.json). Not verified: the real
IMDS on EC2 and the runtime role's 404/403 statuses, which the same tool checks at deployment.

### S16 daily summaries and the last-year lookup (2026-10-15)

[S16](../../plans/issue-2701.md) ([spec](../../specs/issue-2701.md), #2701) adds `server2::summary`. Per
O-13 it stores daily summaries and an internal last-year fallback only; no response field, API
version or UI changes. Legacy stores no summary: the grid values are the rows the tw_svc assembly
derives at `getPastMid`, so S16 adds storage, not a new computation.

| Source | Values | Complete when | Written by |
| --- | --- | --- | --- |
| `grid` (key: the town) | The `_getDaySummaryList` row `getPastMid` merges (`controllerTown.js:2697`, `:5530`): `taMax`, `taMin`, `t1d`, `reh`, `rn1`, `sky`, `pty`, `lgt`, `wsd`, AM/PM fields, `observationHours` | at least 18 valid `t1h` hours; the `00:00` hour counts for the previous day (`:5539`) | the recorder, for KST today-6..today-1 (today-2 before 01:00, while yesterday's `2400` hour is still the live minute-updated row) |
| `asos` (key: station) | The `policy.normalize` daily row (`taMin`, `taMax`, `t1d`, `reh`, `rn1`, `wsd`) | `taMin`, `taMax` valid and ordered; rain optional | the recorder (S15b-2 ranges) and the lookup (on demand) |
| `vc` (key: 0.02-degree cell) | `taMin`, `taMax`, `t1d` (°C), optional `rn1` (mm), `observationHours`, `localHours` from a body fetched after the local day ended | temperature in at least 75 % of the local hours (23/24/25, IANA zone) | the lookup, from stored raw VC records |

Native v000901, v000902, v000903 address routes and v000803 town routes record the same
`getPastMid` rows. v000705 routes do not record grid summaries: their current-data repair
prefix differs from the S16 baseline. The shared backend preserves each route response.

Grid summaries are keyed by town, not grid: `mergeCurrentByStnHourly` corrects a town's rows with
its own stations and ASOS mapping, so towns of one grid can differ. AK approved town keys and
lookup-only VC derivation on 2026-10-16 (decision 6); revision volume is measured after S15b-4.

**Objects.** `summary/v2/{source}/{key_sha256}/{YYYYMMDD}/{latestFetchedMs:013}-{count:06}-{revision_sha256}.json`,
created with `If-None-Match: *` (a 412 counts only when the stored bytes are identical) and never
deleted; the role has no delete permission and no lifecycle rule exists, so retention is unbounded
(at least the three years of D6/O-4). The body records the canonical key, date, values and the
input set (`count`, `latestFetchedMs`, SHA-256 of the sorted input identity lines, per-family
counts). The newest revision is the greatest name whose body verifies; a later newest input sorts
later.

**Complete inputs and late revisions.** The KMA snapshot records summary inputs only when its
reads were complete; a listed group that S06 excludes (not eligible, or a raw body missing) makes a
grid, station-page, registry-seed, ASOS or VC read partial. Grid families are read from published
catalogs; since S15b-4a a missing latest publication is acquired within the request's single wait
bound and becomes an input (with its stored fetch time) when it arrives in time; one that misses
the bound is not an input, so a stored day may be recorded without it and revised by a later
request, as are the late inputs of the backfill pass the request does not wait for;
the station fold the answer used is still the current one, every day of the 8-day page window was
read and its latest read did not fail, and no S3 load, fold, geocoding or unfolded page is pending;
the history answer has no `cache-read-*` reason; and the ASOS acquisitions it answered from were
read under the same lock as "no recovery run in flight, no failed read". Input identities are the
acquisitions themselves: grid publications and ASOS ranges with their fetch time and content hash,
and the station pages the fold applied with their fetch time and raw hash, plus the station
registry (seed, window pages and geocodes decide station selection and the ASOS mapping of every
date) as its content hash and the instant it first appeared; a failed registry seed read blocks
recording. S15b-2 keeps the first
page acquired for an hour (one acquisition per hour); a later acquisition of the same hour is not
applied by the assembly, so it is not a summary input either. An ASOS S3 reload still running when
the history answer is built also blocks recording. After a natively served response the backend hands the `getPastMid` rows
(a JSON copy taken before later steps mutate them; the response is unchanged) to the recorder, which
runs outside the request (two tasks, serialized, 30 s each; more are dropped and repeated by a later
request). Per source, key and date it skips an input digest it already examined; a new digest lists
the date in S3 (another process may have written), and a new revision is written when its newest
input is newer than the stored newest revision's (also with equal values, so the stored order follows
the inputs) or as new with other values. An older input set never supersedes a newer one. A late
input therefore recomputes the day; an older input set never supersedes a newer one.

S16 also changes one S15b-2 behavior: a station-page day whose `aws-hourly` or `city-obs` catalog
is not listed now reads as empty. Before, the absent catalog's lookup answered "incomplete", so a
day without city pages never loaded its hourly pages from S3 and was read again on every load.

**Last-year lookup** (`summary::Lookup::last_year`, not wired to a route). The same date a year
earlier (Feb 29 → Feb 28), then ±1..±3, earlier first. At each date: the town's grid summary, then
the station's ASOS summary (when missing, one data.go.kr daily range `[base-3, base+3]` through the
funded S15b-2 acquirer, published to S06, its complete days stored; at most once per station and
range a day; a concurrent lookup waits for that acquisition and a cancelled one releases it), then
the cell's VC summary (derived from the stored raw VC records each time and stored as a new revision
when newer records give other values; the VC provider is never called). The first complete summary
wins. A failed S3 read, a provider failure or another lookup's unfinished acquisition at the deadline
returns an error rather than a lower-priority answer; `03` means absent.

**Load (estimates, not measured).** A town request with new inputs examines at most 12 candidates,
each with one LIST and at most one GET. After a day ends, only a few new inputs concern it (its
`2400` hour, late station pages, ASOS ranges, a registry change; a process start also restarts the
registry instant), so a few revisions of about 1 KiB each: 2,000 requested towns at 3 revisions a day give about 2.2 M objects and 2.2 GB a
year. Unit prices are not assumed. An on-demand ASOS range is one data.go.kr call under the S08
`DONGNAE_SECRET_KEYS` budget. S16 uses no local disk (the 2026-10-15 disk-cache rule is not
needed): the recorder keeps at most 65,536 memory entries of a few hundred bytes (about 15 MiB at
most), and S3 stays the only store.

Verification (local, test peers only): unit tests for keys, bodies, names, input relevance,
completeness (17/18 grid hours; inverted, missing and sentinel ASOS extremes; 23/24/25-hour New York
days needing 18/18/19 hours), store revisions, the recorder (late inputs, older inputs, equal
values, cold process, failures) and the lookup order and failure rules; end-to-end over the S06
loopback S3 peer with the native backend (24-hour day stored including its `00:00` hour, 17-hour
day not stored until its late 18th hour, a late `2400` hour writing a second revision, no record
while an ASOS run is in flight, ASOS acquired once and published, VC derived from a stored raw body).
Live on 2026-10-15: one ASOS daily call for station 108, 2025-10-12..18 (`00`, 7 items, 0.30 s),
kept as the test fixture.

### S18a push registration state (2026-10-15)

[S18a](../../plans/issue-2703.md) ([spec](../../specs/issue-2703.md), #2703) ports the used push
registration routes and moves their state from MongoDB to server2-owned S3 state. Delivery (S18b)
and notices (S18c, no legacy route exists yet; #2623 is open) are separate. The
[declaration](../../server2/config/tasks/S18a.json) lists the paths. The routes are a library
service with a loopback router, like S12; process wiring and the family switch belong to S20.

**Routes.** `POST`, `PUT` and `DELETE` on `/v000705/push` and `/v000902/push`
(`routes/v000705/routePushNotification.js`, one router mounted on both), `POST /v000902/push-list`
(`routes/v000902/route.push.update.list.js`), and the `cors()` preflight for every method. The
observed groups are `PUT`/`DELETE`/`OPTIONS /v000902/push`, `POST /v000902/push-list` and
`POST /v000705/push`; the other method/mount pairs share the same handler. The port follows the
legacy request path step by step: body-parser 1.20.6 `json()` (100 kb, strict, `utf-*`
charsets) and `urlencoded({extended: false})` (a null-prototype object, so `hasOwnProperty` is a
TypeError), the version router's `decodeURI(req.originalUrl)`, Express case-insensitive mounts,
the handlers' validation in order (TypeError messages as V8 prints them), `initUnits`,
`updatePushInfo`/`updateAlertPush`, `lib/pushStore/mongo.js` (`keyQuery`, `tokenQuery`, upsert,
`multi` token renames, `remove`), Mongoose 5.1.2 casting (query keys cast last first; `CastError`
text via `util.inspect`, including the `MongooseArray` form; ` for model "x"` on query casts) and
the saved document's key order and `minimize`, and the `geo` field's `2d` index bounds (a point
outside [-180, 180) is a write error, as MongoDB refuses it; the server message text
`point not in interval of [ -180, 180 )` is not re-verified against a live 3.4 server). Answers are `res.send` (JSON or `text/html`, weak
ETag) or the production `finalhandler` (status text, `nosniff`). Write results are the MongoDB
3.4 write-command reply core (`{n, upserted?, nModified, ok}`, delete `{n, ok}`); replica-set
metadata (`opTime`, `electionId`, `$clusterTime`) is not reproduced and the app ignores the body.

**Deliberate differences.** Update operators in a body (`$inc`, ...) are dropped and operator
query values (`{"$ne": ...}`) are cast errors, so a body cannot run MongoDB operators (legacy
passed them through). A castable `_id` in a body is ignored (MongoDB refuses to change `_id`; an
upsert would take a client-chosen id). Items of one `push-list` request that target the same key
apply in list order (legacy ran them concurrently and could duplicate an alert). Date strings in
date fields follow Mongoose (`new Date(string)`) for the ECMAScript date-time format and the
millisecond rule; V8's legacy free-form forms (`Oct 1 2020`, ` 2020`, `2020-02-30`, unsigned
six-digit years) are cast errors. Only `precipAlerts`/`airAlerts.pushTime` can carry a client date
(`updatedAt` is set by the server) and the app never sends them. The session cookie is not set
(as S12).

**State.** Records keep the legacy document shape (field names, BSON kinds, `_id`, natural
order), so the copied registrations and new ones are one data set. Memory holds each record as
its encoded document plus the five fields queries use (`type`, `cityIndex`, `id`, `fcmToken`,
`registrationId`) and token indexes: the 76,442 production registrations take about 65 MB. One
writer task orders every change (D01): a request is planned against the current state in a
transaction overlay, and one that changes state is answered only after its journal entry is in
S3. Before planning, the writer reads the next journal sequence so another process's entry
(the importer, an overlapping replacement) is applied first.

| S3 object (`index/v2/push/state/`) | Write | Content |
| --- | --- | --- |
| `journal/{seq:012}.json` | `If-None-Match: *` | header line, then one line per changed record (final state or removal) |
| `snapshot/{seq:012}-{nonce}/{part:04}.json` | `If-None-Match: *` | header line, then record lines (2 MiB parts) |
| `head.json` | `If-Match` (or `If-None-Match: *`) | snapshot sequence, natural-order counter, parts with sha256 and counts |

A journal sequence belongs to exactly one entry, so two writers can never both commit it; the
loser gets `412`, applies the other entry and plans again. An unknown write outcome (timeout,
transport error, 5xx) is read back: our body means committed; absent means a `void` entry is
written conditionally so the original can never commit later; if that cannot be decided, the
writer accepts no further change until it can (a later read that finds the entry applies it,
durable though never acknowledged). A 4xx refusal and a credential failure before sending are
not commits. A removal entry keeps the record's `_id`, and snapshots keep removed `_id`s, so a
registration removed through the API is never re-created by a later import. Restore reads the head, its parts (at most 8 reads at once, digests and counts
checked) and the journal after it until the first absent sequence; a failed restore leaves the
service unready and retries every 5 s. A snapshot is written after 1,024 entries (each part
upload bounded to 8 s); a failed snapshot leaves the journal authoritative and is retried after
the next commit, so while snapshots keep failing the journal to replay grows beyond 1,024
entries. Other S3 operations have a 2 s bound; a request waits at most 9 s (the app's timeout is
10 s). State is memory and S3 only: no local-disk copy is made, so device
tokens are not written to disk (AK's 2026-10-15 disk-cache rule changes nothing here).

When the change cannot be made durable in time (S3 refusal, void, unready state, full queue or
the wait expiring), the route gives its legacy store-error answer with the message
`push state storage unavailable`: `POST /push` and `PUT` 500, `DELETE` 501, and `push-list` 200
with `null` for each affected item (the legacy batch helper swallows store errors). Validation and
cast-error answers are unchanged because they precede any store call.

**One-time copy.** `push_registration_convert PUSHES ALERTPUSHES IMPORT REPORT` (offline) reads
`mongoexport` output of `pushes` and `alertpushes` (lines or `--jsonArray`; relaxed, canonical or
legacy Extended JSON) and writes canonical import lines (owner-only file mode) and a report with
counts, positions and reasons only. A document is malformed when it is not JSON, lacks an
ObjectId `_id`, repeats an `_id`, has a model field of the wrong BSON kind, uses an unsupported
Extended JSON type, or has neither `fcmToken` nor `registrationId`; fields the model does not
declare are kept. `push_registration_import IMPORT` (server2 S3 settings, as the S12 importer)
restores the state and merges by `_id`. Each imported record keeps the sha256 of the legacy
document it came from, so a later run can tell who changed it: absent records are inserted in
export order; a record removed in server2 stays removed; identical is unchanged; when only server2
changed it (the legacy document equals the one imported before) server2 is kept; when only legacy
changed it, it is replaced; when both changed, a newer legacy `updatedAt` wins, otherwise server2
is kept (no date is never "newer"). It commits 1 MiB journal
entries, re-plans after another writer's entry and writes a snapshot. A re-run with the same file
writes nothing. The final run before cutover is an S20 operator step.

**Verification.** The [oracle fixture](../../server2/tests/state/fixtures/PROVENANCE.md) replays
115 requests in 9 scenarios through the legacy routes (Node 16.20.2, Express 4.13.4, Mongoose
5.1.2 over an in-memory collection double; synthetic data); server2 matches status, body bytes,
headers (except date, connection and the session cookie) and both collections after every
request, and the final state after an empty-memory restore. Fault tests cover refused, lost,
committed-but-lost and unreadable writes, a concurrent writer, two writers racing for the same
sequences (no false success, contiguous journal, converged state), 24 concurrent requests (contiguous
journal, identical restore), multi-part snapshots, a corrupt snapshot (unready, legacy store
errors) and a hanging store (answer within the wait, nothing acknowledged late); one test runs
the journal over `HttpS3Transport` and the owned S3 peer with injected `commit500`,
`drop-commit` and `conflict409`. A read-only copy of the production collections (2026-10-15,
MongoDB 3.4.15; 42,226 alarms and 34,216 alerts) converted with no malformed document, imported
into a loopback S3 peer in 2.0 s (64 journal entries), restored in 1.3 s with every record equal,
and a re-run changed nothing. The raw export and converted file were deleted after the check; no
token or record was committed or logged. No push provider was called.

### S18b-1 scheduled alarm delivery (2026-10-16)

[S18b-1](../../plans/issue-2703.md#s18b-1-scheduled-alarm-delivery) ports the legacy alarm worker
(`server/controllers/controllerPush.js` `start`, `sendPush`, `sendNotification` and the message
builders; started only in `SERVER_MODE=push`, `server/app.js:140-147`) onto the S18a state. It is a
library worker like the routes; process wiring and the switch from the legacy push process belong
to S20, so legacy and server2 never both send. Conditional alerts (S18b-2), the push warning feed
deferred by S12 (S18b-3) and notices (S18c) are separate PRs. The
[declaration](../../server2/config/tasks/S18b-1.json) lists the paths.

**Minute.** At each UTC minute boundary (legacy: `setInterval` 60 s from process start, so a
minute could be skipped or repeated) the worker: removes duplicate registrations
(`lib/pushStore/mongo.js` `removeDuplicates`), selects alarms with `pushTime` equal to the minute's
seconds of day and `enable !== false` in natural order (`getAlarmsByTime`), keeps those due on the
client's local weekday (`_filterByDayOfWeek`, `kmaTimeLib.toLocalTime`), claims the minute in the
ledger, delivers with at most six in flight (`async.mapLimit(..., 6, ...)`), writes the minute's
result, then removes records not updated for 60 days and stamps records without `updatedAt`
(`_removeOldList` through `makeRemoveSelector` and `updatePushInfo`). Store changes go through the
S18a writer as internal operations (journal before effect). A minute with no due alarm writes no
ledger object. A minute whose state is not restored
is neither claimed nor sent. A minute missed while no process ran is not caught up.

**One delivery.** As `sendNotification`: language default `ko`, `initUnits`, package default
`todayWeather`; the record selects `GET {SERVICE_SERVER}/v000902/kma/coord|addr/...` or
`/v000902/dsf/coord/...`, or first `GET {API_SERVER}/geocode/v000903/coord/...` (city 0 with
`geo`, or no known source), with the units query and `Accept-Language` (legacy names and defaults,
`config.js` `serviceServer`/`apiServer`). The title and text are the legacy builders' output
(`_makeKmaPushMessage`, `_makeDsfPushMessage`, `_makePushAirMessage`, `_getAqiStr` with V8's sort
and the legacy comparator, i18n 0.8.3 lookup over an embedded subset of the legacy locale files
with per-file sha256 provenance). The FCM HTTP v1 request is the firebase-admin 5.13.1 `send`
request: `POST https://fcm.googleapis.com/v1/projects/{project}/messages:send` with
`{"message":{"notification":{title, body},"data":{"cityIndex"},"token"}}` and a cached OAuth
token from an RS256 service-account assertion (the scopes and claim order of firebase-admin; one
hour; refreshed when less than a minute is left). Service accounts are server2 settings
(`SERVER2_FIREBASE_TODAYWEATHER`, `SERVER2_FIREBASE_TODAYAIR`). Responses are classified with
firebase-admin's rules (`FirebaseMessagingRequestHandler`, `MESSAGING_SERVER_TO_CLIENT_CODE`): an
unregistered token (`NOT_FOUND`, the documented
[`UNREGISTERED` 404](https://firebase.google.com/docs/cloud-messaging/error-codes)) disables every
alarm of that token (`disableAlarmsByFcm`); the outcome is reported after the disable is durable,
with class suffix `;disable-failed` when it could not be committed. Records with only a GCM `registrationId` are not sent:
node-gcm used the legacy FCM API, which Google deprecated on 2023-06-20 and began shutting down on
2024-07-22 ([migration guide](https://firebase.google.com/docs/cloud-messaging/migrate-v1)).

**No hidden retry, no resend (D02).** Each delivery makes at most one FCM request; reqwest's
protocol-NACK retry is disabled and redirects are not followed. firebase-admin retried once after a
network error, which could deliver twice; server2 records the outcome as unknown. FCM recommends
backoff retries for `UNAVAILABLE` and `QUOTA_EXCEEDED`; D02 keeps them out: the failure is recorded
and the next independently scheduled minute is the next attempt. Weather and geocode requests are
one attempt each, bounded to 30 s (legacy had no bound); the OAuth and FCM requests to 10 s.

| S3 object (`index/v2/push/delivery/`) | Write | Content |
| --- | --- | --- |
| `alarm/{YYYYMMDD}/{HHMM}.json` | `If-None-Match: *`, before any send | minute, claim time, nonce, record `_id`s |
| `alarm/{YYYYMMDD}/{HHMM}.result.json` | `If-None-Match: *`, after the sends | per `_id`: outcome, class, HTTP status |

A delivery is identified by (kind, minute, record `_id`). Only the process whose claim committed
sends; a second process, a restart or a repeated tick finds the claim (409/412) and sends nothing.
An unknown claim outcome is read back (our body: owned; another body: taken; unreadable: nothing
sent), and a refused or unavailable ledger sends nothing for that minute. A claim without a result
means the outcomes are unknown and are not resent; an unknown result write is read back, and a
result that was refused or whose outcome stays unknown is reported as a minute note and counted. Outcomes: `accepted`, `unregistered`,
`rejected` (firebase-admin client code), `unknown` (timeout or transport error after sending) and
`failed` (nothing sent: weather, geocode, build, credentials, OAuth, connect, iOS without FCM token,
retired GCM, unknown type).

**Diagnostics.** Ledger objects and diagnostics hold record `_id`s, minutes, outcome classes and
HTTP statuses only: no token, coordinate, name, address or message text (legacy logged whole
records with tokens). Standard error gets one line per non-accepted delivery and per skipped
minute; counters cover minutes, skips, selections, each outcome, removals and stamps. Nothing is
written to local disk.

**Deliberate differences.** Besides the retry, minute alignment and GCM items above: duplicate
removal deletes the records holding the group's earliest `updatedAt` and skips a group with one
distinct date or a record without one (legacy compared the first two unordered `$addToSet` values
and threw on a single date); an unknown package fails the delivery (legacy threw inside a
callback); OAuth uses the token endpoint and audience Google documents for service accounts,
`https://oauth2.googleapis.com/token`
([service-account flow](https://developers.google.com/identity/protocols/oauth2/service-account);
firebase-admin 5.13.1 used `https://accounts.google.com/o/oauth2/token`), tokens are refreshed on
demand per app, one request at a time, and a failure is not cached; the duplicate pass groups on
indexed key fields and decodes only grouped records; the 60-day removal and the `updatedAt` stamp
re-check records in the writer: of the records the `makeRemoveSelector` filter matches, the
selected one is removed only while it still equals the document read at selection and any other
only while its own `updatedAt` is older than 60 days; an unregistered token's disable removes
exactly those records of every selection of the minute with that token in its own journal entry
(legacy disabled, then removed them the same minute), so no restart can leave one enabled and one
disable never makes another stale selection look recent; the
stamp applies only while the record still has no `updatedAt`. So a user change or removal made
during the minute is never undone (even one that repeats the same settings) and a stamp never
re-enables a disabled token (legacy removed every match and upserted the copy read before
sending); legacy disabled unregistered tokens without waiting; OAuth tokens are cached and refreshed with one lock per app,
and the assertion and expiry use the time of each send (not the minute's start).

**Verification.** The [oracle fixture](../../server2/tests/delivery/fixtures/PROVENANCE.md) runs
the real `ControllerPush` and firebase-admin 5.13.1 (Node 16.20.2) over HTTPS and weather doubles:
47 single deliveries (KMA, DSF, geocode, TodayAir, units, languages, failures, every FCM error
class, connection resets, token errors, iOS/Android/unknown types) and one scheduled minute with 7
registrations (weekday filter, 60-day removal, `updatedAt` stamp). server2 matches the weather
and geocode URLs with `Accept-Language`, the OAuth request bytes (re-signed only for the audience),
the FCM path, authorization and body bytes, and the outcomes; the minute's FCM bodies and requests
as multisets and the resulting state. Fault tests: one request on 503, timeout and reset with
nothing sent later; a replacement process at the same minute sends nothing and the next minute
delivers; two processes claiming one minute deliver each alarm once; a claim whose answer was lost
is read back (own: delivered; another's: nothing sent); selection excludes other minutes,
`enable: false`, excluded local weekdays and weekday lists without `timezoneOffset`; a user update
made during the minute (changed or identical settings) survives the stale cleanup; a claim stored
with a lost answer and a failed read-back sends nothing, also after a restart, and the next minute
delivers; a refused claim and an unrestored state
send nothing; an unregistered token's alarms are disabled durably before the outcome (not
re-enabled by the stamp; stale ones removed in the disable's journal entry, also when several
share the token), and a failed disable is reported and not resent;
the classification follows firebase-admin 5.13.1 for its detail type and for current FCM error
bodies; diagnostics and ledger objects contain no token, coordinate or name. With
42,226 synthetic alarms a minute ran in about 0.1–0.2 s (debug build, loopback doubles). Only
loopback doubles were called; no push was sent.

### S17a KMA v000901 and v000902 address weather (2026-10-15)

[S17](../../plans/issue-2702.md) ([spec](../../specs/issue-2702.md)) ports the used older weather
versions, nation and town in three PRs: S17a (this section), S17b (direct `/v000901/kma/addr`,
`/v000803/town`, `/v000705/town`) and S17c (`/v000903/nation/KR`, failed-only `/v000901/nation/KR`).
S17a covers the gateway backends of unversioned `/weather/coord` (70.72% of the accepted report's
product requests; the gateway default is v000901), `/weather/v000901/coord` and
`/weather/v000902/coord`.

- **Assembly.** The S15 chain selects the legacy router list by the request version. v000901 and
  v000902 share the first 23 v000903 steps (through `getKeco`) and then run
  `getKecoDustForecast, getRiseSetInfo, insertIndex, makeAirInfo, AirForecast, insertSkyIcon
  (v000901) | insertSkyIconLowCase (v000902), setYesterday, convertUnits, insertStrForData,
  getSummaryAfterUnitConverter, makeResult, sendResult`. They have no air fallback and no
  `specialInfo` step. `makeAirInfo` builds one `airInfo` from the first station's fresh rows and
  the dust forecasts; `AirForecast` creates `{source: "airkorea"}` when absent and adds the station
  forecast. v000903 is unchanged.
- **Inputs.** The S15b S3 input source is version independent, so all three versions read the same
  snapshot and, since S15b-4a, the same request-time acquisition of missing forecast inputs (no
  input forwards). History coverage is the S14/S15b-2 coverage of v000903; no version-specific
  history exists.
- **Routing.** `kma-v000901` and `kma-v000902` in `SERVER2_NATIVE_FAMILIES` select those gateway
  backends; `kma` stays v000903. Any of them builds the one S3 input source (S3 settings and
  `DONGNAE_SECRET_KEYS` required). Each version switches and rolls back alone.

Verification (local, test peers only): a pinned Node 16.20.2 oracle runs both legacy routers through
the S15 harness and driver (only the router, mount and scenario list differ;
[provenance](../../server2/tests/legacy_versions/fixtures/PROVENANCE.md)). All 123 recordings (94
v000901, 29 v000902; 2,307 store answers) replay to the legacy bytes and ETags with every call in
order, except the two S15 declared forwards. The S02 goldens `domestic-v000901(-db1)` and
`domestic-v000902(-db1)` equal their recordings, and the gateway goldens `gateway-default-domestic`,
`gateway-v000901-domestic` and `gateway-v000902-domestic` match on the wire with the native switch,
the legacy default, a one-version switch and the rollback. The release `kma_smoke.py` runs
legacy -> `kma-v000901,kma-v000902` -> legacy: listed versions answer natively (S3 reads and
loopback acquisitions, no legacy KMA hop), the unlisted v000903 still reaches legacy, the legacy
phases return identical bytes, and repeated or unknown entries and missing settings are refused. Live provider data and
production latency are not claimed.

### S17b direct `/kma/addr` routes and town v000803/v000705 (2026-10-15)

S17b serves the legacy direct public routes, which reach Express through nginx rather than the
`/weather` gateway: `/v000901/kma/addr` (1,853 requests in the accepted report), `/v000903/kma/addr`
(1,320), `/v000803/town` (205) and `/v000705/town` (12, retained under O-8).

- **Routing.** `server2::api::DirectRoutes` answers listed direct routes before the gateway routes:
  `kma` claims `/v000903/kma/addr`, `kma-v000901` claims `/v000901/kma/addr` and the new `town`
  entry claims `/v000803/town` and `/v000705/town`, matched case-insensitively as in Express
  (`req.baseUrl` keeps the requested spelling); the mounts answer the legacy usage JSON.
  Unlisted paths keep the previous 404; only GET and HEAD are claimed. Direct `/v000902/kma/addr` (zero observed) is not claimed. The listed
  entries share the one KMA handler and S3 input source.
- **Town assembly.** The town router lists run on the S15 chain without query defaults, with
  `getSummary` (ControllerTown) and the upper-case icons. v000803 ends with `makeResult` (no
  `location`); v000705 adds `dataToFixed` and has no `makeResult`, so it answers
  `res.json(undefined)` (200, `application/json`, empty body, no ETag). The v000705 sub-routes are
  ported as well. Without query defaults, `rn1Str` is JavaScript `NaN` (JSON `null`), as in legacy.
- **Envelope.** Express 4.13.4: weak ETag, `fresh` 0.3.0 revalidation and its 304 headers, HEAD,
  `cors()` and `X-Powered-By`; the i18n locale from `twcookie` then Accept-Language; no session
  cookie (S12 precedent).
- **Forwards.** Since S15b-4a listed direct routes answer natively with request-time
  acquisition. Outcomes legacy must still answer (a town absent from the town list, the S15
  `next(err)` forwards, including the v000705 `/short`, `/shortest`, `/current` 500s) take the
  legacy hop unchanged (`BackendDispatcher::proxy`: verbatim request target to the plain-HTTP
  loopback origin, which direct entries require at startup, hop-by-hop and `Connection`-listed headers dropped, 30-second CloudFront origin timeout).

Verification (local): a town oracle (86 recordings; 58 v000803, 25 v000705, 3 v000901 usage and
mixed-case; 1,214 store answers; S17a driver with the router, mount, path, method and scenario
list changed, including usage roots, HEAD and upper-case mounts) replays to the legacy statuses,
bytes and ETags, with 10 declared forwards in total across both S17 fixtures. The S02 goldens
`domestic-v000803`, `domestic-v000705`, `domestic-v000901` and `domestic-v000903` (with their 304
revalidations) match on the wire natively (status, body and every header except `date`,
`connection` and `set-cookie`), and HEAD and forwarded requests keep the legacy reply. The release
`kma_smoke.py` shows unlisted direct paths unclaimed (404, no legacy hop) and listed ones reading
S3 and answering natively with the Express envelope (JSON with a weak ETag, the v000705
`res.json(undefined)` reply without one, the usage root) and no legacy hop.

## S17c: native nation weather and air

The `kma` and `kma-v000901` entries also claim the used direct nation routes
`/v000903/nation/:nation` and `/v000901/nation/:nation`. The nation backend calls
fifteen native KMA assemblies using legacy version rules, concurrently with one absolute
three-second deadline; it never calls legacy or opens a separate provider source.
The child replies retain legacy city order after removing `airInfo`/`airInfoList`.
Nation children share the same `KmaBackend` and S16 recorder as direct weather requests.
When a complete snapshot produces compatible captured `getPastMid` rows, the shared backend
records its summaries without adding fields to the nation response. Rendered nation errors
keep the Jade `res.send` ETag/HEAD contract, distinct from native finalhandler errors.
Mount claiming remains case-insensitive, but an uppercase `V` makes legacy query validation
remove the version, so city requests default to v000901. Child locale uses only the forwarded
`Accept-Language` header (English if absent); the parent `twcookie` is not forwarded.
An actual failed internal child response maps to the legacy rendered 500, as AK
approved; the response is successful when the internal calls succeed. Other late
provider branches remain omitted according to the existing KMA partial-data rules.
Native errors omit the legacy session ID, consistent with the existing absence of
legacy session middleware/cookies. This is a response difference in diagnostic
HTML only, not an invented synthetic session identity.

Nation air is a projection of the same `AirInputs` S3 raw acquisitions as town air.
The newest urban hour is selected independently per province; each pollutant uses
its own valid numeric count and legacy rounding. The SidoArpltn schema drops
24-hour PM fields. National `전남광주` labels are split by station-list address,
without a second province-specific provider query. Unresolved station ownership
is omitted, allowing the labelled representative-point fallback. Stored means
become stale at exactly eight hours; provider observations keep the existing
inclusive eight-hour boundary. The safe rejection reason is exposed through a
backward-compatible AirSource method, while ordinary weather keeps its old
AirOutcome interface. Fallback calls run at most four at once and never put
provider error text or URLs in `airStatus`.

No new API method is needed. The existing real-provider evidence (2026-10-14,
672 nationwide rows in one `numOfRows=1000` page) and
[official catalog](https://www.data.go.kr/data/15073861/openapi.do) apply. The
new tests use recorded/synthetic public station data and loopback peers. Full
nation composition uses deterministic child response doubles; the S15/S17
oracles continue to verify the actual weather assembler. S3 restore tests verify
the nation air branch separately from child-weather assembly.

See [nation setup and checks](../operations/server2-nation.md),
[PDF manual](../operations/server2-nation.pdf), and
[nation sequence](diagrams/server2-nation.html)
([editable JSON](diagrams/server2-nation.json)).

### S18b-2: conditional alerts

`push::deliver::alerts::AlertWorker` ports `alert.push.controller.js` over S18a registrations,
S18b-1 FCM and the durable delivery ledger. This is an unwired library capability: no process
starts the scheduler or sends live notifications. [Operator guide](../operations/server2-push-delivery.md),
[PDF](../operations/server2-push-delivery.pdf), [flow](diagrams/server2-push-delivery.html) and
[editable source](diagrams/server2-push-delivery.json) describe this slice.

At UTC :07/:17/:35/:50 it selects explicitly enabled alerts in inclusive day/overnight windows.
A weather or air send at or after now minus six hours suppresses the entire record. It claims
the `index/v2/push/delivery/alert/{YYYYMMDD}/{HHMM}.json` cycle before weather preparation,
then prepares at most six alerts concurrently. It requests v000902 weather with the legacy
source/coordinate-or-address/units/language contract (`VC` shares `/dsf/coord`). One weather
attempt has the legacy ten-second bound; there is no geocoding fallback for missing source.
S20 must connect SERVICE_SERVER to server2's native weather routes before retiring legacy.

The pure parser/comparison/text port preserves current rain detection, two successive wet
shortest rows, short/hourly forecast fallback and current-air threshold transitions. Computed
air forecasts are discarded, as legacy. Overseas data older than 30 minutes is skipped.
The worker updates only the two alert-state fields through the single S18a writer before
submission. Exact selected-document matching rejects a stale evaluation after an app change.
Ordinary evaluations do not change `updatedAt`; an unregistered token disables every matching
alert and stamps `updatedAt`/`updatedBy=push`, without changing alarms.

FCM is submitted once with the existing S18b-1 adapter. Claim/state faults send nothing;
provider rejection, unknown outcome, missing result and process restart never resend a claimed
cycle. Result objects and diagnostics contain only record ID, kind, minute, outcome class and
HTTP status. A no-notification decision is still persisted and recorded as `not-needed`.
Legacy's misspelled `updateAt` cleanup remains a no-op. Duplicate registrations use S18b-1's
earlier-date cleanup rule (including its documented malformed-group difference).

Intentional safety differences: await state durability before send, skip stale selected
records, one weather-preparation attempt instead of legacy's two, and no legacy GCM submission
(same S18b-1 retirement handling). No new environment variable or dependency. Warning feed
and notices remain subsequent S18 slices. [Selected verification](../evidence/tasks/issue-2703-s18b2/verification.md)
records the actual offline comparison and functional checks; it does not claim device delivery.

## S18b-3 warning feed and one-shot delivery (2026-10-16)

`push::deliver::warning_feed` ports the actual legacy S3 warning feed, with an
explicit `WarningCollector::with_push_feed` post-persistence sink. Every fetched
zone page/day must already be published in S12 before the sink receives its rows.
A failed sink is reported as a collection/storage error; it cannot send a push.
There is no process-startup installation in this PR. S20 owns wiring this sink and
one warning worker together with the alarm/conditional workers, using native
server2 geocode and weather routes and a single operational sender.

Feed state lives under `index/v2/push/warning-feed/`: absent-only event objects
precede a conditional `head.json`. The first durable source window is silent;
later fingerprints persist across memory loss (last 50,000). The head references
24 hours of events. Legacy publication-time normalization, cancellation/duplicate
filtering and source freshness (less than five minutes, at most 60 seconds ahead)
are preserved. Interrupted publication cannot expose an orphan event, and a
refused head preserves the prior readable head. CAS conflicts merge against the
new head. Immutable event caching is disposable and pruned to retained references.

The worker's first read is separately silent; it does not resume pending delivery
or broadcast at replacement. New issue commands 1/3/6/7 group matching zones by
announcement identity. Active S12 zone state, end time, enabled registration and
inclusive UTC normal/overnight window gate admission; the ordinary conditional
six-hour gate does not apply. Coordinate registrations resolve via server2's
configured geocoding route, sharing one resolution for a common geometry. The
region cache is only in memory while campaigns remain open and is cleared when
none remain; it holds no device tokens and is never durable serving truth.

Each fresh five-minute campaign can admit a newly eligible endpoint. Package and
FCM token deduplicate city registrations; a deterministic per-endpoint claim at
`index/v2/push/delivery/warning/` precedes one submission. Claim outcomes are never
replayed after failed/unknown/cancelled work or restart. Current registration and
active-zone state are rechecked after OAuth preparation, immediately before POST.
The read-only registration check runs through the writer's S3 journal catch-up,
including commits by another process; S12 zone reads use the durable store. A
four-second guard timeout/error fails closed. APNs expiry uses the final submission
clock. A missing result never releases
its claim. Unregistered FCM tokens disable conditional alerts, leaving alarms alone.
Korean titles use the legacy weather/level names; other languages use legacy
English text. The first matched zone supplies the body. The urgent HTTP-v1 envelope
preserves `data.eventId`, Android TTL `300s`/priority `HIGH` and APNs expiry at
submission time plus 300 seconds; see the [official message reference](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages).

The new feed/claim paths fall inside the repository S03/S10f `index/v2/*` IAM
read/write permissions and use its required conditional writes. This is a source
policy comparison, not an actual-role or live-AWS verification claim. No AWS change,
real provider request, device push or deployment is performed by this slice.
S18c remains a subsequent backend/API, publishing CLI and S3 notice-state PR under
#2623; client/web popup implementation and SQLite are outside these S18 PRs.
