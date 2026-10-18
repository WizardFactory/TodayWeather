# Bounded warning work: selected local evidence

[Issue #2819](https://github.com/WizardFactory/TodayWeather/issues/2819), C4 only.
Implementation parent: `2e67d146af033ba9dc51a7e86e1a1f79728260b0` (unmerged
C2 PR2827). Candidate is bound separately by the commit/review record. The binary
executions below use the recorded working-tree projection, not that parent's code.
No main, complete recovery bundle, seven-day shadow or production qualification.

## Behavior

Known `Owned`/`Taken` physical claims are remembered before another await in a
bounded local memo. `Unavailable` is not ownership; full memo falls back to
ordinary durable CAS for new targets. Existing open/window pruning, zone/natural
selection, endpoint deduplication and exact episode-scoped location reuse remain.
A poll advisory view replaces per-endpoint preclaim reconstruction; post-claim
and after-own-OAuth strict reads remain independent. Original four-second final
admission, journal/clock/window/stopping guards and zero OAuth on postclaim state
failure remain. At most six delivery futures are constructed at once. There is
no shared in-flight read, new timer/TTL/publication head, claim release or actual
failed/unknown-send retry.

## Actual Reds and current checks

Two public owned-HTTP regressions on unchanged runtime complete all 12 accepted
outcomes/results before failing: first S12 requests 432 exceed the predeclared
302 limit; the next poll performs 144 S12 requests plus 12 claims instead of zero.
The original and corrected whole logs are retained. Initial descriptor reads
were classified as other; the corrected counter includes their content-addressed
S12 group keys before the current baseline/measurement. A compiler error, timeout
or setup failure is not described as the intended Red.

Current scoped clean inventory is **326 passed, 1 ignored**: library118,
delivery95, state18, runtime31/1, catalogs33 and warnings31. All six full targets were renewed after the review correction. Do not count individual reruns twice. Formatter,
all-target Clippy with `-D warnings`, and the optimized example build exit zero.
The original whole checks3 delivery91/1 failure remains retained: its exact-six
minimum was an obsolete coalescing assumption; current behavior promises at most
six and permits immediate independent failures to finish one at a time.

Public controls retain the independent-store release while OAuth is held and the
postclaim `warning-state`/zero-OAuth test. Added controls hold an older S12 result
while a late OAuth-ready caller obtains a new released state; quiesce while the
final read is held prevents POST. Six independent postclaim source errors keep
six claims/results, make zero OAuth/FCM calls and are skipped later from local
knowledge. An uncertain committed claim leaves the memo empty until an actual
subsequent `Taken` CAS. Service/worker reconstruction first initializes its silent
baseline, then selects a distinct feed event in the same campaign and observes
an actual `Taken` before memoizing it; startup silence alone cannot satisfy that
assertion. This is same-process reconstruction, not an OS-process restart.
A further public control covers initial advisory error and inactive state: neither
claims nor memoizes work, and the next healthy poll delivers it once.

Private checks cover the memo's full/nonownership/pruning behavior, lazy six-future
construction/start order, advisory read-start ordering and poll-local error reuse.
The ordinary worker path on saturation is additionally source-reviewed; no full
65,536-entry public saturation run or whole-process RSS measurement is claimed.

## Actual 5,000-endpoint comparison

Current corrected candidate execution is `functional4`: **723 repository inputs
frozen before and after its owned process**, with a freshly rebuilt optimized
executable. The untouched baseline is reused from the actual `functional3`
execution; helper, fixture, peer and runtime asset bytes are unchanged. Both
recorded processes exit zero and both pairs of listeners close. This is one
current execution plus the retained baseline, not two newly executed processes.
The original narrow 506-file source map was not an exhaustive runtime-input
proof. Current compilation binds `checks7-source.json`; the earlier checks4/5
metadata correction and old outputs remain historical.

| Actual controlled work | Untouched binary | Selected implementation |
| --- | ---: | ---: |
| Accepted posts / unique claims / verified accepted results | 5,000 each | 5,000 each |
| First S12 HTTP requests | 180,000 | 120,012 |
| First total S3 HTTP requests | 195,002 | 135,014 |
| First consumed request-body bytes | 2,445,000 | 2,445,000 |
| First written response-body bytes | 109,715,563 | 73,212,865 |
| Repeated-poll S12 / claim / journal requests | 60,000 / 5,000 / 0 | 0 / 0 / 0 |
| Repeated-poll total requests | 65,001 | 1 (feed) |
| Synthetic location-adapter calls | 1 | 1 |

The limits were fixed before Red: first S12 <=126,000 (70% of180,000), total
requests/body bytes <=baseline, all5,000 complete outcomes, and zero repeated
endpoint-specific work. Result-verification GETs are recorded separately from
worker work. Counts cover actual parsed owned HTTP requests; credential snapshots
are not requests. Bytes exclude headers/TLS and do not establish malformed-HTTP
or partial socket-write accounting.

The complete synthetic seed replays three recent days, not a seed-absent 60-day
worst case. The fixed domain clock is `2026-10-16T01:02:00Z`; actual elapsed times
are 30737 ms retained baseline and 15783 ms current candidate. They do not establish a
real five-minute delivery SLA, provider headroom or EC2 capacity. The test peer
uses explicit16,384-object/64MiB stored-body capacity,16connections and a2s socket
bound. It is volatile HTTP storage, not AWS, IAM/TLS/versioning/disk proof.

A separate small seed-absent strict-source probe uses the runtime four-second
CurrentZones deadline. It records **240 actual HTTP requests, zero consumed
request-body bytes and38,789 written response-body bytes**, under the predeclared
512-request bound. It does not extrapolate5,000-recipient worst-case capacity.
KnownTown is a synthetic adapter; existing geo precedence/location regressions
are separate. Zero live/device activity follows the forced loopback/test-vector
setup, not a device-send counter.

Final comparison report SHA-256:
`5bb60c8c901182b0fe230f2afb7481b4840777aef1e6862528696ac1b438323f`.
Untouched executable SHA-256: `995e8bd8102a6e74e6625ddbd98c2f9daabf378d4e287bcc9235286af9c0a689`.
Selected executable SHA-256: `3012741495e8313dc9c29b331bfc192dae6c2401f96465bee4272a34e4eb38f2`.
Full raw counters, process/source/executable maps and failed invocations remain
ignored task evidence; the PR record binds the committed source to this run.

## Selection and bounds

A correct caller-driven shared-read prototype was measured and retained. Its
additional saving was only132 requests, while adding a private driver/start-gate
lifecycle and correlated postclaim errors. The selected shape removes it, keeps
independent strict admissions, and still satisfies the same frozen budget. Those
prototype tests and measurements are historical, not added to the current326.

The [diagram](../../../architecture/diagrams/server2-warning-fanout.html) and
[editable source](../../../architecture/diagrams/server2-warning-fanout.sequence.json)
are a proposed contract at parent2e67d146. Artifact/provenance/browser checks pass;
main1440px light and2048px dark sequences were actually inspected. Offscreen
cards were read as source, not claimed visually inspected. Their prototype
comparison is not current implementation evidence.

C1/B1 remain parallel unmerged branches. First-poll silence, traffic-independent
warning acquisition, startup credentials, readiness, shared S3 priority/capacity,
other #2819 findings and #2704/#2705 remain separate/open. New local stats do not
wire HTTP metrics or qualify operational rollback thresholds. Current independent
source review and exact CI remain pre-merge gates; nothing is merged or deployed.

C4 admission limits: an advisory view can still say active after an external
release. Such an endpoint can acquire its one-shot claim before the independent
post-claim read returns `warning-inactive`; that claim remains terminal and is
not released or retried. Inactive/error advisory results instead leave work
unclaimed for a later poll. The default `StderrDiagnostics::minute` adapter is
silent, including the memo-saturation note; `fanout_stats()` is the only library
snapshot signal until operational metrics are wired. No default stderr/HTTP
saturation metric is claimed. The post-claim read retains the source's own
existing deadline; the worker adds no outer timeout there. The separate final
after-OAuth admission guard retains its original four-second timeout.

## Review correction

Actual independent review1 found an unintended new outer4s post-claim timeout.
A public injected source held4.2s reproduces the lost delivery (0 accepted vs1)
on review1 code. The correction restores the base direct source await; that
source still owns its production deadline, and the original final after-OAuth
four-second guard remains. The new regression now observes one OAuth, one
accepted POST and three independent source reads. Source time is parsed once
per group, and one physical claim identity is carried from memo lookup to
insertion. Selected diagnostic/advisory limits are stated above. Review1's325/1
and functional3 selected binary remain historical, not relabelled current. The
current326/1, formatter, all-target Clippy and optimized build are renewed; the
current5000 run is functional4. Independent reviewer resolution of001 and exact
new-headCI still gate readiness.
