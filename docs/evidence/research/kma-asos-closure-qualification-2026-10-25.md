# Seven-day ASOS history: source qualification, 2026-10-25

**Seven-day closure remains NOT QUALIFIED.** The 2026-10-26 KST continuation found KMA ASOS-specific definitions for blank rain, trace zero and blank QC, and implemented a bounded observed-history correction. APIHub is an optional candidate, not a proven mandatory or exclusive source. Actual QC9 and boundary gaps remain. This is source qualification and local verification, not a client-response benchmark. Qualified full-cold and full-restore samples remain **zero**; no p95/p99 is reported.

The [2026-10-30 follow-up](kma-history-gap-options-2026-10-30.md) analyzes QC9 hours, stations without phenomenon recording and alternative sources across 15 station-periods. Its proposed rules are not implemented.

The requirements are unchanged: internal hourly history, the existing public three-hour interval, seven completed KST days with AM/PM weather and measured extrema/rain, observation/ODAM/VSRT historical sources, and response before canonical raw publication. Per-grid source-plan optimization remains deferred.

## Actual source evidence

The retained Seoul (108) data.go.kr originals contain the following. Counts describe fields as returned, without filling blanks.

| Retained input | Explicit values | Blank values | Qualification limit |
| --- | ---: | ---: | --- |
| ASOS hourly cloud `dc10Tca` | 168 | 0 | A single station and period |
| ASOS hourly rain `rn` | 18 | 150 | 106 normal-QC dry blanks now supported; 44 QC9 rows remain unknown |
| ASOS hourly phenomenon `dmstMtphNo` | 18 | 150 | Supported codes plus qualified rain absence; never the code blank alone |
| ASOS daily minimum/maximum | 7 / 7 | 0 / 0 | Release-time and station-coverage gates remain |
| ASOS daily rain `sumRn` | 3 | 4 | Four dry totals supported with other measured values and empty event/duration guards |

The actual `rnQcflg` is blank on 124 rows and `9` on 44 rows; `rnQcflag` is absent. An earlier implementation-report sentence incorrectly said all 168 flags were blank and is now corrected. Of 150 blank rain/phenomenon pairs, 106 have blank QC and 44 have QC9. This observation does not establish an undocumented rain-QC contract.

There are 168 returned hourly rows, but only **167 overlap the required window** `2026-10-18 01:00` through `2026-10-25 00:00` KST. The midnight endpoint is absent from that ASOS range. A newly captured public midnight page is a candidate input, not proof of native integration. The October20 daily original reports `sumRn: "0.0"` alongside explicit rain events; a zero quantity must not erase an explicit precipitation phenomenon. Original hashes and request metadata are in the [selected JSON](kma-asos-closure-qualification-2026-10-25.json); retained ASOS bodies are covered by their [provenance](../../../server2/tests/domestic/fixtures/ASOS-20261025-PROVENANCE.md).

Eleven finite public-city logical requests were executed, including eight followed redirect requests: 19 HTTP transactions in total. Four attempts through the formerly wired obsolete URI exceeded the two-redirect ceiling, with `tm` already discarded. Four direct-current-URI probes returned HTTP200, exact displayed observation times and a Seoul108 row at the oldest boundary, night, winter and midnight. Each Seoul daily-rain cell was blank.

Two station-specific probes returned 48 hourly rows each, for October23–24 and December31–January1. Each has **36 explicit weather/cloud rows, 12 blank weather/cloud rows and 48 blank daily-rain cells**. This establishes a possible batch-acquisition format, not a complete seven-day source. The October table explicitly reports cloudy weather at some hours; the winter table explicitly reports clear weather at some hours. Neither permits filling the other hours by assumption. [3] [4]

The new tool bounds calls, redirects, hosts, body sizes and socket timeouts; keeps exact originals and hashes; checks displayed observation time separately from the form value; and supports offline replay. A matched page header alone never sets field/window qualification. These HTTP durations exclude assembly and client delivery and must not enter latency percentiles.

One additional future-hour query requested23:00 at22:44KST. The actual response returned a complete table with22:00 in both its observation header and form. Native acquisition returns `Stale(22:00)`, creates no raw group and does not retry. This is one observed unavailable/future-hour shape, not proof of every current-hour publication delay or historical reach. [5]

## ASOS-specific meanings and the remaining gaps

