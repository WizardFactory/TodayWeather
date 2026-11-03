# KMA full-response implementation and verification — 2026-10-25

The ASOS-primary and response-first implementation exists locally. **The complete
user requirement is not finished:** actual seven-day source coverage and actual
full-response cold/restore latency remain **NOT QUALIFIED**. No deployment,
production mutation or eligible live p95/p99 sample is claimed.

This records changes against `82f7a4838dda046be966ee9c25c9cb66561d099d`, including
uncommitted implementation. Earlier dated reviews remain historical evidence.
AK subsequently allowed acquired ASOS historical numbers to differ and retained
the current public three-hour cadence. Internal history stays hourly. Seven
completed KST days, including AM/PM weather, measured extrema and rain, remain
required. Per-grid source-combination generation is explicitly deferred.

[Machine-readable results](kma-full-response-implementation-2026-10-25.json) ·
[Selected design](../../architecture/server2-kma-data-design.md) ·
[Sequence](../../architecture/diagrams/server2-kma-data-design.html) ·
[Provider manual](../../reference/external-apis/kma.md)

## Implemented behavior

1. **Acquire observations.** The new policy acquires selected-station ASOS hourly
   and daily ranges, incorporates measured historical values, and requests elapsed
   current-day ODAM and a bounded VSRT window. It removes historical SHRT/RSS
   weather influence. Future values and the existing public cadence remain
   regression-protected. Station selection uses the existing deterministic nearest
   ASOS mapping; it is not the deferred optimal combination plan.
2. **Keep uncertainty explicit.** Acquired-row coverage is separate from value
   completeness, so a returned blank row does not trigger an endless full-range
   fetch. Qualified normal ASOS blanks now distinguish dry weather from trace
   zero, with another measured value and daily event/duration guards. Other
   missing values stay unknown. Winter measured rain keeps
   its three-hour period. Unknown phenomena, QC failures and unavailable amounts
   do not become dry/clear/zero. Bounded domestic phenomenon codes produce PTY;
   no numeric lightning amount is invented. Yesterday's minimum uses official
   daily observations, then measured hourly values before any VSRT fill.
3. **Respond from validated RAM.** Capacity is reserved before polling a provider.
   One supervised writer owns the original batch before announcing RAM readiness.
   Pure complete-group validation precedes assembly. The HTTP body ends, errors or
   drops before ordinary weather publication starts. A ten-second dormancy cap,
   no-waiter completion and shutdown also release publication. This observes the
   server body; it does not prove app receipt or a kernel flush.
4. **Retain and publish originals.** Natural-key single flight and a writer-owned
   pending overlay survive the short flight retention period. Generation pins and
   full RawId deduplication cover canonical/overlay promotion. Transient failures,
   including corrupt stored/control reads, retry the same bytes and identity.
   Deterministic invalid input parks under its charge until shutdown. Quiesce
   immediately wakes queued admissions and rejects new provider misses. A bounded
   drain counts abandoned served originals. Accepted volatile crash loss cannot
   recover an exact vintage without an independent durable original.
5. **Fence only actual summary inputs.** Grid inputs, retained station pages and
   ASOS ranges carry full canonical identities. A snapshot waits only for its own
   pending originals, so an unrelated parked grid cannot block it. Receipt
   intersections use a hash set outside the writer table lock. Rejection wakes and
   skips affected summaries immediately. Up to 32 response/durability waiters are
   separate from the two S16 storage workers; the 30-second task deadline remains.
   Busy/late summaries may be skipped and retried on a later request. RAM-ready
   raw never becomes a canonical receipt, result/disk-cache dependency or durable
   summary input prematurely.

Canonical storage still contains exact provider bodies, envelopes and original
group/catalog identity. No normalized hourly store, preassembled response store,
grid head, day locator or pack accelerator was added. Existing life/air behavior
and warning ownership are retained; those branches are not certified by the wet
weather test below.

Warning collection still uses its existing durable-first raw/state publication.
This slice does not establish post-body publication for every auxiliary input of
the whole request. That integration/ordering gate remains open alongside coverage;
the foreground weather writer must not be presented as a completed whole-route
response-first implementation.

Relevant implementation: [source](../../../server2/src/domestic/kma/source/mod.rs),
[ASOS adapter](../../../server2/src/domestic/kma/source/asos.rs),
[station ownership](../../../server2/src/domestic/kma/source/observe.rs),
[writer](../../../server2/src/storage/response_first.rs),
[recorder](../../../server2/src/summary/recorder.rs).

## Verification and its limits

The following table records the earlier implementation snapshot. The later
keyless city/publication repair has its own [verification record](kma-asos-closure-qualification-2026-10-25.md)
(51 provider tests, one scripted full-flow regression, 19 offline Python checks
and all-target Clippy); it does not represent a rerun of all 398 tests below.

