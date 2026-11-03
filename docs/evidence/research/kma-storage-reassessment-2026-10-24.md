# Korean raw-storage reassessment — 2026-10-24

## Decision and status

This review rechecks the [selected Korean acquisition/storage proposal](../../architecture/server2-kma-data-design.md) against the completed [external API manual](../../reference/external-apis/README.md), with independent Opus and GPT-5.6 investigations. The source baseline is `82f7a4838dda046be966ee9c25c9cb66561d099d`. It is a design/documentation review, not implementation, activation or a performance result.

Select original canonical raw/catalog replay, packaged public reference candidates and one bounded shared RAM input closure as the initial design. One coordinator owns natural-owner acquisition/admission; original complete groups retain weather-admission authority. Optional packs enter before canonical body GETs. Grid heads and v3 day locators are deferred.

The fresh judge rates all three design proposals **ISSUES**. GPT-5.6's own **BLOCKED** verdict concerns complete implementation/activation. Verified empty-S3 seven-day history and activation remain **BLOCKED**; independent canonical replay/instrumentation is separable. This is an adjudicated design choice, not proof of source equivalence or authorization to change public values.

The later, separately authorized [verification and live measurement](kma-validation-measurement-2026-10-24.md)
executed 312 frozen native output comparisons, bounded provider capture and S3
restore. It reproduced a past-source value conflict and measured LIST fan-out;
complete historical phenomena and production tails remain unqualified. The
no-live-call statements below describe this earlier design-review phase only.

AK later accepted a [response-first foreground amendment](kma-response-first-review-2026-10-24.md):
complete validated raw may serve from RAM before asynchronous canonical S3
publication, with possible crash loss and bounded recovery. A new Opus5.5/max
review checks that exception, overlay consistency, durable summary/cache gates
and shutdown. The canonical-first statements below record this earlier decision;
canonical complete groups still govern durable restoration, and the source/value
and full-history gates remain open.

## Requirements and comparison method

Preserve the existing public values, units, sentinels, slots, icons, rounding and field-level source precedence. Historical inputs are constrained to measurements, nowcast and ultra-short forecasts; short/mid forecasts remain future inputs. Cover the existing hourly window and seven completed KST dates for daily AM/PM cloud/precipitation summaries, including necessary boundary hours. Air quality and life indices are excluded.

Persist exact provider raw bodies and lossless copies, identity/reference metadata and the existing authorized daily-summary exception. Do not introduce a normalized hourly or preassembled-response store. Original v2 group ownership and complete-publication eligibility remain weather-admission authority. Use natural provider owners; source-plan candidates do not replace exact town-coordinate selectors.

The two requested investigators received the same frozen brief and seven input-file hashes, with separate ignored output directories and no sibling-report access. The lead wrote its own report before reading their reports. A fresh read-only judge first checked the frozen requirements/source and receives all stable reports for comparison. Model agreement is not evidence of provider equivalence. Earlier same-provider candidate work is reused only as prior design context, not relabelled as this cross-provider review.

| Seat | Requested/configured model and thinking | Completion evidence |
| --- | --- | --- |
| Opus | `claude/claude-opus-5-5`, `max`, auto approval mode | Report complete; Paseo snapshot confirms model/effective max, runtimeInfo confirms Claude model |
| GPT-5.6 | `codex/gpt-5.6-sol`, `max`, auto-review mode | Report complete; Paseo snapshot and runtimeInfo confirm model and effective max thinking |
| Lead | Current coordinating agent | Independent source report frozen before sibling reads; public primary rechecks |
| Fresh judge | Separate inherited-model agent, fresh context | Source preflight and all-three-report adjudication complete |

No saved agent profiles were configured; exact advertised model IDs/thinking options were selected through provider discovery. The two requested seats are two providers; this is not a three-provider panel. The model's own assignment label was not treated as runtime proof.

## What the API manual changes in the review