Three public KMA climate-data-portal answers now resolve a distinction that the earlier generic FAQ did not. Board 66383 says a blank ASOS rainfall amount means no precipitation phenomenon, while numeric 0 means precipitation occurred but the measured amount was0. Board 29442 separately distinguishes minute data: its blank means missing/error and its 0 means no precipitation. Board 30942 says a blank hourly rainfall QC flag is normal QC0. These are KMA ASOS QnA answers, **not data.go.kr API serialization specifications**. Applying them to the same ASOS product in data.go.kr JSON is a source-based inference supported by the retained originals, including all eight numeric 0 rows carrying rain code01. [6] [7] [8]

The observed normalizer now applies these bounded rules:

| Acquired ASOS input | Normalized treatment |
| --- | --- |
| Present empty-string rain, normal QC, another valid measured field, compatible phenomenon | Summer hourly zero quantity and PTY0 |
| Present empty-string daily rain, another valid measured field, explicitly empty `iscs`, no conflicting `sumRnDur` | Daily zero quantity |
| Numeric0 | Preserve zero quantity; require a supported precipitation code for its type; never infer PTY0 |
| Missing field, JSONnull, malformed/sentinel value, QC1/9, or all-blank row | Keep unknown |
| Winter blank at a non-reporting hour | Do not invent hourly zero or no-event |

The official ASOS dataset page documents November–March precipitation at three-hour intervals. Interpreting the ending-mark amount as the preceding three-hour accumulation was initially an inference; the winter control below corroborates it for two station-days. It is never relabelled hourly, and no complete winter response is qualified. The current portal also says D−1 after 10:00, while the retained API guides say 11:00: these are endpoint/document observations, not a demonstrated API availability change. [9]

Exact originals and canonical schemas stay unchanged. Legacy ASOS replay is unchanged. Observed grid S16 input identity includes `rain-blank-semantics-v2`, preventing reuse of the earlier normalization result. Station S16 summaries intentionally keep their unchanged legacy derivation and IDs for the internal last-year lookup; they do not supply the current seven-day raw-based observed store.

On the **same retained original bytes**, supported hourly rain/PTY increases from 18 to 124:18 explicit wet rows plus106 normal-QC dry blanks. All eight trace rain rows retain PTY1. All 44 QC9 hours remain unknown. Daily rain increases from 3 to 7 supported totals. The retained range still overlaps only 167 of 168 required hours. Dry days with nonempty event logs remain conservative gaps until their event grammar is qualified. These are improvements in local interpretation, not full seven-day or nationwide qualification.

The generic FAQ's zero-versus-NULL statement remains relevant to its own context, but cannot override these more specific hourly/daily ASOS definitions or be copied to minute or public HTML fields. The instantaneous AWS rain sensor still cannot certify a whole dry hour. [2] [6] [8]

The official APIHub manual documents hourly ranges up to 31 days and the IX discriminator for included, omitted and missing weather reports. That is a useful candidate for separating no significant reported phenomenon from unavailable observations. The same PDF conflicts on whether IR3 means no precipitation alone or no precipitation/missing; no IR3-to-zero rule is qualified. No APIHub data was requested, and the data.go.kr key was not sent there. An APIHub key enables that candidate's own qualification; it is not a prerequisite for the existing data.go.kr correction and does not guarantee complete history. [1]

The retained national AWS pages contain explicit numeric precipitation windows, including zero at midnight. Their interval boundaries, trace precipitation, winter behavior, corrections and relationship to phenomena still need qualification. They have not been adopted as an automatic seven-day fallback.

## Implementation boundary and next gates

The source probes were followed by a narrow native repair: city requests now use the current URI; hourly/city acquisition requires the returned observation time to equal the requested hour; and city search-form echoes alone cannot certify a publication. Older pages remain `Stale`; newer mismatches are rejected before raw construction. Minute/RSS retain their minimum-publication behavior. That narrow URI repair did not change weather mapping. The later observed ASOS normalization above changes only qualified historical values; canonical raw formats and bytes remain unchanged. Station batches remain unintegrated and must not be stored under the nationwide-page key.

The first research wording overstated normal raw-time misattribution. Inspection of `DomesticAcquirer::acquire_web` confirms it already records the **actual parsed publication**. The reproduced defect was that a newer page could complete an older-hour request/flight, and a form echo could stand in for an observation header. Both now fail acquisition. This correction preserves the distinction between request, publication and raw identity.

