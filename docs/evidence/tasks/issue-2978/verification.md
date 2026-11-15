# Verification: server2 log pipeline LP-1 (#2978)

Selected evidence for [#2978](https://github.com/WizardFactory/TodayWeather/issues/2978) (LP-1 of #2977). Generated run files stay in the ignored `reports/` tree; this page keeps the results and identities needed after they expire. No AWS resource, deployment or live provider call is involved.

## Environment

- Disposable Lima VM (vz) on the author's Mac: Ubuntu 24.04, `Linux 6.8.0-147-generic aarch64`, `systemd 255 (255.4-1ubuntu8.18)`, Python 3.12.3. Created for this task only.
- Collector: Vector 0.61.0 aarch64 musl, archive SHA-256 `12d7e91db2e447003558c955c4f510b17ed1d77340757f3e591e5222e464675c` (equal to the release `SHA256SUMS`). The x86_64 archive (`e1609b8a55ef1c1fc4fd88633e2bc6366e9a4022f6f1ae846cadd27af5237621`) also ran `--version` and `validate` on the rendered configuration (through Rosetta).
- Server: a retained x86_64 musl release binary built from master on 2026-11-07, SHA-256 `1d40cf97e40b566ca725da7e1969131ecdde1fc0e496078c1b550f3b445be3d4`, run through Rosetta. This task does not change Rust code; the binary only produces the records to ship.
- Stand-in: `server2/deploy/logging/standin.py` on `127.0.0.1:443` with a test CA; `/etc/hosts` maps `s3.ap-northeast-2.amazonaws.com`, `<bucket>.s3.ap-northeast-2.amazonaws.com` and `logs.ap-northeast-2.amazonaws.com` to it.

## Feasibility observations (2026-11-14)

| Observation | Result |
| --- | --- |
| Vector with `AWS_ENDPOINT_URL_S3` / `AWS_ENDPOINT_URL_CLOUDWATCH_LOGS` set | Ignored: requests went to the real AWS endpoints with dummy credentials and were rejected. Tests therefore redirect host names, not endpoints. |
| Vector trusts the system CA store | Yes: a test CA added with `update-ca-certificates` was accepted; S3 requests are path-style. |
| CloudWatch Logs calls with health checks off | `DescribeLogStreams`, `CreateLogStream`, `PutLogEvents`. |
| S3 calls with health checks off | `PutObject` only, `Content-Encoding: gzip`. |
| `journald` source `current_boot_only: false` | Rejected on systemd 255 ("not supported for systemd versions 250 through 257"). |
| Collector peak resident set | 69.9–76.9 MiB (VmHWM; the three shipping scenarios in each of runs 5–8 and 11). |
| Collector stop time after the server stopped | 0.016–0.237 s (runs 5–8 and 11), with up to 569 server journal lines. |

## Offline tests

`python3 -I server2/deploy/logging/test_logging.py`: 22 tests, OK (19 before the review correction). Seeded defects in temporary copies were all detected: health check enabled, value echoed in the `SERVER2_LOG_SINKS` message, `create_missing_group` true, and the server unit requiring the collector.

## Integrated check

Command (inside the VM, as root):

```sh
python3 -I server2/deploy/logging/linux_check.py --disposable-host \
  --server-binary <server2> --collector-tarball <vector-0.61.0-aarch64-unknown-linux-musl.tar.gz> --report <out.json>
```

Earlier runs, retained as failures:

| Run | Result | Cause and change |
| --- | --- | --- |
| 1 | FAIL | Collector exited with configuration error 78: `current_boot_only: false` unsupported on systemd 255 → current boot only. Invalid settings looped through `Restart=on-failure`. |
| 2 | FAIL | `RestartPreventExitStatus` does not apply to the start condition → `Restart=on-abnormal`. S3 delivered nothing: the stand-in read the regional host name as a virtual-hosted bucket (stand-in defect). `LOG_NAMESPACE` from systemd missing from the test's allowed names. |
| 3 | FAIL (crash) | Resetting the journal namespace by stopping its units tripped a start limit, so `server2.service` failed on its journal dependency (test harness defect) → rotate and vacuum instead. |
| 4–7 | PASS (77 checks each) | Run 6 added a 300-request burst; run 7 ran on the first staged candidate. |
| 8 | PASS (77 checks) | First PR head `93577610` (only comments changed after run 7). |
| 9 | FAIL (80 of 81) | After the review correction: the new running-delivery checks passed; the harness reset found old journal entries because the namespace daemon had exited while idle (test harness defect) → start it before rotating. |
| 10, 11 | PASS (81 checks) | Run 11 adds the local journal to the secret check (GEM-LP1-003). |
| 12 | PASS (79 checks) | Latency measured from one start before a new request, each destination watched independently (CX-LP1-005); in the all-destinations scenario the new request produced no record because the preceding burst had exhausted the server's own per-second rate limit. |
| 13 | PASS (80 checks) | Waits 1.5 s before the measured request. |
| 14 | PASS (80 checks) | Each scenario declares the destinations it must time; a missing measuring record fails (CX-LP1-006); CloudWatch at `error` is an explicit exclusion. |

Run 14 on the final candidate repeats the run 8 results below and adds two kinds of check. A delivery check while both units run, timed from a new request and watched per destination: S3 58.6 s and 58.3 s against the 70 s bound, CloudWatch 1.0 s against 10 s (CX-LP1-003/005/006); CloudWatch at `error` gets no new runtime record, a declared exclusion. And the local journal in the secret check (GEM-LP1-003). Run 8 (report SHA-256 `fa30d85ac86fc89e6f8134192164e420d4218769b3a1f325ef2f0171dbbbbb5f`):

| Scenario | ACs | Checks | Observed |
| --- | --- | --- | --- |
| local-only | AC1 AC2 | 11 | Collector skipped (`ConditionResult=no`); no stand-in request; journal holds error/warn/info/debug records and the readiness line. |
| s3-only (`info`) | AC1 AC2 AC4 AC5 | 15 | S3 holds exactly the 19 server lines at `info` or above, one start record, keys in the contract; no CloudWatch request; only `PutObject`. |
| cloudwatch-only (`warn`) | AC1 AC2 AC4 AC5 | 15 | Streams `server/<machine>/<boot>` and `collector/<machine>/<boot>` hold exactly the 3 lines at `warn` or above and one start record; no S3 request. |
| all-destinations (`s3` debug, `cloudwatch` error, burst of 300) | AC1 AC2 AC4 AC5 | 18 | 303 journal lines (the server's own rate limit of 100 per second and level dropped the rest of the burst); S3 exact at `debug` (302 schema-1 lines), CloudWatch exact at `error` (1 line); readiness line nowhere remote; no overwrite. |
| invalid-destination / invalid-level / missing-prefix | AC3 | 6 each | Collector `failed` without restart; server active and `/health` 200; message names the variable and does not contain the value. |

In every delivery scenario the synthetic value `SYNTHETIC-PRIVATE-2802` (sent in URL, header and body; and the provider-key values in `.env`) appeared in no stand-in file, and the collector's process environment held only systemd names and the test credentials (AC4). The check pauses one second between stopping the server and stopping the collector; see the smoke below for why.

## Operator smoke

A separate manual flow on the installed VM: `install.sh`, `.env` with `local,s3,cloudwatch` and a synthetic provider key, start both units, one `/health` and one weather request, stop.

| Run | Stop | Result |
| --- | --- | --- |
| Smoke 1 (log SHA-256 `430eda61…`) | `systemctl stop server2.service server2-logs.service` (one transaction, server first) | Startup records shipped; the request and shutdown records (written 12–41 ms before the collector received SIGTERM) were **not** shipped and stayed in the journal. On SIGTERM Vector stops reading the journal at once. After the stop the S3 reader's checkpoint file was empty. |
| Smoke 2 (log SHA-256 `67663f9a…`) | Server stopped, 2 s later the collector | S3 held exactly the journal's server records (16 `info`, 4 `warn`), CloudWatch the 4 `warn` records, including the shutdown records; no synthetic value anywhere. The journal still held smoke 1's records (the namespace vacuum ran while its journal daemon was stopped), and the collector, starting without a checkpoint, shipped those too. |

Consequences, recorded in the guide's limits: shipping the final records at shutdown needs a drain step (LP-4, #2981); the empty S3 checkpoint means a restart resends that boot's records to S3 (LP-2, #2979).

Smoke 3 after the review correction (log SHA-256 `6b194802…`): the `.env` line `SERVER2_LOG_SINKS` carried a leading byte order mark, which server2 reads as a setting (CX-LP1-001); delivery was journal-exact (8 `info` and 2 `warn` in S3, 2 `warn` in CloudWatch) and no synthetic value appeared in the stand-in, the rendered configuration or the journal.

## Independent review

| Reviewer | Head | Verdict | Findings and disposition |
| --- | --- | --- | --- |
| Codex `gpt-6.1-sol`, high (required, OpenAI) | `93577610` | CHANGES_REQUIRED | CX-LP1-001 (Required): `.env` parsing differed from server2 on ECMAScript whitespace and U+2028/U+2029 → ported `parse_line` exactly, Rust boundary cases added as tests. CX-LP1-002 (Required): non-setting errors exited 1, which systemd treats as a skip → every preparation failure exits 255, tests for manifest, identity and write failures. CX-LP1-003 (Recommended): delivery was only proven at shutdown → running-delivery check added. Red (`correction-red`: 1 failure, 4 errors) then Green (22 tests). |
| Codex, same context (round 2) | `0b13be88` | PASS | All round-1 findings resolved (it also compared 784 `.env` cases with server2's rules). CX-LP1-004 (Recommended): on macOS the write-failure case had failed on the missing `/etc/machine-id`, not on the write → the case fixes the host identity and asserts the write was attempted; with the 255 handler removed it now fails on the injected ENOSPC (`correction2-control`). CX-LP1-005 (Recommended): latency was timed per destination in sequence → one start per request, destinations watched independently. |
| Codex, same context (round 3) | `af99465d` | PASS | CX-LP1-004/005 resolved (a 30-second CloudWatch delay now fails). CX-LP1-006 (Recommended): a missing measuring record skipped the timing → timed destinations are declared per scenario and a missing record fails. |
| Gemini 4 Argon high (additional) | `93577610` | PASS | GEM-LP1-001/002 equal CX-LP1-002/001. GEM-LP1-003 (Recommended): the secret check skipped the local journal → added. |
| Grok 4.7 high (additional) | — | not completed | Stopped by its usage quota (HTTP 429, rolling 24 h) before returning findings; not retried. |

## Manual

[server2-logging-pipeline.pdf](../../../operations/server2-logging-pipeline.pdf) (5 pages) was built with the screenshot-manual toolchain from [its source](../../../operations/assets/server2-logging-pipeline/manual.json). The images are terminal sessions captured in the same VM on 2026-11-14 (install with default local only, a mistyped `SERVER2_LOG_SINKS`, shipping to both destinations, delivered keys and streams, reading each destination) and rendered as text images; S3 and CloudWatch Logs were the stand-in. Every page was rendered and inspected; the text layer holds every instruction and expected result, and neither the captures nor the stand-in data contain a synthetic secret.

## Placement

`server2/tools/check_placement.py --declaration config/tasks/LogPipeline2978.json`: PASS.

## Limitations

- The VM is aarch64 Ubuntu 24.04; Amazon Linux 2023 and an x86_64 kernel were not run. The x86_64 collector was exercised only with `--version` and `validate`.
- Credentials came from a test drop-in; instance-role credentials through IMDS are LP-3.
- Delivery after a destination outage, loss counters, reboot backlog, Spot notice handling and IAM templates are LP-2 to LP-5.
