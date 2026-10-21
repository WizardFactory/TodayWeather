# F2 rainfall ownership specification

Stable task:issue-2819-rainfall-handover; base:c1ae9082b2c86f0087727be9872b0cf82b4e3bb1. Root-selected B with one same-grid CAS batch, typed minute results and cancellation/immutable snapshots. Root selected this contract after independent A/B source comparison. The canonical stage gate precedes implementation; no production handover is claimed.

## Observable behavior

Confirmed absent activation serves existing seeded station values and performs zero rainfall-state writes. An unreadable, malformed, mismatched or unsupported authority must **not** be treated as absent: station getters return the existing partial StoreError path, never a silent baseline or stale-statistics substitute. Other weather sections keep their current behavior; affected S16 completeness is false. The same rule applies to cold and warm current requests. An already delivered immutable snapshot remains unchanged.

A qualified native current-window decision increments each eligible original station-document identity once. Keep original cumulative values, field absence, isMountain, registration ordering and existing public filters. No original Mongo write, extra provider/backfill, startup scan, timer, nationwide coverage guarantee or new verification mode. Demand is only the grids current requests actually load. Native statistical writes start only after acknowledged valid activation, declared shutdown time and eligible window.

## Private original identity

Parse original EJSON `_id: {"$oid":24hex}` to a private12-byte identity sidecar; preserve it through StationSeed and Registry. Activation requires every source document to have exactly one valid unique identity. Do not expose it in public JSON, replace it with ordinal/stnId, or merge duplicate stnId documents. Existing unactivated reader fixtures without imported identity may remain compatible; they cannot activate. New native-discovered stations without a persisted source identity are not F2 candidates.

Activation binds exact final seed bytes/source hash/export time/count and a canonical sorted ObjectId set/baseline digest. Pin this seed while active; never adopt a newer import as a counter reset. The existing exporter/importer already preserve original raw lines and need no business-logic rewrite. Public Registry output remains in its natural order and overlays only the two statistics fields by ObjectId.

## Exact schema1 control body

Fixed key:`index/v2/statistics/rns/state.json`. JSON object keys below are required, duplicate/unknown fields rejected recursively. Rows are sorted by canonical ObjectId bytes and match the activated seed identity set exactly. ObjectId is lowercase24hex on wire. Digest/epoch fields are lowercase64hex. Null is an explicit absent value, not zero.

```
Checkpoint = {schema:1, revision:SafePositive, activation:Activation, rows:[StationState]}
Activation = {
 epoch:Digest, policy:"flat-minute-rnshit-v1",
 target:{bucket:BoundedBucket, region:BoundedRegion},
 source:{store:"mongo",database:BoundedDatabase,collection:"kmastninfos"},
 seed_body_sha256:Digest,seed_source_sha256:Digest,
 seed_exported_at_ms:SafePositive,seed_documents:1..1024,
 seed_identity_sha256:Digest,baseline_sha256:Digest,
 shutdown_at_ms:SafePositive,shutdown_evidence_sha256:Digest,
 first_end_ms:SafePositive,
 first_end_basis:"full-post-shutdown-hour"|"legacy-highwater",
 legacy_highwater_ms:null|SafePositive
}
StationState = {
 oid:ObjectId,rns_hit:null|FiniteCounter,rns_count:null|FiniteCounter,
 last_end_ms:null|SafePositive,receipt:null|WindowReceipt
}
WindowReceipt = {
 end_ms:SafePositive,cutoff_at_ms:SafePositive,grid:[ValidNx,ValidNy],
 current_sha256:Digest,minute_sha256:Digest,batch_sha256:Digest,
 row_count:15..60,sensor_count:1..row_count,hit:bool
}
```