A complete city table without a parseable header is now the format fault `observation header`; a newer hour is `observation publication`. Broken observation tables are rejected before publication aging, including minute pages; the two minute classification cases are pinned explicitly while their valid-page minimum semantics remain. Previously stored raw is not retroactively revalidated or quarantined, and no bucket was inspected. A full-restore qualification must validate its selected input closure; this repair does not claim to fix earlier form-echo-admitted originals.

Before measuring full response latency: close the explicit QC9 gaps with actual allowed observations and validate their periods; close the exact hourly/daily/output fields including midnight and release cases before 11:00; complete auxiliary response-first ownership; then test native `Gateway::handle` cold and fresh canonical restore with a continuous client timer. Actual dry, wet, trace, mixed, winter and unmanned/missing cases remain required; the scripted wet/dry cases below are not live source qualification. No dates or fields may be dropped to pass.

Verification: **10 offline tool tests passed**, plus the existing nine coverage checks; six captured observation bodies replayed with their original SHA-256 values and matching displayed page times. Three new fixed-hour behavior tests failed before the first repair; the additional form-echo regression also failed before its fix. Final native checks are recorded in the companion JSON. No actual AWS/S3 or full-response live timing was run. The earlier scripted runtime evidence remains separate and does not certify actual source closure.

After the repair, **51 provider tests** and **one scripted full-response/store/restore regression** passed; all-target Clippy with warnings denied and formatting of the six changed Rust files passed. The actual current-midnight and future-hour HTML are retained as two reusable [provider fixtures](../../../server2/tests/providers/fixtures/PROVENANCE.md). The midnight tests preserve measured cloud/temperature and missing daily rain, verify exact outgoing queries, and cover23:00/00:00/01:00 across the day boundary. The updated diagram passed artifact, browser and capture checks; selected light/dark viewport images were inspected. These are local checks, not production or tail measurements.

The existing AK-approved **Opus5.5/max** reviewer performed two bounded source/diff inspections and found no correctness or durability blocker in the examined repair. Its diagnostic and test-strength findings were addressed. Final minor reason/query assertions and the actual future-hour probe were checked locally afterwards. The advisor ran no tests, builds, live calls or AWS operations; its review is not seven-day or latency qualification.

## Normalization continuation verification

Three initial regression checks failed before the native correction. Opus5.5/max then identified missing-row/daily-event guards and trace/PTY conflicts; focused failing checks were retained before repairs. The actual168-hour replay now checks each row's rain and PTY, including the eight trace rows and 44 QC9 rows, rather than relying only on aggregate counts. The daily fixture's exact bytes and all 7 extrema remain preserved.

An intermediate complete domestic suite passed 176 tests with 2 ignored. Final ASOS, observed assembly, summary and native wet/dry Gateway/store/restore results are recorded in the [selected JSON](kma-asos-closure-qualification-2026-10-25.json). Only the local loopback provider/S3 doubles ran. No new provider-data or AWS/S3 call, actual full-client timing or p95/p99 sample was added. The Opus checks are source-only and do not certify actual source completeness.

## Observation controls continued, 2026-10-26 KST

A restricted offline journal experiment compared the same retained originals
using positive-duration overlap with each preceding hour. All **123 comparable
normal-QC hours agree**: 18 wet and 105 dry. The first returned hour, October 18
00:00, needs the unavailable October 17 journal and is excluded. All 44 QC9 hours
fall outside the logged rain intervals, but this does not turn them into valid
zero quantities or PTY0. The experiment handles only the retained simple rain
grammar; exact-hour endpoints, cross-midnight continuation, snow/mixed journals,
unmanned observations and LGT remain unqualified.

Two fixed public AWS requests tested October 20 at 21:00 (ASOS QC9) and 22:00
(ASOS trace rain/code01). Both pages display the exact requested time and
station 108, with `rs1h=0` and `rns=○`; their temperatures also match ASOS.
These fields therefore fail the no-event/trace discriminator. No AWS-zero-to-PTY0
fallback is enabled. The two bodies and hashes are retained locally; HTTP times
are source-call diagnostics and are excluded from client latency. Two earlier
sandbox-DNS failures obtained no HTTP response; their exhausted profile remains
separate from the explicitly declared two-attempt network-enabled profile. [10] [11]

