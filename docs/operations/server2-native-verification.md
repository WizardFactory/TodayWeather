# Common native verification

Run the existing verification layers through one fixed command. The default selection has 11 checks. A successful subset remains a subset, and no suite result qualifies whole-service earlier-release recovery, live traffic parity or production activation.

## Prepare artifacts

Use a reviewed checkout and the coordinator's Cargo target/build lease. Check free disk and keep the expected build plus a 3 GiB reserve. Build the server2 binary, examples `loopback_server`, `kma_s3_replay`, `warnings_smoke`, `notice_smoke`, `conditional_alert_smoke` and `warning_push_smoke` in release mode. Build release test executables with `cargo test --locked --release --test summary --test domestic --test state --test runtime_services --no-run --message-format=json`. Use the emitted executable paths; do not guess a hash-suffixed test filename. The suite does not build or download artifacts.

Record JSON with exactly these top-level fields:

```json
{
  "schema": 1,
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "artifacts": {
    "notice_smoke": {
      "path": "/owned/release/examples/notice_smoke",
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "profile": "release"
    }
  }
}
```

Replace the illustrative revision, path and hash with actual build provenance and file SHA-256. This example contains only the role needed for `--check notice`; a default full run requires all 11 roles listed by `--list`. Relative artifact paths resolve from the manifest directory. Revision/profile are caller declarations, not signed build attestations. Files must be executable and match the supplied hash. For KMA checks, the verified `kma_s3_replay` must reside at `examples/kma_s3_replay` beside the selected `server2` artifact, as the existing adapter requires. Keep manifests and executable copies in ignored task evidence.

## Execute and inspect

Run from the repository root on a POSIX host with Python 3.9 or later and dependencies already present:

```sh
python3 server2/tools/native_suite.py --list
python3 server2/tools/native_suite.py --artifacts reports/my-task/artifacts.json --out reports/my-task/run-1
python3 server2/tools/native_suite.py --artifacts reports/my-task/artifacts.json --out reports/my-task/notice-1 --check notice
```

Each output directory must be new and outside `server2/`. Do not reuse a previous run directory. The suite validates all selected prerequisites before launching any child, then runs fixed commands sequentially with a narrow environment. No operator `.env`, provider credentials or proxy settings are inherited. Existing tools use owned loopback peers and synthetic fixtures. No manifest can supply a shell command.

Open `report.json`: inspect `selected`, `full_coverage`, each check's `status`, `layer`, `limitations`, artifact hashes and hashed evidence paths. `PASS` means only the selected checks passed. `full_coverage` is true only when all 11 passed. Unselected checks stay `NOT_RUN`. Exit 2 / `BLOCKED` means invalid prerequisites or output location; exit 1 / `FAIL` means an executed check, timeout or result validation failed. A failure retains logs and later checks still run. A zero exit without its expected structured result, a missing replay report or zero matching Rust tests is rejected. A timeout terminates the task-owned process group; it never changes runtime deadlines or retries a product failure.

## Coverage and boundaries

| ID | Existing verification | Boundary |
| --- | --- | --- |
| kma-core | Frozen CORE/native S3 HTTP paired replay and perturbation control | Own denominator; no earlier-release rollback |
| kma-rich | Separate Rich/native S3 HTTP paired replay | Own denominator/provenance limits |
| world | Native VC/WAQI/S3 sharing and restart smoke | Includes frozen legacy coexistence/switch checks |
| warnings | Warning seed/raw/catalog/API with owned HTTP peer | Synthetic recorded provider |
| summary-model | Existing derive/record/lookup tests | Library/in-memory doubles |
| summary-http | Existing domestic summary_s3 tests | S3 HTTP/publication/backfill only |
| state | Existing registration journal/parity/restore/import tests | Library and owned HTTP layers |
| notice | Translation/S3/API/add/withdraw/delayed commit example | Owned synthetic translation service |
| conditional-alert | Weather/OAuth/FCM/claim/restart example | No real device send |
| warning-push | Warning catalog/geocode/OAuth/FCM/feed/restart example | No real device send |
| workers | Current production factory, 9 phases x 3 termination triggers | Current release only; no prior-release qualification |

CI runs the suite's Python controls and retains all existing product gates. The full operator suite is explicitly invoked with its required artifacts; a unit-control pass is not an integrated suite run. The [workflow design](../architecture/diagrams/server2-native-verification.html) describes the intended tool flow, not a deployed or source-pinned runtime diagram. [Selected execution evidence](../evidence/tasks/issue-2704-s19b/verification.md) records what was actually run.

## Actual usage capture

![Actual common-suite invocation and result](../evidence/tasks/issue-2704-s19b/suite.png)

The capture and selected evidence belong to the recorded execution identity. Neither a static stdout banner nor repeated log bytes establish a second execution. Keep family-specific reports and the original failed outcomes when investigating a run.