SafePositive is an integer in1..2^53-1. Counter is the existing optional finite f64 within abs<=2^53-1, preserving its value rather than casting/rounding; every qualifying post-increment must remain within bound and increase count. No new integral-only/hits<=count baseline condition. Row receipt and last_end are either both null or have equal end; a receipt implies qualified count contribution. Initial revision1 has baseline counters and null receipts/ends. Subsequent updates increment revision exactly once, replace only eligible row counters/end/receipt and preserve activation/other rows exactly. Body<=1MiB applies to the **same exact encoded buffer** passed to PUT/readback. Numeric/body exhaustion blocks without truncation/reset.

Activation is an operator-only write-if-absent of the complete initial body, read back exactly before acknowledgement. Runtime never creates/recreates or migrates it. Database is1..64ASCII bytes without controls, bucket<=63 and region<=32 using existing S3 validation. Missing/invalid target/source/policy/seed binding rejects writes and station overlay. A later epoch/policy/seed migration is not implemented by this increment. Any already pinned owner observing another epoch blocks; old in-flight ETags cannot overwrite a changed authority.

Both future eligible full releases/configurations must support this identical schema1, policy and overlay. Unknown fields/version fail closed. No additive-compatibility rule is invented. Pre-F2 seed-only releases are ineligible; full recovery keeps the authority and accumulated values, never an old seed or S3 version rewind.

## Handover time

shutdown_at_ms and seed export/cutoff are real UTC instants. Observation end/legacy_highwater are legacy KST wall-clock labels encoded by existing KMA time helpers. Convert explicitly; do not compare fetched_atUTC with a station row wall time. Final seed export must not precede the declared shutdown. Native commit clock must not precede shutdown; clock rollback blocks a violating attempt.

For full-post-shutdown-hour, legacy_highwater is null and first_end's one-hour lower boundary is at/after shutdown converted to the observation convention. For legacy-highwater, a proven last legacy end is required and first_end is strictly later; preserve the referenced proof. Candidate current ends must be valid canonical Current observation instants and>=first_end. The inspected Current source uses provider baseDate/baseTime; this is the hourly observation date/time, not a freely chosen minute bucket. A complete final seed has no implied last legacy receipt. Code validates the declared values/digests, not actual process exit, frozen ingress or export completeness. Those remain separately authorized operational evidence.

## Complete input and deterministic replay

Use only existing complete acknowledged single-record `kma-web/aws-minute`, key`aws-national` acquisitions. The inspected web acquirer publishes exactly one raw response per acquisition. No ASOS hourly/daily history, nearest station, public20-minute OR or rs15m correction. The public40-minute fold remains unchanged.

At owned work start capture a real UTC availability cutoff. Enumerate the one/two relevant day catalog controls completely with existing Catalog validation, record their body hashes/validators and select **all** immutable member IDs whose minute publication is in the observation interval and fetched_at<=cutoff. Require publication/envelope/parsed page dates to agree. For each selected ID, existing lookup_acquisition verifies S06 group/member/raw; require one raw minute record. Recheck the original catalog controls after reads. Targeted coverage alone is not full-window coverage: a changed/missing control, selected member/group exclusion, incomplete enumeration or failure yields Incomplete/Unavailable. No early stop by fetched-time order or dropping revisions to fit bounds. This is a validated observed catalog view with cutoff, not a global atomic snapshot or proof that all cross-process writes fetched before cutoff have already become visible. A remote writer can publish a late catalog member after recheck, even with an older fetched timestamp. First qualifying decision freezes the rows actually validated for that end; no later retrospective correction is promised. Do not describe the cutoff as a globally complete acquisition watermark.

Order all revisions using existing immutable `identity_order`: fetched_at,raw_sha256,period.local_date,period.slot,source,kind,key_sha256. This matches S06 single-record ordering. Apply parsed rows through RowStore::save, including omitted-field preservation, then select actual station rows in `(end-1h,end]`. Numeric sensor joins use the existing Number cast; registry ObjectIds remain distinct. Missing rns counts as a row, absent minute timestamps do not. For each original ObjectId, the receipt covers 15..60 exact unique minute timestamps after RowStore merging; duplicate page/revision copies do not manufacture rows. Preserve each original identity once in the checkpoint; duplicate stnId documents remain independent original identities. Require15rows, at least oneSome(bool), hit if anytrue, and rain iff pty>0 OR rn1>0; then unchanged rnshit::update.

