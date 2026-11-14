# Verification: server2 log pipeline LP-3 (#2980)

Selected evidence for [#2980](https://github.com/WizardFactory/TodayWeather/issues/2980), on master after LP-1, LP-5 and LP-2. Disposable Lima VMs (Ubuntu 24.04.5, systemd 255, aarch64; the x86_64 server binary through Rosetta), the pinned Vector 0.61.0 and the same server binary as [LP-1](../issue-2978/verification.md). S3 and CloudWatch Logs are the stand-in `standin.py` behind the real regional host names; EC2 instance metadata is the stand-in `imds_standin.py` on `169.254.169.254` (IMDSv2 token, instance ID, life cycle, instance-role credentials). No deployment and no AWS change.

## Bounded experiments (2026-11-14)

| Question | Observation |
| --- | --- |
| Can Vector read an earlier boot? | Not with `current_boot_only: false` (rejected on systemd 250–257). A reader with `extra_args: ["--boot=<id>"]` reads that boot, and a checkpoint seeded with a cursor of that boot resumes after it. |
| Instance-role credentials through IMDSv2 | Vector's AWS chain uses them once the token response echoes `X-aws-ec2-metadata-token-ttl-seconds` (as EC2 does). Every request in the checks was signed with the stand-in's role key; the collector's environment held no AWS name. |
| User data size | Embedding every pipeline file compressed to 16,247 bytes (EC2 limit 16,384); removing comments saved about 1 KB. Pinning a commit and per-file SHA-256 and downloading from the public repository: 1,324 bytes. |
| Vector after an unhandled component error | It exits with status 0 (observed with an unreadable checkpoint); `Restart=on-abnormal` left it stopped. ExecStop then runs with an empty `$MAINPID`. |
| Lima stop | `limactl stop` forces the VM off about 30 s after asking it to shut down (an abrupt stop); an in-guest `systemctl poweroff` is clean (about 100 s with the S3 drain). The reboot checks use the clean poweroff. |

## Defects found by the reboot check (retained runs)

| Run | Result | Cause and change |
| --- | --- | --- |
| reboot 1 | FAIL (S3 30 of 85) | S3 never confirmed anything before the reboot, so it had no checkpoint and no backlog was planned → the boot in which a reader without a checkpoint started is kept (`reader-start.json`) and planned. |
| reboot 2 | FAIL (collector stopped) | The start step runs as root and wrote the seeded checkpoint owned by root; Vector (dynamic user) got "Permission denied" and exited with status 0 → the seed is owned like the state directory; the unit restarts on that exit too. |
| reboot partial 1 | FAIL (backlog never finished) | A boot's last entry is journald's own "Journal stopped", which the unit-filtered readers never read → positions are compared only with entries of the read units. |

## Checks on the final candidate

Candidate `e50075d8`, after review round 1.

- `python3 -I server2/deploy/logging/test_logging.py`: 77 tests OK on macOS (2 need GNU `sha256sum` and are skipped there) and all 77 OK on Linux. The 8 regression tests for review round 1 fail on the reviewed head `c3219339` (`correction-red`).
- `linux_fresh_check.py` on a **new** VM, with user data generated for `e50075d8` (1,324 bytes): **PASS, 17 checks**. Nothing of server2 was installed before. The user data ran as root in 19.9 s: it downloaded and hash-checked the 10 pipeline files and the pinned collector from GitHub, then installed and started the collector. All three units were enabled. The start record named `i-0c0ffee0000000001`, `on-demand` and the three destinations. The collector environment held only systemd names and the seven destination settings, with no `AWS_*` name; the host had no credentials file. After the release step (binary and `.env`), S3 (`info`) and CloudWatch (`warn`) held every server record from the first one exactly once. Every request was signed with the instance-role key, and every metadata request used an IMDSv2 token.
- `linux_check.py` (report SHA-256 `d315dcd0e2203ed3efe19fe39132c321bf89a0e8db7c1d1a56074f7309c740a3`): **PASS, 158 checks**. Credentials and identity came from the metadata stand-in only. Every scenario required each AWS request to be signed with the instance-role key and every start record to carry `instance_id`, `instance_life_cycle` and `boot_id`. LP-3 scenarios:

| Scenario | ACs | Observed |
| --- | --- | --- |
| instance-replacement | LP3-AC2 | Two instance IDs in hour 14 with identical settings, each started on an emptied journal and state. Each instance had its own server and collector streams and keys, holding exactly its own records and none of the other's. No overwrite. The start records name both instances. |
| abrupt-stop | LP3-AC5 | S3 confirmed a first object. A later server object was stored, but its confirmation was delayed by 45 s, and the collector was killed (SIGKILL). It restarted by itself, and its stop drain was skipped. Nothing was lost on S3 or CloudWatch. S3 repeated 50 records, all inside the 93 records after its saved position; CloudWatch repeated none. |
| spot-local-only-warning | LP3-AC4 | `collector.local_only_on_spot` written on Spot and absent on On-Demand. |
| delivery (local, S3, CloudWatch, all) | LP3-AC3, LP3-AC6 | Every scenario starts from an emptied journal and state. The start record holds instance, life cycle, boot, version and destinations. The LP-1 and LP-2 scenarios still pass: S3 receives within 58.4–58.6 s, CloudWatch within 1.5 s, and the collector peaks at 74–77 MiB. |

- `linux_reboot_check.py`, a clean in-guest poweroff and start of the same disk during an S3 outage, in two variants:

| Variant | Before the reboot | After the reboot |
| --- | --- | --- |
| `before-partial` | 77 records; S3 had confirmed 27, so its saved position was inside the boot; shutdown 101 s (drain gave up on S3 after 75 s) | The boot alone started the collector; the start record listed the previous boot for S3. After S3 recovered, both boots' 104 records arrived within 57.7 s, exactly once on S3 and CloudWatch, each under its own boot's keys; no overwrite; the next start had no backlog left. |
| `before` (unconfirmed) | 52 records; S3 had confirmed none, so it had no saved position; shutdown 96 s | Same, with 79 records within 57.8 s, exactly once, and no backlog left. |

- Restart after an exit with status 0 (manual smoke, `restart-exit0.log`): after `kill -TERM` of the collector process (it exits 0 by itself), the unit was active again after 5.7 s (`NRestarts=1`), and the drain was skipped with `collector already exited`. A requested `systemctl stop` drained (60.7 s) and did not restart.
- Placement gate (`LogBoot2980.json`), artifact policy, Archify `finalize` and `visual-check` (captures inspected), the manual PDF (8 pages rendered and inspected): PASS.

## Independent review

| Reviewer | Head | Verdict | Findings and disposition |
| --- | --- | --- | --- |
| Codex `gpt-6.1-sol`, high (required) | `c3219339` | CHANGES_REQUIRED | CX-LP3-001 (Required): when the position's boot had rotated out, the remaining earlier boots were not planned → every remaining earlier boot is planned. CX-LP3-002 (Required): non-atomic state writes, and a corrupt file read as empty, could drop the backlog → atomic writes; an unreadable file is kept as `.corrupt`, reported, and every earlier boot is shipped again. CX-LP3-003 (Required): the completion test ignored the sequence ID → the IDs must match. CX-LP3-004 (Required): rotated backlog boots were dropped although the overrun check ignored backlog readers → the overrun check takes the earliest position of all readers, and a rotated boot stays planned until its loss has been reported. CX-LP3-005 (Required): the abrupt-stop repeat bound was overstated → derived from the ordered checkpoint and checked by the abrupt-stop scenario. CX-LP3-006 (Recommended): stronger instance-replacement check → applied, though not on two VMs. Red: `correction-red` (8 regression tests; the reviewer's reproductions are the semantic Red). |
| Gemini 4 Argon high (additional) | `c3219339` | CHANGES_REQUIRED | GEM-LP3-001 (Required): status, drain and age queried boots that had left the journal → those boots are no longer queried. GEM-LP3-002 (Required): matches CX-LP3-004; in addition, while its checkpoint is still in a backlog boot, the current-boot reader's position now starts at the current boot's first entry. GEM-LP3-003 (Recommended): sequence ID, a boot with no unit entries counts as done, and an unselected destination keeps its plan → applied. GEM-LP3-004 (Recommended): the tautological disjointness check is replaced, and the reboot variant is recorded → applied. |
| Grok 4.7 high (additional) | `c3219339` | unavailable | 429: free usage exhausted (rolling 24 h). |


## Limitations

- The user data was run by the check as root (`bash -s`), as cloud-init runs it; cloud-init itself and a real EC2 launch were not exercised. The pipeline files and the collector were downloaded from GitHub for real.
- Instance metadata, S3 and CloudWatch Logs were stand-ins; IAM evaluation, real IMDS behaviour (hop limit, throttling) and real AWS were not exercised.
- Two instances were simulated on one host (instance ID changed, journal and state emptied between them) against one destination stand-in, not two VMs.
- The abrupt-stop repeat bound (the records after each reader's saved position) was exercised with one delayed S3 confirmation and a killed collector; several later batches confirmed before an earlier one, power loss and kernel crashes were not produced. The size of that range under a fast backlog replay was not measured.
- The overrun of a planned earlier boot was checked offline; a real rotation of an unfinished earlier boot was not produced in the VM.
- Amazon Linux 2023 and native x86_64 were not run.
