# Bounded shadow supervisor

This operator is under implementation. The journal, S3 admission, host checks and evidence/cleanup APIs described below are implemented components. The public lifecycle is connected but has not yet completed its Linux candidate/review/CI qualification. The Linux host installation component is implemented separately; these components do not establish live qualification readiness. See the [spec](../../specs/issue-2614-shadow-supervisor.md) and [implementation plan](../../plans/issue-2614-shadow-supervisor.md).

## Durable coordinator state

`python3 server2/deploy/shadow/state.py init --state <new-private-directory> --run-id <run-id> --manifest-sha <sha256>` creates local state only. `inspect` reads the same record. Repeating `init`, changing identity, or opening a second coordinator is rejected. Keep the state directory through cleanup and evidence reconciliation; deleting it is not a supported restart mechanism.

Journal schema 5 includes the separate operator allowance, exact nonsecret request parameters and immutable typed acknowledgements. Older experimental schemas are rejected rather than reset; no live run has used these schemas. The first epoch fixes collection expiry at 168 hours and cleanup reserve at 170 hours. The sole RunInstances request includes a nonsecret first-boot script that installs an enabled persistent poweroff timer for that original 170-hour deadline. Bootstrap failure requests immediate poweroff. SSH installation verifies the exact timer contents, enabled state and active state before starting any candidate; it cannot replace or extend the launch deadline. This closes loss of the coordinator before SSH installation, subject to the approved Linux image executing its first-boot user data. No independent AWS termination service is claimed. Generation reservations are durable before launch and cannot be refunded after an uncertain launch or process death. At most three generations can be consumed (initial plus two planned restarts). `dispatch_recorded` commits the exact request before its one physical dispatch and retains the typed acknowledgement. If execution stops before the acknowledgement is saved, a reopened journal preserves the uncertainty and refuses another dispatch. Operation-specific reconciliation uses that original request; a failure cannot be overwritten with a successful receipt.

## Prepare and inspect without cloud calls

`provision.py prepare` accepts a JSON plan with exactly `host`, `cloud` and
`allowance`: the schema-4 host plan with frozen artifact/price/grant inputs, the
schema-1 Seoul cloud plan, and the initial S3 grant. It fixes the epoch, validates
the projected AWS estimate and all paid grants, records the cloud parameters and
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

The main `server2` executable recognizes the optional `SERVER2_SHADOW_S3_LIMITS=reads,writes,put_bytes` setting. Values are nonnegative decimal integers. Maximum per-process values are 900,000 reads, 900,000 write/list attempts and 2 GiB of attempted PUT bodies. Missing leaves ordinary runtime behavior unchanged; an empty, malformed or excessive value fails startup. The coordinator must supply a disjoint precharged allocation for each process, not the maximum on each restart. Aggregate candidate allocations and the separate operator/export/cleanup reserve must fit the run's ceilings.

Main installs one immutable process owner before runtime construction. Every S3 transport consults it immediately before a physical send; constructing additional clients or validating settings cannot replenish it. GET and HEAD consume reads. LIST consumes write/list attempts despite using HTTP GET. PUT atomically consumes one write and its body size. Rejected compound reservations spend neither dimension. Once admitted, failures, 412 conflicts and cancellation are not refunded. Existing automatic HTTP retries and redirects remain disabled.

The setting applies to the main qualification executable. The supervisor must not launch `server2-notice`, arbitrary importers or other binaries under the same allocation. Direct library use without main initialization is not a qualified process. The allowance alone does not limit provider quota, total network bytes, elapsed time, local disk or other AWS clients. Those remain required host/operator guards before live acquisition.

## Qualification paid-provider allowance

Host-plan schema 4 requires a frozen `paid_policy`: dated tariff evidence digest,
USD per existing runtime budget unit, and separate `initial`, `restart-1` and
`restart-2` grants for `visual_crossing`, `google_geocode`, `google_air` and
`openweather`. All three grants are priced before a bundle can be prepared; their
sum must not exceed $5. A null tariff requires zero units. No shared free credits
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

The guard compares the actual Linux process start ticks, boot identity, executable hash, exact process environment hash, working directory, `.env` hash, cgroup and loopback socket ownership. It samples every ten seconds; missing/stale observations, changed identity, disk reserve, network counter rollback, exhausted S3 allowance and classified auth/quota events latch a stop. Its systemd watchdog stops the owned candidate and reader if observations cease. Original collection and poweroff deadlines are separate calendar timers and do not move with a generation.

The opt-in `/internal/metrics` fields are `server2_shadow_s3_{reads,writes,put_bytes}_remaining` and `server2_runtime_{auth,quota}_failures_total`. Rejection signals are recorded before log filtering and queue admission, so dropped diagnostic logs cannot erase them. They count classified events, potentially more than one per provider request; they are not provider usage or billing counters. No shadow metrics appear when the opt-in allowance is absent.