The proposed private replay result is Ready(immutable rows/evidence) or NotEligible(no rain/insufficient/all-missing/no exact grid); partial selected storage scope and error/deadline/capacity propagate typed errors as incomplete/unavailable station outcomes, not successful MinuteResult variants. None consumes a window except an actual qualifying commit. Later qualifying input for an uncommitted current end remains retryable. Deterministic replay is the statistics policy; it is not falsely described as identical to warm public entry/or_insert selection.

CurrentWitness uses the station's exact geo grid and existing complete current saver projection/final logical current row. Select the final canonical Current row in existing fcsDate order, retaining its actual provider observation date/time and unchanged precipitation values. Derive end exclusively with the existing KMA conversion of that row's date+time (originating from provider baseDate/baseTime). Missing, malformed or inconsistent row/date/input binding cannot produce Ready. Do not substitute request now, floor(now), cutoff, latest available schedule, fetched-at or the HTTP request's minute. `grid_documents` uses now for input visibility/retention; it does not create a new observation date. A repeated canonical observation at distinct request times or after raw acquisition refresh has the same end and cannot increment twice. A new canonical Current observation may qualify a later end. This follows legacy _updateRnsHitRate's use of the final currentData row date+time, while the chosen native forward-only policy deliberately prevents its repeated invocation from recounting the same observation. Never substitute the requested town grid, hourly/daily station data or nearest-ASOS current. Preserve original raw identities; a request-private visible() clamp is not a canonical statistics identity. current_sha256 binds the exact current view/grid/end/precipitation and original input identity sequence; minute_sha256 binds policy/cutoff/selected raw identities and retained station rows including missing sensors. batch_sha256 binds epoch/read revision/sorted targeted OIDs/pre-state and those immutable input decisions. Use canonical domain-separated encodings specified with the implementation tests, not an unordered set digest.

## Atomic owner and visibility

After source::build has a complete current result, offer only imported documents whose exact own geo grid matches it. Validate minute input for each distinct accepted grid/end decision and batch all qualifying still-uncommitted document identities into one CAS; P2 below permits projection reuse only after independent full validation. Each row computes from freshly acknowledged checkpoint counters. End<=last_end is AlreadyObserved/Ahead, never another count or correction. On412 reload/filter/recompute; preserve unrelated rows. No permanent receipt log or retrospective late-window backfill.

The proposed P2 topology below separates read tickets, distinct owned intents, shared heavy flight and one writer; it supersedes the original single-running-job/eight-queued-offers profile. Dropping an HTTP waiter cannot cancel started commit/reconciliation. No Observations lock or assembly CPU permit is held across awaits. Quiesce refuses offers; existing process shutdown drains started work within its current deadline, reporting incomplete rather than inventing success.

Only a200 PUT or validated readback authorizes a new immutable overlay. On unknown do not optimistically project or automatically resend original bytes. Readback may recognize exact receipt, another same-end decision, or Ahead; Ahead is not proof of the earlier historical PUT. A later fresh demand may propose a still-uncommitted current end against a fresh ETag; test both delayed old-PUT orders. No void/journal/pending-delta replay/reset. Current acknowledged S3 state is authoritative after restart.

Every current station section uses the validated complete overlay or partial-failure, including warm errors. All snapshots already handed out are immutable. Update the Registry/S16 identity on acknowledged statistics changes; never record complete S16 inputs from a failed statistics overlay. Other section behavior/acquisition budgets stay unchanged.

### Fixed digest encodings for schema1

All digests are SHA-256 of compact UTF-8 JSON arrays serialized by the pinned Rust serde_json encoder; no trailing newline. Strings remain strings, optional values encode null, integer values stay integers, and counters retain f64 encoding. Ordered lists are never converted into sets. These domains and array positions are part of policy flat-minute-rnshit-v1:

- Identity set:`["rns-identities-v1", [sorted canonical oid strings]]`.
- Baseline:`["rns-baseline-v1", seed_body_sha256, [[oid,rns_hit_or_null,rns_count_or_null] in oid order]]`.
- Raw member tuple:`[source,kind,key_sha256,local_date,slot,fetched_at_ms,raw_sha256]`; sort by the existing identity_order tuple described above, not tuple serialization order.
- Current:`["rns-current-v1", policy, [nx,ny], end_ms, sha256(existing ordered current Doc JSON bytes), [[family,start_ms,end_ms,fetched_at_ms,content_sha256] in original S16 input order]]`. The Doc encoder retains existing special-number response behavior; original identity sequence prevents different raw inputs being hidden by a rendered-null value. No private visibility-clamped completion is substituted.
- Minute:`["rns-minute-v1", policy, cutoff_at_ms, numeric_sensor_id, [[catalog_key,generation_or_null,body_sha256_or_null,etag_or_null,version_or_null] in catalog-key order], [ordered raw member tuples], [[numeric_sensor_id,date_wall_ms,rns_or_null] in ascending date order]]`.
- Batch:`["rns-batch-v1", epoch, read_revision, [nx,ny], end_ms, cutoff_at_ms, [[oid,old_rns_hit_or_null,old_rns_count_or_null,old_last_end_or_null,current_sha256,minute_sha256,row_count,sensor_count,hit] in oid order]]`.

Identity/source/current metadata is private evidence, not a public API field. A later encoding or policy change is a new reviewed migration/recovery qualification, not a silent schema1 additive field.

## Selected fixed admission profile

# Static basis and selected code-admission limits

This is offline analysis, not a handler/test/build/RSS/S3 measurement. `size_checkpoint.py` reads the repository seed and emits synthetic schema shapes. Synthetic activation timestamps/digests are **not valid handover evidence**.

Actual seed:183,019B,776 documents and776 unique original ObjectIds;965 and989 occur3times each as station IDs. Both stats fields are present in695 documents and absent in81. rnsHit ranges0..1020; rnsCount1..1102. All observed counters are finite nonnegative integral values. This inventory is not the final live export and does not justify normalizing other valid numeric baseline values.

| Selected F2 bound | Rationale and failure outcome |
| --- | --- |
| Activated documents<=1024 | Covers the actual776 with bounded membership. A larger final export blocks activation; no truncation. |
| Exact encoded checkpoint<=1MiB | Static Python JSON: initial776 shape80,716B; all776 rows populated with maximum receipts/counters393,730B;1024-row conservative24-byte/f64-token bound531,507B. Headroom517,069B. This is not Rust encoding proof: check the exact final buffer before every PUT and preserve it for readback. |
| Counter values finite, abs(value)<=2^53-1; checked post-increment within same bound | Preserve optional f64 baseline and legacy addition, without integer casts/rounding/reset. Missing remains missing until qualification; saturation/nonfinite outcome blocks. No new hits<=count or integer-only baseline rule is inferred. |
| Revision and timestamp integers positive and<=2^53-1 | No f64 saturation or wrap. Row last_end/receipt must agree; initial rows have both null. |
| Epoch/digest64lowercasehex, ObjectId24hex normalized to12-byte identity | Reject duplicate/missing ObjectIds at activation; private metadata only. |
| Source database<=64ASCII bytes; target bucket<=63/region<=32; exact collection/store/policy literals | Fixed-schema bounded metadata; actual environment values remain private operator inputs. |
| P2:128 read/delivery tickets,8 distinct mutation intents,same-grid/end join,9 delivered versions;1 in-flight authority probe/1 heavy flight/1 CAS writer; existing<=4 input lookups | Separate read classification from mutation/parse capacity; no new S3 class, TTL or timer. Required active work over capacity is partial/retryable, never baseline. |
| Input catalog controls<=1MiB each, at most2days,<=2048entries each | Explicit selected F2 limits; validated metadata first, without full-day raw loading. Changed/malformed/incomplete enumeration cannot produce Ready. |
| Selected complete minute acquisitions<=256; total selected raw<=16MiB; each raw page<=1MiB | Admits a normal60-minute set with revisions while refusing excessive work. These are new F2 input-admission limits, not a statement about live sensor availability. No dropping revisions to get under the cap. |
| At most60distinct observation minutes per sensor/window; projected rows<=60*1024 | Require the existing minute publication format and matching envelope period; RowStore dedupes station/date. Missing timestamps are not invented rows. Projection only needs stnId/date/rns after existing parse. |
| One64MiB logical scratch reservation plus16MiB raw/provenance budget, released by actual job completion | Proposed process-local admission, not hard allocator/RSS enforcement. Existing HTML parser has owned dynamic containers and no allocation-meter API. Bound input before parsing, release day/control/raw work promptly, enforce retained projection limits, and measure actual adversarial parser peak before claiming adequacy. Do not import a global allocator or rewrite shared HTML parser under F2. |
| Owned work deadline3s, CAS attempts<=4 including rebase; existing process drain deadline unchanged | Existing S06 default deadline/CAS count are comparison inputs. Timeout retains acknowledged state and yields typed failure, not incomplete-data success. Actual feasibility/performance must be measured locally; no production cadence claim. |

