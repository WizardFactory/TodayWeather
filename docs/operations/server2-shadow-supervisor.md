# Bounded shadow supervisor

This operator is under implementation. The journal, S3 admission, host checks and evidence/cleanup APIs described below are implemented components. The public lifecycle is connected but has not yet completed its Linux candidate/review/CI qualification. The Linux host installation component is implemented separately; these components do not establish live qualification readiness. See the [spec](../../specs/issue-2614-shadow-supervisor.md) and [implementation plan](../../plans/issue-2614-shadow-supervisor.md).

## Durable coordinator state

`python3 server2/deploy/shadow/state.py init --state <new-private-directory> --run-id <run-id> --manifest-sha <sha256>` creates local state only. `inspect` reads the same record. Repeating `init`, changing identity, or opening a second coordinator is rejected. Keep the state directory through cleanup and evidence reconciliation; deleting it is not a supported restart mechanism.

Journal schema 5 includes the separate operator allowance, exact nonsecret request parameters and immutable typed acknowledgements. Older experimental schemas are rejected rather than reset; no live run has used these schemas. The first epoch fixes collection expiry at 168 hours and cleanup reserve at 170 hours. The sole RunInstances request includes a nonsecret first-boot script that installs an enabled persistent poweroff timer for that original 170-hour deadline. Bootstrap failure requests immediate poweroff. SSH installation verifies the exact timer contents, enabled state and active state before starting any candidate; it cannot replace or extend the launch deadline. This closes loss of the coordinator before SSH installation, subject to the approved Linux image executing its first-boot user data. No independent AWS termination service is claimed. Generation reservations are durable before launch and cannot be refunded after an uncertain launch or process death. At most three generations can be consumed (initial plus two planned restarts). `dispatch_recorded` commits the exact request before its one physical dispatch and retains the typed acknowledgement. If execution stops before the acknowledgement is saved, a reopened journal preserves the uncertainty and refuses another dispatch. Operation-specific reconciliation uses that original request; a failure cannot be overwritten with a successful receipt.

## Prepare and inspect without cloud calls

