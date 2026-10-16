# S20b execution plan

Owner: S20b builder. Named notebook: `2026-10-16-issue-2705-s20b`. Inputs: [intent](../intent/issue-2705-s20b.md), [spec](../specs/issue-2705-s20b.md). Stable counters stay in the installed SDLC state CLI; maximum 10 per stage, no resets. Endpoint pre-merge, root coordinates independent QA.

## Placement declaration

Exact allowed paths are [S20b.json](../server2/config/tasks/S20b.json), written before implementation. Runtime/test/tooling all remain inside server2. Outside paths are only own intent/spec/plan, maintained runtime architecture/diagram/operations PDF and selected own evidence. Root accepted ops.rs and runtime_services/{supervision.rs,process.rs,peer.py} additions before dependent edits. No Rich-owned domestic code/tests/oracles, shared infrastructure, AGENTS or parent plans.

## Ordered work

1. Investigate actual ownership, NativeFetch contracts, claim/send/final guards; record intent/spec/design and scenarios before code.
2. Add lifecycle tests and preserve intended Red separately from tool/setup failures.
3. Introduce process-owned supervisor, FCM final stop admission, writer close/join/cancel, shared factory construction and one shutdown deadline. Preserve terminal/ambiguous outcomes.
4. Green then refactor-green; run focused existing delivery/state/runtime regression and additional actual process HTTP smoke. Use shared build lease/target with jobs=2/debug=0/incremental=0. Capture proof binaries/hash inside lease before release.
5. Update operations manual with actual usage screenshots and visually check all PDF pages. Regenerate Archify HTML from JSON; validate artifact/browser/visual separately. Check placement/dependencies and staged/outgoing artifact policy.
6. Commit/push, create task PR/update issue, freeze packet for root's QA context. Apply selected findings, renew affected evidence and exact-head CI. Finish readiness only with actual independent PASS and merge disabled.

Risks/blast radius: factory now activates ordinary push scheduling; HTTP signal/error drain changes; registration writer shutdown must not corrupt durable state. Alternative rejected: detached worker run() plus HTTP-only timeout cannot prove ownership or prevent post-stop sends. Global cancellation is required for provider work beyond the bounded waiter; never infer full completion. Rollback: revert task commit, retaining S3 claims and state; no automatic replay or deployment action.

## User scenarios and proof

- S1 operator starts selected push+notice/native services with owned peers: both binds precede jobs; registration/notice HTTP works, constructors perform no provider/send calls. Bind failure starts no delivery (AC1).
- S2 operator sends SIGTERM/SIGINT or a listener fails while idle/registration queued/weather/OAuth/pre-POST/POST/result-write: stop blocks new schedules and POSTs; bounded joins/cancellation retain claims and classify incomplete work (AC2).
- S3 overlapping workers/restart and user subscription change/cleared warning: one durable claim, final current selection/time/zones, no resend after unknown POST or missing result (AC3).
- S4 reviewer reproduces isolated tests/smoke and reads actual manual/diagram evidence, reviews frozen head and CI; PR remains unmerged with no live actions (AC4).

2026-10-17 corrective scenario: a foundation operator sends SIGTERM while a client holds partial headers; prerequisites ordinary no-push process,9s socket lifetime. Send partial headers, thenSIGTERM; expect logged forced closure5s (unchanged smoke4.5..7s/8s wait), not socket-age termination. Contrast actual push-owned OAuth wait10s: stop rejects finalPOST but drains under shared34s/35s maximum. Preserve original CI failure as Red and all counters; scoped source repair+runtime/release regression+actual functional smoke, affected guide/PDF/diagram, exacthead CI/rootreview4.
