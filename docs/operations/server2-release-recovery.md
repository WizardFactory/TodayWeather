# Paired server2 release recovery verification

This is a local evidence tool for #2704, not a command that changes a deployed release. It adds mixed-release durable worker recovery to the existing [API rehearsal](server2-native-recovery.md) and [family checks](server2-native-verification.md). The [workflow](../architecture/diagrams/server2-release-recovery.html) shows the verification layers; [JSON](../architecture/diagrams/server2-release-recovery.json) is editable. See the [PDF](server2-release-recovery.pdf) and [selected evidence](../evidence/tasks/issue-2704-s19c/verification.md).

## Incident use

1. Preserve the incident UTC window, deployed executable hash, release/configuration receipt, authoritative state/claim evidence and [structured diagnostics](server2-logging.md) before stopping or replacing the process. A missing log record cannot prove a send did not happen.
2. Locate the failing trace and anonymous submission. Follow its actual send and batch result. `accepted` means FCM accepted; `unknown` can mean a request reached FCM without an acknowledged response. Neither proves device delivery. Never replay an existing delivery claim because a result is absent or a replacement release starts.
3. Select an explicitly retained earlier release with the capabilities required by the incident. A passing four-API rehearsal alone does not qualify workers, and a library state test alone does not prove a process restored state. Inspect every layer below, actual configuration compatibility and S20's host/release eligibility evidence.
4. Reproduce with the fixed local pair command and owned fixtures. On failure, retain the original `report.json`, failed phase and process logs; correct the relevant input/tool/runtime under its normal review path, then use a new output directory. Do not erase an assertion or substitute legacy to obtain PASS.
5. Production rollback, traffic routing, provider availability, host retention and deployment remain separately authorized procedures. This tool performs no host activation, repair, journal mutation in production or notification replay.

## Prepare two explicit bundles

Use release executables retained outside disposable Cargo targets. Build scheduling and disk reserve follow repository guidance; this tool does not compile, download, discover or silently replace an artifact. Distinct revision and corresponding binary hashes are required. The accepted schema has exactly `schema: 1` and `releases`, whose keys are `current` and `previous`. Each release has exactly `revision` (40 lowercase hex) and `artifacts`. Each artifact has exactly `path`, `sha256` (64 lowercase hex) and `profile: "release"`.

All eleven roles are required before any child: `server2`, `loopback_server`, `kma_s3_replay`, `domestic`, `summary`, `state`, `runtime_services`, `warnings_smoke`, `notice_smoke`, `conditional_alert_smoke`, `warning_push_smoke`. The KMA example must be at `examples/kma_s3_replay` beside its selected `server2`. Relative paths resolve from the manifest. Keep actual build/source provenance: the revision/profile fields are declarations, not signed attestations. A dirty build needs its source digest and verified later commit mapping; do not rewrite an old receipt to imply it ran on a later checkout.

```sh
python3 server2/tools/shadow/release_recovery.py \
  --artifacts reports/my-recovery/pair.json \
  --out reports/my-recovery/preflight-1 --validate-only
python3 server2/tools/shadow/release_recovery.py \
  --artifacts reports/my-recovery/pair.json \
  --out reports/my-recovery/run-1
```

`ELIGIBLE` from validation means the local inputs are admissible, not that any check passed. Each output directory must be new and outside `server2/`. Only scope `local-layers` is supported; requesting whole-service or production eligibility fails before execution. Manifest-supplied commands are forbidden. No operator `.env`, proxy or credentials are inherited by child commands. Synthetic accounts use the existing public RFC test key and disposable files. Owned peers never relay requests to providers or devices. This is explicit loopback isolation and an environment boundary, not a network namespace or arbitrary-binary security sandbox.

## Read the layers

| Layer | What actually executes | Important limit |
| --- | --- | --- |
| Nine family checks per release | KMA CORE/Rich, warnings, summary model/HTTP, state, notice, conditional alert and warning push; existing assertions/counts remain | Eighteen library/HTTP/recorded layers; no combined `full_coverage` or whole-service claim. World coexistence and the single-release worker matrix are excluded. |
| Native API pair | Current → previous → current on one S3/disk fixture; geocode, partial KMA, world-air, empty notice; exact cold/warm bytes/headers and cross-phase304 | Legacy HTTP must be zero; restored VC/air provider work zero. Partial/empty inputs do not qualify complete KMA/history/notice mutation. |
| Durable worker pair | Seven actual stop stages, starting with each release, followed by opposite/original releases on the same journal/claim store and minute | Production process/RuntimeServices lifecycle, with injected clock and recorded NativeFetch; not full provider/worker startup. |
| Mixed overlap | Current and previous processes share one due registration and conditional claim store | One owner/post only. It is local at-most-once evidence, not distributed production S3 or device reliability qualification. |

The seven worker stages are weather, OAuth, pre-POST guard, in-flight POST, result write, ambiguous send response and successful alarm/conditional delivery. Every restored cycle must actually attempt claim admission; waiting or starting a process alone cannot pass. Original claim bytes stay unchanged. An acknowledged registration must update as an existing record after each restore, rather than being silently recreated. No additional owned FCM post may appear after replacement. Unknown send results remain unknown and are not resent. Claim-before-send can deliberately leave an unsent claim after cancellation; the existing at-most-once policy is preserved, not repaired into at-least-once delivery.

The final report retains release identities, manifest and evidence hashes, exact per-layer selections and failure status, native API observations, worker phases, counts and limitations. Logs identify each initial/replacement process. Exit 2 / `BLOCKED` means inadmissible scope, artifact or output; exit 1 / `FAIL` means executed validation failed; exit 0 / `PASS` covers only all declared local layers. A child failure or missing phase cannot become PASS. `whole_service_eligible` remains false even on PASS. No new retries, schedules, recovery action or runtime storage format were introduced.

The selected `runtime_services` executables are release-built Rust integration entrypoints. Their compiled fixture lookup can refer to the build checkout (`CARGO_MANIFEST_DIR`); retain that checkout/fixture identity with the executable. The current tool and owned peer implement the harness layer for both releases. This is not a portable standalone bundle or a claim that every fixture/tool came from the earlier release.