Transport proof: actual catalog_transport.rs has an8MiB maximum control-document guard; GET accepts200, maps404 distinctly and returns an opaque ETag; PUT uses if-none-match:* or if-match, sends the exact supplied body and returns the exact status. Runtime should recognize only200 as immediate acknowledgement,412 as conflict, terminal rejected4xx separately, and ambiguous transport/409/5xx through readback. The adapter itself performs no retry/reconciliation. These statements were verified against the newly frozen actual file, not the judge's missing source.

The one-hour bound cannot be implemented by stopping a fetched-time-sorted page scan at an old observation publication: late revisions can arrive later. Full validated metadata enumeration plus selected targeted reads and post-validation provides the declared window snapshot. It does not assert a global atomic remote snapshot against arbitrary simultaneous external writers.

Required later evidence: exact Rust serialized maximum-case bytes; source/input/binary-bound successful full-hour owned check and all failures; actual heap/RSS under admitted maximum raw/HTML shapes, cancellation with blocking parse still running, queued/busy and body/row/revision exhaustion. If the proposed scratch/input profile is inadequate, root must narrow the accepted input profile or approve a scoped implementation change before claiming the bound. Static776-row arithmetic alone is not a memory or throughput PASS.

The profile above is selected as conservative local code admission, not a hard whole-process/RSS guarantee. ExactRust encoded maxima and actual admitted shape/CPU/memory measurements remain implementation acceptance; failure must return to root, not silently raise caps or reduce the corpus.


## Failure-informed optional wait and owned pressure fixture
Current focused16/library3/normalHTTP4 proof is retained, including exactseed pin, canonical Current availability, S16 stable input identity and existing peer persistent connection fix. Two initial11pass/5setupfail runs with TIME_WAIT up to34000 and the subsequent16PASS/194 comparison remain distinct; no OS setting or runtime concurrency change was used.

Actual same-corpus fresh process comparison establishes an optional-wait defect: inactiveHTTP200/.689s, activeHTTP502/3.005s, then actual owner drain/acknowledged revision2 with3/5. Keep this failing response as a product regression. Reserve a fixed10ms from the caller's outer request deadline for return/partial assembly, only in the optional rainfall wait. The original source-owned3s deadline, queue, blocking reservation, CAS4, full-window/forward-only/durable semantics and all byte/count limits remain unchanged. If the caller has no positive wait time, return typed unavailable without consuming the remaining response budget. Do not claim a mathematical wall-clock response guarantee from10ms; prove actual boundary races and normal native HTTP partial response. An optional timeout means station partial/S16 incomplete, never a seeded or stale statistics substitute. The detached already-admitted owner may complete and commit; later requests read the acknowledged state. No original uncertain PUT resend and no mutation of already returned snapshots.