| Check | Result | What it establishes |
| --- | --- | --- |
| Response-first tests | 16 passed | Readiness before publication; drop/cap/no-waiter release; bounded admission; identity-preserving retry; overlay promotion; drain; unrelated parked-key isolation; rejected-summary fast return |
| Summary tests | 29 passed | Durable provenance, existing derivation/revision behavior, separate wait/write admission and exclusion of a midnight minute-only row |
| Library tests | 100 passed | Native library regressions, including foreground publication planning |
| Gateway tests | 59 passed | Gateway regressions and native budget propagation |
| Full domestic suite | 172 passed, 2 ignored | Native acquisition/assembly/storage and existing domestic regressions; the ignored tests were not run |
| Runtime services | 22 passed, 1 ignored | Native construction, owned service lifecycle and shutdown regressions |
| Focused domestic rechecks | 59 passed before the final full run | ASOS 12, observed-history 2, parity 2, full-flow 1, station 10, summary-S3 10, town 17, native switch 5 |
| Offline coverage checker | 9 passed | Necessary historical coverage/value-difference checks; not whole-response qualification |

The final distinct Rust suites total **398 passes and 3 ignored tests**, excluding
duplicate focused rechecks. Clippy passed `--all-targets -- -D warnings`; 38 scoped
Rust files passed rustfmt. No dependency manifest or lockfile changed.

The legacy parity test covers 98 recorded oracle scenarios. Legacy output remains
byte-exact under the legacy policy; the ASOS-primary policy intentionally replaces
historical forecast numbers with acquired observations. Same-new-closure replay
must remain byte-exact.

The [full-flow test](../../../server2/tests/domestic/full_response.rs) starts with
an empty local S3 peer and empty source state, calls `Gateway::handle`, acquires
scripted current/forecast/station inputs and complete **wet September** ASOS
history, collects the body, waits for canonical publication/S16, then restores
through a fresh source with providers unavailable. It checks seven daily dates,
the hourly history gate, no ordinary weather publication before body termination,
ordered timestamps and identical replayed body. This is a native integration
test, not a real-provider latency measurement. Its approximately 0.7-second test
duration must not be quoted as client latency. It does not qualify dry, winter,
unattended-station, pre-release or every auxiliary-source condition.

Earlier monolithic domestic runs had failures. Two findings were corrected:
legacy gap-field ordering and the unsupported snow/text assertion. A later
165-pass/7-failure run recorded `address_unavailable` on 57 history HTTP, 80 S3 HTTP
and three gateway operations. The classifier maps this to `AddrNotAvailable`;
affected groups passed isolated runs. Domestic test peers now select the existing
bounded HTTP connection-reuse mode to avoid ephemeral-address exhaustion during
thousands of local reads. The default dedicated storage/runtime fault peers,
16-connection admission, two-second socket bound, production transport and
operational timeouts are unchanged. Both peer modes passed framing/HEAD/204/CAS/fault
checks. The final complete domestic run passed **172 tests, with 2 ignored** and
no `address_unavailable` event. Original failure logs remain retained.

## Actual provider evidence

At 19:16 KST, one bounded Seoul station 108 probe returned 168 hourly rows and
seven daily rows for October 18–24. Exact selected originals and provenance are
retained in the [hourly fixture](../../../server2/tests/domestic/fixtures/asos-hourly-108-20261018-20261024.json),
[daily fixture](../../../server2/tests/domestic/fixtures/asos-daily-108-20261018-20261024.json)
and [provenance](../../../server2/tests/domestic/fixtures/ASOS-20261025-PROVENANCE.md).
Their hashes are in the companion JSON.

- All hourly temperature, humidity and cloud values were present. Rain and domestic
  phenomenon fields were blank on 150 hours; the other 18 had rain phenomenon `01`.
- All seven daily extrema were present; daily rain was blank on four dates.
- The actual QC property is `rnQcflg`: blank on 124 hourly rows and `9` on 44.
  The original diagnostic inspected misspelled `rnQcflag`; its report is retained
  unchanged. A later sentence incorrectly described all 168 flags as blank;
  the [source recheck](kma-asos-closure-qualification-2026-10-25.md) corrects that
  claim against the original body. The parser accepts both spellings.
- A current-day midnight query returned result `99`, no rows. A January seven-day
  probe returned 168 hourly rows with all rain blank and 161 phenomenon blanks.
  Two public national AWS pages were reachable, but reachability does not qualify
  their period/field mapping as a replacement.

Hourly and daily HTTP durations were **421.493 ms** and **205.729 ms** respectively.
These are single provider-call observations, not request-to-client durations,
full-coverage results or tail estimates. Four ASOS attempts and two public AWS
page attempts were made under the recorded source-qualification caps. No actual
AWS/S3 request was made for this implementation verification.

The initial checkpoint had not retrieved an ASOS-specific definition for rain
blanks. The subsequent [source qualification](kma-asos-closure-qualification-2026-10-25.md)
now records KMA QnA 66383/29442/30942: hourly/daily blank rain is no precipitation,
numeric 0 is trace precipitation, and blank QC is normal. Their application to
data.go.kr JSON is a source-based inference corroborated by retained ASOS
originals, not an API serialization guarantee. Normalization now supports124 of 168
hourly rain/PTY rows and all7 daily totals. The44 QC9 hours stay unknown. The
originals/schema and legacy replay remain unchanged. APIHub is an optional
candidate; its key is not necessary for this correction.

