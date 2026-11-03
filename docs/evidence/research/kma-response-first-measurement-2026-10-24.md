# KMA response-first continuous measurements — 2026-10-24

## Qualification correction — 2026-10-25

**This experiment does not validate the full client response AK requested.**
AK required the delivered weather values and historical data to remain intact.
The lead reduced the experiment to seven latest products without authorization
to replace that acceptance criterion. Both the 1.700597-second provider result
and the 0.301403-second S3 result concern responses missing all 168 historical
hourly slots and seven historical daily dates. They must not be used as the
latency of the required complete response or as evidence that its verification
is complete. The original client-data requirement remains unchanged.

The measurements below are retained as diagnostic evidence of that incomplete
profile. Identical incomplete bodies prove repeatability within the profile;
they do not prove preservation of the requested client data. The full-response
verification is **INCOMPLETE**. Provider/history gaps must be resolved or reported
as unmet requirements, rather than removed from the measurement scope. Accepted
post-response crash loss does not authorize omitting data from the response.

## Result and scope

The first weather-cache-empty provider request reached the test client's complete
response body in **1.700597 s**. Reading those same seven complete groups from S3
through a fresh targeted source reached the complete body in **0.301403 s**.
Canonical publication began after the first client terminal signal; its separate
writer-drain timer measured another **0.556887 s**. These are continuous HTTP timers and a
separate writer-drain timer, not a sum of previously measured stages.

This is a component experiment for the [response-first design](kma-response-first-review-2026-10-24.md)
with a limited latest-forecast input. It does **not** satisfy the requested
full-response verification or qualify complete historical weather, the
production route or p95/p99. The first pair precedes the native
discovery control; subsequent samples include possible background contention
from that control. Keep those conditions visible rather than pooling the
samples into an uncontended speedup.

Observed on macOS arm64, 2026-10-24 **23:49:58–23:50:12 KST**
(`14:49:58.136719–14:50:12.894224 UTC`), at repository revision
`82f7a4838dda046be966ee9c25c9cb66561d099d` with the retained task harness.
The entire campaign took 14.757 s, including its credential/prefix prerequisites.
[Selected machine-readable evidence](kma-response-first-measurement-2026-10-24.json)
contains every HTTP sample, input fingerprints, publication outcomes and limits.

## Every HTTP sample

All eight requests returned HTTP 200 and a fully received body. HTTP 200 here
does not imply historical completeness.

| Profile | Trial | Send → full body | Conditions |
| --- | --- | ---: | --- |
| P1 provider → validated RAM → client | 0 | 1.700597 s | Before S0; no prior native discovery work |
| S1 targeted canonical S3 → client | 0 | 0.301403 s | Before S0; 7 control + 7 descriptor + 7 raw reads |
| S0 unmodified native S3Source → client | 0 | 2.715386 s | Real discovery, ancillary work and native request guard |
| P1 provider → validated RAM → client | 1 | 1.514664 s | After S0; possible native background contention |
| S1 targeted canonical S3 → client | 1 | 0.295511 s | After S0; possible native background contention |
| P1 provider → validated RAM → client | 2 | 1.471558 s | After S0; possible native background contention |
| S1 targeted canonical S3 → client | 2 | 0.282011 s | After S0; possible native background contention |
| A0 provider → canonical publication → RAM → client | 3 | 2.057330 s | Durable-first control using the same adapter; after S0 |

P1's post-client writer-drain times were **0.556887, 0.525525 and 0.524773 s**.
Each P1 had zero weather `put_raw` and zero weather `put_control` admissions at
the client's terminal checkpoint. All seven groups subsequently passed native
publication in every trial. A0 deliberately had seven raw and fourteen control
PUTs before its client completed; its post-client drain was already finished.
The control is one different acquisition, not a paired statistical estimate of
the saving from B.

For P1, the slowest input in each batch was SHRT: **1.667, 1.497 and 1.454 s**
from the start of that job, including native acquisition/pure validation and
applicable quota work. Those values explain the foreground bottleneck without
being substituted for the end-to-end measurements.

## Input and output equivalence

Each provider trial acquired the fixed latest products for Seoul grid 60/127:
ODAM, VSRT, SHRT, mid forecast station 108, mid land region 11B00000, mid
temperature region 11B10101 and town RSS. Six native data.go.kr acquisitions and
one native public RSS acquisition ran at concurrency four. No reach probes,
historical SHRT, ASOS, air or life provider jobs were included. This does not
remove existing pure response fields derived by the native assembler.

All 28 logical jobs completed, producing 28 complete acquisitions and 28 durable
groups. Each batch retained 149,884 original raw bytes. Full RawId sets were
checked during S1 restoration, and all three S1 bodies and functional headers
equaled their P1 counterparts. S0 and A0 also produced the same body. All eight
bodies were **44,321 bytes**, SHA-256:

```text
a477c058b00b70032023c2d5f39f963e7d57fd978c137630c225777117d8acf9
```

The body contains 41 short slots, six shortest slots, current conditions and
eleven mid daily entries for D0 through D+10. It explicitly lists **all 168
historical hourly slots and seven historical daily dates as missing**. This is
forecast-only parity against the native assembly using those inputs, not parity
against a fully populated legacy response. Seven-day cloud/PTY/LGT recovery,
historical source restrictions and original-vintage equivalence retain the
[earlier qualification gates](kma-storage-reassessment-2026-10-24.md).

## What the timer includes