Prove timeout/delayed-owner and simultaneous-ready timer paths with actual existing interfaces, then repeat the same pressure corpus/binary-bound native HTTP: valid core weather200 with explicit station partial if optional wait expires; actual owner drain and later acknowledged read. Do not change the old502 assertion into an accepted result. Current raw input and workload bounds are not reduced.

The existing ordinary owned peer retains64 versions per object. Preparing up to256 selected raw acquisitions updates a day catalog more than64 times, so its507 is a fixture setup cap, not runtime acceptance. Add a separate explicit TEST-only rainfall profile with16384objects/64MiB store and512 versions per object; default and existing warning-fanout profiles retain their exact prior limits. Use a pure profile selector/checks, reject incompatible simultaneous profiles and record the selected profile in the runner receipt. No production peer/config/deployment change or unlimited resource override. Exact test paths were declared before edits.

Whole-process pressure RSS431MiB versus inactive127MiB is observed, not attributed entirely to one allocation or compared as if64MiB logical scratch were a hard RSS limit. Required memory assessment separates raw/metadata, shared full HTML parser/Vec<char>/Document/full rows, projected RowStore, repeated per-sensor digest inputs and ordinary source restore. A Parse-only/load-only counterfactual may use the exact same physical admitted raw corpus in a child after source declaration; keep feasibility/memory outcomes and do not silently raise limits, rewrite the shared HTML framework, or label unresolved adequacy PASS.

The selected existing minute input is kma-web/aws-minute from cgi-bin/aws/nph-aws_txt_min, matching the current legacy KmaStnMinute2 flat upsert, not a new official ASOS minute API. Circle○ maps false, filled● true, missing None; numeric sensor join does not establish nationwide live ASOS coverage. Synthetic108/112 rows are compatibility tests, not coverage observations. No new collection schedule, provider or live call.


## Qualified caller-boundary correction3

The selected terminal-qualified samephysical page run returns Snapshot with6.447584ms left, starts the real blocking store-read chain and returns HTTP502 before that chain retires. Optional rainfall waiting must share the existing Source `until` (outer deadline minus its existing500ms answer reserve), rather than spending that reserve. Public3s and existing200ms section adjustment remain unchanged; no new margin or timeout increase.

Owner admission, caller wait and owner completion are distinct: keep the existing outer-deadline10ms admission guard; admitted work retains its original3s from offer including queue/CAS/readback and survives the caller. Add an explicit caller-ready cutoff to the private offer seam. Wait only until min(Source until, outer deadline minus10ms), without subtracting10ms again from Source until. If Source until has already elapsed but the original outer admission guard permits admission, accept one bounded offer and return Timeout/unknown to the caller immediately; do not starve background forward progress or invent absent authority. If the original outer guard has expired, admit nothing.

After awaiting even an already-ready oneshot, check the actual monotonic caller cutoff before accepting its value. At or beyond cutoff, choose station-partial even if the result and timer are simultaneously ready; no seeded/optimistic counters or S16 input stamp. This explicitly replaces the earlier validated-ready-wins caller race for this optional seam. Actual acknowledged work remains durable for the next demand. Before cutoff, preserve exact acknowledged-state checks and absent activation/no-write behavior.

All current raw/HTML/JSON/identity/seed/revision/None rules and CAS4 remain; the P2 section replaces one-running/eightoffers. Physical16MiB/256acquisition/1024OID caps and original one-hour/min15/anytrue statistics stay. This correction does not reduce parser allocations or qualify a64MiB physical heap/RSS bound. The prior matched large-page453263360B whole-child peak remains a measured limitation for later whole-candidate capacity work. No parser change is selected.


## P2 concurrent demand and replay ownership — proposed design4

This section replaces the earlier one-running-job/eight-queued-offers topology and the topology-reuse statement in design3. It is a proposed contract for the unapplied P2 runtime candidate; root must renew the canonical gates before implementation. Old runs, review findings and failures remain evidence for their actual source, not P2 execution proof. RF-CLAUDE-007 is unselected; reviewer disposition remains root-owned.

