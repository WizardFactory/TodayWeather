# E3a writer availability verification

2026-10-19 integration note: the dated results and source/binary hashes below
retain their original execution identities. Statements about an unmerged or
parallel parent describe that original verification point. The integrated source
now includes C1/B1 and the preceding ordered fixes. Current source-bound checks
require explicit dev and release package rebuilds, separate owned smoke, independent
review and exact CI/tree reconciliation. The final [PR2834 integration record](https://github.com/WizardFactory/TodayWeather/pull/2834)
binds those actual results; this note does not relabel historical checks or
qualify production, a full recovery bundle, shadow or issue closure.

Scope: writer portion of #2819 E3 only, parent unmerged E1/E2 PR2832 at938e5ba9.
The full readiness endpoint/S3/credential-source health remains open. No main integration,
full E3/recovery, seven-day shadow or production qualification.

`PushService::ready` now requires successful restore and an open existing writer receiver.
Receiver close can precede pending-command drain; false availability does not prove a
completed join or cancellation. No monitor, second owner, lock, new mode/retry, queue,
state or send-policy change. Source projection preserves the rest of service.rs byte for
byte. Existing HTTP failure contracts stay unchanged.

## Actual checks

- On unchanged runtime, corrected Red2 produced **two intended readiness failures**:
  successful normal drain/join still left ready true, and an actual test-only OidSource
  panic left ready true before cleanup. Owned writers were reaped before final assertions.
  Original source, regression, executable, raw log and exit101 are retained locally.
- Initial Red1 was mixed: normal exit was the intended failure, but the panic test first
  expected an incorrect500 on POST push-list. The existing per-item contract is200/[null]
  (routes::list maps store failure to null); valid token-update PUT returns500/storage-error.
  The oracle was corrected before runtime edits and Red2 reran both intended readiness
  checks. Red1 is not claimed as two readiness Reds; original evidence is preserved.
- Minimal predicate change: focused Green **2/2 PASS**. Full current targets:
  state20/1ignored, delivery95, runtime41/2ignored, lib134 = **290 passed / 3 ignored**.
  fmt-check, all-target Clippy (`-D warnings`), optimized main and state-test builds PASS.
- Additional retained optimized state executable: actual public PushService/router and
  HttpS3Transport against an owned Python S3 peer. Restore succeeds, an actual writer
  panic is injected by the test-only ID source, POST returns200/[null], subsequent PUT
  returns500/`push state storage unavailable`, availability is false before cleanup,
  acknowledged sequence stays0 and journal1 is absent through real HTTP404. Both owned
  API/S3 ports retire. The faulted drain reports false, not a healthy join. **PASS, exit0**.

This extra CLI constructs no production main, delivery/acquisition worker or Firebase
client. No real provider/device is contacted; this is construction/isolation scope,
not a measured device counter or host/IAM/credential-source proof. The integration binary
requires the matching compile-time checkout and Python peer assets. Current functional
binary SHA-256: `9898f4ff50223c55cd1c28ba2e21d120a22cf341a6d2bafd8d3105f76a3b85be`. Raw report SHA-256:
`24286aa82cc79cd64ff4ba7559ebfd052e54bc9be1c538d01a869727d75e31f4`.

## Retention and remaining gates

Ignored reports/sdlc/issue-2819-writer-liveness retains original before sources/bin/logs,
current source/build/test maps, selected executables, raw functional trace/report and
SDLC/design evidence. No source/fixture/log/report/worktree cleanup is claimed. The shared
Cargo target is protected for active ordered verification. Final implemented-source diagram,
current independent review and exact parent/current CI remain before pre-merge. This does
not close #2819/#2704/#2705 or authorize merge, deployment, live calls or shadow traffic.
