# KMA full-response requirement reassessment — 2026-10-25

## Decision

**Current native FULL_COLD: BLOCKED. Full canonical restore: NOT_QUALIFIED.**
Keep response-first serving and canonical raw storage as the conditional design,
but qualify the entire required weather response before measuring its latency.
The empty-S3 requirement remains binding. A seeded-history experiment cannot
replace it, and a byte-identical partial body cannot satisfy it.

This is a source/document review against
`82f7a4838dda046be966ee9c25c9cb66561d099d`, including the existing working-tree
design/evidence. No runtime source, dependency or configuration was changed;
no build, provider-data call, AWS operation or new latency experiment ran.
Public official documentation was retrieved on 2026-10-25.

The [latest-only measurement](kma-response-first-measurement-2026-10-24.md)
omitted all 168 required historical hours and seven dates. Its 1.700597 s
provider result and 0.301403 s targeted restore are disqualified as full-response
latency. Their raw observations remain retained; there are **zero qualified
full-response cold or restore samples**, and no established full-response
p95/p99.

## Binding response contract

| Requirement | Acceptance | Current verdict |
| --- | --- | --- |
| Existing client data and values | Preserve route/version, fields, slots, units, sentinels, icons, rounding, rain intervals, source order and yesterday comparisons | Conflict evidence remains; no waiver |
| Latest regional weather | Latest eligible complete SHRT, VSRT, ODAM and each required mid product, including all pages/categories and existing weather dependencies | Not qualified by the seven-job prototype |
| Recent three-day history | Preserve the requested hourly obligation and existing client behavior; resolve the granularity discrepancy below explicitly | Specification discrepancy; no silent resampling |
| Past seven completed KST days | Daily extrema, AM/PM sky/weather and precipitation, assembled from the necessary hourly cloud/phenomena and boundary observations | No qualified full-cold input closure |
| Allowed historical sources | Measurements + ODAM + VSRT; no historical SHRT/mid substitution | Conflicts with existing residual forecast values |
| Client priority and persistence | Full required RAM assembly before response; supervised original-raw persistence afterwards; bounded recovery | Conditional proposed design |
| Reuse and performance | Restore the same complete response through canonical discovery; measure one continuous request-to-body interval | Full restore unqualified |