The subsequent [APIHub-key/public-page qualification](kma-asos-closure-qualification-2026-10-25.md)
records AK's absence of an APIHub key and the eleven additional finite public-city
requests. Current-URI pages were reachable; station batches still have blank
phenomena/rain. The 168-row ASOS input overlaps only 167 of the required boundary
slots. Native collection now uses that current city URI and requires an exact
observation header time for hourly/city requests; a city form echo is insufficient.
No complete-history or client/tail qualification is added by these repairs.

## Independent check and operational bounds

The already authorized Claude Opus 5.5 (`claude-opus-5-5`, max) reviewed permitted
sources and non-secret evidence without editing, building, testing or calling a
provider/AWS. Its findings caused the reservation, shutdown, per-snapshot fence,
rejection notification and summary-admission fixes. Its final checked spans had
no remaining correctness/durability blocker. This is a source-only opinion;
test counts above are the lead's runs.

The writer defaults to a real maximum **768 MiB** retained-byte commitment,
88 MiB/group, 4,096 entries and three publishers. A 616 MiB conservative one-grid
fan-out reservation is tested before any provider completes; charges shrink to
validated retained size. Production memory headroom and concurrent load are
unqualified. Publish attempts are bounded to nine seconds with backoff capped at
30 seconds; shutdown drain is 34 seconds.

The public gateway stays at nine seconds. The observations-primary handler gets
eight seconds with 500 ms reserved for assembly; geocoding retains its own
three-second cap. These are chosen ceilings, not measured latency or an accepted
operational SLO. The client's existing overlapping two-second retries are unchanged.

The sequence's Archify validation, generation, artifact check and browser check
passed. Light/dark captures at 1440×900 and 2048×1320 passed readable-layout checks;
selected light/dark screenshots were visually inspected. The diagram describes
local ownership and qualification gates, not deployed performance.

## 2026-10-26 KST normalization continuation

The observed-only correction distinguishes present normal dry blanks, numeric
trace amounts and actual missing/QC1/9. Daily dry inference additionally requires
an explicitly empty event log and no conflicting rain duration. All-blank rows
remain unknown. Any valid numeric rain amount, including0, blocks a contradictory
PTY0. Winter cadence comes from the official ASOS dataset description; preceding
three-hour accumulation attribution remains an inference, and no complete winter
response is qualified.

The same raw Seoul input now supplies 124 typed hours (18 wet plus 106 dry) and7 daily
rain totals;8 trace rain rows remain PTY1. Per-original-row assertions preserve
all44QC9gaps. The required midnight is still outside that retained ASOS range.
Observed grid summaries carry a new normalization dependency digest. Station
summaries retain their unchanged legacy derivation for the internal last-year
lookup and do not supply the current seven-day observed store.

Three initial regressions failed before the correction. Opus identified guard
gaps that were separately reproduced and repaired. An intermediate full domestic
run passed176with 2 ignored; that is an earlier candidate, not a final whole-suite
claim. Final focused checks and the source-only review are retained in the
[normalization evidence JSON](kma-asos-closure-qualification-2026-10-25.json). Both
wet and dry scripted Gateway/body-terminal/raw-publication/fresh-restore cases
pass and replay byte-for-byte. These loopback results are not live timings.

## Remaining acceptance gates

1. Close explicit QC9 and midnight gaps with actual allowed observations. Qualify
   nonempty daily event logs, winter periods and unmanned stations. Cover D−1 delivery before
   11:00 without pretending delayed fields exist.
2. Demonstrate the complete required client data in a truly empty-weather-store
   acquisition, then restore the same selected raw closure through a fresh source.
   Qualify response-first ordering for the complete auxiliary-input closure as
   well. The current wet/dry scripted proof does not satisfy this actual-data gate.
3. Only after coverage and replay qualify, measure continuous request-to-client
   latency for both cohorts and run a prospectively bounded p95/p99 campaign.
   There are currently **zero eligible live full-response samples**.

No earlier latest-only timing, HTTP 200 partial body or result-cache hit substitutes
for these gates. The requirement was not reduced to make the implementation appear
complete.

## Scope, artifacts and build capacity

The 53-path declaration covers 52 changed task paths. Whole dirty-tree placement
reported only 30 pre-existing outside-scope paths and no additional placement
finding; those earlier changes were preserved. This is a scoped manual pass, not
a clean whole-tree gate claim. The 308 local maintained-document links resolve.
The artifact checker passed against the real index; task changes remain unstaged,
so this is not candidate-commit validation. No commit or push was made.

The existing shared `server2/target` is retained for the unfinished source and
measurement work. It was about 6.5 GiB with about 137 GiB free before final checks.
No build output, source, evidence, fixture or diagram recovery metadata was deleted;
space reclaimed by this task is zero. Final exact capacity and checks are recorded
in the companion JSON.
