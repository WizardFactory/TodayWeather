# S20b source verification

Date: 2026-10-16. Task [#2792](https://github.com/WizardFactory/TodayWeather/issues/2792), stable ID `issue-2705-s20b`; own branch `feat/2792-s20b-worker-supervision` from exact `171472c5bfffb0010f1868ffcae1100dfb262de6`. Endpoint is pre-merge; merge/queue/auto-merge/deployment/live actions remain excluded. Independent review and exact-head CI are recorded on the task PR; local tests alone do not establish readiness.

## Preserved feedback and focused evidence

The intended Red was an alarm subscription disabled during held OAuth: old code emitted one FCM POST, expected zero. The new final guard emits zero. Distinct positive/negative boundaries retain timestamp-only refresh delivery, material name/disable changes during OAuth, and user edits after an admitted POST through stale cleanup. Conditional legacy normalization, malformed-input and air-filter oracle expectations/goldens remain unchanged. Direct historical run_minute fixtures remain supported; actual entry-clock aging and the supervisor's stale queued-tick check guard real scheduling.

Initial existing delivery run: **52 pass, 8 fail**. The six alert failures identified request-normalization versus stored-document comparison errors; implementation was repaired. Alarm cleanup expectations were separated at final admission rather than dropping post-admission race coverage. Later setup failures (incorrect test API names, a Rust pattern-guard move, omitted request content-length) and an incorrect enable=true oracle were retained as failures, never intended Red or PASS. Stable build accounting retained all rounds; delayed receipt submission is explicitly retrospective, not a claim that those receipt timestamps preceded historical executions. No counters were reset.

Final focused checks actually executed:

| Check | Observed result |
| --- | --- |
| delivery regression | 60 pass |
| runtime services, including new ownership/guard tests | 21 pass; one ignored child entrypoint exercised by the process smoke |
| unchanged state scope | retained 18 pass from post-refactor round 6; writer/durable source unchanged since that run |
| unchanged notice scope | retained 24 pass; source/API/translation behavior unchanged by later guard/harness edits |
| cargo clippy --all-targets -- -D warnings | pass |
| placement, full task diff and dependency/resource scan | pass using Python 3.14 and explicit own repository root |
| Python verification tool compilation | pass |

The toolchain was the supplied Rust 1.99 aarch64 Darwin installation. Builds used the coordinating Python lease, shared `/private/tmp/tw-s15b4c-target`, jobs=2, dev/test debug=0 and incremental=0. The target was 3.3 GiB with 177 GiB free at intake and remains protected for other consumers. Required binaries were copied and hashed inside the lease before release. No other targets/data were deleted.

## Actual process HTTP and stop evidence

The ignored child test runs the **same RuntimeServices factory, production supervisor and stop code**, with code-injected typed NativeFetch dependencies, owned S3/native/OAuth/FCM peers and public RFC 7515 test-vector signing material. The child environment is explicitly cleared and loads no dotenv. Production endpoints, real account files, AWS/Mongo, paid translation and device sends were not used.

The strengthened matrix used a 40-second socket cap only in the own injected peer, retaining production 3-second weather waiter, 10-second OAuth/FCM and bounded S3 behavior. Shared catalog peer files/limits were not changed. **27/27 actual combinations passed**: SIGTERM, SIGINT and actual public-listener task failure across idle, queued registration, slow weather, OAuth, final before-POST guard, in-flight POST, result write, ambiguous send and scheduled success. Maximum observed shutdown: **10.048 seconds**, below the documented 35-second cancellation envelope.

- Public health and notice-null HTTP succeeded; registration responses followed durable state or retained the legacy `[null]` failure answer for unresolved queued writes.
- Scheduled alarm and conditional paths produced separate durable claims and owned-peer POSTs in the success scenario. Warning scheduling read the shared feed and established its baseline silently; warning send/state/release guards are covered by the existing delivery regression cases.
- A real OwnedFlights acquisition outlived its waiter; its incomplete task Drop printed `S20B_PROVIDER_CANCELLED incomplete` during runtime teardown. This is genuine future cancellation, not inference from process exit.
- Stop during OAuth/final guard produced no FCM POST. In-flight POST timeout remained Unknown. Claimed cycles were not replayed on restart, including ambiguous responses/result writes.
- Additional actual process checks: failure to bind the second listener started no delivery; two overlapping processes over the same owned S3 peer produced exactly one POST for the minute.
- The preliminary 27-case matrix with inherited two-second peer closure and the first screenshot/provenance setup failures remain retained. They are not the strengthened slow-bound evidence.

Retained strengthened process-test binary SHA-256: `f208484674b4ecbc402148ee90f0ed15813b023ae7f4b77a6ad79c0b86e8c524`. The selected capture comes from actual smoke receipts/logs and includes the TERM subset; all 27 cases remain in the authorized review packet.

![Actual owned-peer process results](runtime-smoke.png)

## Documentation and boundaries

The [operations source](../../../operations/server2-runtime-services.md) and [two-page PDF](../../../operations/server2-runtime-services.pdf) include startup selection, final admission, durable no-replay and explicit incomplete cancellation semantics. Both rendered pages were visually inspected with PyMuPDF; Poppler was absent and no installation was needed. The actual browser capture was visually checked. Archify artifact, real-browser and perceptual checks are distinct; the final diagram's exact source revision/checks are supplied in the PR review packet.

The 35-second limit is a cancellation envelope, not a proof that every batch, queued write or owned provider acquisition completes. Long native work can be cancelled with partially published state; authoritative S3 and immutable claims govern recovery. This work does not claim production activation, real provider/device delivery, EC2/quota measurements, seven-day shadow, full S20/#2742 or #2705 cutover completion. Root owns integration and parent plans.

Final diagram evidence pins committed implementation `ef4909533ebb387ae2d7b3020580587eb434cd84`. Archify showcase validation/delivery/strict artifact and real-browser checks passed; final 1440px light/dark captures were visually inspected with no crossings or unreadable/clipped labels. The current-state-guard detour is visible and clear. The PDF was re-encoded with binary Flate streams to avoid Git treating valid PDF syntax as text whitespace; both unchanged rendered pages were inspected again. No runtime source changed for these documentation refinements, so adequate scoped behavior/smoke/Clippy evidence was reused rather than rerunning unrelated groups.