A separate fixed pair of data.go.kr requests acquired **72 hourly and 3 daily
Seoul 108 observations for November 26–28, 2024**. The exact bodies are retained as
[reusable winter fixtures](../../../server2/tests/domestic/fixtures/ASOS-20261025-PROVENANCE.md).
All 20 numeric precipitation amounts occur at three-hour marks. The other 52
amounts are blank with QC9. Rain, sleet, snow and composite phenomenon codes
occur. The eight amounts ending at 03:00 through the following 00:00 sum to 26.0 mm and
22.4 mm, matching the official November 26/27 daily totals. This is API-level
evidence for those two ending-three-hour windows and the following-midnight
boundary, not an hourly distribution or nationwide winter guarantee. Winter
journals contain continuation and visibility modifiers and are rejected by the
restricted summer experiment.

The new native regression verifies the original hashes, all 20 quantities,
three-hour units, mixed/snow PTY, trace-without-type preservation and both daily
sums. **18 ASOS tests pass**, and all-target Clippy with warnings denied passes.
The earlier normalization verification's 50 tests remain a separate checkpoint;
the other groups were not rerun for this fixture-only continuation. Production
runtime code is unchanged in this continuation, and no Amazon cloud/S3 call was made.
Opus 5.5/max agrees with these bounded conclusions from the reported numbers;
this follow-up ran no tools and independently verified no new result.

The next source gate is a strict journal comparison across additional staffed
stations and the winter profile, with continuation/modifier parsing and a
predeclared 100% control-agreement rule. Any mismatch keeps QC9 absence unknown.
Passing that gate would cover presence/absence only; hourly quantities, measured
LGT, unmanned coverage, complete cold/restore responses and tails stay open.

## Frozen journal checks continued, 2026-10-26 KST

**The journal fallback failed qualification and remains disabled.** A new
[offline qualifier](../../../server2/tools/verification/kma_asos_journal.py)
keeps unsupported syntax and uncertain event boundaries explicit. It does not
change the native service, fill quantities or produce latency samples. Its
[regressions](../../../server2/tools/verification/test_kma_asos_journal.py)
preserve both the original failed cases and the new held-out failures.

The actual official 2021 guideline PDF was retrieved: 828,082 bytes, 86 pages,
SHA-256 `6f21cd3515872b94099ba9be0de755de1e734bfad8fc93ab64faedb95562bdaa`.
Its text was extracted locally with macOS PDFKit. This supersedes the earlier
limitation that only indexed PDF text had been available. Section1.3.6 derives
hourly phenomenon codes from the journal, so agreement between them is a
consistency check, not independent validation. AppendixA also distinguishes
progress checkpoints from event onset, describes midnight continuation, and
records the end of manual thunder/lightning entries in2017. Transferring its
paper-symbol notation to data.go.kr brace text remains an inference. [12]

The first candidate was frozen before four HTTP requests for Busan159 and
Jeju184, each returning168 hourly and7 daily rows. It **failed**: one Busan day
contained unsupported `안개비`; two Jeju hours disagreed and one was ambiguous.
Jeju's03:00 intensity checkpoint had incorrectly been treated as an onset,
although01:00/02:00 already reported rain. The frozen source and failed results
are retained. The correction treats the earlier interval as unknown and
propagates unresolved previous-day24:00 continuation; it never infers absence.
Adding the drizzle category and changing checkpoint handling are post hoc
corrections, not fresh held-out passes.

The corrected candidate was then frozen at SHA-256
`bf4d67b655a3334ecd08aa0d79b224ab86aee45865d6f6f10611b54978dfc607` before
six requests for three new station/date pairs. All six returnedHTTP200,
resultCode00,96 hourly or4 daily rows as requested. Zero comparable gauge
mismatches, complete applicable journal parsing, wet/dry gauge controls and
observed overnight-checkpoint, winter-snow and drizzle cases were required in
advance. Hourly code consistency and summer1h/winter3h rainfall checks were
reported separately; no rejected or unknown row was silently dropped.

| Fresh control | Result under the frozen rule |
| --- | --- |
| Incheon112, January27–30,2025 | 48 code comparisons agree;26 gauge windows include **one disagreement**. January28 21:00 has normal-QC `rn:"0.0"`, but no journal precipitation in18:00–21:00. Trace is precipitation under the retained source rule. |
| Gangneung105, March2–5,2025 | All four journals are empty despite daily totals16.9/17.5/10.1/14.4mm. All four days are rejected; staffing or a reason for omission is not inferred. |
| Mokpo165, October11–14,2026 | 50 gauge windows agree. An hourly phenomenon string `"1"` is outside the strict two-digit grammar and explicitly fails the code gate. No universal padding rule is adopted. |

