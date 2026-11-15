# Verification: server2 log pipeline LP-6 (#2983)

Selected evidence for [#2983](https://github.com/WizardFactory/TodayWeather/issues/2983): the qualification host ships its candidate, guard and reader output through the LP-1..LP-4 pipeline. These checks ran on master after #2947 and #2971. There was no deployment, no AWS change, no qualification run and no host acquisition.

## Defects found by the VM check

| Run | Result | Cause and change |
| --- | --- | --- |
| run 3 | FAIL (no guard record) | The guard's stop record never reached the journal. When the guard stops the candidate, the candidate's `ExecStopPost` stops the guard's own unit, which ended the guard before it printed its decision. This is earlier behaviour that LP-6 exposed. → The guard now writes and flushes its decision before it stops the units (`report_stop`). The decision and the stop actions are unchanged. |
| run 1–2, 4–6 | FAIL (check harness) | Errors in the check itself, not product defects: synthetic key lists that were not JSON arrays, stand-ins left over from an earlier run, a peer serving the previous run's test certificate, the destination outage fault also hitting the candidate's data bucket, and a reader that had ended by its own rule. All were fixed in the harness. |

## Checks on the candidate

Candidate `7c413365` after review round 1 (later commits are evidence only). Round 0 ran the same checks on `55690214` (52 checks, PASS).

- `server2/deploy/shadow/linux_check.py` on a disposable Lima VM: **PASS, 58 checks** ([`linux-check.json`](linux-check.json), SHA-256 `c59605790ec51d0e20a7764d1b8e996a1d471a48c58d9f3ceafa0f140db9d25d`).
  - VM: Ubuntu 24.04, systemd 255, aarch64.
  - Server binary built in the VM from this branch's unchanged Rust sources (SHA-256 `2037140e…`).
  - Pinned Vector 0.61.0 aarch64 archive (`12d7e91d…`).
  - Each scenario prepared a real plan, journal and generation grant. It then applied the launch user data and streamed the bundle into the real receiver (`remote.RECEIVER`, which runs `install-host`). The install answered one JSON object (191 bytes) within about 2.3 s.
  - The real host names were pointed at loopback stand-ins: the run's S3 buckets, the production origin and the providers. Instance metadata was the LP-3 stand-in.
  - Every other outbound TCP connection was rejected; 0 packets were rejected, so no live provider or production read happened.

| Scenario | ACs | Observed |
| --- | --- | --- |
| provider-stop | LP6-AC1, AC2, AC3, AC4 | **Unit properties:** the candidate, guard and reader had `Restart=no`, `TimeoutStopSec=10s` and `LogNamespace=server2`, and none of them requires, wants, binds or is ordered after the collector. The guard had `WatchdogSec=30s` with SIGKILL. The deadline timers were at epoch + 168 h and + 170 h, and the 168 h stop leaves the collector running. The collector, queued without waiting, was running.<br>**Stop:** the reader's request led the candidate to Kakao geocoding, which answered 401, and the guard stopped with `provider_auth_or_quota` (first rejection: `auth`, `geocode`, `provider_http`, 401).<br>**Retention:** the stop (reader, candidate and guard, then the collector) drained in 50.6 s, and all four units ended inactive or failed.<br>**At the destination (`logs/server2/` of the run's state bucket):** 4 objects with `server` 6, `guard` 1, `reader` 1 and `collector` 1 records. They include the candidate's `warn` failing record (`cause: auth`, `status: 401`), the guard's decision with `stop: provider_auth_or_quota` and its latched diagnostics, and the reader's summary.<br>**Privacy and access:** no synthetic key, peer body marker, URL or loopback origin appeared. The collector only used `PutObject` on the state bucket. |
| config-change | LP6-AC3 | Providers answered unusable 200 bodies, and the log destination answered 503 from the start. Installation still started everything. Appending a line to the candidate's `.env` stopped acquisition in 5.6 s with `binding_config_sha256`. After the destination recovered, the retention stop drained in 50.2 s, and the guard's stop record, the server, reader and collector records all arrived. |
| frozen-guard | LP6-AC3 | With the collector stopped while the candidate and guard ran, a SIGSTOP of the guard led to its watchdog kill (`Result=watchdog`), and acquisition was inactive after 30.2 s. The restarted collector shipped the server records it had missed. |
| collector-broken | LP6-AC3 | With the collector unable to start (its state directory path blocked; it ended `inactive` with `Result=exec-condition`), installation reported `started` and the candidate, guard and reader were active, with no stop decision. The retention stop completed. |
| tampered | LP6-AC5 | A bundle whose `render.py` changed after preparation was refused by `install-host` with `{"error":"invalid or incomplete evidence"}`. No tree or unit was installed and nothing was started. |

