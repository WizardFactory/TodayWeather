# server2 foundation operator manual

S04 provides a Rust host foundation for local validation. It serves operational
health only. Weather/geocode, S3, provider adapters, capture jobs and production
cutover are later tasks. Keep nginx and production routing on legacy.

## Build and check

Prerequisites: pinned Rust 1.99.0 with rustfmt/clippy, Python 3.11+, and an isolated
checkout. Cargo may download public dependencies; the binary never calls providers.

```sh
cd server2
cargo fmt --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo build --locked --release
python3 tools/smoke.py --binary target/release/server2
```

The smoke starts two sequential release processes on ephemeral loopback ports. It
checks GET/HEAD health, rejects public metrics, reads private counters, tests a
2-second incomplete-header timeout with elapsed bounds, socket-cap rejection/recovery,
and both idle and partial-header SIGTERM shutdown. It also verifies that
nonloopback metrics configuration fails startup. No legacy collectors run.

## Configure and operate

Start `server2/target/release/server2`. Startup prints the two bound socket addresses.
The default public listener is 127.0.0.1:3002; private metrics is 127.0.0.1:3003.
Set SERVER2_BIND to change the public address. SERVER2_METRICS_BIND must stay loopback,
including IPv6 ::1 if used. Invalid values and listener collisions fail startup.

| Environment variable | Default | Allowed |
| --- | --- | --- |
| SERVER2_WORKER_THREADS | 2 | 1..64 |
| SERVER2_BLOCKING_THREADS | 4 | 1..64 |
| SERVER2_CPU_LIMIT | 2 | 1..blocking threads |
| SERVER2_INFLIGHT_LIMIT | 40 | 1..1024 |
| SERVER2_CACHE_BYTES | 16777216 | 1..1073741824 |
| SERVER2_CONNECTION_LIMIT | 128 | 1..1024 public connections |
| SERVER2_CONNECTION_SECONDS | 9 | 1..30 seconds maximum connection age |

Metrics connections have a separate fixed limit 16. Socket limits bound slow headers
and body draining; a connection expires at its maximum age even with keep-alive.
This is an absolute connection lifetime, distinct from the later S10 per-request
9-second gateway deadline. These foundation limits require S10 assessment before cutover.
The volatile cache is a single byte-bounded slot; keyed/sharded cache algorithms
are S07. CPU permits remain reserved until blocking work ends after caller cancellation.

```sh
curl -i http://127.0.0.1:3002/health
curl -i http://127.0.0.1:3003/internal/metrics
```

Health returns 200 with exact body OK, text/html; charset=utf-8 and CORS *. HEAD returns 200,
no body, Content-Length 2. Public /internal/metrics returns 404. Private metrics
returns 200 and no-store, without CORS access, with only finite counters and declared limits.
OPTIONS /health currently returns 405; legacy CORS preflight (204), session-cookie
and complete middleware-header parity are deferred to S02 and not asserted here;
S02 freezes the complete legacy oracle before route ports. SIGTERM/SIGINT drain
both listeners for at most 5 seconds; a signal-triggered timeout logs a forced stop
and exits successfully. Startup, signal-registration and unexpected serving failures
remain unsuccessful. Tokio
runtime shutdown then waits at most 1 second for blocking work, including error
paths, giving a total shutdown bound of 6 seconds plus scheduling overhead. A CPU
closure may outlive that wait until process exit; this does not claim a durable S3
or provider drain. Later tasks own their interruption guarantees.

## Enforce placement before task completion

Declare owned directories and exact outside exceptions in config/tasks/<task>.json
before editing and link the issue declaration. Use an exact reviewed task base:

```sh
cd server2
python3 tools/check_placement.py --root .. --declaration config/tasks/S04.json --base <exact-task-base>
python3 tools/test_placement.py
```

The checker audits the full tracked server2 snapshot, Cargo local paths, literal
Rust compiler resources/path attributes and direct read/read_to_string/read_dir/open/create strings,
symlinks and both rename endpoints. Plain and matched-hash raw Rust strings are checked;
borrowed/parenthesized runtime literals are included. Encoded, backslash-containing
or continued direct resource strings are rejected
conservatively. Python direct call literals (including decoded escapes), decoded
JSON/TOML values and literal shell/service/config/deployment paths are also checked.
Validated config/tasks/*.json outside.path identities and exact test_placement.py
self.write/fixture_symlink data roles are exempt;
invalid or blanket declarations, runtime config fields and executable open/subprocess
calls in the fixture file still undergo checks. Shared workflow
wiring allows checkout@v4, full history and one owned command, with a 30-minute timeout. It rejects root Cargo and
undeclared outside implementation. Git/JSON/TOML failures are incomplete checks.
Computed or aliased filesystem paths, custom loaders, macros and dynamically built
commands require human review. These supported direct literal checks are a review
aid, not an adversarial sandbox or proof of arbitrary program behavior. The CI entrypoint runs only on server2-related PRs and invokes
server2-owned checks. Remote branch protection is not configured by this task.

## Actual usage capture

This [usage capture](../evidence/tasks/server2-foundation/usage.png) comes from the
release-process smoke on 2026-10-06; ports are ephemeral. The
[manifest](../evidence/tasks/server2-foundation/manifest.json) records command,
platform and the binary/capture hashes. This is local foundation evidence,
not a deployed service, live provider result or complete client parity report.
