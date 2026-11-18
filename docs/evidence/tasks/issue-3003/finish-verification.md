# SR-5b resumable finish verification

The Ubuntu and simulation runs completed on November 18–19, 2026 (Asia/Seoul).
Both used `5ba1cd88d54a4497ab22895f3efab2f485ede45f`.

## Integrated Linux and simulation

- `python3 -I server2/deploy/shadow/linux_check.py --disposable-host` passed
  all 119 checks on Ubuntu 24.04 arm64. The run used the pinned server binary
  and collector archive recorded in the [selected Linux report](finish-linux-check.json).
  The real `provision.py finish` CLI ran with SSH and the host data directory
  unavailable. Using a local version-store stand-in, it verified 12 paired
  files against an independent bucket audit and matched 18 source versions
  against the loopback uploads. It read the evidence before the synthetic
  writer fence, sealed both bucket inventories before deletion, and reported
  cleanup complete.
- `python3.11 server2/tests/integration/shadow_simulation.py --seeds 20 --scenario <name>`
  retained evidence and completed modeled cleanup in all 380 runs across 19
  scenarios. The operator IP change and unreachable-at-deadline scenarios
  each completed 20 of 20 runs using bucket evidence with no SSH. Fourteen
  scenarios reached 168 hours for all 280 runs, including the combined fault
  scenario. The five remaining scenarios produced their expected early stop
  for all 100 runs and still retained evidence. Both the day-three exit and
  the final-copy failure followed by recovery stopped on candidate exit. The
  other three stopped on the cost ceiling, storage authorization, and reader
  origin outage. [Simulation summary](finish-simulation.json)
- Targeted offline checks on the same revision passed all nine cases in
  `test_shadow_finish_remote.py` and both selected simulation cases. The
  remote suite exercised the real embedded ledger and paired-file exporter with
  local fixtures, including reader-stop enforcement, input validation, archive
  limits, and the cleanup deadline. The simulation covered fetching only the
  missing pairs and retaining the state bucket at the deadline when evidence
  remains unverified.

## Full-size interrupted bucket export

A separate run at `bc83993c9a0afc80db629aeefa9e99da285240cd` exercised the real
`provision.py finish` CLI against a local AWS CLI stand-in without an SSH
identity. The command was
`python3.11 server2/tests/integration/shadow_finish_rehearsal.py --output <empty-directory> --log-objects 1000 --timeout 1800`.
This revision preceded the bounded host-side SSH snapshot correction. The
bucket path completed without calling that exporter.

- The fixture generated 11,707 attempts, 23,414 paired files, 995,095,000
  body bytes, and 1,509 source versions, including 1,000 compressed logs.
  The runner interrupted the second GET after checkpointing the first
  verified original, then resumed with the same journal and output path.
- All paired file hashes and source-version dispositions matched. The
  sealed inventory SHA-256 was
  `92bcce43d37dc26507d1208e9a71dbcae63ee2a32c6ddf5dee2dc24b1c81fc05`.
- The GET count was two at interruption and 1,508 after resume. A second
  successful finish left that count and the 1,331,296,800-byte attempted
  body charge unchanged. Independent control reads increased from 1,528 to
  1,535 and consumed their own allowance.

## Operator documentation and limits

The workflow diagram passed Archify validation, artifact provenance, and
browser execution. The rendered diagram and two-page operator PDF were
visually checked. The manual includes a screenshot of an actual 71-attempt
local finish run.

The checks used loopback services, offline fixtures, or simulation. Real
provider traffic, AWS signing and upload, real SSH transport, and production
resource deletion remain unverified.