The [test entrypoint](../../../server2/examples/kma_response_first_measure.rs)
uses the real direct v000903 address route, KmaBackend and native assembler, with
an owned loopback listener and a fresh reqwest client per HTTP attempt. The timer
starts immediately before `send()` and stops after `bytes()` has received the
entire response. Provider work is first polled inside the HTTP source request;
there is no provider prefetch before the timer. Client setup, listener setup,
credential export, empty-prefix proof and retained-evidence file writes are
outside that individual timer. API Gateway/CloudFront, mobile networks and app
rendering are also outside it.

P1 uses an actual native empty-context snapshot for static/default callbacks,
then native public grid/RSS/mid folds for the newly validated raw. Its own live
visibility follows the existing fetched-time clamp; RawIds are never retimed.
Its pending writer owns the original acquisition before readiness. A shared
semaphore reserves the maximum bounded batch plus metadata before provider work,
and the trial keeps its pending data until completion. Pending snapshots expose
no durable summary inputs. This is a single-batch verification adapter, not the
production coordinator, generation-pinned overlay or multi-waiter writer.
([adapter](../../../server2/examples/kma_response_first_measure/source.rs),
[owner and pure validation](../../../server2/examples/kma_response_first_measure/pending.rs))

P1 deliberately skips canonical weather discovery using that empty context.
Native S08 quota reads/CAS writes still precede provider requests: each P1 had
four quota GETs and eight quota PUTs before responding. Moving weather
publication later does not remove those budget operations. The accepted design
also retains initial discovery until a separately verified change removes it;
these P1 timings must not be assigned to unchanged S3Source.

Before each S1, the main task drops its provider source, pending owner and direct
raw handles. The fresh S1 source receives only target catalog metadata and
expected RawId keys, with no reference to provider raw bytes. S1 uses a
fresh read-only canonical store; native lookup verifies complete original
groups, and the same pure folds/assembler produce the response. It receives the
seven target catalogs from the test profile, so it measures targeted restoration,
not general discovery. No application weather cache, normalized store or disk
cache serves P1 or S1. OS DNS/TLS state and provider-side caching are uncontrolled.

The client itself signals full-body receipt to release the P1 writer. The server
body wrapper observed body **drop**, not a poll-to-EOF event, in these runs. Neither
observation is a production kernel-flush/mobile-receipt guarantee. The normal
release reason was the test-client terminal signal in all three P1 trials;
the 15-second cap was not used.

## Background-work finding and tool correction

The as-run order put S0 after the first P1/S1 pair. Aborting its HTTP listener and
dropping a source handle did not stop all native background discovery. Subsequent
counter deltas contain LIST operations although P1's real transports perform only
acquisition/publication and S1 performs only targeted lookups. S0 is the only
real discovery source in this process; these extra LISTs are therefore attributed
to its surviving work. They can affect later timings and prevent per-profile
attribution of those global I/O deltas.

The retained as-run report and executable are unchanged. The maintained harness
now runs S0 last and records final counters **after runtime shutdown**, including
late/cancelled native operations. Its console summary now omits the per-I/O event
dump while preserving counters; the full raw report still retains events. This
corrected revision passed local tests/build/lint, but **was not run in a second
live campaign**. Do not relabel these samples as corrected uncontended results.

At the as-run final checkpoint the ledger recorded 28 provider transport
admissions, **1,732 native S3 reads**, **116 writes**, **16,848,021 conservative
body/header bytes**, zero denials and zero in-flight reservations. Three CLI
empty-prefix LISTs are additional. These are checkpoint counters, not a claim
that late runtime-shutdown charges were separately settled. The native ledger
guarded the entire process against the fixed maximums: 64 provider admissions
(at most 256 wire attempts), 50,000 total S3 reads, 5,000 writes, 250 MiB
conservative transfer charge and a 30-minute campaign. The charge excludes wire
framing/TLS and is not actual network traffic.

Only new task prefixes below `raw/v2/verification/`, `index/v2/verification/` and
`budgets/v2/verification/` were used. Original identities/envelopes were preserved.
S08 ran under task-only budget keys; this does not qualify production shared
quota. No production object was overwritten/deleted, and no deployment occurred.

## Reproduction, verification and retained identity

Build the example with the pinned Rust 1.99.0 toolchain, `--release --locked
--offline`, then invoke the [runner](../../../server2/tools/verification/kma_response_first_measure.py)
with `--binary <retained-executable>` and a new `--out` directory below `reports/`.
It requires the repository AWS profile, the existing private provider-key setting
and the fixed verification bucket. Credentials enter only the child environment;
no values are retained in configuration, logs or selected evidence. The
task declaration (`KMA-RESPONSE-FIRST-MEASURE.json`, kept outside the repository history because a PR holds one declaration)
defines implementation and documentation paths.

The **measured** executable SHA-256 is
`1a611f5544d6cb23d34b657ba71a4992188060e82f23d58153f89f0c34a68531`.
Source/executable hashes were equal before and after the live run. Original
source snapshots, raw report, API bodies and executable remain in the ignored
task run; the selected JSON retains their hashes and all measured outcomes.
The later harness correction has a distinct candidate identity and no new live
latency claim.

Final local checks: ten Rust tests, six Python tests, locked/offline build,
Clippy with warnings denied, formatting, scoped placement/dependency review,
reference/evidence checks and isolated-index artifact policy. Rust's optional
debug-stripping tool emitted the already observed missing-libLLVM warning;
builds, native tests and the retained measured arm64 executable ran successfully.
Production overlay promotion/removal races, multi-reader liveness, shutdown drain,
retry/crash recovery and deployment remain unqualified. The shared Cargo target
is protected for other consumers; no cache cleanup or recovered-space claim is
made.
