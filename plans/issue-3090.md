# Reduce Server2 PR verification latency

[Issue #3090](https://github.com/WizardFactory/TodayWeather/issues/3090) owns the outcome and status. This is a plan for one CI-only implementation PR. The inspected checkout is `312fa4f2106be5492ded264874d9d5ad6d224426`. The first implementation step is ready now.

## Baseline and integration point

The five successful heavy PR runs in the investigation were [44467780312](https://github.com/WizardFactory/TodayWeather/actions/runs/44467780312), [44388483708](https://github.com/WizardFactory/TodayWeather/actions/runs/44388483708), [44387053175](https://github.com/WizardFactory/TodayWeather/actions/runs/44387053175), [44308362053](https://github.com/WizardFactory/TodayWeather/actions/runs/44308362053) and [44307685206](https://github.com/WizardFactory/TodayWeather/actions/runs/44307685206). Their creation-to-completion median was 53m37s. The example run spent 20m38s in Cargo tests, including 3m31s compiling and 12m14s running the domestic integration binary. The serial Python simulation and supervisor checks took 7m05s and 2m11s. Their 9m16s sum is a potential overlap in that run, before added checkout, setup and queue time.

Before editing, check the current base and [open CI coverage PR #2836](https://github.com/WizardFactory/TodayWeather/pull/2836). Both touch the controller, workflow and exact workflow audit. Coordinate their landing order with the existing owner. Base the latency PR on the selected integrated workflow, inventory its commands again, and preserve any applicable event classification and provenance checks. Do not import the entire scope-audit feature into a latency change. [Timeout PR #3019](https://github.com/WizardFactory/TodayWeather/pull/3019) documents cancellations during artifact preparation and the decision to allow 90 minutes.

## First experiment

Codex and Gemini 4 Neon High agreed to the following topology after considering the cost of keeping GNU release verification on the serial tail. One CI owner delivers the experiment in one PR. The ready task is to capture the serial reference, transitive setup requirements and expanded command inventory at the reconciled base.

| Job on a relevant PR | Starts after | Responsibility |
| --- | --- | --- |
| Placement | Applicable base scope decision | Run the whole-diff placement audit with the reviewed declaration and exact event range. Keep full history and preserve the integrated scope controller’s handling of missing evidence. |
| Python | Placement passes | Run the offline Python command group, including shadow simulation, supervisor, paired-read, finish suites, local and native tooling tests. Preserve conditional selection and relative order. Prove independent setup on a clean checkout. |
| Rust workspace | Placement passes, parallel with Python and GNU | Run the placement regression suite and the complete locked workspace test command with the existing 8 MiB Rust test stack and pinned toolchain. |
| GNU release and smoke | Placement passes, parallel with Python and Rust | Run fmt, clippy, isolated operational checks and all GNU release producers and consumers. Include the loopback example, local smoke when applicable, logging, gateway, widget, narrative, KMA checkpoint, deploy smoke, both KMA replays and isolated manifest-functional after its GNU binary exists. Keep the original build calls unless parity of a combined invocation is demonstrated. |
| Foundation | Placement and all three parallel jobs conclude | Evaluate all required upstream results before checkout or expensive setup. On success, perform the Linux musl build, readelf check, verification, packaging and upload on this runner with full history and the expected revision. Preserve the published artifact name and the reviewed base’s retention. |
| Goldens | Existing integrated trigger | Keep its independent inputs, evidence and conclusion. |

Derive membership from the complete baseline rather than a hand-counted list. Run each job with the prerequisites its commands and subprocesses actually use. Preserve `SERVER2_PYTHON`, the matched local test/smoke presence check and the fail-closed isolation wrapper. The placement job and local default own declaration resolution; downstream jobs consume the same approved source revision and any provenance evidence required by the integrated base. No intermediate release artifact crosses runners.

CI-1 freezes the inventory on the selected base. CI-2 implements group selection and a no-argument local entry point that retains the serial order. Reuse a single inventory and reject unknown groups. CI-3 wires the jobs, their required conclusions, the placement audit and its fixtures in the same change. CI-4 measures and qualifies that exact candidate. CI-2 depends on CI-1, CI-3 on CI-2, and CI-4 on CI-3.

## Verification and adoption

1. **Maintainer checks coverage.** Compare the serial inventory at the base with the combined candidate jobs for each applicable condition. Check command multiplicity, inputs, flags, environment, sandbox wrappers and producer-before-consumer order. Exercise missing and duplicate assignments, a bad group, and a mismatched local-test/smoke pair. Execute the local default on compatible isolated Linux. Pin bubblewrap jobs to the reviewed Ubuntu 24.04 environment, retain AppArmor setup, and run the 20-round KMA checkpoint free of competing work on its runner.
2. **Contributor sees an accurate result.** On a relevant PR, fail each group in turn, exercise cancellation and an unexpectedly skipped prerequisite, and verify by run/attempt that foundation cannot report success and no verified artifact appears. A cancelled workflow may itself conclude cancelled. For legitimately unrelated changes follow only the integrated base’s skip rules. Test malformed workflow wiring and removed dependencies against the exact placement audit.
3. **Artifact consumer can use the passing run.** Download the published `server2-linux-musl-verified` artifact. Verify the integrated base’s retention, file inventory, archive, hashes, executable permissions and bound source revision using its existing verification path. Keep full history for range/provenance decisions. Release inputs and outputs stay on one runner.
4. **Contributor gets faster feedback.** Interleave at least three successful serial runs and three candidate runs, holding product/test tree, runner class and cache state comparable. Record run/attempt URLs and revisions, time from workflow creation to completion, initial queue, inter-job wait, each job duration, critical path and summed runner minutes. Separate retries and failures. Report every sample, paired differences and medians. Check whether fresh runner setup, repeated toolchain downloads or cold Cargo builds offset the overlap. Adopt only with equivalent verification, correct failure/artifact behavior and a repeatable lower end-to-end median. If variation obscures the difference, collect additional matched pairs. If the improvement does not persist, retain the serial workflow.

## Scope and rollback

The plan lives at `plans/issue-3090.md`. Implementation paths are `server2/tools/ci.py`, `server2/tools/ci.sh`, `server2/tools/prepare-ci.sh` as needed, `server2/tools/check_placement.py`, `server2/tools/test_placement.py`, group-parity tests under `server2/tools/` and one task declaration under `server2/config/tasks/`. Declare `.github/workflows/server2.yml` as the sole shared CI wiring change, and the plan as documentation if shipped. Review the actual paths and dependency edges against that declaration. Preserve the foundation check identity and 90-minute long-job budget.

Revert the single CI PR, including its matching workflow audit, to restore serial execution. Domestic test sharding, artifact transfer and Cargo caching are separate experiments, contingent on the measured remaining bottleneck. The broader design’s latency projection is outside this experiment’s acceptance criteria.

## First experiment result

PR #3099 adopted the parallel topology on 2026-11-22. Three interleaved successful pairs took 35.8, 33.9 and 32.7 minutes against 76.5, 68.8 and 54.7 minutes serially (medians 33.9 and 68.8). Summed runner minutes stayed about equal. In the third pair the critical path was placement (0.5 min), then the Rust job (21.6 min, including 12.3 min for `tests/domestic.rs`), then the foundation musl build and verification (10.5 min). The Python job varied from 12.7 to 22.8 minutes across runs.

## Second experiment: musl candidate promotion

AK chose to remove the serial musl stage from the critical path, which relaxes the first experiment's rule that no intermediate release artifact crosses runners.

| Job | Starts | Responsibility |
| --- | --- | --- |
| `musl` | Placement passes, parallel with Python, Rust and GNU | Run the unchanged musl build, `readelf`, `verify_artifact.py` and native bundle commands, then upload the directory as the same-run candidate `server2-linux-musl-candidate` with one-day retention. |
| Foundation | All five jobs conclude | Fail before checkout unless placement, Python, Rust, GNU and musl all succeeded. Download the candidate into the original output path, run `tools/promote_artifact.py`, then upload the unchanged `server2-linux-musl-verified` with seven-day retention. |

`promote_artifact.py` executes nothing from the candidate. It requires the exact file inventory with regular files only. It recomputes the source identity of the PR head and the hashes of the binaries and sources, and requires them to equal `manifest.json`. It requires `verification.json` to have passed for that manifest. It extracts only regular `native/` entries from `native.tar.gz` and validates the bundle with `native_artifact.verify`, including the same source as the manifest. The candidate is reachable only within the workflow run; a failed run can leave a candidate but never the verified name.

Adopt with the same criteria as the first experiment: unchanged command inventory plus the promotion check, a fail-closed guard covering the musl job, a downloadable verified artifact that passes the existing bundle verification, and a lower median over at least three interleaved pairs against the first experiment's parallel workflow. The expected critical path is the longest of the four parallel jobs plus about two minutes. Revert this PR to restore the first experiment's topology.
