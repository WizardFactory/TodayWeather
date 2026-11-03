# Server2 installation and operations entrypoint

Use this guide to build server2, check it locally, and find the settings and
operating procedures for an approved target. It describes the repository after
[G1 PR #2844](https://github.com/WizardFactory/TodayWeather/pull/2844), merged as
`821c4ccd6a765da6cb03a0726822a8d6f0bece28`. It is not evidence of a production
installation or traffic switch.

## 1. Prepare a checkout and build

Use Git, Python **3.11+**, and the pinned Rust **1.99.0** toolchain with rustfmt
and clippy. Cargo may download public dependencies. Node **16.20.2** and npm are
needed for the separate [golden verification procedure](server2-golden.md), not
for the Rust health/metrics smoke below.

Before building, check free space and the selected Cargo target's size. Reuse a
compatible owned target when available and keep room for the expected build plus
a **3 GiB reserve**. Coordinate shared-target use; do not remove another task's
build inputs. The commands below use the default `server2/target` layout; adapt
binary paths if a different `CARGO_TARGET_DIR` is deliberately selected. The local
stack later in this guide requires its executable to resolve under `server2/`.

From the repository root:

```sh
cd server2
rustc --version
python3 --version
cargo build --locked --release
```

Keep subsequent commands in `server2/` unless stated otherwise. The release
executable is `target/release/server2`. For the repository's fmt, clippy and test
commands, see the [foundation checks](server2-foundation.md#build-and-check).
For a retained Linux release bundle and hash verification, use the
[native artifact guide](server2-native-verification.md#retain-the-linux-verification-bundle).
A host-native build does not establish Linux compatibility.

## 2. Choose configuration before starting

For isolated local verification, use the tools in section 3. They supply their
own restricted environment and empty working directory; no private `.env`,
provider key, Firebase account, MongoDB or AWS credential is needed.

For an operational target, prepare settings from
[`server2/.env.example`](../../server2/.env.example) and the
[gateway configuration table](server2-gateway.md#process-configuration).
An optional `.env` is read from the process working directory; process variables
take precedence. A complete process environment may omit the file. Keep any
private `.env` ignored and mode 600; do not execute it as a shell script.
Example placeholders are not a complete operational configuration.

Without an explicit development coexistence origin, operational main requires
`SERVER2_NATIVE_FAMILIES=geocode,dsf,kma,kma-v000901,kma-v000902,town,push,notice`
and `SERVER2_WORLD_VERSIONS=v000901,v000902,v000903` (the default world selection),
plus their provider, S3 and Firebase settings. Bare or partial selection fails
before service construction/listeners. A nonempty
`SERVER2_GATEWAY_LEGACY_URL` permits explicit development coexistence, not
production fallback. Selecting `push` starts supervised delivery and warning
acquisition after both listeners bind. Follow the
[runtime services guide](server2-runtime-services.md#select-and-start) before
starting with real settings.

## 3. Verify a local release

Run the existing isolated process smoke:

```sh
python3 tools/smoke.py --binary target/release/server2
```

It exercises the actual release process on ephemeral loopback ports: health,
private metrics, invalid listener configuration, connection limits and shutdown.
It stops its owned children. A passing smoke is local process evidence, not
provider, notification, storage or production readiness.

For an interactive session with owned local S3/provider test peers, start the
existing local stack in a foreground terminal:

```sh
S03_DIR=$(mktemp -d "${TMPDIR:-/tmp}/server2-s03-XXXXXXXX")
python3 deploy/local/stack.py --binary target/release/server2 --ready "$S03_DIR/ready.json"
```

In a second terminal, set `READY_FILE` to that run's absolute ready-file path.
The file's `public_endpoint` and `metrics_endpoint` identify its actual ports;
do not assume ports 3000/3001. With curl available:

```sh
READY_FILE=/absolute/path/to/server2-s03-XXXXXXXX/ready.json
PUBLIC_URL=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["public_endpoint"])' "$READY_FILE")
METRICS_URL=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["metrics_endpoint"])' "$READY_FILE")
curl -i "$PUBLIC_URL/health"
curl -i "$METRICS_URL/internal/metrics"
curl -i "$PUBLIC_URL/internal/metrics"
```

Expect health `200` with body `OK`, private metrics `200` with `no-store`, and
public metrics `404`. The S3/provider peers are published for test clients; this
health/metrics process does not read their endpoints or use them as its storage.
The test peers do not forward to AWS or providers. See the
[local infrastructure guide](server2-infrastructure.md#start-and-verify-locally)
for the peers' limits and ready-file ownership rules.

## 4. Stop and diagnose

Press Ctrl-C in the foreground stack terminal, or send SIGTERM to the confirmed
owned launcher. Normal shutdown stops its child and peers and removes its owned
ready file. Confirm the listeners are closed before removing the empty private
task directory. A stale ready file is not proof of a live process; follow the
infrastructure guide's identity checks after a crash rather than killing a PID
from the file alone.

Ordinary push-enabled main has a different drain contract: up to **35 seconds**,
including teardown, with incomplete work classified and durable claims retained.
Use [stop and inspect](server2-runtime-services.md#stop-and-inspect) and the
[logging guide](server2-logging.md) for operational diagnosis. `/health` alone is
liveness; it does not establish restored state, provider access or delivery
readiness. Do not use `/gather` as a health probe.

## 5. Prepare an operational installation and transition

Before starting on an actual target, freeze the exact release/configuration and
eligible previous bundle, service command, listener topology, state compatibility,
credential references, worker ownership and stop/rollback procedure in the
[cutover dossier](server2-cutover.md#2-freeze-a-release-and-recovery-dossier).
That guide owns the separately authorized activation sequence and remaining
real-host, shadow, quota and recovery evidence. Local checks and G1 merge do not
complete those gates. This entrypoint supplies no production deployment command.

The linked Markdown files carry current amendments. Existing companion PDFs and
screenshots are dated task snapshots where labelled; they are not automatically
regenerated copies of these current instructions.
