# Push registration state safety verification (#2819 C1)

2026-10-18 KST. Base `1e31ac1ee91e916f9c36162ff474c4386b36ecd4`.
This correction does not close #2819, S19 or S20 and does not qualify production
or the previous complete recovery bundle. No live notification, cloud mutation,
production registration copy or provider request was performed.

## Behavior and checks

- On the unchanged implementation, the two unsafe insert/existing-alert-update
  regressions failed their intended assertions: poisoned documents were acknowledged.
  A separate Red showed the ready flag remaining true after writer stop.
- After the correction, the focused regression execution passed 96 library,
  28 state, 60 delivery and 31 runtime-services tests; one runtime-services test
  remained ignored (215 passed, 1 ignored). The state tests cover direct commit
  rejection, atomic mixed journal rejection without sequence advance or rewrite,
  huge journal-header count rejection without untrusted preallocation,
  valid restart, writer stop/panic, BSON round trips, and escaped-size/depth bounds.
  Existing state parity exercises 115 legacy requests. These are synthetic tests,
  not a new production export or parity run against a deployed legacy host.
- Native ARM64 release builds of `server2` and `loopback_server` passed, followed
  by the same separate HTTP smoke on the release executable (including a structured
  corrupt-restore event and no panic). This does not establish Linux/EC2 compatibility.
- `cargo clippy --locked --offline -j2 --all-targets -- -D warnings` passed.
  Rust toolchain 1.99.0, macOS ARM64, process-scoped incremental/debug disabling;
  the coordinator reused an ignored target directory. No global Cargo settings changed.
- The additional owned HTTP smoke starts the native loopback process over a fresh
  local S3-compatible peer. Invalid units returns 500/store-error without a journal;
  an existing alert's invalid precipAlerts returns 200 `[null]` with unchanged journal.
  Valid insert/rename and post-restart rename succeed. An injected old corrupt next
  entry makes registration writes fail without altering original journal bytes.
  `/health` remains 200 liveness; this is not aggregate readiness.

Run the reusable smoke from the repository root against an explicitly retained
loopback executable (Python 3.9+, no production environment or credentials):

```sh
python3 server2/tools/push_state_smoke.py --binary /owned/examples/loopback_server \
  --output reports/my-task/state-smoke
```

A second fresh owned store carries a `changes: 1e30` header. The process rejects
restore with a structured corruption result, no panic and unchanged header bytes.
This exercises the additional no-panic guard independently of document corruption.

The output directory must be new and outside `server2/`. The child environment is
synthetic; no Firebase credentials are supplied and scheduled send times are invalid.
The tool records the executable digest before/after and terminates its owned child
and peer. Its report's `production_eligible` and `live_actions` remain false.

The independent review found missing converter reporting for the new limits. A new
Red showed that all four mixed records were converted instead of only the safe one,
and that direct import misclassified bad input as corrupt state. The converter now
reports rejected positions/static reasons without values; its release CLI smoke
reads four synthetic records, converts the one safe record, reports three rejected
positions/reasons without input values and creates the import file with mode 0600; edited canonical imports
fail with a line reason, and direct planning names the one-based input record. The
whole import remains fail-closed with no state writes. Alert and warning scans retain
only eligible decoded records, preserving the compact-state memory design.

The original Red, setup failures, correction logs and HTTP reports are retained
locally under ignored `reports/sdlc/issue-2819-state/` and
`reports/verification/issue2819-state/`. Failed offline dependency and test-peer
setup attempts are not labeled product regressions. Selected durable facts and
commands are maintained here; no maintained link depends on those local directories.

## Recovery and documentation bounds

The 256 KiB encoded document and depth-32 admission limits are new explicit safety
bounds, not measured maxima of all production registrations. Existing valid fixture
and typed EJSON behavior is covered. The converter rejects invalid imported records;
operators must review rejected counts before the separately authorized final copy.
A corrupt acknowledged entry is never silently skipped or repaired; preserve it and
keep admission closed until a compatible repair is approved. Writer readiness is
cleared on exit/abort/unwind; aggregate S3/credential/private readiness follows later.

The [workflow](../../../architecture/diagrams/server2-push-state.html) and
[editable contract](../../../architecture/diagrams/server2-push-state.json) describe
admission and recovery decisions rather than an execution or deployment topology.
Archify showcase validation, delivery, strict artifact checks and real browser
checks passed. Light/dark endpoint captures were inspected for readable labels,
clear branches and no horizontal overflow. The diagrams introduce no runtime owner.

## Preserved Linux CI failure

The initial `8ce23e45` foundation run `39088203115` failed the combined native-router
inventory: cold `/v000901/kma/addr/Seoul` returned502 at the 3-second assembly limit
rather than the fixture expectation200. All other 30 runtime-services tests passed
and one was ignored. The whole failure log is retained; no assertion or production
timeout was relaxed. A bounded unchanged-baseline Linux release experiment passed
31 passed / 1 ignored with both 2 and 1 test threads; it did not reproduce or establish the failure's
cause. This is not proof of current-candidate CI success or of native-host performance.
The latest candidate's full CI remains a separate readiness gate.

## Shared inventory oracle correction (CI-INVENTORY-001)

The current C1 and B1 Linux CI runs both reached the combined native factory
inventory and returned the established direct KMA dependency-error response where
the test required200. The setup deliberately has no weather history, real time
and unreachable recorded-provider roots. `api::native` already answers dependency
failure or its3second deadline with502 `Bad Gateway\n`; the existing public-route
regression independently verifies that response and zero legacy forwarding.

For only the four direct KMA/town read groups, the inventory now accepts the
successful native response or that exact502, including body, length, ETag,
Express/CORS headers and absence of cache-control/nosniff. Every successful-body
assertion and acknowledged-state restore check remains. It does not accept404,
arbitrary5xx or empty502 error responses. This corrects a route/error-contract test; it does
not establish weather availability, cold latency or fix D2. No production timeout,
peer mode, test-thread policy or runtime behavior changed. Original failed CI
and bounded diagnostic evidence remain retained; final current CI is still required.

Renewed local verification of the corrected inventory: runtime-services31passed/1ignored,
existing forced direct-KMA native502 regression1passed, format and all-target
clippy pass. The unchanged product sources, examples and smoke tools retain prior
functional evidence by exact hash; no new product execution is claimed.

Selected reviewer006 adds exact502 content type/length/ETag/Express/CORS and absent
cache-control/nosniff checks to the existing deterministic direct-native error test.
The successful v000705 empty200 reply remains accepted. This is wire-contract proof,
not a new latency bound; the optional per-route elapsed log was not selected.

Deterministic header correction verified locally: the existing direct-route
forced dependency-failure HTTP test passes for all retained direct goldens with
exact502 headers/body. Format and all-target clippy pass. Current remote CI and
independent reviewer confirmation remain required.