- **Offline suites:**
  - `server2/tests/integration/test_shadow_supervisor.py`: 106 tests OK. They cover generated units, the collector unit map, the settings against `render.py`'s rules, journal settings equal to LP-1, install order and files, refusal of an unpinned or changed archive before the grant, wrong architecture, existing journal settings, a failing collector start that does not block acquisition, the export of log objects (state bucket first, without raw metadata), the remote stop command, a running collector blocking the export, the priced log PUTs, and the guard's record order.
  - `server2/deploy/logging/test_logging.py`: 97 tests OK (2 need GNU `sha256sum` and are skipped on macOS), including the `--unit` map and its rejection.
  - `server2/tests/integration/test_paired_read.py`: 17 OK, including the one-line summary.
- **Gates and diagrams:**
  - The placement gate (`LogShadow2983.json`) passed. Its self-tests need `rustc` and run in CI.
  - Archify `finalize` passed for both diagrams. The `visual-check` captures were inspected.

## Independent review

| Reviewer | Head | Verdict | Findings and disposition |
| --- | --- | --- | --- |
| Codex `gpt-6.1-sol`, high (required) | `a7a83049` | CHANGES_REQUIRED | CX-LP6-001 (Required): installation waited for and required an active collector, and the acquisition units were ordered after it, so a failing or slow collector blocked acquisition (LP6-AC3) → no relation between the acquisition units and the collector; installation queues its start without waiting or checking (a rejected start is noted in the receipt); the retention stop runs two commands, acquisition and then the collector. CX-LP6-002 (Required): periodic status records closed an S3 object every 50 s, about 10,000 over 168 h, which exhausted the operator's 9,000 ordinary export reads → no periodic status unit on this host; the export reads the state bucket first; documented object bound. |
| Gemini 4 Argon high (additional) | `a7a83049` | CHANGES_REQUIRED | GEM-LP6-001 (Required): same as CX-LP6-002; also suggested pricing the export reads → resolved as above; the operator's export reads are already inside the priced 100,000 reads. |
| Grok (additional) | — | not run | Unavailable (quota), as in LP-3 and LP-4. |

## Limitations

- **Architecture.** The VM was aarch64, with an aarch64 server build and the aarch64 collector pin. The qualification host is x86_64 (`t3.small`) with the x86_64 pin; selecting the pin by architecture is covered by offline tests. Under Rosetta, `/proc/<pid>/exe` names the translator, so the guard cannot bind an x86_64 binary in this VM.
- **Stand-ins only.** S3, instance metadata, the providers and production were stand-ins. IAM evaluation (the existing role allows `PutObject` on the state bucket), real S3 and a real EC2 launch were not exercised. The cleanup's export of the log objects (`export_sources`) was not run against them.
- **Provider coverage.** The provider rejection came from Kakao geocoding; the KMA providers were not reached in that run. Any provider 401/403/429 that the candidate classifies as auth or quota takes the same path.
- **Deadlines.** The 168 h and 170 h deadlines were checked by their timer contents, not waited for.
- **Reader rule.** In the config-change and frozen-guard scenarios the reader ended by its own rule: the candidate answered 5xx three times in a row because the providers' bodies were unusable.
- **Separate observation (not LP-6).** With the candidate's own S3 unavailable, its geocoding quota check reports `quota`, and the guard stops with `provider_auth_or_quota`. The cause is S3, not a provider. Read the first rejection's `stage` in the guard's record to tell the two apart.