The manual clarifies actual caller status, distribution surfaces, missing fields, time semantics and per-family page/retry limits. It does not itself contain complete real-response schemas or an automatic seven-day acquisition demonstration. Data.go.kr `serviceKey` and the newer guide's APIHub `typ02/authKey` examples are distinct interfaces; a shared weather product name does not prove identical bytes, revisions, access or latency.

| Need | Available source shape | Qualification limit |
| --- | --- | --- |
| Latest/current | Grid ODAM plus the existing selected station/city inputs | Current ODAM has no SKY/LGT; all selected categories/pages and publication lag still matter |
| Ultra-short forecast | Grid VSRT issue with six-hour valid horizon | Revisions within an issue, overlapping vintages and phenomenon units cannot be flattened |
| Short future | SHRT by grid/publication | Outer extended horizon is three-hourly/qualitative for some elements; historical use is restricted |
| Mid future | Separate outlook station, land region and temperature region | Preserve exact town mapping and freshness; one shared regId is insufficient |
| Measured seven-day history | ASOS hourly/daily by the selected station and contiguous range | QC/missing-only merge, winter rain, cloud coverage and station choice; no current PTY/LGT mapping |
| Seven-day SKY/PTY; LGT where used | Stored compatible inputs plus qualified measurement/VSRT archive alternatives | No demonstrated automatic equivalent-vintage empty-S3 path for every required field |
| D−1 final boundary | D0 0000 under the existing 0100..2400 attribution | ASOS completed-date API alone cannot supply that current-date hour; an eligible boundary input and publication lag are needed |

The official ASOS hourly page restricts the query end date through D−1. [2] Both retrieved ASOS guides document previous-day availability after 11:00 KST; the actual before-11 response and field completeness remain untested. Treat this as documented not-yet-available coverage, not a promise of immediate midnight restoration. [4][5]

The completion profile must freeze the fields and slots the existing output requires, including its legitimate missing-value behavior. LGT and other additional elements are mandatory where that response path uses them. This review does not strengthen the product contract into every possible field at every hour.

The VSRT archive documents files through the previous day and UTC-based search, while its issue times and application valid slots need explicit conversion. Archive existence establishes neither automatic delivery nor reproduction of an earlier first-valid vintage. [3]

The historical short-overlay and vintage gaps were already explicit in the prior proposal. This review does not present them, or measurement-gated packs, as newly discovered defects. It makes them activation gates and sharpens the initial serving boundary.

## Exact values versus permitted historical sources

