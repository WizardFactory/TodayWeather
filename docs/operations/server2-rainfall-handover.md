# Rainfall hit-rate handover

This procedure prepares and verifies server2. Production activation, final legacy shutdown/copy and a traffic switch require their own approved execution record. The local example uses fixed inputs, denied providers and an owned S3 peer; it does not exercise a production host or send notifications.

## Preserve the calculation and existing totals

Use the existing national `kma-web/aws-minute` web records, compatible with legacy KmaStnMinute2. Do not start a new collector, official-ASOS API or pre-collection schedule. The forecast is the last assembled canonical Current document, with its exact publication end and grid/input identity; it is not the request's current hour.

Only eligible canonical rain predictions (`pty > 0` or `rn1 > 0`) enter the updater. A dry observation of that prediction is a miss; it does not mean dry forecasts are newly counted.

For each original registration/statistics ObjectId, select actual minute rows in the strict window `(prediction end − 1 hour, prediction end]`. Require at least 15 actual rows and at least one known rainfall boolean. A known true anywhere is the observed-rain result; all known booleans false is observed-dry. A row with no rainfall boolean counts as a row and never becomes false. Keep the existing hit/count calculation and preserve imported cumulative totals. Distinct ObjectIds sharing a station number remain distinct.

## Read and mutation ownership

Read classification has 128 bounded tickets, separate from eight distinct mutation intents. No-current and dry requests still validate authority; confirmed absence before an active pin serves baseline without a rainfall write. Same grid and canonical end join the existing accepted decision before mutation capacity is charged. Each independent decision keeps its original three-second deadline and exact input cutoff.

One overlapping authority probe is shared only while it is running. There is no completed authority cache, negative cache or TTL. After an active pin, missing or invalid authority remains a partial failure, including warm no-current requests. Freshly validated equal checkpoint payloads may share storage, with at most nine distinct delivered versions; storage sharing does not authorize skipping reads.

One shared heavy flight retains raw input and projection. Every distinct grid decision independently validates its complete catalog/raw scope; projection is reused only after exact full-envelope equality. One conditional writer preserves unrelated rows and acknowledges only a successful write or validated readback. A logical timeout does not release a still-running parse or extend the original deadline. These are admission and ownership bounds, not a hard heap/RSS or fleet capacity guarantee.

## Activation and durable recovery

Freeze the final seed/high-water identity after the separately approved legacy stop and edit freeze. Bind the exact seed, namespace, activation epoch and first native prediction window. An operator creates the initial schema 1 authority; runtime must not create it. Preserve the original read-only copied legacy documents.

The runtime conditionally updates counters, last completed window and input receipts together in the same S3 authority. A repeated window or process restart cannot increment again. A conflict reloads/rebases within the existing bounded owner; an ambiguous write never grants a resend or optimistic public increment. An unreadable/corrupt/foreign-epoch or mismatched seed authority makes the station-statistics section unavailable. It must not silently return old seed totals.

Both eligible recovery bundles must understand and preserve this authority, the final-registration marker, delivery claims and forecastNarrative. Never rewind the checkpoint/journal or use a previous bundle that drops these fields. Local statistics verification alone does not qualify the full production recovery pair.

## Keep the weather answer within its budget

The public native answer retains its existing 3s deadline. Rainfall work may run independently for its original 3s from offer, including queue/read/CAS/readback. The caller waits only through the existing Source answer boundary, leaving its established assembly reserve. If the caller cutoff is reached, return a truthful station-partial weather answer and omit unconfirmed statistics and S16 summary inputs. Accepted work continues; the next demand or a fresh process can read its acknowledged result.

An expired caller cutoff is not evidence of absent activation. Before cutoff, a verified absent authority preserves the original inactive baseline with zero writes. The same distinction applies when a oneshot result and timer are both ready: an expired caller does not use the late result.

## Repeat the owned local verification

From `server2/`, use the selected protected optimized example and a new output directory:

