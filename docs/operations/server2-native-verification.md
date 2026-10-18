# Common native verification

Run the existing verification layers through one fixed command. The default selection has 11 checks. A successful subset remains a subset, and no suite result qualifies whole-service earlier-release recovery, live traffic parity or production activation.

## Prepare artifacts

### Retain the Linux verification bundle

On a clean reviewed Linux checkout, run from `server2/`:

```sh
python3 tools/native_artifact.py --target-dir target --output ../reports/linux-native --archive ../reports/native.tar.gz
```

The producer reuses the selected Cargo target, builds sequentially, and requires
3 GiB expected build space plus a 3 GiB reserve. It selects compiler-emitted
release executable paths for the eleven roles below and the logging/narrative
probes. It exports `bin/`, `source/server2/`, `artifacts.json` and `bundle.json`.
Only regular tracked server2 source and fixtures are copied; installed packages,
ignored caches and account files are excluded. The optional archive contains a
`native/` directory, including hidden tracked inputs and directory/executable
modes. CI retains `native.tar.gz` inside the existing
`server2-linux-musl-verified` artifact; the shared upload is unchanged. Compare
the archive SHA-256 with the trusted producer/CI receipt before extracting it
into a fresh owned directory. The original
two-binary export remains unchanged. Seven-day CI retention is transport only;
retain selected executable inputs and reports before expiry.

Check `python3 --version` (3.9 or later) and `git --version` on the receiving
host. The paired replay records revision metadata using the Git executable even
when the copied source has no Git checkout; an absent Git executable blocks that
report. Run checks as an unprivileged account. After transfer to a fresh owned directory,
restore executable permissions on the thirteen declared files if the transport
stripped them, and preserve the exported source tree's read-only permissions.
Run `chmod -R a-w BUNDLE/source` after transport and before verification;
archives that omit directory entries and ZIP transports can lose directory modes.
Python cache files must not become extra executable inputs. Run:

```sh
python3 BUNDLE/source/server2/tools/native_artifact.py --verify BUNDLE
```

Replace `BUNDLE` with the actual directory. Verify the trusted build receipt's
revision, server2 tree and bundle metadata hash as well: these JSON hashes detect
changes against that receipt, but are not signed attestations. Missing, changed,
extra, symlinked, foreign-architecture or dynamically interpreted payloads block
verification. Exit 2 is BLOCKED. No verification command installs files or starts
a product process.

Rust integration tests retain `CARGO_MANIFEST_DIR` from compilation. Inspect
`compiled_source_root` in `bundle.json`. On the empty owned host, map that exact
location to `BUNDLE/source/server2` before execution; this is explicit operator
setup, never a manifest-driven installation. Stop if the exact destination already
exists, including a symlink; never overwrite a checkout or another run's mapping.
A newly created symlink or bind mount to this bundle is allowed. Local container
builds record `/work/server2`; CI builds normally record
`/home/runner/work/TodayWeather/TodayWeather/server2`. Creating those parents can
require privileged operator setup, but run verification itself as the ordinary
user. For example, after checking that `/work/server2` does not exist:

```sh
sudo mkdir -p /work
sudo ln -s /absolute/BUNDLE/source/server2 /work/server2
```

Use the actual recorded path, keep the frozen source unchanged, and then require:

```sh
python3 BUNDLE/source/server2/tools/native_artifact.py --verify BUNDLE --require-source-root
python3 BUNDLE/source/server2/tools/native_suite.py --artifacts BUNDLE/artifacts.json --out RUNS/native-1
python3 BUNDLE/source/server2/tools/widget_smoke.py --binary BUNDLE/bin/server2 --peer-binary BUNDLE/bin/examples/loopback_server --output RUNS/widget-1
python3 BUNDLE/source/server2/tools/narrative_smoke.py --binary BUNDLE/bin/examples/narrative_smoke --out RUNS/narrative-1
```

Use absolute bundle/run paths and fresh output directories outside the frozen
source. The copied suite may observe no Git checkout; its declared artifact
revision and the bundle's exact source tree remain the execution binding. Record
the actual host, source-map verification and original failed runs separately.
The bundle producer's PASS means export integrity only. Existing runtime checks
must actually run; no full previous-release or production eligibility follows.

### Build or declare individual artifacts

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

Run from the repository root on a POSIX host with Python 3.9 or later, Git and dependencies already present:

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

## Linux host execution record

[Selected 2026-10-17 Linux bundle/EC2 evidence](../evidence/tasks/issue-2813/verification.md) records the source identities and original failures. Nine native checks passed in the original run; two missing-Git report failures were renewed separately and passed. Neither native report claims full coverage. All eleven checks have passing evidence across the retained runs; the packaging-only source change has unchanged runtime/fixture/harness bytes and all thirteen executable hashes. WW HTTP, narrative and logging also passed. The separate nginx host setup failure is tracked in [#2814](https://github.com/WizardFactory/TodayWeather/issues/2814).

![Typeset actual retained CLI results](../evidence/tasks/issue-2813/linux-bundle.png)

The image retains intermediate packaging snapshot `af6e72af` / tree `dbc3f845`;
final review corrections change only the producer and its controls. See the linked
verification record for final source/hash and standalone host mapping admission.

This labelled image is rendered from actual CLI records; browser/window capture was unavailable. It is not an application UI screenshot or another execution. Real S3, live shadow, quota, production listener and eligible previous full-release gates remain open.

## DataGoKr selected-attempt funding (#2819 B2)

For an isolated local composition check, run from `server2/`:

```sh
cargo run --locked --offline --example data_go_kr_funding_smoke
```

The example opens owned loopback HTTP and an in-memory conditional S08 budget
transport using synthetic one-unit authority blocks. It invokes the real domestic
page acquirer and keyring. Fresh A completes one page with one HTTP/reservation
and never creates unused B authority. With A already reserved/exhausted, B completes
two pages/requests and stays remembered, with no provider-quota outcome. Total
owned HTTP is3; the process stops its owned listener. Output is a compact JSON
report; structured runtime diagnostics use stderr. No live provider, S3, key/account
quota measurement or runtime verification mode is introduced.

Logical per-attempt units differ from normal S08 block claims. Known local
exhaustion alone can advance key selection; ambiguous/corrupt/transport funding
remains fail-closed. VC maximum prepayment is unchanged. Operating API allowances
remain an open deployment prerequisite; this example supplies no production values.