Life indices and air quality are excluded from this weather investigation.
That exclusion does not authorize unrelated response-envelope changes. Station
refinements, warnings, sunrise/sunset and other inputs consumed by existing
weather fields belong in the dependency census where applicable; they cannot
be replaced by empty callbacks solely to improve the timer. The
[native chain](../../../server2/src/domestic/kma/chain.rs#L118-L180) defines their
order, and the [API manual](../../reference/external-apis/README.md) identifies
the source-wired products.

**Granularity discrepancy:** the current
[short template](../../../server2/src/domestic/kma/short.rs#L277-L299) starts at
D−2 00:00 with 41 three-hour slots. The
[client parser](../../../client/www/js/service.weatherutil.js#L338-L403) uses
those rows for charts without hourly interpolation. Internal hourly history is
a different axis. Neither calling this public axis hourly nor changing it to
72 hourly rows is authorized. Freeze the exact route/client slot manifest and
resolve this discrepancy before declaring the original hourly requirement met.

## Output and source obligations

| View | Actual assembly dependency | Cold/compatibility obligation |
| --- | --- | --- |
| `current` and live refinements | ODAM, existing station/minute inputs; forecast synthesis when ODAM is stale | Include fallback branch and real auxiliary acquisition |
| Past public `short` | SHRT/RSS base overwritten by three-hour aggregates of hourly observations | Missing observation keys leave forecast values behind |
| Future `short` / `shortest` | Eligible SHRT/VSRT, with existing issue/valid-time rules | One latest issue still requires all products/pages and elapsed-day handling |
| Daily D−7..D−1 | Hourly summaries, then short-derived overlay, then missing-only ASOS repair | Extrema alone do not establish AM/PM weather |
| Yesterday comparison and daily boundary | Matching H−24 and `0000`→previous-day `2400` observations | Include boundary inputs outside naive date ranges |

The [short observation merge](../../../server2/src/domestic/kma/short.rs#L1358-L1442)
and [daily assembly/overlay](../../../server2/src/domestic/kma/mid.rs#L530-L773)
establish this order. Daily AM includes 12:00; PM follows it. Seven completed
days need the D−7 01:00..D0 00:00 closure under this existing attribution,
along with today's elapsed observations and the separate comparison inputs.
The planner's 192-hour lookback is an implementation window, **not a proof that
every new grid must wait eight days** or a replacement for the user's horizons.

### Three separate completeness gates

1. **Raw-group integrity:** original identity, owner, pages, declaration, hashes
   and complete membership validate. A complete latest group can still contain
   no historical hours.
2. **Required output coverage:** every required slot/field has a valid allowed
   source, or an explicitly justified original missing-value outcome. Missing
   acquisition is not made legitimate merely by emitting a sentinel.
3. **Value/provenance parity:** the same clock, selector, revisions, fold order
   and policy produce the required existing values and functional headers.

The [current status predicate](../../../server2/src/domestic/kma/policy.rs#L667-L682)
considers hourly t1h/reh or daily taMin/taMax. Its
[gap reporting](../../../server2/src/domestic/kma/policy.rs#L799-L875) does not
certify PTY/LGT or daily AM/PM wf/sky. Zero `missingHourlySlots` and
`missingDailyDates` therefore cannot pass gate 2. Padded hourly rows are also
not evidence of measured coverage.

Use a test-owned required-response manifest: route/client version, location and
town selector, clock/timezone, output slots/fields, permitted missing reasons,
source family, issue/fetch revision, units, interval/QC and derivation. Check
all three gates against it. This does not propose a new client diagnostic API.

## Historical acquisition: gaps and candidates

| Class | Established finding | Consequence |
| --- | --- | --- |
| Wired acquisition reach | Foreground point acquisition requests latest issues; local background reach is 23 earlier ODAM/VSRT issues, not seven days | Existing cold request cannot obtain the required history |
| Unawaited work | Backfill and station history may continue beyond the three-second request waiter | Later completion cannot qualify an earlier partial response |
| Adapter omission | ASOS normalizes temperature/humidity/rain/wind/cloud but emits no PTY/LGT; winter hourly-rain exclusions remain | ASOS alone does not close AM/PM weather |
| Availability boundary | ASOS guide places D−1 access after 11:00 KST | Before-11 completeness needs another qualified source; no inference from an untested call |
| Mapping/value gap | Station vs grid, cloud vs SKY, phenomenon codes, QC, rainfall intervals and official vs sampled extrema differ | A populated field is not proof of equivalent value |
| Vintage gap | Same publication can be revised; first-valid selection depends on acquisition order | A later archive/refetch cannot promise lost original bytes/values |

The [native acquisition](../../../server2/src/domestic/kma/source/mod.rs#L512-L672)
and [ASOS adapter](../../../server2/src/domestic/kma/source/asos.rs#L108-L190)
support the code findings. The
[previous bounded probes](kma-validation-measurement-2026-10-24.md) found ODAM
24 h/168 h and VSRT 168 h unavailable, while VSRT 24 h succeeded. These single
probes do not establish a universal provider cutoff. The ASOS portal lists
`dmstMtphNo`; the guide supplies the availability boundary. [3] [4]

Official documentation leaves concrete alternatives open. APIHub documents
recent-one-day ODAM and recent-three-day VSRT, while portal VSRT files extend
through D−1. Their CSV uses UTC issue time plus forecast lead, requiring one
correct conversion to KST valid time. These statements describe those services,
not a verified change to the wired data.go.kr transport. [1]

APIHub's ASOS hourly period query (`kma_sfctm3.php`) documents up to 31 days,
domestic WW phenomena and CA_TOT cloud. It is a candidate measurement source,
not an already admitted grid substitute. [2]

Qualify archive/APIHub authentication and quota, unattended delivery and latency,
all pages/ranges/boundary hours, station selection, field/QC/blank semantics,
WW or `dmstMtphNo` parsing and PTY/LGT mapping, cloud→SKY, and vintage/value
equivalence. The retrieved domestic code table identifies phenomena; it does
not settle concatenated-code parsing, blank meaning or numeric lightning
equivalence. No new mapping is adopted here. Likewise the current
[manual](../../reference/external-apis/kma.md#grid-observations-and-forecasts)
documents VSRT POP support; that does not prove equality with historical SHRT POP.

Thus **no qualified connected seven-day closure** is established. This is not
a claim that KMA has no seven-day phenomena data anywhere.

Qualification should start with already retained ASOS `dmstMtphNo` and the
existing hourly/daily range path: determine whether an exact allowed mapping
exists before adding another service. Next qualify grid VSRT archive delivery,
preserving issue/lead/vintage wherever that source contributes existing values.
Use APIHub's multi-day station query as a separately compared alternative when
it can close a demonstrated gap. Prefer shared station/range/national raw over
per-grid copies; retain recent ODAM and each latest forecast's natural owner.
This is an investigation order, not a claim that one candidate already matches
the old values. No combination is admitted by latency alone.

New endpoints and formats also need explicit source/endpoint/range/revision
identity, byte-preserving raw publication and bounded parsing. APIHub text and
archive CSV/ZIP cannot be relabelled as existing JSON/XML acquisitions or
silently share their identities. Verify archive container/member integrity,
expansion limits and complete replay before using extracted values.

## Existing-value versus source-policy conflict

The frozen [removal probe JSON](kma-validation-measurement-2026-10-24.json)
(`/past_source_probe`, clock 2026-09-24T06:31Z) removed complete SHRT/RSS
acquisitions while leaving other input/code fixed. It changed **82 fields in
nine past short slots**: 2026-09-22 24:00 and 2026-09-23 03:00..24:00.

Affected families were `pop`, `r06/s06` and interval/approximation metadata,
`wav`, `reh`, `t3h`, `tmn`, `vec` and `wsd`. VSRT POP is a possible source but
not an equivalence proof. Measured precipitation/snow values have different
semantics from the existing forecast fields; no equivalent wired WAV source
is shown. Other differences occurred where observations had not overwritten
forecast values. This probe found no past daily differences in its fixture;
that does not prove the daily overlay universally harmless.

Retain current behavior while the conflict is unresolved. Do not remove fields,
admit historical SHRT/RSS, substitute zeros or change the oracle unilaterally.
The next decision artifact must list each affected output/date, old value,
allowed-source candidate and remaining mismatch. Any unavoidable change to
values or historical-source policy requires AK's decision after that evidence.

## Reassessed serving, storage and reuse design

Keep the [response-first proposal](kma-response-first-review-2026-10-24.md),
with the following full-response obligations:

1. Resolve the exact selector/profile; perform real bounded canonical discovery
   and quota admission. Public per-grid source plans optimize planning, not
   data coverage or selection authority.
2. Reserve bounded retained bytes before provider calls. Acquire the entire
   missing required closure, including required historical inputs as foreground
   work. Optional history warming may remain durable-before-visible background
   work; it cannot stand in for history needed by this response.
3. Pure-validate each original group and transfer its charged ownership to the
   supervised writer before RamReady. Pin/deduplicate the full S3/RAM input
   closure and assemble with unchanged rules. Full-response qualification checks
   coverage and parity as well as raw integrity.
4. Return the full required body without waiting for weather publication.
   Existing runtime failure/missing behavior is not changed by this review;
   partial bodies and deadline failures fail full-response qualification.
5. Release writer I/O at the defined eligible response terminal event, no-waiter
   condition or abnormal bounded cap. Normal publication follows response.
   Freeze eligible waiters; later overlay readers do not extend dormancy.
6. Persist exact original bodies/declaration with original canonical owners and
   catalog CAS. Retry retained bytes, bound pressure and drain on shutdown.
   Generation pins plus full RawId deduplication protect S3/overlay transitions.
   Only durable groups enter summaries, result/disk caches and dependency tokens.
7. Later requests discover/validate canonical inputs, load and fold each once,
   and reuse one immutable RAM closure. No normalized weather store is added.
   Packs remain conditional; grid heads/day locators remain deferred.

Accepted crash loss is unchanged. Recovery prefers complete canonical raw and
bounded repair, then qualified reacquisition with a new identity for a new
vintage. Reach is source-specific, not the local 23-issue code bound. Exact lost
RAM-only originals may be irrecoverable. Record the resulting history gap;
accepting crash loss never grants permission to omit healthy-request history.

## Full-response experiment contract

Do not start another latest-only run as a substitute. First qualify the manifest,
historical source path and source/value conflict; then use these cohorts:

| Cohort | Required initial state and path |
| --- | --- |
| FULL_COLD | All application weather caches and the owned weather S3 namespace empty; real full required provider acquisition and normal discovery/admission |
| FULL_RESTORE | The exact complete compatible canonical groups present; fresh Source/RAM/disk; providers disabled and rejected if called; normal bounded discovery |
| SEEDED_DIAGNOSTIC | Captured history available, latest absent or caches cold; explicitly separate, never a replacement for FULL_COLD |
| WARM | Shared RAM/result reuse and real freshness checks; never pooled with restore |

Keep route, location, effective clock/own-input visibility, raw identity closure,
units and output manifest comparable. Compare the complete body and functional
headers against the full oracle. Do not provide target catalog IDs or empty
ancillary callbacks in a purported normal full-route acceptance run.

Record client send→full client body receipt continuously, plus server receipt
and body-terminal timing. Remote app receipt remains unproven unless observed.
Measure post-response raw publication/drain separately. Discovery, quota/CAS,
provider retries/pages, validation, decoding, assembly and serialization all
remain inside their actual request span. Never add stage percentiles or combine
different requests to manufacture end-to-end latency.

Count all attempts: partial, HTTP error, timeout, quota/guard denial and complete.
For deadline qualification, a response that never completes the required body
has no finite full-completion time. Report success latency separately with its
success/coverage rate and denominator. Preserve failures in tail analysis;
neither successful partial HTTP 200 nor native `historyStatus` is a pass.

Isolate or join all background work before the next cohort; settle final counters
after supervised runtime shutdown. Exercise midnight/noon, H−24, ASOS 11:00,
publication grace, month changes, revisions, slow/reset clients, writer pressure,
drain and overlay-promotion races. A larger p95/p99 campaign needs an explicit
statistical precision/sample plan and provider budget after functional gates.

## Independent check and verification limits

Fresh advisor `17c98353-c38e-46c3-a3f2-dabe833ba480` reviewed the original approved
read categories independently, without the reduced prototype or new results.
The completed snapshot exposes `claude-opus-5-5` and effective `max`, with matching
runtime model metadata. This is exposed runtime evidence, not model-build
attestation. The initial report was 1,791 whitespace-delimited words and
self-reported 20 read operations. Its one focused follow-up was 498 words,
above the 450 target; that overrun is retained. No nested agents were used.

All 12 frozen source/evidence hashes matched before maintained edits. The
advisor and lead agree on FULL_COLD BLOCKED, full restore NOT_QUALIFIED,
conditional response-first/canonical raw, and an open archive/APIHub route.
The synthesis corrects the initial advisor's overly broad provider-absence
claim, eight-day minimum, POP classification and seeded-cold terminology.
Its initial report remains retained alongside the correction rather than
silently rewritten. This is one independent model plus lead reconciliation,
not a multi-provider arena or a live measurement double-check.

The review updates the design and proposed sequence, not native behavior.
Local reference/source-range checks, citation-evidence checks, artifact policy
and diagram delivery/browser checks validate the documentation artifacts;
they do not establish full weather coverage, API mapping or latency.

## Sources

[1] https://data.kma.go.kr/community/nuriLovePopup.do — KMA grid observation and forecast usage guide
[2] https://apihub.kma.go.kr/apiList.do — KMA APIHub ASOS hourly period query
[3] https://www.data.go.kr/data/15057210/openapi.do — KMA ASOS hourly OpenAPI portal
[4] https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002411530&fileDetailSn=1 — KMA ASOS hourly service guide
