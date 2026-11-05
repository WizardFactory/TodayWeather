# Korean weather acquisition and S3 retrieval design

Selected on 2026-10-24 against `82f7a4838dda046be966ee9c25c9cb66561d099d`;
local implementation updated on 2026-10-25. This is not deployment evidence.
The [implementation and verification record](../evidence/research/kma-full-response-implementation-2026-10-25.md)
is the current status: ASOS-primary assembly, foreground current-day ODAM/VSRT,
writer-owned response-first raw, bounded recovery and canonical replay exist in
the working tree. An empty local weather S3 test with scripted complete wet/dry
ASOS inputs proves response-before-weather-PUT, later S16 admission and identical
fresh-source replay. It does **not** qualify actual full cold/restore latency.

AK permits historical numeric changes from acquired observations, primarily
ASOS. Keep the public three-hour `short` axis and internal hourly history.
Same-new-closure replay stays byte-exact. Seven completed days remain required;
explicit QC9 gaps, missing boundaries, winter/delivery and other real source
coverage remain unqualified. Qualified normal ASOS blanks now distinguish dry
weather from numeric trace zero. No p95/p99 is established. Per-grid optimal
combination generation is explicitly deferred; no source-plan, head, day-locator
or pack accelerator was implemented.

The [source qualification](../evidence/research/kma-asos-closure-qualification-2026-10-25.md)
records ASOS-specific KMA definitions and a local blank/trace/missing correction.
APIHub is optional; its absent key is not a blocker for this correction. Public
station batches and44 QC9 hours remain incomplete. A narrow local
repair now uses the verified current city URI. Hourly/city admission requires the
returned observation header to match the requested hour; a city form echo is
insufficient. Minute and RSS requests retain their minimum-publication semantics.
These guards do not establish seven-day coverage or a full live latency sample.

The subsequent [verification and live pilot](../evidence/research/kma-validation-measurement-2026-10-24.md)
passed 312 frozen native comparisons, captured real provider raw and measured
canonical S3 restore. LIST was 87.718% of native reads in that bounded full-route
pilot. Its small, partial-response samples do not qualify production tails or
complete seven-day history; the proposed accelerators remain unimplemented.