```sh
python3 tools/rainfall_handover_smoke.py \
  --binary /absolute/path/to/qualified-rainfall-example \
  --output /absolute/path/to/new-owned-output
```

Record the exact source/toolchain/binary/runner and fixture hashes first. The normal flow checks inactive200 with zero writes; one qualified update; repeat and restart with no double count; a later dry window; and corrupt-authority station-partial behavior. Complete HTTP bodies and durable receipts remain evidence. The normal synthetic example's expected totals 4/5 then 4/6 are separate from the large-page scenario's 3/5 acknowledgement.

The large-page scenario reuses the same 46 raw records and 16MiB physical corpus for inactive and active requests. It must return200 core weather and truthful partial statistics before the deadline, then expose the acknowledged result from a fresh child after actual drain. Preserve physical raw/envelope/catalog body/ETag/version equality, original errors and complete child retirement. A terminal diagnostic proves only its observed example/rainfall-permit cutoff; it does not measure exact CPU admission, allocator peak or final network flush.

The pre-correction large-page request returned 502 and the whole active child peaked at453,263,360 bytes. That failed result and sizing limitation remain historical evidence. This caller-boundary change does not rewrite the HTML parser or prove a 64MiB physical heap bound. The historical pre-P2 corrected selected native run returned HTTP 200 in 2.557937542s, omitted unconfirmed station statistics, then committed 3/5 and returned 3/5 from a fresh same-S3 process. Its whole active-child RSS was453,967,872 bytes. Screenshots and the PDF display retained local receipts; they are not an additional product execution. Independent review and final source binding remain separate gates.


## Current-master local verification (2026-10-21)

Build17 source snapshot `3a31a023f21c4e7f62593e7b0b5ffd735518be0a` integrates master `e09672a3`.
The full workspace passed 1,124 tests with zero failures and 9 ignored,
using default scheduling; the separate owned operator test and eight diagnostic tests
also passed. This is a local record, with independent review and current PR CI still
required before readiness.

The newly built optimized example returned all six normal HTTP200 bodies byte for
byte equal to build16. On the unchanged 46-record/16MiB corpus, inactive returned200
in 0.220s with zero rainfall PUT; active returned200 in
0.790s with acknowledged3/5. Actual drain and a fresh same-S3 process
retained revision2/3of5 with exactly the same checkpoint bytes. No reset or reactivation
was used. Active whole-child peak RSS was 364,494,848 bytes, an
observation rather than a hard memory limit. The prior partial-response measurement
above remains historical; early acknowledged completion is a valid current result.

## Local verification record and manual

The [three-page screenshot manual](server2-rainfall-handover.pdf) and
[selected evidence](../evidence/tasks/issue-2819-rainfall-handover/verification.md)
show retained local receipts. All three rendered pages were visually inspected.
They are not a fresh product execution or production handover approval.

The retained operator example accepts `preview SEED ACTIVATION_JSON`,
`activate SEED ACTIVATION_JSON`, and `verify SEED`. `preview` validates and encodes
the exact checkpoint without an S3 request; the S3 namespace still comes from
validated server2 settings. `verify` performs a bounded read and reports revision,
checkpoint/seed hashes and row count. Both verify and activate require the exact complete imported S06 seed acquisition/raw proof even when a local file has the expected hash. A local preview does not certify imported seed presence. `activate` performs a conditional creation
and readback and must run only under separately scoped operational authority.
Never use the owned smoke's fixed synthetic activation as production input.

Rebuild the screenshot PDF from the maintained [manual JSON](../evidence/tasks/issue-2819-rainfall-handover/manual.json)
and its three relative images with the screenshot-manual builder; no local raw report
is required. Re-render and inspect all pages after changing the manual.


The [runtime ownership diagram](../architecture/diagrams/server2-runtime-services.html)
shows the demand-driven owner, conditional authority and separately approved
operator activation. Its source references pin the tested source commit; it does
not establish a production handover or complete eligible recovery pair.
