# S18b-3 warning push verification

Task `issue-2703-s18b3`, source base `82356a95`, 2026-10-16. This evidence describes
library behavior with isolated dependencies. The normal process does not install
the warning sink or worker; S20 owns startup wiring. No deployment, real OAuth/FCM,
provider request, device delivery or production database write was performed.

## Independent legacy authority

The maintained [Node recorder](../../../../server2/tools/push/record_warnings.js)
executes the actual warning feed, `engine.pollWarnings/eligible`, registry window,
`runtime.warning` message and urgent transport envelope from the pinned legacy
revision. Node 16.20.2, UTC and a fixed clock are used. Unused runtime constructors
are stubbed; recorded function bodies are not rewritten. HTTP is intercepted, so
no network request is sent. Two recordings were identical. The fixture and exact
source hashes are in [provenance](../../../../server2/tests/delivery/fixtures/warnings-PROVENANCE.md).
Coverage: 13 feed series, 108 messages, 10 date cases, 13 grouped cases, 50 window
cases and the urgent payload. Alarm/conditional fixtures remain unchanged.

## Actual checks

- Intended compiled Red: initial feed baseline/date/publication errors; shared
  location resolving twice; post-OAuth other-process disable still submitting and
  APNs expiry using the pre-auth time. Each regression was fixed and retained.
- Delivery tests cover first-head/first-worker silence, forced head CAS conflict,
  invisible orphan event, prior-head preservation, unknown committed claims,
  concurrent workers, failed/unknown/cancelled submission, restart no-resend,
  late eligible endpoint, shared location and user edits during preparation.
- Optional review GROK-HIGH-1 added a compiled Red regression for S12 errors
  immediately after an owned claim. Transport and timeout errors now record
  `warning-state` diagnostics/result without OAuth/FCM; repeat/restart remains
  terminal. The corrected delivery suite has 60 passing checks.
- Post-OAuth guards cover other-process durable disable (deliberately stale first
  service RAM), a release committed through a different S12 store, deadline,
  journal failure and guard error/timeout. No POST is made and claims stay terminal.
- S12 hook tests read back published zone rows before observing the feed callback.
  Raw publication failure prevents the callback; failed feed publication is
  observable and can complete on a later source collection attempt.
- Actual loopback S3/raw catalog/geocode/OAuth/FCM HTTP smoke: one shared geocode
  request, one synthetic submission, zero restart resends, zero external calls.
  The first smoke failed because its synthetic area code was absent from the
  current zone table; it was corrected to Seoul's actual `L1100000` code. The
  original failure is retained in ignored task evidence.
- Clippy: workspace/all targets, warnings denied, passed. Final workspace test
  outcome: 784 passed, zero failed, two slow sweeps intentionally ignored. Exact
  commit/CI/review and current-master focused checks are recorded on the PR.
- PDF: all three rendered pages visually inspected using PyMuPDF (Poppler was
  unavailable); screenshots are rendered actual stdout with synthetic data.

Reusable commands (repository root, isolated environment):

```sh
cargo test --locked --manifest-path server2/Cargo.toml --test delivery --test warnings
cargo test --locked --manifest-path server2/Cargo.toml --workspace
cargo clippy --locked --manifest-path server2/Cargo.toml --workspace --all-targets -- -D warnings
cargo run --locked --manifest-path server2/Cargo.toml --example warning_push_smoke
```

[Editable manual](../../../operations/server2-push-delivery.md) and
[PDF](../../../operations/server2-push-delivery.pdf) preserve existing conditional
instructions and add the warning scenario. Existing broad S18 review histories
are not reset; this is a separately declared PR scope.

The source-pinned [warning sequence](../../../architecture/diagrams/server2-warning-push.html)
passed Archify artifact and browser gates; actual light/dark captures were inspected.

## Limits

S3 paths are within checked-in S03/S10f `index/v2/*` policy permissions. This is a
source comparison, not an actual EC2-role permission check. Synthetic provider
acceptance is not evidence of live account permissions or device receipt. The
warning cache is disposable memory only and adds no required local-disk capacity.
No test/live/dry-run mode or new runtime setting is introduced. S18c remains a
separate backend/API, publishing CLI and S3 notice scope; client/web popup work
is excluded.