Stop diagnostics use the same opt-in endpoint. `server2_runtime_local_paid_exhaustions_total` counts quota signals caused by the local paid-unit allocation rather than a provider response. `server2_runtime_first_rejection_info{cause,origin,component,stage,provider,status}` identifies the first counted auth/quota signal with fixed vocabulary only; `origin="local_paid_allowance"` means no provider request was sent, and `provider`/`status` are `none` when the originating record lacked them. When the paid allowance is installed, `server2_shadow_paid_units_{initial,remaining}{provider}` report conservative admitted-unit snapshots, not billed usage. The guard validates these values on every sample and stores the latest snapshot, including the auth and quota counts, in the `diagnostics` field of `decision.json` (schema 3). A stop latches that snapshot, and the existing evidence export retains `decision.json`. Malformed diagnostics stop acquisition as `metrics_unavailable`; stop and cleanup behavior is otherwise unchanged.

`prepare_generation` verifies the frozen plan against the journal and copies an exclusive private bundle only after consuming its allocation. A changed artifact, conflicting plan, reused generation or existing destination is refused. `bootstrap.sh --check <new-output-directory>` verifies the bundle hashes and renders seven systemd unit/timer files. It does not install them, launch a process or call AWS. The internal candidate launcher clears ambient environment overrides and consumes a local one-use marker before `execve`; the host restart/reader-resume connector is not yet exposed.

For an existing offline guard fixture, use:

```sh
python3 server2/deploy/shadow/guard.py check --manifest host.json --state decision.json --sample observation.json --now 1001
```

This command only evaluates and records the fixture. `guard.py run` requires Linux/root and initialized bound state; it has no fake-clock or fixture endpoint option. Qualify both the Linux guard and the installed native candidate before launch. A Linux stand-in can exercise `/proc`, socket ownership, configuration changes and watchdog shutdown; macOS loopback metrics alone cannot replace those checks. The complete candidate installation still needs its own verification.

## Source export and deletion evidence

The operator has a separate durable allowance of 10,000 reads, 10,000 write/control attempts and 2 GiB of original-body export attempts. Ordinary work and export may use at most the first 9,000 attempts in each request dimension; the last 1,000 are reserved for cleanup. Cleanup can inspect ownership and delete it, but cannot create resources or use its protected reserve to fetch original bodies. Export still uses the ordinary allowance when called from cleanup. Reopening or reaching the original collection deadline does not replenish either budget. Failed attempts are not refunded; deleting the journal cannot be used to replenish them. Export uses explicit S3 version IDs and a prepaid byte range covering the whole original; it rejects a prefix or mismatched total length. Empty originals use HEAD and a retained empty file. Export schema 2 preserves original bytes and SHA-256 together with the complete bounded GetObject/HeadObject response metadata, LastModified timestamp and representation headers. Raw-v2 envelope metadata must match the key and compressed-body hash; the existing Rust codec verifies a retained canonical raw object after the fixture original is removed. Missing metadata or an unzoned timestamp is incomplete evidence. Header validation occurs after receipt and is not a wire byte cap. It leaves `complete=false` on any missing/mismatched/exhausted read. A completed export is still a superset with `dependency_closure=unproven`, not proof of each response's exact source dependencies.

Ownership binding requires successful named-resource creation receipts, a prepared exact launch request, one matching instance/token/image/subnet, run tags, enabled bucket versioning and exact role/profile/group/volume observations. Missing or rejected creation receipts cannot be replaced by matching tags. An uncertain instance launch can be reconciled by its original token; no replacement launch is sent by this path. Cleanup accepts only the immutable bound resource digest. It independently confirms instance termination before deleting source versions, includes delete markers, checks inner `DeleteObjects` errors and performs fresh absence inventories after deletion. Empty successful deletion output cannot substitute for those inventories. Failed evidence export remains incomplete even if resource deletion succeeds.

`coordinator.py audit-absence --resources resources.json --evidence responses.json` checks an exact ordered set of recorded AWS responses offline. Access denial, malformed output, pagination gaps or a request/response mismatch cannot produce a complete result. This audit command never executes cloud operations; live lifecycle commands are in `provision.py`.

## Remaining launch gates

Audit frozen paid-provider prices against the actual enabled API products; admission does not establish those prices. Qualify the complete Linux Rust installation and the shortened watchdog/stop timing. The transfer model reserves contingency but does not establish a physical network or billing-system hard cap. Complete native-candidate installation checks, integrated CLI scenarios, manual/diagram verification, independent review and CI before acquiring the approved host. The shared-key headroom prerequisite remains waived; no dedicated-key check is reintroduced.

## Initial host installation component

The private bundle binds eight artifacts and a host-plan schema 4, including frozen cost inputs. `coordinator.py install-host --bundle <private-owned-bundle>` is Linux/root-only and accepts no installation-path or clock override. It refuses an existing task tree/unit, changed artifact, mismatched reader executable or expired original epoch. Installation writes an exclusive private tree, enables both original-deadline timers, confirms they are active, starts the candidate, verifies its guard, and starts the reader last. A failed installation stops the three acquisition units and retains a failed receipt; it does not erase the directory, reuse the process grant or remove the expiry safety net. This internal host operation is not the complete cloud-launch command. Do not use it for an approved live capture until all launch gates above pass.