[Diagram](diagrams/server2-kma-data-design.html) ·
[Editable source](diagrams/server2-kma-data-design.json) ·
[Official provider review](../evidence/research/kma-provider-review-2026-10-24.md) ·
[Manual-backed reassessment](../evidence/research/kma-storage-reassessment-2026-10-24.md) ·
[Full-response reassessment](../evidence/research/kma-full-response-reassessment-2026-10-25.md) ·
[Existing storage contract](server2.md#4-s3-layout-and-catalog-publication)

## Scope and binding requirements

AK requires reusable source combinations for each Korean grid, seven completed
days of hourly cloud and precipitation phenomena for AM/PM summaries, original
provider bodies in S3, and fast retrieval. Historical inputs are measurements,
ultra-short observations and ultra-short forecasts. Short/mid forecasts may
supply future weather; they must not silently supply historical weather.
Life indices and air quality are outside this design.

The current public three-hour slots are retained by AK's explicit decision;
internal collection and seven-day cloud/phenomena coverage stay hourly.
Preserve routes, envelopes, units, rounding, missing-value behavior, time slots,
icons and current/yesterday comparisons. Historical numbers may change under
the ASOS-primary policy; future weather and unrelated envelope behavior remain
regression-protected. A missing acquisition never becomes a fabricated zero.
The public response remains assembled in memory. Persisted weather
remains raw bodies and lossless copies, identity/coverage indexes, and the
existing authorized daily-summary exception; no normalized hourly weather or
preassembled response store is introduced.

The public gateway deadline remains nine seconds. The ASOS-primary source now
allows an eight-second handler budget, with a 500 ms acquisition/assembly reserve;
native weather geocoding has its own three-second cap within that public deadline.
Legacy-source handlers retain three seconds. These are ceilings, not observed
latencies. The existing client's overlapping two-second retries are unchanged;
owned single-flight coalesces repeat provider work. Production qualification must
include concurrent requests and early/late KST hours before this budget is accepted
as an operational SLO. Optional legacy backfill remains durable-before-visible;
required ASOS and today's ODAM/VSRT work use foreground RAM-ready groups.
See [deadlines](server2.md#7-budgets-deadlines-and-failures).

## Response-first durability and recovery

The selected flow is full required provider acquisition, complete original raw
validation, pinned RAM assembly, response, then original canonical S3 publication. Later
requests restore complete canonical inputs and run the same value assembly.
This amends the earlier durable-first proposal for foreground live input; it
does not pretend that pending RAM has a published-group receipt.

Complete raw-group validation, required field/slot coverage and same-closure
replay parity are three separate gates. Latest-group completeness cannot establish
seven-day history. Observed `historyStatus` now includes hourly SKY/PTY and daily rain/AM/PM
weather gaps, while winter rain is checked on its actual three-hour period.
It is still not a full-source/latency qualification receipt and does not certify LGT. Use the full-response manifest and gates in the
[reassessment](../evidence/research/kma-full-response-reassessment-2026-10-25.md#three-separate-completeness-gates);
partial HTTP 200 bodies cannot qualify full-response performance.

One coordinator reserves retained-byte/group capacity before provider work and
owns natural-owner acquisition, quota and single-flight. One supervised writer
owns the pending overlay before readiness is broadcast. The overlay survives the
three-second flight retention until durable promotion or an explicitly failed
state; later requests use true fetched-time visibility. Actual acquisition
waiters retain the existing own-input visibility rule.

Writer readiness and permission to start I/O are separate. Normal weather PUT
release follows an eligible response's terminal body event, or no remaining
waiters. Freeze the eligible set at readiness; overlay readers cannot prolong
dormancy. Dormant batches hold byte reservations, not writer slots. Cover drop,
deadline, slow reader and shutdown with bounded liveness handling; an abnormal
cap is not recorded as successful full-body delivery. A production hook proves
only its actual server-stack boundary, not remote app receipt.

Generation pins must protect discovery readers while overlay entries become
durable or are removed. Deduplicate S3/overlay input by full RawId, preserving
original group boundaries and fold order. Pending inputs cannot enter durable
S16 summaries, result/disk caches or catalog/dependency tokens. No additional
mobile acknowledgement API is introduced.

The implemented S16 fence contains only pending originals identified by the
snapshot's full RawIds. Grid acquisitions, retained station pages and ASOS ranges
carry those identities through RAM reuse. A parked failure for another grid
cannot block this snapshot's summary. The recorder waits after body termination
under a separate 32-waiter bound, then takes one of the two storage-worker permits.
Deterministic rejection skips affected summaries immediately. The shared 30-second
deadline remains; this is not a delivery receipt or guaranteed per-response summary.

On storage faults, retry the same retained original bytes/declaration. On restart,
prefer eligible canonical groups; bounded original repair can finish catalogs
when all descriptor/raw members survived. Missing original pages remain an
incomplete group. Reacquire only qualified available inputs under the existing
finite-miss/source/quota policy, with a new identity for a new vintage. Lost
original bytes that existed only in RAM may be irrecoverable.

Stop new provider misses at pending capacity and supervise bounded shutdown
drain. Do not silently discard healthy-process pending raw or blindly clear a
memo/refetch after a permanent persistence error. The
[review and recovery matrix](../evidence/research/kma-response-first-review-2026-10-24.md)
records the independent Opus check, pressure policy and proof obligations.

## What the provider review establishes

The [provider matrix](../evidence/research/kma-provider-review-2026-10-24.md#provider-matrix)
distinguishes compatible inputs from candidate replacements:

| Need | Preferred acquisition shape | Remaining qualification |
| --- | --- | --- |
| Latest grid weather | One complete publication per existing point API/product, all required categories and pages | Availability grace, revisions within a publication, today's elapsed hours/extrema |
| Mid-range weather | Separate land and temperature regions; outlook only where the existing output uses it | Town/region mapping and current publication validity |
| Seven days of station history | Contiguous ASOS hourly and daily ranges for the selected recovery station | Station coverage, QC, winter rain, exact observation/summary semantics |
| Historical grid observation | Stored ODAM bodies plus recoverable recent publications | Ordinary point lookup is not a verified seven-day archive |
| Historical cloud/phenomena | Measured cloud/phenomena plus archived VSRT for fields the current policy repairs | Automated archive delivery, vintage equivalence and latency are unverified |
| Live station refinements | Reuse existing city/hourly/minute inputs and rain neighborhood | New APIHub endpoints need field/value equivalence before substitution |

ODAM does not currently provide SKY/LGT. ASOS cloud amount can produce a sky
category. The observed adapter now parses bounded, unambiguous domestic
phenomenon codes into PTY, keeps unknowns absent and represents winter rain as
`rn3h` only at three-hour ending marks. It does not invent numeric LGT. Official VSRT files exist through the previous
day, but an archive page is not proof of an automated low-latency API.

Official APIHub documentation also exposes a 31-day station hourly query with
WW phenomena and cloud amount. APIHub VSRT's documented recent-three-day reach
is distinct from the local 23-issue backfill and from verified data.go.kr
behavior. These remain unwired candidates; authentication, automated delivery,
mapping, time/vintage and value equivalence are unresolved. See the
[candidate assessment](../evidence/research/kma-full-response-reassessment-2026-10-25.md#historical-acquisition-gaps-and-candidates).
The blocker is the absence of a qualified connected closure, not proof that
KMA has no seven-day phenomenon data anywhere.

The [manual-backed review](../evidence/research/kma-storage-reassessment-2026-10-24.md)
adds official ASOS hourly/daily guides documenting D−1 availability after 11:00
KST. Before-11 provider responses are untested. Distinguish not-yet-available
from no-data, and include this boundary in cold completeness/latency qualification.
ASOS `dmstMtphNo` and AWS hourly `rns` are measured-phenomenon candidates already
present in acquired raw bodies. Supported ASOS codes supply observed PTY. KMA
ASOS QnA definitions support a bounded normal-blank dry/trace distinction; their
transfer to data.go.kr JSON and preceding winter 3h-period attribution are explicit
inferences corroborated by retained inputs. QC1/9 and missing fields stay unknown.
AWS-symbol fallback, complete winter coverage and numeric LGT remain unqualified; a seven-day LGT
requirement must follow actual output usage.

The 2026-10-19 point-service guide documents updates within a publication.
Consequently `product + base_time` is not a raw revision identity. Preserve
provider publication time, valid time and acquisition time separately.

## Compatibility checks before acquisition optimization

Two different claims need separate proofs:

1. **Replay equivalence:** the same complete raw input closure produces exactly
   the existing public body and functional headers after changing storage.
2. **Provider equivalence:** a newly fetched range/endpoint/vintage reproduces
   the values the existing provider inputs would have supplied. A historical
   provider correction can make this fail even when replay is exact.

Do not treat replay equivalence as proof of provider equivalence. In particular,
empty S3 cannot reproduce an old first-valid value from a provider that now only
returns a revised value and does not expose its prior vintage.

Current source facts needing frozen-clock regressions:

- [Station selection](../../server2/src/domestic/kma/source/stn.rs) uses a town
  coordinate and different city/rain neighborhoods. [ASOS recovery](../../server2/src/domestic/kma/source/observe.rs)
  uses a separate Haversine selection. A grid-center station is not universal.
- [ASOS folding](../../server2/src/domestic/kma/source/asos.rs) and
  [historical merge policy](../../server2/src/domestic/kma/policy.rs) retain
  first valid contributions and fill missing fields. Latest-body-only replay
  can change values. Retain contributing revisions and their order.
- [Daily assembly](../../server2/src/domestic/kma/mid.rs) computes past summaries
  and subsequently overlays short-derived summaries. The historical source
  restriction can conflict with strict legacy parity. Detect such dates/fields
  and fail qualification; do not silently reinterpret them as equivalent.
- The [visible past short slots](../../server2/src/domestic/kma/short.rs) also
  retain forecast-only fields or forecast fallback when observations are absent;
  the conflict detector must cover those slots and RSS fallback as well as daily
  rows. Preserve existing all-missing-to-zero quirks until separately decided.
- Legacy polling and server2's first acquisition can select different revisions
  of one open issue. Freeze that vintage policy; an issue-only cache or a new
  refresh rule cannot silently change it. Current latest-plus-23-hour backfill
  does not establish seven-day coverage or the matching yesterday comparison.
- [Existing durable grid summaries](../../server2/src/summary/grid.rs) cover
  D−6..D−1 and exclude yesterday before 01:00. They are not proof of seven full
  days. D−7 must be restored from its actual inputs until separately qualified.

These remain coverage and replay gates; AK permits acquired historical numeric
changes under the ASOS-primary decision above.

## Grid source plan

Precompute a versioned **acquisition plan**, not weather values. Package the
public reference snapshot with the release so weather-empty S3 does not require
reference-data HTTP calls first. Keep provenance/licenses and the applicable
reference date. Future runtime assets belong under `server2/`.

An illustrative `GridSourcePlan` contains:

```text
schema, grid(nx, ny), reference_hashes, selector_policy_hash
point_product_grid_ids
candidate_city_stations, candidate_rain_stations, candidate_history_stations
candidate_mid_land_regions, candidate_mid_temperature_regions, outlook_regions
per_endpoint_fields, cadence, availability_lag, range/page_limits
archive_capability = verified | documented_only | unavailable | unknown
```

Candidate stations must form a certified superset over the whole relevant grid
footprint, including radius/ranking boundaries, ties and registry natural order.
At request time evaluate the existing selector at the resolved town coordinate.
Use a single cached winner only when all supported contexts in that grid are
proven to choose it. A stale/uncertified superset falls back to the complete
in-memory registry. Town/address-dependent mid zones remain town dependent.

Preserve user-specific labels and exact location context in RAM. Persistent
plans describe public grids and reference candidates; they never record users,
IP addresses, precise input coordinates, coordinate hashes or query histories.
Two locations may share grid raw and still require different station sources
and final response cache keys.

For each required `(field, valid_slot)`, keep an in-memory coverage map of the
permitted source/vintage and validity. The existing merge policy decides values;
there is no new universal “observations always overwrite everything” rule.
Choose acquisition batches lexicographically: compatible values and coverage,
legal quota/reliability, measured critical-path latency, then calls and bytes.
Only value-qualified alternatives compete. A set-cover heuristic may combine
equivalent fields/ranges, but must not replace the compatibility constraint.

Deduplicate work by the provider's natural owner: API/product + grid/station/
region + publication or requested interval + format/version. Concurrent grids
sharing a station or region join the same owned acquisition. National pages are
acquired once per required publication, not once per requested grid. The
negative-cache key includes the endpoint, interval and retry-after condition;
quota/auth/timeout errors are not “no weather”.

Proposed private interfaces keep the existing HTTP caller independent of S3
keys, provider pagination and pack formats:

```text
KmaWeather.serve(RequestContext, Deadline) -> ExistingHttpResult
SourcePlanner.plan(ResolvedTown, ReferenceSnapshot, PolicyId) -> SourcePlan
RawResolver.resolve(SourcePlan, RequiredWindow, Deadline) -> Resolution
Resolution = ValidatedVolatileSnapshot | PublishedSnapshot | PartialSnapshot(Coverage) | ExistingFailure
AcquisitionCoordinator.ensure(AcquisitionKey, Deadline) -> ReadyAcquisition
PersistenceOwner.claim(ReadyAcquisition, ResponseGate) -> PendingLease
RawBytes.load(ExpectedEnvelope, RepresentationCandidates, Admission) -> VerifiedRawRecord
PackMaintenance.prepare(PublishedOwnerScope, WorkBudget) -> RepresentationId
```

`KmaWeather` owns the complete request and existing output policy; the planner
owns source identities; the resolver owns one pinned raw closure and admission.
One acquisition coordinator owns natural-owner single-flight, provider budget,
request identity, retries, publication and cancellation/background handoff; the
planner and resolver do not create separate acquisition owners. A complete pure
validation gate admits volatile foreground raw; the storage publisher alone
admits durable complete groups. Maintenance only creates optional representations
of published bytes. `RequestContext` remains transient.

Latest and backfill share the funded data.go.kr executor. Evaluate bounded
foreground priority with starvation/quota tests so history cannot consume all
permits before latest work. This is a proposed scheduling change, not current
priority behavior or proof that either completion fits the waiter.

`RawBytes` is a private body-loading boundary below original catalog/group
selection and before any canonical body GET. The current catalog lookup already
loads raw bodies; selecting a pack after that call would save no body requests.
No change to that boundary is required for the initial canonical-only baseline.

## Historical time and field contract

Use KST calendar dates, not a rolling 168-hour approximation, for completed
days D−7..D−1. D0 has elapsed observations and future forecasts. The existing
hourly observation window is a distinct rolling 192-slot contract; the visible
short response uses three-hour slots beginning D−2. Preserve existing axes
while recording the unresolved hourly requirement above. The 192-slot planner
lookback does not prove a minimum eight-day accumulation period for new grids.

For daily aggregation, preserve the existing `0000`→previous-day `2400`
attribution and AM-through-1200 rule. Seven complete daily summaries therefore
need each day's 0100..2400 input closure, including D0 0000 for yesterday.
Retain the native timestamp and an explicit timezone/valid interval; do not
convert a UTC archive twice. A range query may need boundary hours outside a
naively selected seven-date file interval.

| Historical field family | Required treatment |
| --- | --- |
| Temperature, humidity, wind | Preserve selected station/grid origin, QC and missing-only precedence; do not average stations for speed |
| SKY | Existing valid source wins; eligible measured cloud mapping and the existing VSRT repair rules fill gaps |
| PTY/LGT | Where the existing output uses the field, require its supported phenomenon/code; no inference of “no rain/lightning” from a missing field |
| Rain | Keep measurement interval, cumulative versus interval basis, trace/range text, valid-hour count and winter exclusions |
| Daily extrema | Official daily extrema and extrema of sampled hours are different; preserve the current branch selecting them |
| Snow | Distinguish depth and new accumulation and their intervals; do not fill from rainfall |

Track complete-page coverage, valid-field/hour coverage and publication scope
separately. Missing is never zero solely because the new archive is empty.
Freeze the response's actual required fields/slots and legitimate missing-value
behavior; do not silently require every possible element at every hour.
Historical VSRT retains its publication/vintage and is never labelled measured.
Do not keep only every sixth VSRT publication merely because each covers six
hours: overlapping forecasts can have different values. Any such thinning
requires a value-equivalence proof.

The machine-checked precipitation slice of this contract is
[`server2/config/contracts/kma-history.v1.json`](../../server2/config/contracts/kma-history.v1.json)
(version 1, slice `precipitation-1`). It declares sources, hourly/slot/half
nodes, edges with separate approval and verification status, rules and
invariants. SKY values, snow, LGT and other daily rain totals are not declared
yet. Under ASOS-primary, `precipitation-guard-v1` keeps measured precipitation
evidence from becoming PTY 0. A slot whose evidence has no known type gets PTY
−1. A half loses its PTY, SKY and text, keeps its date and is listed in
`missingDailyDates`. `dry-closure-v1` checks each observation day
(01:00–24:00 KST) against its official daily total. When the day's 24 hourly
amounts close against that total, an April–October QC9 hour without a
precipitation code is dry (R1b). A blank daily total without numeric or coded
hourly precipitation is 0 mm (D1). Both passed held-out validation and AK
approved them on 2026-10-31. `wet-bulb-rain-v1` types an uncoded April–October
amount as rain at a wet-bulb temperature of at least 5 °C (R2s, approved
2026-11-03 after a fourth held-out sample). Hourly rule-derived values stay
apart from measured values in the ASOS record's `inferred` field. They fill only
what measured ASOS, ODAM and VSRT left missing. A derived rain type also replaces
PTY 0, because the ASOS amount contradicts it, and a recorded type always stays.
`station-altitude-v1` keeps a town from reading a station far above or below it:
the nearest city station must lie within 200 m of the town's terrain elevation,
a replacement lies within 35 km, and otherwise the town uses no station and
reports `station-unrepresentative`. Island stations serve only their own county.
Stations 185 and 188 keep their measurements but not wind. Towns without an
official coordinate keep the nearest station. The temperature-qualified type (R2)
and winter windows (W1) failed a second held-out sample, a winter-inclusive
wet-bulb variant failed a third, and both remain proposed edges that are excluded
from coverage; see the
[2026-10-30 research](../evidence/research/kma-history-gap-options-2026-10-30.md#held-out-validation-of-proposed-rules-2026-10-31).

Client delivery is checked separately by the
[client wire contract](../../server2/config/contracts/kma-client-wire.v1.json) and
[`kma_client_eval.py`](../../server2/tools/verification/kma_client_eval.py). The eval
learns the wire profile of each version and surface (v000705/v000803 town,
v000901–v000903 address and gateway) from the pinned legacy recordings. It then
checks null and type changes, required and consumer-read fields of the iOS widget
and the app, slot and date order, and the observed-history rules.
`cargo test --test legacy_versions client_eval` runs it on every native recorded
scenario in legacy and ASOS-primary mode. `python3 kma_client_eval.py --body <file>
--version <v> --surface <s> [--observed-history]` checks a captured body.

## S3 layout and ownership

Keep existing canonical raw and group identities unchanged. New paths below are
illustrative schemas for a later implementation, not existing objects:

```text
raw/v2/{source}/{kind}/{YYYY}/{MM}/{DD}/{period}/{key_hash}/
  {fetch_ms}-{raw_sha256}.raw.gz
index/v2/groups/{group_hash}.json
index/v2/{source}/{kind}/{key_hash}/{original_partition}.json

# Optional representations, after qualification:
packs/v2/{source}/{kind}/{key_hash}/{day}/{pack_sha256}.pack
representations/v1/{source}/{kind}/{key_hash}/{day}/{manifest_sha256}.json

# Server-written folds in canonical raw, each read through one LIST and one lookup:
raw/v2/kma-warning/zone-state/{YYYY}/{MM}/{DD}/...
raw/v2/data-go-kr/kasi-fold/{YYYY}/{MM}/{DD}/...

# Deferred discovery experiments; not initial serving dependencies:
index/v3/{source}/{kind}/{key_hash}/day/{YYYYMMDD}.json
lookup/v1/kma/grid/{nx}-{ny}/{source_plan_hash}/head.json
lookup/v1/kma/grid/{nx}-{ny}/{source_plan_hash}/{manifest_sha256}.json
```

| Asset | Owner and contents |
| --- | --- |
| Canonical raw | Acquisition/storage owner; exact provider response bytes, ordered pages, sanitized request identity, content hash and acquisition metadata |
| Day locator, deferred | Storage indexer; identity-only references to intersecting acquisitions and their original owning/sibling catalogs; no authority to admit a group |
| Shared raw pack | Bounded maintenance owner; independently decodable copies of exact canonical bodies, shared by station/region/national owner |
| Representation manifest | Storage representation owner; immutable raw-ID→pack/member locations and integrity metadata; no weather values |
| Grid lookup, deferred | Source-plan owner; candidate/natural-owner references, exact dependency vector, finite manifests/shards and coverage scope; a navigation accelerator |
| Daily summaries | Existing summary owner and authorized schema; only proven complete inputs/dates; not an unconditional shortcut for D−7 |
| RAM views | One snapshot/assembly owner; decode each raw identity once per parser revision, share immutable parsed data across response stages |

Initial serving uses original catalogs/groups and bounded existing discovery;
it has no per-grid S3 head or day-directory dependency. A future grid head is a
hint, not a transaction committing multiple source catalogs. Current original
catalog generations still determine eligible data. Do not
publish field-merged weather in a “manifest” or mutate an immutable existing
`Envelope` to attach a pack: current catalog equality rejects envelope changes.
Representation locations are a separate overlay keyed by full immutable raw ID.

Partition acquisition ownership and lookup coverage separately. Keep original
v2 owning catalogs and `GroupDeclaration` unchanged: ownership contributes to the
group hash. Every selected group still passes original sibling/eligibility
checks, irrespective of the body representation used.

An ASOS original partition contains its full start–end range. A seven-day request
can overlap ranges beginning on thirteen start dates, but that is not thirteen
catalogs. Different end dates/hours produce additional identities. The current
loader lists bounded monthly prefixes; range, page, revision and original
catalog work must remain in the request accounting. Do not claim a no-LIST hit
or silently truncate a full prefix on the initial baseline. A capacity outcome
is preferable to dropping an eligible contribution.

For a future locator, revalidating its listed catalogs cannot detect an unlisted
catalog published before the request. A crash after canonical publication but
before hint update leaves that false negative even with strongly consistent S3.
Ordinary post-publication invalidation therefore does not establish complete
discovery. Use a bounded hint plus complete original fallback until coverage is
certified. A finite day locator also needs deterministic shards, byte/page and
owner/revision limits and explicit capacity failure.

One deferred protocol candidate preannounces identity-only original CatalogIds
into every intersecting day directory before original publication. Qualification
must reconcile old catalogs, fence all writers, pin absent as well as present
catalogs, revalidate directory/catalog vectors and cover crash/CAS/capacity and
retention cases. It would make the directory authoritative for discovery
membership only, while original groups retain weather-admission authority.
That is a new protocol with costs and failure semantics to prove; neither CAS
alone nor the current proposal establishes it. Registration failure must not
quietly alter the canonical acquisition acknowledgment contract.

The current Reader treats an absent original catalog as incomplete/corrupt,
not as a harmless pending entry. Preannouncement therefore also needs an
explicit pending-membership state with absent-token tracking, preserving
existing corruption distinctions and compatible prior results. It is not a
drop-in list of keys for the current lookup API.

These grid/day experiments are outside initial implementation. The earlier
proposal already required locator coverage/invalidation proof; this revision
defers that unresolved protocol instead of treating it as a baseline dependency.

### Existence checks and partly stored data

The layout above is known before any request, so a LIST of one prefix proves whether anything
is stored. Implemented on 2026-11-05:

| Question | Asked by |
| --- | --- |
| Which partitions does this key have? | One LIST of the key when the range exceeds two months, or for a fold; one LIST per month otherwise, because a long-lived grid key's whole listing costs more pages than two months |
| Which KASI days are stored? | One LIST of the kind, assigned to areas by key hash |
| Which warning days hold data? | One raw LIST of the kind; only those days are read |
| Is a publication absent? | The listing: under ASOS-primary the provider call of a grid or RSS publication starts without waiting for stored reads |
| Which stored publications matter? | Under ASOS-primary, the last 54 hours (`stored-read-window-v1`) |

A grid head or day locator would not shorten the empty case: it cannot prove absence, so an
empty answer would still need the LIST. Shared data that many objects fold into is instead stored
as one fold: `zone-state` once a KST day by the warning collector and `kasi-fold` by the KASI
capture pass. These hold provider items or legacy-shaped state, not assembled weather, and a new
process falls back to the original objects when no usable fold exists. The observed response also
uses the release's land zones (`data/kma_forecast_land_zones.csv`) until a forecast-zone list is
stored, so its first answer can request mid temperatures. Measurements are in the
[speed evidence](../evidence/research/kma-speed-options-2026-11-04.md#result-of-the-change).

### One wait for a request

The observed request stops waiting for everything it started 2.5 s after it reaches the handler, 2.7 s for air and life and 2.9 s for the narrative it adds last. A KR remap before the snapshot counts too, so the waits cannot add up. What is late is omitted. Stored reads keep the 8 s budget, so a slow S3 delays an answer instead of failing it, which is a decision for AK. The town geocoder runs before the handler and keeps its own 3 s cap.

Two kinds of owned work no longer hold a request. The warning collector offers its zone state once fetched, before its publications; a request answers from that memory, and the push feed still sees only durable rows. A request starts a missing AirKorea image acquisition without waiting for it, because its GIFs take longer than the bound, and a later request reads the result. Measurements are in the [speed evidence](../evidence/research/kma-speed-options-2026-11-04.md#with-one-bound-on-the-request).

## Wire, storage and assembly format boundaries

The [API manual](../reference/external-apis/kma.md) defines current operations,
formats, time/category/unit rules and missing/QC behavior. It is not a complete
captured-response schema. The following are existing fields or proposed private
type boundaries, not new implemented formats:

| Layer | Contract |
| --- | --- |
| Provider wire | Retain exact JSON/XML/HTML bytes and encoding; release-owned operation/version, query clock, units, categories and page rules |
| Existing RecordId | `source,kind,key_sha256,period{local_date,slot},fetched_at_ms,raw_sha256`; full immutable identity, not issue time alone |
| Existing Envelope v2 | `schema,identity,status,content_type,raw_length,pagination,fetch_group`; immutable and rejects unknown fields |
| Original group/catalog | Ordered member envelopes and original owner/sibling CatalogIds; the resolver pins present/absent control dependencies in RAM |
| Optional representation | Full RawId → pack offset, compressed/decoded lengths, codec, raw hash and expected-envelope digest; location only |
| RAM closure/provenance | Ordered verified inputs, source/reference/parser/fold hashes and field/slot → raw/page/path, owner, issue/valid interval, unit basis and merge rule |
| Public result | Existing body, functional headers, values, units, slots and sentinels; no extra diagnostic fields implied |

Keep cloud amount, SKY, PTY, lightning quantity and rain accumulation interval
distinct even where legacy names overlap. Parser/fold hashes invalidate parsed
or assembled caches without invalidating unchanged exact raw bytes. Credentials,
user coordinates and request history do not enter these persisted identities.

## Pack format and fast replay

Group by natural source owner and closed day; keep today's small/open tail as
canonical raw or bounded deltas. A multi-day provider body may be referenced by
several days but is physically stored once per selected pack representation.
Packs contain full provider bodies, not grid-extracted rows. A national body is
not duplicated into every grid pack.

Each member has raw ID, group/page identity, checked offset/length, compression
method, decoded length and raw SHA-256. Include the member index in the already
loaded immutable manifest. Compress members independently; one gzip stream over
the whole archive prevents arbitrary member reads. Coalesce adjacent full frames
within hard overread/byte limits. One GET per member would not reduce fan-out.
S3 does not support multiple disjoint ranges in one GET. See the
[S3 review](../evidence/research/kma-provider-review-2026-10-24.md#s3-behavior).

Validate selected bytes, Content-Range/status/length, decompression bounds and
raw hashes before use. ETag is a concurrency token, not the raw SHA-256.
Corruption/missing pack falls back to canonical raw and queues bounded repair;
it must not trigger another provider call for already durable data. The current
transport/disk cache does not implement the proposed pack Range path.

The optional representation loader runs before a canonical body GET. Original
groups/catalogs still select and authorize the expected complete acquisition;
the loader must match its full immutable Envelope and each page's raw length/hash.
A valid lossless copy may fulfill that logical raw identity even if its canonical
object is missing. This is an explicit availability/fault-semantics choice to
qualify, not permission for arbitrary pack contents to admit new weather.
If every canonical object must be HEAD/GET-checked first, charge those operations
and reevaluate whether packing saves I/O. Selecting a pack after the current
`CatalogStore::raw_checked` body load earns no such saving.

Share parsed raw and one resolved input closure across assembly stages instead
of reconstructing a history store independently for each view. Preserve parser,
fold and source ordering. Packing changes transport cost; shared parsing changes
CPU/memory cost. Measure them separately. Neither makes an unbounded revision
history constant-size.

## Read and write protocols

**Weather-empty S3, empty RAM and disk:**

1. Load the release's public source-plan/reference snapshot; resolve the normal
   location semantics. Include geocoder latency when it is required.
2. Probe original owner catalogs and bounded existing discovery/repair scopes:
   one LIST per existence question, so a fully empty store answers each in one
   request. Partial repair cannot certify absence. There is no initial grid-head
   dependency.
3. Reserve provider budget durably, then acquire independent required products
   and the missing required historical closure as foreground work, concurrently
   under global operation/byte admission. Range/page dependencies,
   quota waits, publication lag and permitted retries remain on the critical path.
4. Complete provider/page/raw/declaration validation and admit the immutable
   input to a charged, writer-owned pending overlay before broadcasting readiness.
   Do not claim storage-dependent eligibility or a durable dependency token.
5. Assemble the full required compatible closure within the existing waiter
   contract. Check required coverage/value parity for full-response qualification;
   preserve existing runtime failure behavior while partial responses fail that
   qualification. Pending input
   suppresses durable summary/cache admission; requests do not await persistence.
6. Release the owned writer after the declared response boundary, or when no
   waiters remain. Perform original descriptor/raw/catalog publication, sibling
   checks and raw verification; retry the same bytes on recoverable failure.
   Retain/pin overlay generations through promotion and concurrent discovery.
7. Build optional packs/reference manifests from verified durable raw afterward.
   A pack is not a prerequisite for a live response or canonical publication.

**Populated S3, empty RAM and disk:** discover the required original range/catalog
scope under existing bounds; pin distinct current owner/sibling catalogs and
group descriptors; load each required canonical body once; validate, parse/fold
once and share that closure across assembly stages. Check recorded present and
absent dependencies according to the actual resolver contract. Include LISTs and
revalidation in the totals. Once separately qualified, representations may
replace body GETs at the private loader; they do not remove original controls.
An incomplete/missing raw closure follows existing acquisition/failure rules.
Data prefetch may overlap controls within admission bounds, but is ineligible
until those controls validate.

**Warm memory:** an unchanged full request/dependency key reuses the assembled
response within existing refresh/TTL rules. Due catalog checks still cost I/O.
Raw/parsed cache hits alone do not prove publication or source freshness.
Refresh must also perform complete owner discovery where no certified membership
protocol exists; checking only known catalog tokens cannot find a new range.

Canonical publication remains the durable restoration authority; complete
foreground provider validation is the separate volatile serving gate. Use
immutable writes and catalog CAS unions. An optional pack is uploaded/verified before its immutable
representation manifest. Initial serving has no grid pointer. Any future pointer
protocol must revalidate dependencies and reject older/incomparable builds;
publishing a pointer last cannot by itself certify discovery. No single S3 transaction
commits all keys. Preserve bounded reconciliation and the existing complete-group
eligibility checks. Failures leave unreferenced duplicates, not false completeness.

Late inputs append identities, invalidate dependency tokens and recompute
affected views/summaries. Preserve first-valid versus revisable policies. Pin
input generations per request; a changed dependency restarts resolution within
the original deadline. Missing-to-present dependencies also invalidate reuse.
Snapshot rollback for diagnosis pins an entire compatible vector/policy and
does not overwrite current catalogs. No raw/pack/catalog deletion policy is
authorized here; include retained versions and obsolete packs in storage costs.

## Cost model and latency qualification

Let `D` be complete bounded discovery/LIST/control work, `C` distinct original
owner/sibling catalog GETs, `G` group descriptors, `N` required canonical raw
member GETs and `V` actual dependency revalidation. Optional prepared reads add
`M` representation manifests/shards, `R` coalesced pack ranges and `U` unpacked
tail GETs. Deduplicate owners, pages, groups and controls:

```text
canonical replay operations = D + C + G + N + V
prepared replay operations  = D + C + G + M + R + U + V
```

Preparation helps only when eliminated body requests exceed its additional
control/range/overread work. Descriptor and current-catalog validation
are never assumed free. No grid-head/day-directory saving is assumed. A
missing/changed manifest adds its failed reads and
canonical fallback. At concurrency J, each dependent stage needs at least
ceil(requests_in_stage / J) batches. These are request counts, not milliseconds.

These are a deduplicating resolver's accounting terms, not instrumented counts
of the current implementation. V is explicit because actual callers may perform
additional checks; the earlier equation did not account for it separately.

Opus's static four-grid-family illustration totals 692 catalog + 692 descriptor
+ 813 body GETs = 2,197 before LISTs and other owners, assuming every lookback
publication exists once and short acquisitions each have two pages. It is not
an observed request count or a latency bound, and the smaller 384-body example
below is not a full current-loader census. Instrument actual controls, repeated
loads, pages and bytes before choosing the next optimization: packs cannot remove
the 1,384 control reads in that illustration.

The current KMA source does not implement the proposed shared grid input cache;
body disk caching and a generic resolver's known-key tokens do not supply that
reuse or discover new range owners. The warm path above is a design to implement
and qualify, including complete discovery on refresh where needed.

For one no-conflict new group with `n` raw members and `c` owner/sibling catalogs,
the current publisher performs `1+n+c` PUTs and `3c+n` GETs (preflight, union,
eligibility and raw verification). Add quota-state operations, any experimental
day-directory GET/CAS/PUT work, absence/repair
probes, actual CAS conflicts/retries and any geocoder work. Future protocol
changes need a new measured count, not this baseline. Optional preparation adds
pack PUTs + representation-manifest publication and maintenance source reads.

For scale only, 192 grid nowcasts plus 192 ultra-short publications can mean 384
raw bodies before corrections, other products or control checks. With 32 admitted
data GETs that is at least 12 raw batches. A station's seven-day hourly and daily
range can instead fit two complete single-page acquisitions by row count under
the existing adapter, but cannot supply all missing grid phenomena. Neither
example predicts a real p95/p99.

Measure independent cohorts only after the full required source/field/slot/value
closure is qualified. There are currently zero qualified full-response samples.
Use the same required output/coverage profile:

| Cohort | What must actually be empty/present |
| --- | --- |
| A — FULL_COLD | Weather S3 + RAM + disposable disk empty; public references present; real full required provider calls and normal discovery/admission; publication timed separately after response |
| B | Canonical S3 present, no packs, RAM/disk empty |
| C | Canonical + qualified representation manifests/packs present, RAM/disk empty |
| D | Parsed/response RAM warm; freshness checks and expiry explicitly recorded |
| E | Late revision, shared-station burst, stale/missing controls, pack corruption, quota/timeout/CAS failures |

A seeded-history diagnostic is a separate profile and cannot replace A. B
requires complete compatible inputs, disabled provider fallback and the normal
discovery path; target-catalog shortcuts do not qualify the normal route.
Do not pool warm reuse with S3 restoration. Stop/join background work between
cohorts and settle final counters after supervised runtime shutdown.

Freeze source-policy/parser revisions, routes, town/grid/selector variants,
clock/publications, host/region/network, concurrency and initial object inventories.
Use deterministic recordings to prove exact output/provenance and fault handling;
they do not measure live provider latency. Live sampling needs a declared quota,
owned test prefix and cost budget. Do not multiply full cold acquisition thousands
of times without accounting for provider calls and publication windows.

Report p50/p95/p99 and sample counts per cohort/geographic class. Include deadline,
HTTP and completeness failures in the denominator; a missing normal completion
has infinite normal-completion time for deadline qualification. Report successful
request latency separately rather than hiding failures. Twenty samples are not
a credible production p99 estimate. Plan enough tail samples and uncertainty
intervals within the allowed quota; underpowered live cohorts remain labelled.

Instrument location resolution, quota wait/reservation, each provider attempt,
page chain, raw writes, CAS/verification, S3 ranges, decode/fold/assembly,
serialization and full-body client receipt. Report peak RSS/temporary bytes,
CPU, bytes/operations, source coverage and provenance differences. Distinguish
first partial response, current/forecast-complete response, history-complete
response and durable background completion. Percentiles of stage medians cannot
be added to obtain end-to-end percentiles. Preserve the existing cold-p95 target
as a qualification target, not a finding; no new p99 promise is made here.

## Selected alternative and implementation sequence

The prior three-candidate same-provider comparison selected shared packs as a
conditional accelerator, already sequenced after canonical replay and measurement.
The API-manual-backed reassessment with requested Opus and GPT-5.6 max seats and
a fresh judge is recorded in the [comparison evidence](../evidence/research/kma-storage-reassessment-2026-10-24.md).
The selected revision combines original-group/byte-loader boundaries, a narrow
canonical-first scope and the independently checked runtime/source boundaries.

The selected revised baseline is original canonical raw/catalog replay, public
source-plan candidates and one shared RAM closure. Keep packs conditional, at
the actual body loader, and defer grid heads/day locators until complete discovery
and costs are qualified. Per-grid full-body duplication remains rejected because
shared station/national bodies and revisions would be copied repeatedly.

Opus's descriptor-free single-owner validation is a separate conditional
optimization: reconstruct the exact original declaration without attached group
references, preserve member order/metadata, compare the full derived FetchGroupRef
and reattached envelopes, and retain descriptor fallback. Its missing-descriptor
semantics need explicit qualification. Newest-first short/RSS/mid thinning also
needs field/order parity, not just a more recent issue. Day-owned grid catalogs
change hashed ownership and require a separate migration/repair/dual-discovery
design; they are not part of this unchanged-group baseline.

For later packs, an immutable separate manifest or a verified self-indexing,
digest-named pack are compatible location formats. Both need deterministic
discovery, integrity, bounded reads and measured benefit; neither requires a
mutable grid pointer. The format choice remains unimplemented.

Implementation should proceed through independently verifiable increments:

1. Freeze the exact full public-value/source/slot manifest, including the
   hourly-versus-three-hourly discrepancy. Expose past short-overlay,
   station-boundary, revision, winter-rain and D−7 incompatibilities. The frozen
   SHRT/RSS removal probe changed 82 fields in nine past slots; prepare exact
   value/candidate decision evidence without silently changing either requirement.
2. Qualify automatic historical archive acquisition and endpoint/batch value
   equivalence. If a required vintage is unavailable, report that coverage gap;
   do not replace it with short/mid forecasts or invented observations.
3. Add release reference-plan candidates while preserving exact town selectors,
   one acquisition coordinator and original canonical publication/ownership.
4. Split validated/durable capabilities and gate summaries/caches/tokens. Add
   charged pending overlay ownership, response release, retry and supervised
   drain. Prove concurrency, cancellation, pressure, late-reader visibility,
   promotion/removal generation pins and full-RawId deduplication.
5. After steps 1–2 qualify the entire required response, instrument original
   control/body/discovery costs and shared immutable input closure. Retain
   original discovery and measure continuous provider-to-client
   and S3-to-client cohorts with equivalent output/coverage, persistence timed
   separately. A latest-only measurement cannot complete this step.
6. Qualify any identity-preserving control/newest-first optimization separately.
   Add optional shared packs/representation overlays if measured body fan-out
   warrants them; compare I/O, CPU and retained bytes with canonical fallback.
7. Independently experiment with a bounded hint/original fallback or a proven
   discovery directory only if measured discovery costs justify another protocol.
8. Qualify p95/p99, completeness, quota and memory on the real deployment class
   before any separate activation/cutover decision.

All implementation, fixtures, benchmark harnesses and operations assets for these
increments belong under `server2/`. The original design-review phase changed
only declared maintained documentation/diagram paths and ignored research; it
performed no live provider call, S3 mutation, Rust build or deployment. The
separately authorized [measurement follow-up](../evidence/research/kma-validation-measurement-2026-10-24.md)
adds server2 verification tools and records its actual calls/builds without
changing production runtime behavior or activating this proposed design.