Winter snow was present; the required new drizzle and initial-checkpoint cases
were not observed. The fresh gate therefore **fails independently of those
missing cases**. The ten exact originals from both profiles are retained as
[source rejection fixtures](../../../server2/tests/domestic/fixtures/ASOS-20261025-PROVENANCE.md).
All finite profiles are exhausted; there were ten actual data.go.kr calls in
this continuation, no retries, no APIHub or AmazonAWS/S3 calls.

The final candidate replay on the earlier Seoul/Busan/Jeju data has zero code
mismatches, but Jeju01:00–03:00 remains unknown. The earlier Seoul winter control
has19 wet gauge windows and no dry gauge control, so it cannot qualify absence.
These replays do not erase either frozen failure. No QC9-to-PTY0 or daily-journal
zero fallback has entered the native runtime.

**40 offline Python checks pass**:21 journal,10 public-history and9 full-response
contract checks. These exercise the qualifier and evidence guards, not live
native response completeness. No Rust build was needed for this tool/fixture
slice. The existing approved Opus5.5/max reviewer identified the unsafe
checkpoint inference and the code/journal dependency in a source-only review;
it ran no tests or provider calls. Its requested400-word limit was exceeded.

The source gate remains open. A clarification about genuinely unavailable raw
values is pending; it does not change acquisition requirements or permit omitted
dates/fields. Auxiliary response-first ownership and complete real cold/restore
measurement remain separate unfinished work. Full seven-day closure and
p95/p99 remain unqualified, with zero qualifying live samples.

## Sources

[1] https://apihub.kma.go.kr/getAttachFile.do?fileName=API.pdf — KMA APIHub surface observation API manual, retrieved 2026-10-25
[2] https://data.kma.go.kr/community/board/selectBoardList.do?bbrdTypeNo=3&pgmNo=95 — KMA Data Portal FAQ, page 2 POST, precipitation and statistics, retrieved 2026-10-25
[3] https://www.weather.go.kr/w/weather/land/city-obs.do?tm=2026.10.24.23%3A00&type=t99&mode=0&reg=100&auto_man=m&stn=108 — KMA public Seoul station observation table, 2026-10-24 23:00 KST, retrieved 2026-10-25
[4] https://www.weather.go.kr/w/weather/land/city-obs.do?tm=2026.01.01.23%3A00&type=t99&mode=0&reg=100&auto_man=m&stn=108 — KMA public Seoul station winter observation table, 2026-01-01 23:00 KST, retrieved 2026-10-25
[5] https://www.weather.go.kr/w/weather/land/city-obs.do?tm=2026.10.25.23%3A00 — KMA public future-hour city query, 23:00 requested at22:44KST, returning22:00, 2026-10-25
[6] https://data.kma.go.kr/community/board/detailBoard.do?bbrdTypeNo=1&pgmNo=96&bbrdNo=66383 — KMA ASOS rainfall blank/zero answer, public read-only POST, retrieved2026-10-25
[7] https://data.kma.go.kr/community/board/detailBoard.do?bbrdTypeNo=1&pgmNo=96&bbrdNo=30942 — KMA hourly rain-QC blank answer, public read-only POST, retrieved2026-10-25
[8] https://data.kma.go.kr/community/board/detailBoard.do?bbrdTypeNo=1&pgmNo=96&bbrdNo=29442 — KMA minute/hourly precipitation distinction, public read-only POST, retrieved2026-10-25
[9] https://data.kma.go.kr/data/grnd/selectAsosList.do?pgmNo=36 — KMA ASOS dataset description and winter cadence, retrieved2026-10-25
[10] https://www.weather.go.kr/cgi-bin/aws/nph-aws_txt_min?202610202100&0&MINDB_60M&0&m — KMA national AWS page, QC9 comparison hour, retrieved2026-10-26 KST
[11] https://www.weather.go.kr/cgi-bin/aws/nph-aws_txt_min?202610202200&0&MINDB_60M&0&m — KMA national AWS page, trace-rain comparison hour, retrieved2026-10-26 KST
[12] https://data.kma.go.kr/resources/images/publication/%EA%B8%B0%ED%9B%84%ED%86%B5%EA%B3%84%EC%A7%80%EC%B9%A8%282021.5%29.pdf — KMA Climate Statistics Guidelines, May2021, actual PDF retrieved2026-10-26 KST, AppendixA §§1.3.6/1.5.1