The guard's schema 2 includes frozen cost policy and monotonic host CPU accounting. `/proc/stat` user/nice/system/IRQ/softIRQ/steal time is charged conservatively without double-counting guest fields or assuming earned credits. A missing/stale tariff snapshot, unavailable counter, counter rollback, accrued estimate of at least $28 or projected estimate of at least $35 prevents continuing. The USD estimate includes all request allowances, full storage over the elapsed period, the full 48-GiB transfer cost reservation and two busy vCPUs for the remaining time through the original 170-hour deadline. It is an upper estimate, not an AWS billing-system cap. The transfer model and its limits are described below; paid tariffs must match the enabled API products.

## Pinned remote installation component

`remote.py` is an internal connector, not a live launch CLI. It binds the exact owned running instance and its public IPv4 to the ED25519 host key fingerprint reported by the authenticated EC2 console output. Untrusted `ssh-keyscan` output alone cannot authorize a connection. SSH uses an exclusive private known-hosts file, strict host-key matching, the existing private identity, no ambient SSH configuration and no agent/port forwarding.

The initial installation consumes its durable intent before sending the fixed-name, hash-checked private bundle. The root receiver rejects links, unexpected members and duplicate staging trees before invoking the qualified host installer. An uncertain SSH acknowledgement never permits another upload/install; resume reads the original installation receipt and checks the three current systemd unit states. A retained `started` receipt with inactive services reports `stopped`. Remote transport checks currently use isolated fixtures; they do not establish an actual AWS host installation.

## Retaining host evidence before cloud cleanup

`retain_host_evidence` stops the owned acquisition units and confirms all three are inactive or failed before downloading a fixed evidence inventory. A private archive retains the original paired bodies, result metadata, SQLite ledger and nonsecret launch/guard/install records. Configuration secrets, SSH identities and arbitrary server logs are excluded. Extraction refuses links, unexpected names and duplicate entries. Body retention is limited to two GiB and 25,016 files; exhausting this limit is incomplete evidence, not permission to extend the transfer budget.

The export intent is durable and one-use, including after collection expiry. A lost transfer acknowledgement cannot trigger another automatic download. The downloaded launch hash must match the installation request. The ledger must bind the exact reader manifest, candidate origin, production origin and sampler hash; every admitted result must match its retained body size and hash. Pending/missing/mismatched entries stay incomplete. These checks establish retained capture integrity, never weather parity or original provider dependency closure.

`finish_run` attempts host evidence retention first and then independent cloud cleanup even if SSH/evidence fails. Proven resource identities are journaled before deletion; cleanup resume uses that record when terminated-instance responses no longer include a volume mapping. Source export still uses ordinary work allowance, while deletion and readback retain the protected cleanup reserve. The public lifecycle connects these components. Complete candidate-bound Linux evidence, review and CI before launch.

## Transfer model and protected cleanup

The coordinator limits candidate grants to 90,000 reads and 90,000 write/list
attempts in total, even though the general runtime setting accepts larger values.
With the operator's 10,000 attempts per dimension, the cost model prices 100,000
reads and writes, full storage and two busy vCPUs through the original 170 hours.
It ignores CPU credits, free tiers and refunds. Acquisition stops on projected
$35 or accrued $28. Verified rate evidence must be supplied before launch.

The transfer reservation is 48 GiB: 4 host threshold, 2 original bodies,
2 paired evidence, 8 control envelopes and 32 contingency. Ordinary control and
cleanup each get a separate four-GiB envelope allowance. Every physical AWS CLI
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
python3 server2/deploy/shadow/provision.py finish --execute --state private-run --identity /absolute/path/to/existing-key.pem --aws-executable /absolute/path/to/aws --profile ACCOUNT --output private-recovery-result
```

`run` provisions only the frozen one-host plan, authenticates SSH against the EC2
console key, installs once, and observes the same install until the original
expiry. Startup waiting is bounded to ten minutes, capped by the original collection deadline. Before the sole launch, a durable first attached-profile observation starts a five-minute settling delay for IAM-to-EC2 propagation. Restarting the coordinator does not refresh that delay. The delay reduces the observed race; it is not a cross-service readiness guarantee. A rejected or uncertain launch still fails closed without an automatic replacement. A lost installation reply
causes inspection, never another upload. A guard stop, missing observation,
interrupt or acquisition error enters evidence retention and exact cleanup.
Termination propagation gets at most three additional cleanup-only checks; the
first source export is preserved if termination delayed it. Existing partial
exports are not repeated. An incomplete cleanup returns exit 1 and retained
pending evidence; inspect that evidence and use `finish` to reconcile, never
create a second run. A clean teardown is not a product qualification PASS.

`finish` requires the original journal but permits a missing bundle or SSH key so
cleanup remains possible. Missing host evidence stays incomplete. It verifies the
AWS account using cleanup's protected reserve even if ordinary work is exhausted.
The local journal lock excludes a second coordinator. If the coordinator dies,
the installed host timers still stop collection at 168h and terminate at 170h;
resume `finish` to independently remove and verify the remaining resources.

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
