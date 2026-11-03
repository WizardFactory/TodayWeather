# KMA response-first serving and recovery — 2026-10-24

## Decision

Select a **validated RAM response followed by supervised canonical S3
persistence** for foreground provider acquisitions. AK explicitly accepts
possible loss of already-served original raw on process failure before S3
publication, with recovery measures. Assembly occurs before each response;
S3 restoration and assembly serve a later request.

```text
provider -> complete raw validation -> RAM assembly -> response -> S3 publication
later request -> verified canonical S3 raw -> same RAM assembly -> response
```

This is an accepted design amendment, **not implemented/deployed behavior or a
new latency result**. Current code still waits for S3 publication before exposing
new raw. The [updated sequence](../../architecture/diagrams/server2-kma-data-design.html)
shows the proposed order; [the main design](../../architecture/server2-kma-data-design.md)
retains the canonical format, source/value gates and conditional pack scope.

The later [continuous-timer prototype measurements](kma-response-first-measurement-2026-10-24.md)
record provider-to-client and targeted S3-to-client results for seven latest
products, including the background-discovery caveat. They do not switch the
production runtime or qualify the required historical window.

**Qualification correction, 2026-10-25:** the lead's latest-only experiment was
not an authorized reduction of the requested client data. Its partial-response
timings do not complete the requested verification. The client must retain its
required historical data and values; acceptance of raw loss after a served
response applies only to subsequent persistence, never to response omissions.
The [full-response reassessment](kma-full-response-reassessment-2026-10-25.md)
reopens qualification: current native FULL_COLD is BLOCKED; full canonical
restore is NOT_QUALIFIED. Its fresh Opus 5.5/max source review and focused
correction cover the full requirements, not the reduced prototype's timings.

One independent Claude Opus 5.5/max review recommends this direction with gates.
A focused follow-up accepts writer ownership before readiness broadcast and
identifies gate-liveness and overlay-promotion races to prove. The lead checked
the material implementation spans and integrated compatible findings. Model
agreement does not prove output equivalence, concurrency safety or performance.

## What changes and what remains authoritative