### Independent clocks and same-grid decisions

Each accepted distinct rainy grid/end decision records its original offer-entry monotonic deadline D_i=A_i+3s, including probe/queue/validation/parse/writer/CAS/readback. At that owned decision's first execution, before any awaited authority or input I/O, sample its exact UTC input cutoff C_i once. Never round, share an earlier cohort cutoff or resample after waiting. A later same-grid/canonical-end offer joins the existing accepted decision before the eight-intent limit; it observes that decision's acknowledged result, with its original witness/C_i/D_i. It does not claim a new receipt for the joiner's clock/witness or add a second contribution. Different grids/ends remain distinct. Existing Current identity, HH40 availability and digest encoding remain unchanged; no new Current fetched-time guard is introduced.

Keep the independent caller boundary min(Source.until, outer deadline−10ms) and outer−10ms admission guard. An elapsed Source cutoff with still-valid admission may start owned work once but returns Timeout/partial immediately. Actual monotonic expiry is checked after await, including already-ready results. Joining cannot extend the original decision deadline. No public3s, answer reserve or shutdown deadline changes.

### Read authority without spending mutation capacity

Admit at most128 live read/delivery tickets. All demand must classify the authority, even with no Current, observed-dry Current or excess distinct mutation demand. One actual overlapping in-flight probe performs a fresh strict targeted read and exact complete S06 seed/baseline validation. Remove its joinable entry before publishing completion. There is no completed authority cache, negative cache or TTL. Same-state Arc reuse is storage sharing after fresh validation, never read authorization.

Register the first eight distinct tentative rainy grid/end intents synchronously before the first await; detach their work before waiting for the caller. Same-grid join uses only a reader ticket. NoCurrent/dry readers use no mutation slot. Additional distinct candidates still classify authority: confirmed absence gives baseline; active required mutation work without a slot gives typed Capacity/partial. The129th reader is Capacity/unknown, never absent.

Confirmed404 before any active pin is the sole baseline outcome and writes nothing. Malformed/unknown/unavailable/foreign/changed-epoch/rollback authority, missing exact imported seed and active-pinned disappearance fail closed, including warm noCurrent traffic. A delayed absent result cannot replace a newer active pin. Normal40 absent requests, including noCurrent, must remain readable; normal40 active/noCurrent requests receive validated overlays without replay/PUT. Normal40 same-grid eligible requests share one canonical decision rather than rejecting the ninth caller.

### One shared heavy flight; independent full validation

The coordinator alone acquires the single heavy logical workspace reservation. Same trusted namespace/verified epoch/exact seed/end intents join its bounded flight membership BEFORE full input equality is known; they never reacquire the global reservation to validate a resident view. A flight-local scheduling cursor serializes complete independent validators. It is not an assembly CPU permit. Hold neither a CPU grant nor Observations/coordinator mutex over I/O.

Every independent decision enumerates the complete one/two day catalog controls using its own C_i, selects all revisions in (E−1h,E] with fetched_at<=C_i, validates each complete singleton S06 acquisition/dependencies/body and rechecks original controls. Only exact typed equality of the ordered FULL Envelopes, with matching namespace/epoch/seed/E, permits projection reuse. Hash/raw identity equality alone never authorizes reuse. Different catalog/cutoff bindings still produce each decision's own unchanged rns-minute-v1 digest. This deduplicates HTML projection only, not S06/raw network validation.

The first producer retains one selected raw vector<=16MiB and parses all numeric sensors from the exact pinned seed once. Later validators stream one page/raw at a time rather than retaining another full vector. A mismatch retains neither a second vector nor another parse: release its view membership/references, avoid that flight serial, wait for physical retirement under its original C_i/D_i, then independently revalidate for a fresh flight. Current publication, row/sensor/page/raw limits and all revision ordering/RowStore/None rules remain unchanged.