[Current daily assembly](../../../server2/src/domestic/kma/mid.rs#L528) builds past rows from current/history inputs and subsequently [overlays short-derived summaries](../../../server2/src/domestic/kma/mid.rs#L575). The [legacy oracle](../../../server/controllers/controllerTown.js#L2815) has the corresponding branch. Where that overlay changes an output field, preserving its value and forbidding its historical SHRT input are incompatible for that case.

No live affected date or field count was measured here. A frozen raw-input/output-provenance oracle must identify actual divergent cases. Removing SHRT and calling the result equivalent is not an allowed optimization. Replaying the same complete raw closure and reacquiring an allegedly equivalent new endpoint/vintage are separate proofs.

The current daily-summary exception also does not resolve the input gap automatically: its retained D−6..D−1 dates and early-yesterday exclusion are narrower than seven completed dates ([summary owner](../../../server2/src/summary/grid.rs)). Missing/QC-rejected hours, rain intervals and first-valid revisions remain material even when the summary shape is present.

Opus broadens the conflict detector to [client-visible past short slots](../../../server2/src/domestic/kma/short.rs#L318): forecast-only POP/R06/S06 and forecast fallback can remain after observation overlay, and RSS fallback participates. Existing all-missing-to-zero behavior also needs an explicit oracle. The historical-source restriction cannot be implemented by removing only the daily overlay.

## Additional independent evidence

Opus inspected the existing station fixture and retrieved the official ASOS hourly/daily guides. The hourly guide documents `dmstMtphNo` as a domestic phenomenon number. The fixture contains concatenated values, including a six-character value despite a declared size of four; the split/blank semantics are not established. AWS hourly HTML also carries `rns` rain-presence symbols. These are candidates for a newly qualified measurement mapping, not existing PTY/LGT output inputs or substitutes already proven equivalent. [4]

The configured latest-plus-23 ODAM/VSRT backfill and request-driven capture do not establish seven-day coverage after demand gaps or a usable yesterday-comparison slot. A capture implementation's existence does not prove production scheduling. Test exact clock/publication/provenance cases before labelling any gap recoverable or comparison available.

Legacy polling and server2's first acquisition may select different within-issue revisions. Preserve the selected source policy until a frozen-clock/value comparison qualifies a refresh change. Latest and backfill also share the funded data.go.kr executor; evaluate bounded foreground priority with quota, starvation and shared-owner tests rather than assuming independent concurrency pools.

Opus's static populated-grid scenario assumes one acquisition per lookback publication, two pages for every short issue and no revisions/retries: 692 catalog + 692 descriptor + 813 raw GETs = 2,197, before LISTs, station/mid owners and any additional checks. The 63% control share is arithmetic for that scenario, not measured production cost. It usefully shows why packing bodies alone may target the smaller term. Neither these counts nor concurrency-derived batches establish an S3 latency lower bound or end-to-end percentile. Baseline instrumentation must record actual repeated loads, page counts, controls and bytes.

## Two storage boundaries needing precise interfaces

### Pack reads must precede canonical body reads

[CatalogStore raw_checked](../../../server2/src/storage/catalog.rs#L278) loads canonical raw before returning a complete acquisition; [group_records](../../../server2/src/storage/catalog.rs#L296) verifies each group member. A pack selected after that lookup saves no canonical body GETs. An optional representation must enter at the private byte-loading boundary while preserving expected Envelope, raw identity, length/hash, page order, group eligibility and admission limits.

The [schema2 Envelope](../../../server2/src/storage/codec.rs#L194) is immutable and denies unknown fields; [catalog union](../../../server2/src/storage/catalog_model.rs#L187) rejects a changed envelope for an existing identity. Pack locations therefore belong to a separate representation manifest. A group/catalog/descriptor still authorizes the expected record; a pack only supplies verified bytes.

A qualified representation reader may treat a valid lossless copy as available without fetching/HEAD-checking every canonical object first. That is an explicit logical-record availability decision, including the canonical-object-missing case. It needs fault tests; it is not evidence that an arbitrary upload or pack admits a weather acquisition. If canonical existence must be separately checked for every member, count those operations and reevaluate the benefit.

### Day discovery must not hide unlisted new catalogs

ASOS original partitions encode the [full start–end range](../../../server2/src/domestic/asos.rs#L115), and the current [loader lists and replays those ranges](../../../server2/src/domestic/kma/source/observe.rs#L1158). Thirteen possible start-owner dates is an overlap bound, not thirteen catalog objects. Different end dates/hours and revisions can produce many identities. A simple daily-range illustration has 49 possible 1–7-date start/end pairs intersecting the seven completed dates ending yesterday, across 13 start dates; this is a key-shape illustration, not observed acquisitions or provider-call counts.

Consider catalog B fully published before a request starts, followed by a writer crash before its hint is updated. A locator still lists only A. Revalidating A and the unchanged locator cannot detect B. A grid manifest with the same incomplete dependency vector has the same limitation. S3 is strongly consistent per key, but does not atomically update multiple keys. [1]

An optional directory must either retain complete bounded original discovery, or define an enforceable publication/certification protocol. A possible future protocol is identity-only membership preannouncement before original publication, with all intersecting day memberships durable, all writers fenced/migrated, old scope reconciled, absent catalog dependencies pinned and directory/catalog vectors revalidated. Such a directory would be authoritative for discovery membership only, not for weather admission. It is a distinct experimental contract, not a completed implementation or a property implied by CAS alone.

The judge additionally checked that the [current lookup](../../../server2/src/storage/catalog.rs#L635) treats an absent catalog as incomplete, and the [source Reader](../../../server2/src/domestic/kma/source/records.rs#L195) maps it to corruption. Preannounced-but-uncreated membership needs a new pending/absent-token state; it cannot be fed unchanged through that API. Mandatory registration failure also adds a publication barrier unless certification is safely disabled before an unannounced canonical commit. These requirements reinforce deferral from the initial baseline.

## Wire, storage and assembly formats

These are interface/type sketches; they are not captured provider responses or new implemented schemas.

| Layer | Identity / contents | Owner and restriction |
| --- | --- | --- |
| Provider wire contract | Product/operation/version, JSON/XML/HTML/charset, query clock, expected categories, units/amount intervals, missing/QC and page rules | Release source specification; retains raw bytes; no credentials in identity/logs |
| Existing RecordId | `source,kind,key_sha256,period{local_date,slot},fetched_at_ms,raw_sha256` | Original immutable identity; issue alone is insufficient |
| Existing Envelope v2 | `schema,identity,status,content_type,raw_length,pagination,fetch_group` | Original raw storage; no pack field added |
| Existing group/catalog | Ordered members and original owning/sibling CatalogIds, generation/ETag/version dependencies | Original complete-group publication authority |
| Optional representation | Full RawId → pack/member offset, compressed/decoded lengths, codec, raw hash and expected-envelope digest | Verified exact-body location only; independently decodable frames |
| Experimental directory | Owner/day, generation/writer epoch, certification scope, original catalog references/shards | Discovery metadata only; no weather or valid-hour completeness claim |
| RAM closure/provenance | Ordered verified raw identities, present/absent dependencies, parser/fold/reference hashes; output field/slot → raw/page/path, selected owner, issue/valid interval, unit basis and merge rule | Shared once within assembly; weather rows and provenance stay in RAM |
| Existing public result | Existing body/status/functional headers, values, slots, units and sentinels | No new completion/diagnostic API fields implied |

Numeric cloud amount, SKY category, PTY, lightning quantity and precipitation accumulation interval must remain distinct even when legacy internal names overlap. The [API manual](../../reference/external-apis/kma.md#categories-and-units) documents those naming/unit traps. Parser/fold hashes belong in parsed/assembled cache keys; exact raw bytes can remain reusable across parser revisions.

## Cost and latency gates

Let D be complete discovery/LIST/control work, C distinct original owner/sibling catalog GETs, G group descriptors, N required raw member GETs and V actual dependency revalidation. Optional prepared reads add M representation manifests, R coalesced ranges and U unpacked-tail reads:

```text
canonical replay = D + C + G + N + V
prepared replay  = D + C + G + M + R + U + V
```

This is a deduplicating resolver's accounting model, not an instrumented count of the current implementation. The prior proposal's baseline equations omit V; callers must include any revalidation they actually perform. Pack savings concern N, not discovery, control eligibility, provider acquisition or all decode work. Keep failed probes, stale fallback, quotas, retries, conditional writes and overread in the totals.

Empty-S3 first fill still needs provider acquisition and durable publication; pack creation must not precede acknowledgment of already published compatible raw. Under the existing three-second backend waiter/nine-second gateway deadline, distinguish first compatible partial/failure, forecast-complete, history-complete and background durable completion. These are internal measurement/qualification classes; the existing HTTP contract still decides the response.

No p95/p99 is established. A valid campaign needs separately budget-authorized live acquisition and restore cohorts, fixed output/coverage requirements, sample counts/uncertainty, provider quotas, KST/publication boundaries, realistic concurrency and all completeness/deadline failures in the denominator. The selected storage structure cannot compensate for an unavailable historical source.

The two ASOS attachments retained by Opus have verified byte identities:

| Guide | Bytes | SHA-256 |
| --- | ---: | --- |
| Hourly | 944,798 | `c4484c0ae95e63eee5b2b8c3fd4e49fff4401321dbb792eae6055288b606c318` |
| Daily | 445,319 | `60e1014ff64ebfeb387d65d8cb5682c9f6058a00415cf45481bc4e59db1a769a` |

## Final comparison and selected sequence

| Contribution | Selected or qualified outcome |
| --- | --- |
| Lead | Original group authority, precise pre-GET byte-loader seam, complete original discovery and explicit representation availability behavior form the base |
| GPT-5.6 | Canonical-first scope, one acquisition coordinator, pure source planning and deferred grid/day accelerators |
| Opus | ASOS 11:00 guide boundary, public past-short residuals, within-issue vintage risk, missing grid-input RAM reuse, executor contention and static control-cost illustration |
| Fresh judge | Required-field/LGT scope, non-universal H−24 wording, pending-directory/error semantics and separation of conditional hash validation from ownership migration |

The prior proposal already made packs conditional and recorded history/vintage/SHRT gates. The revision narrows initial serving dependencies and defines actual loading/discovery interfaces; it does not claim to overturn an unconditional pack commitment.

Descriptor-free single-owner verification is a possible later optimization only if it reconstructs the exact original declaration, strips/reinstates attached group references correctly, preserves member order/metadata, checks the complete FetchGroupRef/envelopes and retains fallback. Missing-descriptor behavior must be qualified. Newest-first thinning needs field/order parity. Day-owned grid catalogs change hashed ownership and require a separate migration/repair/dual-discovery design; the unchanged-group baseline does not adopt that change. Static reductions to 1,505/1,057/864/570/about 170 GETs are conditional Opus scenarios, not achieved results.

Immutable self-indexing/digest-named packs are compatible alternatives to separate representation manifests. They still need deterministic discovery, index/member/range integrity, original eligibility and accounted reads. A mutable grid pointer is not required by the selected baseline.

Proceed with a frozen raw/output/provenance oracle and explicit source-conflict cases; qualify required historical/boundary/vintage sources; instrument and share canonical replay inputs; then measure bounded foreground priority, conditional control optimizations and optional representations independently. The [implementation sequence](../../architecture/server2-kma-data-design.md#selected-alternative-and-implementation-sequence) keeps whole-history activation behind source/value gates while allowing independent unchanged-policy replay work.

## Verification and limits

Both requested seats completed independently before sibling comparison. Paseo completed-seat snapshots confirm the two advertised models and effective max settings; Claude runtimeInfo confirms its model and Codex runtimeInfo confirms its model/thinking. Seven input SHA-256 hashes matched through final adjudication; only then were frozen maintained inputs revised. The judge checked material source spans, attachment/fixture identities and twenty cited path/line ranges. These are inspection checks, not behavior tests or model-build attestation.

The revised diagram passed Archify validation/delivery/strict artifact and real Chrome checks. All four theme/viewport captures passed automated checks; 1440-light and 2048-dark were visually inspected, with a readable main path, no crossing/label collision and an intentional miss detour.

Local checks passed for 317 links/fragments and 63 source-line targets across six affected Markdown documents. The complete manual recheck passed 309 links/fragments, 170 inventory source anchors and its unchanged 102-entry/58-source register. Citation/evidence consistency passed for the initial 17-source review and this focused five-source ledger; these checks do not prove claim completeness or numerical equivalence. The isolated temporary-index artifact-policy check passed for the eight declared maintained paths plus already-uncommitted manual dependencies; the real user index SHA-256 remained unchanged. No content was staged in the actual index.

No provider-data call, AWS/S3 operation, build, application runtime, deployment or commit was performed. Public official-document retrieval and local Chrome artifact inspection are the only network/browser activities. No build artifacts were created, so no Cargo cleanup was needed. Full response schemas/live acquisition, public-value parity and p95/p99 remain unverified.

## Sources

[1] https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html — AWS S3 consistency: per-key atomicity
[2] https://www.data.go.kr/data/15057210/openapi.do — KMA ASOS hourly: completed dates
[3] https://data.kma.go.kr/data/rmt/rmtList.do?code=410&pgmNo=571 — KMA VSRT archive: historical horizon and UTC search
[4] https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002411530&fileDetailSn=1 — KMA ASOS hourly official guide: D−1 availability and phenomenon codes
[5] https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002411540&fileDetailSn=1 — KMA ASOS daily official guide: D−1 availability