`LiveForecast::publish` currently awaits `CatalogStore::publish` before returning
records, and `Published` means published raw. The acquisition flight exposes that
result. Initial partition discovery and canonical reads also precede the latest
miss/acquisition decision. Detaching publication therefore removes a storage
dependency but does not by itself eliminate discovery.
([publication](../../../server2/src/domestic/kma/source/fetch.rs#L199),
[result type](../../../server2/src/domestic/kma/source/fetch.rs#L76),
[flight](../../../server2/src/domestic/kma/source/mod.rs#L1409),
[initial reads](../../../server2/src/domestic/kma/source/mod.rs#L532))

Introduce separate private capabilities for `ValidatedAcquisition` and
`PublishedAcquisition`. These names describe the proposed interface, not existing
implemented types. Only the real canonical publisher can produce the durable
capability. Provider validation, complete page-chain/publication checks, original
member/owner identity, raw hashes and deterministic descriptor/attachment checks
remain mandatory before RAM readiness. Pure preparation should be shared with
publication; storage-dependent catalog preflight, immutable writes, CAS unions,
sibling eligibility and raw read-back remain with the writer.
([provider checks](../../../server2/src/domestic/acquire.rs#L468),
[group construction](../../../server2/src/domestic/acquire.rs#L846),
[preparation and publication](../../../server2/src/storage/catalog.rs#L835))

Do not pass already-attached envelopes back as original unmodified member
envelopes: `attach` checks exact member equality. Original canonical raw identity
and ownership stay unchanged. The lead verified `RawRecord.bytes` is already
`Arc<[u8]>`; cloning records shares body allocations. Charge actual retained
bodies, envelope metadata and outstanding pins rather than assuming either free
memory or a deep body copy.
([attachment](../../../server2/src/storage/catalog_model.rs#L370),
[raw ownership](../../../server2/src/storage/codec.rs#L212))

Canonical complete groups remain the sole durable S3-restoration authority.
Foreground RAM readiness is a new volatile serving authority. Backfill remains
durable-before-visible. Neither a ready provider group nor a targeted raw read
proves the whole required historical window.

## Ownership, readiness and cache gates

One coordinator owns natural-provider-scope admission, quota, acquisition
single-flight, retry memo and handoff. One supervised local writer owns each
batch's pending overlay, persistence and drain. Reserve pending group/byte
capacity **before** provider work. Hand the charged immutable batch to its owner
before broadcasting readiness; HTTP cancellation and an owned-flight timeout
must not leave it ownerless.

The current KMA flight map retains completed results for three seconds, while
latest retry suppression lasts five minutes. A writer-owned overlay must remain
readable beyond flight retention, or a later request could find empty S3 and a
memo that prevents reacquisition despite usable raw still being held.
([KMA flight bounds](../../../server2/src/domestic/kma/source/mod.rs#L269),
[retry memo](../../../server2/src/domestic/kma/source/mod.rs#L193),
[latest retry interval](../../../server2/src/domestic/kma/source/mod.rs#L1380))

Use the existing request-own visibility rule only for waiters that actually join
the acquisition. Later overlay readers use the true original `fetched_at` and
normal request cut. They must not repeatedly clamp a newer acquisition into an
older snapshot. Preserve the late-input oracle.
([visibility](../../../server2/src/domestic/kma/source/mod.rs#L1483),
[oracle](../../../server2/tests/domestic/source_s3_oracle.rs#L307))

Snapshots containing volatile data cannot claim durable dependencies. S16
summaries must not cite raw that may never exist in S3; pending inputs suppress
durable summary admission. The same durable-only rule applies wherever result
or disk caches and catalog/dependency tokens are used. This does not assert that
every generic cache is wired into the current KMA request path.
([summary handoff](../../../server2/src/domestic/kma/backend.rs#L179),
[summary reproducibility](../../../server2/src/summary/mod.rs#L14))

Pin an overlay generation before discovery, retain relevant entries through all
older discovery readers, and deduplicate canonical/overlay contributions by
full RawId while preserving original acquisition boundaries and fold order.
Otherwise promotion can produce either zero copies (S3 read before publication,
overlay removed afterward) or two copies. Durable or failed-state removal needs
the same reader-pin discipline; do not silently stitch conflicting groups.

## Response boundary and bounded work

Writer ownership begins at readiness, but normal weather PUT release follows a
response terminal boundary. Freeze the eligible waiter set at readiness; later
overlay readers do not extend dormancy. One terminal response releases every
batch it consumed. No remaining waiters also releases already-acquired work.
Dormant batches retain charged bytes without occupying writer concurrency slots.

An eligible response can complete, fail or be dropped. A drop guard and bounded
request/dormancy handling must cover slow readers and connection resets; shutdown
releases dormant batches into bounded drain. A cap that forces an abnormal
termination is recorded as such, not a completed successful response. Verify the
actual body-lifecycle hook. Handler return, body polling/drop, socket flush and
remote app receipt are different events; ordinary HTTP provides no application
receipt acknowledgement. Do not add a mobile acknowledgement protocol under
this design.

A verification-owned client can signal its full-body receipt directly to a
prototype's writer gate, proving that ordering for that test. Label this gate;
it does not establish the unmodified production transport's remote receipt.

Provider quota funding remains before provider HTTP. Instance-local single-flight
does not provide global deduplication: preserve S08 per-key/API/KST-day quota
authority and canonical immutable/CAS merge behavior across instances.
([daily budget ownership](../../../server2/src/domestic/kma/source/observe.rs#L1660))

## Recovery contract

| Situation | Action | Remaining limit |
| --- | --- | --- |
| Process alive, storage timeout/5xx | Retain exact original raw/declaration and retry with bounded attempts/backoff; check ambiguous publication through original eligibility | A response already received cannot be revoked; no provider refetch replaces bytes still retained |
| Descriptor and all original raw survived, catalogs incomplete | Complete finite original repair; validate every declared member and republish original catalog unions | Source inspection confirms this path; corrupt/missing members keep the scope incomplete |
| Some original pages are missing | Exclude the incomplete original group; qualified reacquisition creates a new complete group | Never fill an old declaration with pages from a different vintage |
| Graceful stop | Quiesce new misses, release dormant jobs, bounded supervised writer drain, count unpersisted outcomes | Current HTTP-only stop is five seconds and does not drain this proposed writer; wiring/budget alignment needs implementation |
| Hard failure before persistence | Restore eligible canonical S3 groups first; derive remaining product/period gaps from the requested scope | Lost RAM may include the only record of a served raw identity; exact original bytes may be unknown and irrecoverable |
| Available qualified replacement | Reacquire under original source, miss, memo and quota rules; retain actual new fetched time/hash | New data is a new vintage; equal values are not guaranteed |
| Expired/unqualified historical input | Preserve existing partial/missing/failure behavior and explicit coverage gap | No invented clear/dry conditions or historical SHRT/mid substitution |
| Pending capacity exhausted | Stop new provider-miss admission; prioritize already-admitted/latest work and reduce backfill | Finite memory cannot retain unlimited new data through an unlimited storage outage |

The source repair path scans a finite scope, verifies original descriptor/member
identity, loads every original group record and publishes the declared catalogs.
It does not certify an incomplete group merely because some raw objects exist.
([repair](../../../server2/src/storage/catalog.rs#L993),
[verified group publication](../../../server2/src/storage/catalog.rs#L1099))

Pending publication failure is observable as not durable. Do not unconditionally
clear the acquisition memo and repeatedly call the provider after a permanent
capacity/collision failure. Retain already-admitted raw within its charged owner
and stop new misses under pressure; retries/recovery stay bounded and explicit.
The selected policy does not silently discard healthy-process pending raw just
to improve response time. Any future configured expiry/discard policy is an
additional retention tradeoff, not implied by accepted crash loss.

Exact recovery after SIGKILL, OOM, host loss or drain timeout cannot be promised
without an independent durable copy. A pre-response journal/staging write would
change the selected latency/durability tradeoff; an optional asynchronous spool
is not required for this baseline. Neither model agreement nor a later available
provider response reconstructs a lost original vintage.

## Verification and measurement gates

Prove the pure-validation/durable gates first, including a forged S16 summary
case. Then test held/failing publication, concurrent callers, one waiter reset,
three-second flight retention, pending-byte pressure, slow readers/dormancy cap,
shutdown, ambiguous raw PUT, complete orphan repair, missing-page rejection,
promotion/removal races and RawId deduplication. Use in-test barriers for races;
do not infer safety from a successful average latency.

Also qualify the entire required historical/source/value closure before another
live acceptance run. Raw-group integrity, required field/slot coverage and value
parity are separate gates; the native history-status flags are insufficient for
AM/PM weather. Required history is foreground response work; optional background
warming cannot satisfy an earlier partial response. See the
[full experiment contract](kma-full-response-reassessment-2026-10-25.md#full-response-experiment-contract).

After those boundaries and full-data gates exist, run the two requested continuous-timer cohorts:

1. Empty weather RAM/parsed/response/disk state and an empty owned weather
   namespace, providers enabled: client send through complete body receipt,
   including actual route admission, miss discovery, quota/pages/validation/fold.
2. The same compatible canonical groups, a fresh Source/cache state and providers
   disabled: client send through discovery/control/raw reads and complete body.

Record readiness, server-body boundary, client-body receipt, first weather PUT,
canonical completion and persistence failure separately. Freeze effective clock
and own-acquisition visibility policy; compare body/functional headers and field
coverage. Include all partial, deadline, HTTP and persistence outcomes. A
provider-only adapter bypassing original miss discovery is an explicit prototype,
not the unchanged native route.

Keep the truly empty-S3 cohort mandatory. A prefilled-history diagnostic or
targeted-catalog restore cannot replace it. Isolate/join background work between
cohorts, settle counters after runtime shutdown, and never qualify identical
partial bodies as the full response. The source-policy conflict and the
hourly-versus-three-hourly public-axis discrepancy remain explicit requirements
to resolve, not permission to reduce output.

The [previous pilot](kma-validation-measurement-2026-10-24.md) remains valid only
for its recorded profiles. Its 2.347 s capture/publication and 2.674 s later
restored response sum to 5.021 s, but were not one end-to-end request. Initial
discovery, seven-day PTY/LGT/vintage/QC/midnight gaps and production p95/p99 remain
unqualified. This review establishes no new latency number.

## Independent-review evidence and limits

AK explicitly approved the exact Claude read scope after automatic approval
initially rejected it. The retry created advisor
`0b9e7b70-0b64-48b4-b12d-ae0225edf76e`. Completed-seat settings confirm
`claude-opus-5-5`, effective `max`; exposed runtimeInfo independently reports that
model. This confirms exposed runtime metadata, not an underlying model-build
attestation. One initial independent review and one focused synthesis follow-up
were used; this is not a multi-provider arena or fresh-judge result.

Eight source/evidence hashes stayed unchanged through initial review. The advisor
reported 14 targeted reads/23 ranges, above the 20-range preference. The retained
initial report is 2,098 whitespace-delimited words, above its requested 1,800;
the follow-up is 424, above its 350 target. These budget overruns are recorded,
not relabelled as compliance. It reported no edits, builds, provider/AWS calls,
nested agents or lead-report access. The lead verified material source spans,
repair behavior, KMA flight defaults and Arc body ownership; no behavior tests
or new live measurements were executed for this review.
