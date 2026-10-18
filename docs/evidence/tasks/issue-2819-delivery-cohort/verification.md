# Conditional-alert definite no-POST restoration: selected evidence

2026-10-18. Parent C2 scope of [#2819](https://github.com/WizardFactory/TodayWeather/issues/2819),
stacked on lateness PR2826 `e97a50906234e05b87dbdcb28cf87d0959a1e4b1`.
That child addresses C3 and the minute-refusal trigger, separately reviewed with
14 successful CI checks. C1/B1 remain parallel unmerged branches, not ancestors.
This is no main/global, shadow, eligible full recovery release or issue closure.

## Behavior and discriminating checks

Before parent runtime edits, two public worker tests against unchanged child
runtime failed as intended: an owned OAuth503 made no FCM POST but retained the
sent transition/pushTime; a later fresh scheduled evaluation then failed its
`report.claimed` assertion because false cooldown filtered it. That second Red
is not a zero-versus-one POST assertion. All716 source/test/fixture/manifest
hashes and original copies were retained before execution and stayed unchanged.

The minimal implementation passed both cases. Subsequent controls cover
metadata/token edits, nonselected observations, partial ownership, exact
missing/null/structural parents, local and caught-up A-to-B-to-A, deletion and
recreation, writer identity, single consumption and dead weak-lease pruning.
Active receipts are invalidated by intermediate changes from actual settle and
412 conflict catch-up, not merely final-image comparison. Actual rejected and
unknown POSTs retain sent state and are never automatically retried.

A further public Red on the incremental implementation shared one failing clock
between writer and worker. After known commit and held OAuth, a clock error
blocked FCM but also blocked exact undo, leaving sent state. Its718-file input
map and test/runtime copies preceded execution. The correction retains the
known transaction time only for constructing a receipt-owned restore; no new
date/ID is written and final POST admission still fails closed. It is not a new
clock or retry policy. Compiler failure `green1` is retained and is not Red or a
passing run.

An initial whole focused invocation was **18 passed / 1 failed**: a proposed
whole-worker queue deadline test timed out in unchanged preselection duplicate
cleanup before reaching the new typed API. It is retained as failed. The test
was corrected to exercise the actual bounded typed command on a full Tokio
queue; no global bool API was changed and no whole-worker queue bound is claimed.
An initial full check also failed Clippy; its four passing test targets do not
make that invocation PASS. Both lint findings were corrected without disabling
warnings. Current exact results follow below.

## Execution bounds

Unknown initial commit, lost answer or unavailable restore does not manufacture
a receipt, POST or successful compensation. Actual lost-ack/storage tests can
leave suppression pending ordinary writer settlement. One-shot claims remain;
there is no cleanup timer, repair-on-drop, journal rewind or FCM retry. The claim
on an unsuccessfully sent minute cannot replay, even when a fresh later minute
can send after a successful restore.

The additional executable uses four fixed scenarios: OAuth refusal, concurrent
metadata/token edit, actual FCM503/rejected, and connection-reset/unknown. First
two restore state before probing the original claim while the trigger remains
due; later fresh evaluation posts once with current token. Last two keep state;
their absence of further posts also depends on cooldown and does not independently
prove claim admission. Forced synthetic loopback means zero live/device sends,
not actual-device telemetry. Weather is recorded/in-process, journal is MemS3,
and service reconstruction shares one executable: no AWS or OS restart claim.

## Documents and design

All20 paths are predeclared in DeliveryCohort2819. See
[contract](../../../../specs/issue-2819-delivery-cohort.md),
[operator scenario](../../../operations/server2-native-verification.md#conditional-alert-no-post-compensation),
[proposed sequence](../../../architecture/diagrams/server2-delivery-cohort.html)
and [editable source](../../../architecture/diagrams/server2-delivery-cohort.sequence.json).
The checked diagram is frozen design-time `e97a5090`, not an implementation or
test attestation. Its earlier no-parent-tests-yet wording stays historical.
Artifact/provenance/browser checks passed; actual light1440 and dark2048 main
captures were visually inspected, offscreen cards source-only. Sidecar/recovery
metadata is retained. No new UI or PDF manual is claimed for this worker fix.

Independent current PR review and exact-head CI remain mandatory before pre-merge
readiness. No merge/auto-merge/queue, deployment or live action is authorized.

## Current clean inventory and additional executable

After the shared-clock correction, all four full targets were renewed on the
same718-file runtime/source/test/fixture/manifest projection: lib114,
delivery85, state18 and runtime_services31 passed, **248 passed / 1 ignored**
counted once. Fmt, all-target Clippy `-D warnings` and optimized example build
exited zero. Focused Greens, prior247/1 and repeated targets are not added to
that total. No whole-domestic or entire-repository PASS is claimed.

Current actual executable rehearsal is functional2: four cases, four owned FCM
POSTs, five OAuth requests, process exit0 and all four owned loopback listeners
closed; all718 inputs and executable unchanged. Report SHA-256
`56ced2c87867bf7305341d1ab2cce7d6590fe28356e7881617e1775ae960cb2e`; retained optimized executable SHA-256
`81f3e319b02de44bff413a03f3d630cd7df71c9fb657b7136c1d23068ef9861f`. Selected binary stays in the task's
ignored bin2 directory outside disposable Cargo output. Prior functional1 remains
bound to the earlier source and executable, not relabelled as the current run.
Raw logs/maps/exit receipts and both failed whole invocations remain preserved.