H is fixed from the oldest relevant live original deadline at flight creation, not now+3s or producer completion; a later departure never extends it. Pending owned validators and validated unsent writers retain their old-flight membership after the producer finishes. Validated old writers cannot become ghost members of a later flight. Remove the joinable entry at last-member retirement or observed H expiry, prohibit new use/send at H/D_i, and retain actual closure/output references until physical retirement. No completed-view TTL. Blocking parse and its output hold the one workspace through actual exit/last drop even if a JoinHandle/caller is cancelled. Physical release by3s is not promised. Already submitted immutable bytes may reconcile by readback under original D_i; no resend or new proposal after H/D_i.

### One writer and bounded immutable delivery

One CAS writer applies each decision's immutable facts to freshly validated authority: preserve unrelated rows, skip same/ahead ends, rebase412, at most four conditional attempts. Only200 or validated readback acknowledges a new overlay. Unknown transport/409/5xx uses readback, never original-body resend or optimistic counters. Fresh reads and acknowledgements reject lower revisions and same-revision content/counter-bit equivocation. A real immutable earlier ACK may be delivered after a later ACK within its own original caller/D_i/H bounds; caller scheduling order is not authority rollback.

Keep at most nine distinct delivered checkpoint payload versions in a weak intern pool. Equal freshly validated states share Arc payload and stable first_seen/S16 identity; dead slots are reclaimed. Capacity failure returns partial instead of older state, while a real durable acknowledgement remains internally pinned. The128-ticket lease survives overlay clones through Source seed-refold/application, releasing on the last drop. The exact bound seed Arc is reused only after fresh proof. No raw/projection view escapes into public snapshots.

### Exact seed and error semantics

Always establish complete exact S06 seed acquisition/raw presence even when a supplied candidate file already has the expected body hash. Strict intrinsic schema and external trusted target validation precede deriving that single fixed-source identity. Then validate whole seed/body/source/export/count/OID/baseline binding. Operator verify is read-only and uses the same proof; activate requires it before its one write-if-absent/readback. Local preview validates the file only and cannot certify imported presence. Operational database/shutdown truth is not attested by metadata that lacks it. Hourly fold captures and returns the exact seed used to bind its registry, including cached reuse; a concurrent later seed pin cannot relabel it. Selected full-envelope/identity disagreement is Corrupt, whereas byte/count admission exhaustion is Capacity. Shared S06 already detects metadata mismatch; no observed counter defect is inferred.

### Unchanged profile and honest capacity qualification

Read tickets128, distinct mutation intents8, delivered versions9, one actual authority probe, one heavy flight/validator and one CAS writer bound multiplicity. Original limits remain: checkpoint body1MiB/1024 OIDs, at most2 catalog days/2048 entries each,256 selected acquisitions/16MiB selected raw/1MiB per page,1024 numeric sensors/61440 projected rows/60 minutes per sensor, CAS4 and original3s. The64MiB workspace is a LOGICAL reservation, not allocator accounting or hard heap/RSS enforcement. No allocator/string/decode framework, new partition, cap increase or corpus reduction is selected. Existing strict serde/schema remains; malformed body1MiB limits input bytes, not a proven allocation envelope.

Measure actual row/string capacities Q and held-version multiplicity separately from whole-process RSS. Nine delivered versions plus conservative latest/probe/writer-base/writer-candidate scratch can mean up to13 distinct Q payloads before aliasing; that ledger is an assessment envelope, not a hard allocator guarantee or a new four-slot implementation promise. Include raw/catalog/projection/facts/encoded/transport/parser transients and actual owned references. The small two-row private Q print is not1024-row or RSS qualification. Preserve prior453,967,872B whole-child peak and original DOM expansion limitation; no memory-fix claim. The2.558s observation is whole HTTP latency, not measured per-grid parse time and not an eight-grid latency estimate.

Quiesce rejects new offers; accepted detached intents/probe/reconciliation remain owned. Drain covers owned rainfall work and physical heavy reservation within the existing process deadline, not downstream global assembly/CPU/wire completion; child reap is separate evidence. No provider/startup read/timer/scan/cloud activation or actual cutover is introduced.