`provision.py prepare` accepts a JSON plan with exactly `host`, `cloud` and
`allowance`: the schema-4 host plan with frozen artifact/price/grant inputs, the
schema-1 Seoul cloud plan, and the initial S3 grant. It fixes the epoch, validates
the cost policy (one cumulative ceiling, see [Cost ceiling](#cost-ceiling)) and all paid grants, records the cloud parameters and
consumes the first generation before copying the private bundle. Use new paths:

```sh
python3 server2/deploy/shadow/provision.py prepare --plan private-plan.json   --source private-artifacts --state private-run --bundle private-bundle
python3 server2/deploy/shadow/provision.py inspect   --state private-run --bundle private-bundle
```

Both commands make no cloud calls and return `ready_for_live_run=false`.
Inspection checks the original epoch, recorded grant, plan identity and actual
bundle hashes. A repeated prepare is rejected; partial state is retained and must
not be deleted to reclaim the grant. The explicit live commands below remain subject to the launch gates; preparing
a bundle is not qualification approval.

## Qualification S3 allowance

The main `server2` executable recognizes the optional `SERVER2_SHADOW_S3_LIMITS=reads,writes,put_bytes` setting. Values are nonnegative decimal integers. Maximum per-process values are 1,740,000 reads, 900,000 write/list attempts and 2 GiB of attempted PUT bodies. Missing leaves ordinary runtime behavior unchanged; an empty, malformed or excessive value fails startup. The coordinator must supply a disjoint precharged allocation for each process, not the maximum on each restart. Aggregate candidate allocations and the separate operator/export/cleanup reserve must fit the run's ceilings.

Main installs one immutable process owner before runtime construction. Every S3 transport consults it immediately before a physical send; constructing additional clients or validating settings cannot replenish it. GET and HEAD consume reads. LIST consumes write/list attempts despite using HTTP GET. PUT atomically consumes one write and its body size. Rejected compound reservations spend neither dimension. Once admitted, failures, 412 conflicts and cancellation are not refunded. Existing automatic HTTP retries and redirects remain disabled.

The setting applies to the main qualification executable. The supervisor must not launch `server2-notice`, arbitrary importers or other binaries under the same allocation. Direct library use without main initialization is not a qualified process. The allowance alone does not limit provider quota, total network bytes, elapsed time, local disk or other AWS clients. Those remain required host/operator guards before live acquisition.

## Qualification paid-provider allowance

Host-plan schema 4 requires a frozen `paid_policy`: dated tariff evidence digest,
USD per existing runtime budget unit, and separate `initial`, `restart-1` and
`restart-2` grants for `visual_crossing`, `google_geocode`, `google_air` and
`openweather`. All three grants are priced before a bundle can be prepared; their
sum must fit inside the [cost ceiling](#cost-ceiling) minus the prior spend and the finish reserve. A null tariff requires zero units. An exhausted grant refuses that provider and the run continues with that coverage incomplete; it is not a stop. No shared free credits
or unverified account tier are assumed. The prelaunch audit must verify that each
rate matches the actual API product and its runtime unit; the digest alone does
not verify a tariff. The current public lifecycle supports only the initial grant; unused restart grants cannot be reassigned.

The existing durable generation reservation consumes the matching grant before
bundle creation. The journal's immutable plan hash prevents changing the price or
reusing a larger grant after a failed installation. The host clears inherited
environment variables and sets `SERVER2_SHADOW_PROVIDER_UNITS` in this order:
Visual Crossing, Google geocoding, Google Air Quality, OpenWeather. The main
executable validates four comma-separated integers before runtime construction.
Zero refuses calls, absence preserves ordinary behavior, and repeated installation
cannot replenish a process. All keys and UTC windows share that process allowance.
Existing funded acquisition paths consume units before dispatch; failed or unused
pre-funded attempts are not refunded. This counts budget units, not HTTP responses
or a provider's billing invoice. Exhaustion rejects the attempt and latches the
existing qualification quota signal for the host guard.

## Evidence and cleanup boundary

AWS timeout, access denial, malformed output and empty success remain distinct from successful resource inventories. Service errors accept both the legacy AWS CLI format and the current `aws: [ERROR]:` prefix with optional numeric retry-count suffix; absence still requires the exact expected operation and service error code. Only an operation-specific absence result may prove deletion; the caller must also bind the command to the expected account, region and owned resource. Source export must retain original bytes and hashes within the outbound allowance. An incomplete export or unknown response dependency remains incomplete evidence.

The [flow](../architecture/diagrams/server2-shadow-supervisor.html) describes the scoped operator contract, not evidence of a completed live run.

## Host binding and offline preparation

The guard compares the actual Linux process start ticks, boot identity, executable hash, exact process environment hash, working directory, `.env` hash, cgroup and loopback socket ownership. It samples every ten seconds. A missing, stale or malformed observation (including unavailable accounting, metrics or diagnostics) counts as a miss; six consecutive misses (60 seconds) latch `observation_lost`, and a valid sample resets the count, which is kept in the decision state (schema 6, `misses`) across guard restarts. Changed identity, listener ownership, network counter rollback and disk reserve are decided from the sample's own fields before accounting, metrics and diagnostics are validated, so a partial observation never delays or renames them; a missing identity field is a changed identity, as before, not a miss; together with storage authorization and the [cost ceiling](#cost-ceiling) they latch a stop at once; an exhausted S3 allocation or transmit volume is not a stop (SR-4). Storage authorization (`s3_authorization`) means that the server's counter of authorization-failure records (cause `auth`, status 401/403) of the run's own storage and credentials: every record of the S3 object (including the instance credentials), budget-object, history and summary components, so one failed call can produce more than one record (for example the budget object's HTTP record and its reserve record), rose by at least 20 within one fixed hourly window; the guard keeps the window in its decision state (`storage_auth_window`: its start, the count at its start and the count at the last sample), and a new window starts from the last sample's count. The guard stops at its first sample after the counter has risen by 20, so how soon that comes depends on how often the server uses storage and how many records each failure produces: in the Linux check, 165.6 s after the data buckets began answering 403. Isolated rejections spread over the week never add up to a stop; a short burst split across two windows may not reach 20 in either. Provider 401/403/429 and local paid-budget exhaustion never stop the run: the server handles them, and the guard keeps their counts as evidence. Its systemd watchdog stops the owned candidate and reader if observations cease. Original collection and poweroff deadlines are separate calendar timers and do not move with a generation.

The opt-in `/internal/metrics` fields are `server2_shadow_s3_{reads,writes,put_bytes}_remaining` and `server2_runtime_{auth,quota}_failures_total`. Rejection signals are recorded before log filtering and queue admission, so dropped diagnostic logs cannot erase them. They count classified events, potentially more than one per provider request; they are not provider usage or billing counters. No shadow metrics appear when the opt-in allowance is absent.

Stop diagnostics use the same opt-in endpoint. `server2_runtime_local_paid_exhaustions_total` counts quota signals caused by the local paid-unit allocation rather than a provider response. `server2_runtime_first_rejection_info{cause,origin,component,stage,provider,status}` identifies the first counted auth/quota signal with fixed vocabulary only; `server2_runtime_provider_http_rejections_total{source,status}` counts provider HTTP 401, 403 and 429 responses once per response by source (each data.go.kr API by its URL, `data_go_kr_other`, `visual_crossing`, and the keyless public hosts `public_kma_web`, `public_airkorea_web`, `public_mfds` and `public_other`; geocoding providers appear only in the auth/quota totals and the first rejection); `server2_runtime_storage_auth_failures_total` is the counter of storage and credential authorization-failure records above (records, not calls); `origin="local_paid_allowance"` means no provider request was sent, and `provider`/`status` are `none` when the originating record lacked them. When the paid allowance is installed, `server2_shadow_paid_units_{initial,remaining}{provider}` report conservative admitted-unit snapshots, not billed usage. The guard validates these values on every sample and stores the latest snapshot, including the auth, quota and storage-authorization counts and the per-source provider rejections (`provider_http`), in the `diagnostics` field of `decision.json` (schema 6). A stop latches that snapshot, and the existing evidence export retains `decision.json`. Malformed or wrongly typed diagnostics count as a missed observation (six in a row stop with `observation_lost`).

`prepare_generation` verifies the frozen plan against the journal and copies an exclusive private bundle only after consuming its allocation. A changed artifact, conflicting plan, reused generation or existing destination is refused. `bootstrap.sh --check <new-output-directory>` verifies the bundle hashes and renders eight systemd unit/timer files (seven for acquisition and its deadlines, one for the log collector). It does not install them, launch a process or call AWS. The internal candidate launcher clears ambient environment overrides and consumes a local one-use marker before `execve`; the host restart/reader-resume connector is not yet exposed.

For an existing offline guard fixture, use:

```sh
python3 server2/deploy/shadow/guard.py check --manifest host.json --state decision.json --sample observation.json --now 1001
```

This command only evaluates and records the fixture. `guard.py run` requires Linux/root and initialized bound state; it has no fake-clock or fixture endpoint option. Qualify both the Linux guard and the installed native candidate before launch. A Linux stand-in can exercise `/proc`, socket ownership, configuration changes and watchdog shutdown; macOS loopback metrics alone cannot replace those checks. The complete candidate installation still needs its own verification.

## Source export and deletion evidence

A new version-6 journal provides 80,000 reads, 10,000 write/control attempts and 4 GiB of original-body and paired fallback transfer attempts. Ordinary work may use 79,000 reads and 9,000 write/control attempts. Each request dimension protects the final 1,000 attempts for cleanup. A reopened version-5 journal keeps its original 10,000 reads and 2 GiB transfer allowance. Cleanup can inspect ownership and delete it, but cannot create resources or use its protected reserve to fetch original bodies. Export still uses the ordinary allowance when called from cleanup. Reopening or reaching the original collection deadline does not replenish either budget. Failed attempts are not refunded; deleting the journal cannot be used to replenish them. Export uses explicit S3 version IDs and a prepaid byte range covering the whole original; it rejects a prefix or mismatched total length. Empty originals use HEAD and a retained empty file. Export schema 2 preserves original bytes and SHA-256 together with the complete bounded GetObject/HeadObject response metadata, LastModified timestamp and representation headers. Raw-v2 envelope metadata must match the key and compressed-body hash; the existing Rust codec verifies a retained canonical raw object after the fixture original is removed. Missing metadata or an unzoned timestamp is incomplete evidence. Header validation occurs after receipt and is not a wire byte cap. It leaves `complete=false` on any missing/mismatched/exhausted read. A completed export is still a superset with `dependency_closure=unproven`, not proof of each response's exact source dependencies.

Ownership binding requires successful named-resource creation receipts, a prepared exact launch request, one matching instance/token/image/subnet, run tags, enabled bucket versioning and exact role/profile/group/volume observations. Missing or rejected creation receipts cannot be replaced by matching tags. An uncertain instance launch can be reconciled by its original token; no replacement launch is sent by this path. Cleanup accepts only the immutable bound resource digest. It independently confirms instance termination before deleting source versions, includes delete markers, checks inner `DeleteObjects` errors and performs fresh absence inventories after deletion. Empty successful deletion output cannot substitute for those inventories. Failed evidence export remains incomplete even if resource deletion succeeds.

`coordinator.py audit-absence --resources resources.json --evidence responses.json` checks an exact ordered set of recorded AWS responses offline. Access denial, malformed output, pagination gaps or a request/response mismatch cannot produce a complete result. This audit command never executes cloud operations; live lifecycle commands are in `provision.py`.

## Remaining launch gates

Audit frozen paid-provider prices against the actual enabled API products; admission does not establish those prices. Qualify the complete Linux Rust installation and the shortened watchdog/stop timing. The transfer model reserves contingency but does not establish a physical network or billing-system hard cap. Complete native-candidate installation checks, integrated CLI scenarios, manual/diagram verification, independent review and CI before acquiring the approved host. The shared-key headroom prerequisite remains waived; no dedicated-key check is reintroduced.

## Offline run simulation

`server2/tests/integration/shadow_simulation.py` steps the real decision code of a whole run with a simulated clock: the operator's `provision.lifecycle` with its SQLite journal, `guard.evaluate` with `estimate_cost`, the reader's `Ledger` admission and stop rules, and the [evidence copy and bucket audit](#paired-evidence-in-the-state-bucket) over the reader's actual files. AWS is the offline `ProvisionCloud` fixture; SSH, the host's samples and HTTP outcomes are modelled. It needs no network, AWS or server process. From `server2/`:

```sh
python3 tests/integration/shadow_simulation.py --seeds 20 --output <file>.json
python3 tests/integration/shadow_simulation.py --seeds 5 --scenario realistic-combined
```

Each scenario is a set of fault rates and events (operator poll failures, guard sample failures, provider quota signals, production 429/5xx/timeouts, operator-unreachable windows, S3/network/CPU rates, candidate exit). For each seed it reports whether the run reached 168 hours, the collected hours, the host's and operator's stop reasons, and whether the evidence is complete. The host is modelled from the generated units: a candidate exit or a guard stop ends candidate, guard and reader together, while a reader exit stops only the reader until the operator's next poll; the 168-hour stop ends the group if the guard has not; a reader request takes effect when it completes. Since SR-5a, `evidence_retrievable` is the bucket-only audit's verdict: the real copy program runs at install, every wall-clock hour and as the finalizer when the reader stops and at 168 hours, against a host tree with the reader's files, and stores objects in a directory standing for the state bucket; `copy_failures` windows make its PUTs fail. The SSH export is still recorded, as reachability only (`ssh_export_reachable`). Scenarios include an operator unreachable from day 3 (`operator-ip-change-day-3`) or for the last hour (`operator-unreachable-at-deadline`), a failed final copy recovered by the next hourly copy (`final-copy-fails-hourly-recovers`) and a reader that exits 2 (`reader-failed`). Fault rates are inputs, not measurements; a copy run is instantaneous, the log collector is only a reported unit state, and the guard's watchdog, operator process death and host reboot are not modelled. `test_shadow_simulation.py` runs a short deterministic subset in CI. The baseline for this revision is in the [SR-1 evidence](../evidence/tasks/issue-2999/verification.md).

## Local 24-hour provider rehearsal

SR-6 measures one approved request mix on a fresh, disposable Linux VM with systemd. The guest permits outbound HTTPS to the pinned IPv4 addresses of `apis.data.go.kr` for KMA and AirKorea. The comparison origin, S3 and instance metadata use local stand-ins. For the coordinate-and-address workload, retain the configured coordinate observations and schedule a real KMA address request every 15 minutes. Attribute measured load and projected cost only to that workload. The run consumes real provider quota.

Prepare a schema-1 plan, the two-variable provider configuration, its independently trusted key reference and the reader manifest as owner-only regular files (mode `0600`). The plan binds the candidate and collector SHA-256 values, native route families, candidate S3 allowance, paid-provider policy, and the cumulative USD 300 policy including prior spend and the finish reserve. Use zero paid-provider grants. For each scheduled API and every KST date the run can touch, record used calls and a reserved allowance covering retries. Keep a single owner for that reservation. Bind the reader to the candidate hash and set its duration to at least 86,415 seconds to cover the measured day and the runner’s start margin. [Runner input checks](../../server2/deploy/shadow/rehearsal_run.py) · [Quota and credential checks](../../server2/deploy/shadow/rehearsal_inputs.py)

From `server2/` inside the disposable guest, run the following as root. The report must be directly inside a new private output directory. The runner configures the guest firewall, trust store and systemd units.

```sh
python3 deploy/shadow/linux_check.py --disposable-host --rehearsal-hours 24 \
  --rehearsal-input "$PLAN" --server-binary "$SERVER_BINARY" \
  --collector-tarball "$COLLECTOR_TARBALL" --source-commit "$SOURCE_COMMIT" \
  --output-dir "$OUTPUT" --report "$OUTPUT/report.json"
```

Retain the private output through finish. Check `report.json` for `"status": "complete"` and `measurement.json` for `"complete": true`. The runner writes incomplete checkpoints until it verifies 24 consecutive measured hours crossing UTC and KST midnight, the independent stop timer, stopped acquisition units, the final evidence copy, collector drain, bucket audit and the [finish export](#resumable-finish-and-resource-disposition) under `finish/`. Inspect hourly gaps, the failed phase and paired outcomes on a partial run. A complete measurement describes resource use even if some requests failed. API-specific actual call counts are unavailable, and exported object versions come from the local fixture.

For a complete measurement, freeze a separate schema-1 replay policy with `measurement_sha256` over the exact file bytes, a later `planned_epoch`, the S3 `allowance`, `cost_policy` and `paid_policy`. The measured simulator projects additive hourly counters over seven days, retains observed peaks and requires candidate S3 allocations and initial paid grants to cover twice the projected demand within their caps. Review projected cost headroom against the frozen policy. [Projection](../../server2/deploy/shadow/rehearsal_projection.py) · [Measured input validation](../../server2/tests/integration/shadow_measured_input.py)

```sh
python3 tests/integration/shadow_simulation.py --measurement "$OUTPUT/measurement.json" \
  --measured-policy "$REPLAY_POLICY" --seeds 20 --output "$OUTPUT/simulation.json"
```

Inspect `measurement.seed_acceptance` and the individual runs in `simulation.json`. The threshold is at least 19 full simulated runs out of 20. A real cloud canary and a 168-hour collection each require separate authorization.

## Initial host installation component

The private bundle binds thirteen artifacts (eight for acquisition, four for the [log collector](#host-logs) and the [evidence copy](#paired-evidence-in-the-state-bucket)) and a host-plan schema 4, including frozen cost inputs. `coordinator.py install-host --bundle <private-owned-bundle>` is Linux/root-only and accepts no installation-path or clock override. It refuses an existing task tree/unit, changed artifact, mismatched reader executable or expired original epoch. Installation writes an exclusive private tree, enables both original-deadline timers, confirms they are active, enables and confirms the hourly evidence copy timer, queues the log collector without waiting for it or checking it, starts the candidate, verifies its guard, starts the reader, and finally queues one evidence copy (it publishes the run's contract) without waiting; a rejected copy start is noted in the receipt (`copy_start_failed`) and never stops acquisition. A failed installation stops the three acquisition units and retains a failed receipt; it does not erase the directory, reuse the process grant or remove the expiry safety net. This internal host operation is not the complete cloud-launch command. Do not use it for an approved live capture until all launch gates above pass.

The guard's schema 2 includes frozen cost policy and monotonic host CPU accounting. `/proc/stat` user/nice/system/IRQ/softIRQ/steal time is charged conservatively without double-counting guest fields or assuming earned credits. A missing/stale tariff snapshot, unavailable counter or counter rollback prevents continuing, and the guard stops with `cost_ceiling` when its measured estimate plus the finish reserve reaches the [cost ceiling](#cost-ceiling). Exhausting an S3 allocation, a paid grant or any transmit volume is not a stop of its own. The estimate is conservative, not an AWS billing-system cap; paid tariffs must match the enabled API products.

### Cost ceiling

The host plan's `cost_policy` (schema 2) carries frozen tariffs, prior
spend and the approved USD 300 cumulative ceiling. It also records the
configured `finish_reserve_usd`. The guard uses the larger of that setting
and its calculated reserve for the remaining fixed host, IPv4 and storage
cost through hour 170, unaccrued bounded background PUTs, and the operator's
request and transfer envelopes. The configured schema minimum still applies
to existing plans. Preparation checks the effective reserve before launch.
The estimate uses frozen prices. Unobserved CPU and wire traffic after
acquisition are excluded. Indefinite state-bucket storage after the deadline
is a separately disclosed cost.

Every ten-second sample the guard computes, from measured counters:

accrued = prior spend + elapsed hours × hourly (instance, IPv4, 32 GB gp3 and 20 GB S3 storage, with a 28-day month and decimal GB) + host nonidle CPU seconds ÷ 3600 × vCPU-hour price + S3 reads used × read price + (S3 writes used + log object PUTs + evidence copy PUTs) × write price + bytes transmitted since the origin ÷ 10⁹ × outbound price + paid units admitted × their price.

S3 used is the allocation minus the server's remaining count; log object PUTs are bounded by five sources (server, guard, reader, collector and copy) writing one object per 50 s; evidence copy PUTs are bounded by four objects per generation (contract, batch, ledger, index), with one generation for install, one per started hour, and up to four for each of three finalizer starts (the reader's stop, the 168-hour stop and the operator's finish), booked from the first second after the epoch; paid units come from the server's admitted-unit snapshot. It stops with `cost_ceiling` when accrued + finish reserve ≥ ceiling, and records `cost` (`accrued_usd`, `limit_usd` = ceiling − reserve) in the decision (schema 6) at every valid sample.

Worked example (the tariffs of the test fixture: EC2 0.026, IPv4 0.005, gp3 0.0912 per GB-month, S3 storage 0.025 per GB-month, S3 read 0.00000035, write 0.0000045, vCPU-hour 0.05, outbound 0.126 per GB; ceiling 300, prior spend 10, reserve 5): after 24 hours with 3,600 CPU seconds, 10,000 reads, 5,000 writes, 2 GB transmitted and USD 1.50 of paid units, accrued = 10 + 24 × 0.036462 (0.875089) + 0.05 + 0.0035 + 0.0225 + 8,640 log PUTs (0.03888) + 148 copy PUTs (0.000666) + 0.252 + 1.50 = USD 12.742635 against a limit of USD 287.481213. The effective finish reserve is USD 12.518787 at this sample.

## Pinned remote installation component

`remote.py` is an internal connector, not a live launch CLI. It binds the exact owned running instance and its public IPv4 to the ED25519 host key fingerprint reported by the authenticated EC2 console output. Untrusted `ssh-keyscan` output alone cannot authorize a connection. SSH uses an exclusive private known-hosts file, strict host-key matching, the existing private identity, no ambient SSH configuration and no agent/port forwarding.

The initial installation consumes its durable intent before sending the fixed-name, hash-checked private bundle. The root receiver rejects links, unexpected members and duplicate staging trees before invoking the qualified host installer. An uncertain SSH acknowledgement never permits another upload/install; resume reads the original installation receipt and checks the three current acquisition unit states (the collector's state is reported too, but does not change the result). A retained `started` receipt with inactive services reports `stopped`. Remote transport checks currently use isolated fixtures; they do not establish an actual AWS host installation.

## Resumable finish and resource disposition

The first finish binds one new, private output directory to the existing journal,
launch and original deadlines. To resume, use the same journal and output.
A replaced or unmarked directory is refused. A crash before the output
marker becomes durable may leave an unmarked directory. Preserve its contents
in a separate safe location and rerun with the journal's original output path
available.

An installed run uses the state-bucket contract and committed generation indexes
first. It stages referenced original versions and verifies their hashes against
the launch and final ledger. Pending attempts and worker capture failures are
reported separately from missing or mismatched files. If bucket evidence is
incomplete and SSH remains reachable, finish stops acquisition, requests final
copy, drains the collector, and checks the bucket again. It verifies the stopped
reader's ledger and fetches only the missing paired files if needed. The exact
target, requested attempt IDs and transfer charges are durable. Verified
archives can be reused across an interrupted finish.

The coordinator fences the exact owned instance after verified paired evidence
or at the original 170-hour cleanup deadline. It confirms termination or
absence independently before sealing the final inventories. The state bucket
is eligible for deletion only after its sealed originals are fully exported
and verified. Finish deletes only exact versions in the sealed inventory and
checks absence again. Unexpected versions keep the bucket available for
investigation. When finish reaches the deadline before verified export,
the state bucket remains with no expiry. The report identifies retention
separately from confirmed deletion and tracks raw, IAM, security group and
volume disposition independently.

## Paired evidence in the state bucket

The host copies paired evidence to the run's state bucket. Finish verifies and assembles the committed generations from that bucket at its first stage, then uses the [resumable finish](#resumable-finish-and-resource-disposition) checkpoints to preserve originals and reconcile cleanup.

`evidence_copy.py` is a pinned host artifact (Python standard library only). It reads the bucket and region the log collector uses, gets the instance role's credentials through IMDSv2 and sends SigV4-signed `PutObject` requests. Every run takes an exclusive lock on `state/copy.lock` and is the only writer of `state/copy.json` (`reserved`, `committed`, `contract`, `shipped`), which it replaces atomically. A run:

1. publishes `evidence/<run>/contract.json` (the installed `launch.json` and `reader.json` texts with their SHA-256) until one PUT has succeeded;
2. snapshots `data/paired/ledger.sqlite3` with SQLite's online backup from a read-only connection and runs `integrity_check` on the copy. A stopped reader can leave a hot rollback journal: then the ledger and journal are copied privately and rolled back there; the live files are never modified;
3. reserves a new generation number g (never reused), checks the response metadata, body size and body SHA-256 against the snapshot, then writes and PUTs `batch-<g>.tar` with matching unshipped pairs (at most 256 MiB including tar headers and padding). It PUTs `ledger-<g>.sqlite3`, then `index-<g>.json` last. The index is the commit point: generation, `kind`, the snapshot time, the reader's unit state, the ledger's terminal state, the batch and ledger hashes, the attempt counts and pending IDs, the shipped files with their sizes and hashes. `copy.json` changes only after the index PUT succeeded; a failed or interrupted run leaves objects without an index, and the next run re-ships the same files under a new generation.

A final generation requires a durable request in `state/final.requested` and a stopped reader. The reader is stopped when systemd reports `inactive` or `failed` and its `data/paired/owner.lock` is free. The reader and its children hold this lock while running. The finalizer waits up to 120 s for the reader to stop, then ships up to four generations from one stopped snapshot under the copy lock. Its last committed index is marked `final`. The request remains until the contract and all required pairs are committed. An hourly run sends one generation and can continue a pending final request. Pending rows and capture failures do not require files. Missing or mismatched pairs remain eligible on a later run.

Every phase is bounded by epoch + 170 h − 10 min and by 570 s of elapsed time from the copy's start. A wall-clock rollback cannot extend those bounds. The copy logs one JSON line per event (`copy.committed`, `copy.skipped`, `copy.incomplete` or `copy.failed`) with fixed reason and stage values. The collector ships these records as the log source `copy`.

| Unit | Purpose | Relations and bounds |
| --- | --- | --- |
| `<run>-copy.service` | one copy run | oneshot, `Restart=no`, `TimeoutStartSec=600`, `TimeoutStopSec=10`, `LogNamespace=server2`; no relation to candidate, guard, reader or collector |
| `<run>-copy.timer` | hourly copy | `OnCalendar=hourly`, `Persistent=true`, enabled at install |
| `<run>-finalize.service` | final copy (`--final`) | as the copy service; started with `systemctl start --no-block` by the reader's `ExecStopPost` (guard stop, candidate exit, watchdog kill, the reader's own exit) and by the 168-hour stop after its stop requests |

No unit waits on these: the 170-hour poweroff and the launch-expiry timer neither depend on them nor wait for them, and a copy still running at shutdown is stopped within 10 s. A final copy is therefore not guaranteed at shutdown; the durable request and the hourly retries before it are.

`evidence_audit.audit` is the operator's bucket-only check: a pure function over downloaded objects (every version). It requires the contract (missing: `contract_missing`) whose `launch.json` hash equals the journal's launch hash and whose `reader.json` hash equals the launch's pinned reader artifact (otherwise `contract_mismatch`). A generation counts only when its index exists and its ledger and batch match the index's sizes and hashes and the batch holds exactly the listed files. The newest valid final generation's ledger must pass the integrity check and bind the reader manifest, origins and sampler hash as the SSH check does; each of its attempts is, in order, pending (result null), a capture failure (`"captured": false` and no body fields, written by the reader for a child it had to stop) or required to have both files matching its result as the SSH check compares them. The same attempt with the same bytes in two generations counts once; different bytes are a conflict. Without a final generation the result is `tail_unverified` with the newest snapshot time; without any index, `no_paired_evidence`. The assembled files and ledger are written to the audit directory. It judges retained capture integrity only (`qualification: not_assessed`).

## Host logs

The candidate, guard and reader write to the `server2` journal namespace, and since SR-5a the evidence copy and finalizer too. A collector unit generated with the other host units ships them, as the sources `server`, `guard`, `reader` and `copy`, to `logs/server2` in the run's `-state` bucket, at `warn` for server records ([logging guide](server2-logging.md#qualification-host-lp-6)). The bundle carries the pinned collector archive and its pin (`collector.tar.gz`, `collector.json`), and the logging pipeline's `render.py` and `status.py`. They are hashed like the other artifacts, and `prepare_generation` and installation also require the archive to be one of the pin's archives, for the host's architecture. Installation extracts the collector binary, writes the destination settings to `config/logging.env` and the journal namespace settings to `/etc/systemd/journald@server2.conf`, and queues the collector's start without waiting for it: a collector that fails or hangs never delays or blocks acquisition (the receipt notes a rejected start, and `inspect` reports the collector's state). A failed installation leaves the collector running, so the stopped units' records are still shipped.

The guard writes its stop decision before it stops the candidate and reader, because stopping the candidate also stops the guard's unit. A stop such as `s3_authorization` can therefore be read after the host is gone: the candidate's failing record and the guard's stop record (with the latched first rejection) are in the exported `logs/server2/` objects. The collector is not part of the guard's coupling and the acquisition units have no relation to it, not even ordering: it never starts, stops or delays acquisition, and the 168-hour stop leaves it running. The cumulative cost estimate includes the collector's upload traffic and CPU in the measured host counters. The cost model bounds log object PUTs by elapsed time, with up to one object per 50 seconds from each of five sources. Its journal (at most 1 GiB) counts toward the disk reserve. The log objects' storage and export fall inside the existing 20 GB storage and the operator's allowance (79,000 ordinary reads and 4 GiB of export bytes for new journals, already priced), which they share with the candidate's objects. The collector therefore writes no periodic status records on this host (they would close an object every 50 s, about 12,000 over the run): it ships its start and stop records, and server records only at `warn`, so a run without failures adds only a handful of objects. Each 50-second window with a failure adds at most one object per source. The export reads the state bucket first, so the stop reasons are kept even when the candidate's objects exhaust the allowance. An export that exceeds the allowance is incomplete evidence, as before.

`server2/deploy/shadow/linux_check.py` checks this on a **disposable** Linux VM (root; it changes units, `/etc/hosts`, the CA store and iptables). It prepares a real bundle and grant, applies the launch user data, and streams the bundle into the real receiver. The real host names of the run's buckets, the production origin and the providers are pointed at loopback stand-ins, and every other outbound connection is rejected. The scenarios are: a provider rejection (401) is counted by the guard without a stop while acquisition keeps running, and after the retention stop the stand-in holds the server, guard, reader and collector records without a synthetic key, URL or body; the run's data buckets answering 403 stop the guard with `s3_authorization`, whose stop record is shipped; a configuration change during a destination outage; a frozen guard with the collector stopped; a collector that cannot start, with acquisition still starting; and a changed collector file, which installation refuses. See the [LP-6 evidence](../evidence/tasks/issue-2983/verification.md). SR-5a adds a final evidence generation after the guard stop and the watchdog kill, and two scenarios: `evidence-copy` (the copy timer, shortened by a test-only drop-in in the VM, ships batches, ledgers and indexes; a refused evidence PUT is logged and its record reaches the destination; the reader exits 2 and a final generation follows with the reader `failed`; the 168-hour stop starts the finalizer again; the copy and finalize unit properties; the bucket-only audit of the stand-in's objects is complete while the host's data directory is unreachable) and `evidence-candidate-exit` (a killed candidate, then a final generation and a complete bucket-only audit).

## Transfer model and protected cleanup

Candidate S3 grants follow the server's parse caps (1,740,000 reads, 900,000 write/list
attempts, 2 GiB of PUT bytes); the allocations themselves are sized from measurement
(SR-6). With quota renewal working, the November 21–22 coordinate-and-address rehearsal used 124,168 candidate reads in 24 hours. Repeating this workload for seven days gives 869,176 reads, requiring a grant of 1,738,352 at twice the projected demand. The read cap rounds that floor up to the next 10,000. The [cost ceiling](#cost-ceiling) prices what is actually used; it ignores CPU
credits, free tiers and refunds. Verified rate evidence must be supplied before launch. The cost estimate uses the initial generation's counters. A future restart mode must carry prior-generation spend into the estimate.

The finish reserve prices up to 16 GiB of operator transfers for new journals.
The 4 GiB body allowance covers original objects and paired fallback transfer.
Ordinary control has an 8 GiB response-envelope allowance and cleanup has a
separate 4 GiB allowance. Existing version-5 journals keep their 4 GiB ordinary
control allowance. Host transmission remains accounted for by the guard. Every physical AWS CLI
attempt precharges 8 MiB for version-list/batch-delete responses, or 64 KiB for
other control responses; timeout/failure does not refund it. Oversized CLI output
is rejected. SSH control observations also precharge 64 KiB. Bodies have their
separate bounded exports and one-use intents.

These are conservative accounting envelopes, not pre-download wire limits: AWS
CLI downloads and parses its response before returning output. Protocol overhead,
pending packets and termination delay consume contingency. Do not present the
48-GiB model as a proven network ceiling. The real Linux stop test must validate
the ten-second sampling, 30-second watchdog and ten-second stop configuration;
review the live rate evidence and resulting headroom before launch. No speculative
32-GiB metadata guarantee from the earlier design discussion is used as proof.

## Execute or finish a qualified run

After the candidate's verification, independent review and CI pass, use the
existing prepared journal and bundle. Both commands require explicit `--execute`:

```sh
python3 server2/deploy/shadow/provision.py run --execute --state private-run --bundle private-bundle --identity /absolute/path/to/existing-key.pem --aws-executable /absolute/path/to/aws --profile ACCOUNT --output private-result
python3 server2/deploy/shadow/provision.py finish --execute --state private-run --identity /absolute/path/to/existing-key.pem --aws-executable /absolute/path/to/aws --profile ACCOUNT --output private-result
```

`run` provisions only the frozen one-host plan, authenticates SSH against the EC2
console key, installs once, and observes the same install until the original
expiry. Startup waiting is bounded to ten minutes, capped by the original collection deadline. Before the sole launch, a durable first attached-profile observation starts a five-minute settling delay for IAM-to-EC2 propagation. Restarting the coordinator does not refresh that delay. The delay reduces the observed race; it is not a cross-service readiness guarantee. A rejected or uncertain launch still fails closed without an automatic replacement. A lost installation reply
causes inspection, never another upload. While collecting, the host is the lifetime
authority: a status poll that fails, times out or cannot be validated is reported
(`"poll":"unreachable"` with a consecutive count, then `"poll":"recovered"`) and
retried a minute later; it never stops, exports or terminates. Collection ends when
the host reports that its acquisition units stopped (`host_stopped`, for example a
guard stop or a reader exit), at the deadline, or on an operator interrupt. An
interrupt while collecting detaches without touching the host (`operator_detached`);
`run` with the same arguments resumes observing the recorded install, and `finish`
ends the run. The collecting phase is recorded in the journal (`collection-started`)
the first time the install is confirmed started. A resumed `run` in that phase makes
no provisioning or install call: it reconnects through the SSH target authenticated
earlier in the run (not the console fingerprints) inside the collecting loop, so a
failed reconnect, including the first after a resume, is an unreachable poll.
Only a validated host stop ends collection. The receipt reports `failed`,
or it reports all three acquisition units with known systemd states and at
least one `inactive` or `failed`. Missing or unknown unit states remain
unreachable. While collecting, an interrupt detaches with exit 0. A local
journal or progress failure detaches with exit 1 and retains its failure
class. Startup, host stop or deadline enters the finish phase, and a partially
observed install is protected by the installed-run retention path.

For an installed run, `finish` binds its private output in the original
journal and audits the bucket. Resume into that same output. At the deadline,
the host timers still stop collection at 168h and terminate at 170h when the
operator is disconnected. `finish` requires the original journal and a
verified AWS account. A bundle and SSH key are optional, and the protected
cleanup reserve remains separate from original-body reads. Exit 1 reports
incomplete evidence, pending cleanup, or an intentionally retained state
bucket. Inspect `result.json`, `sources/manifest.json` when available, and
the retained run journal to distinguish these cases. A completed finish
preserves capture integrity. Weather parity is assessed separately.

The paired reader records 401, 403, 429, redirects, 5xx, timeouts and oversize bodies
with the attempt and continues its schedule; its summary reports failed attempts per
origin. An origin that has failed at least three times with no success for 30 minutes
ends the reader (`origin-outage`); its exit stops only the reader, and the operator's
next poll finishes the run as `host_stopped`.

Host-plan schema 4 explicitly lists native read families. `push` and duplicate
families are rejected. The launched process uses only the run's raw bucket in
Seoul and instance-role credentials; empty process credential variables override
static `.env` keys. Unsupported routes can reach only a closed loopback fallback,
not production. Provider API keys remain private in the hashed configuration.
This lifecycle supports only the initial process; it does not automatically
restart, replace a host or replenish a grant.

## Operator quick start

The [one-page manual](server2-shadow-supervisor/manual.pdf) and its [editable source](server2-shadow-supervisor/manual.json) show actual offline prepare/inspect/refusal output with fixture artifacts. They are not evidence of an AWS capture.

The SSH receiver starts the installer with Python bytecode writes disabled (`-B`). This keeps interpreter-generated cache directories out of the private input bundle without relaxing its ownership or permissions checks. This option does not depend on an operator environment variable surviving SSH.

Evidence validation compares response metadata exactly, excluding only the nonnegative integer `elapsed_ms` added to the ledger after capture. Missing bodies, pending attempts, changed headers or hashes remain incomplete. The S3 export adapter supplies `--bucket`, `--key`, `--version-id` and `--range` as separate argv values from the frozen request. The customized AWS CLI `get-object` command does not accept `--cli-input-json`; the original version and full byte range remain pinned.
