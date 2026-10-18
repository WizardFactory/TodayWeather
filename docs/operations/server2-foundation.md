# server2 foundation operator manual

S04 originally provided a health-only Rust foundation. Later tasks added native services;
the current operational executable rejects bare/partial startup without an explicit
development legacy origin. Health-only/partial construction remains available through
code-injected factories and examples. This manual retains foundation checks and labelled
historical evidence; it does not authorize production routing or cutover.

## Build and check

Prerequisites: pinned Rust 1.99.0 with rustfmt/clippy, Python 3.11+, and an isolated
checkout. Cargo may download public dependencies. The isolated smoke below uses only
health/metrics and a closed-loopback development origin; it makes no provider request.
This does not describe ordinary push-enabled main, which starts supervised work.

```sh
cd server2
cargo fmt --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo build --locked --release
python3 tools/smoke.py --binary target/release/server2
```

The smoke starts two sequential release processes on ephemeral loopback ports (`PORT=0`)
in an empty working directory with an explicit closed-loopback development legacy origin,
so no real `server2/.env` is read. It checks GET/HEAD health, rejects public metrics, reads
private counters, and tests the existing gateway-enabled 12-second incomplete-header
timeout with elapsed bounds, socket-cap (128) rejection/recovery, and both idle and
partial-header SIGTERM shutdown. It also verifies that an invalid legacy `PORT` fails startup.
No legacy collectors run.

## Configure and operate

Before starting `server2/target/release/server2`, provide complete native coverage
(`geocode,dsf,kma,kma-v000901,kma-v000902,town,push,notice` and all three world versions)
or an explicit development `SERVER2_GATEWAY_LEGACY_URL`. Selecting `push` starts supervised
delivery and warning acquisition after both listeners bind. Do not use real credentials
or endpoints for isolated verification. Use the smoke's allowlisted development
configuration, not a private legacy `.env`; see the [runtime-services contract](server2-runtime-services.md).
Bare configuration fails before services/listeners. `.env` is optional when required process settings are complete;
missing mandatory settings fail and the file never substitutes for validation.
S10e (#2753): the process
reads its environment and then `.env` in the working directory (a copy of the legacy
`server/.env`, see [server2/.env.example](../../server2/.env.example)) with the legacy dotenv
rules; a process variable wins over the file. The listener follows legacy `config.js`: address
`OPENSHIFT_NODEJS_IP` (default 127.0.0.1), port `OPENSHIFT_NODEJS_PORT`, else `PORT`, else 3000.
Private metrics listen on the loopback address at the next port (an ephemeral port with port 0).
Startup prints the two bound socket addresses. Invalid values and listener collisions fail
startup. During coexistence on the legacy host, give server2 a port other than the legacy
origin's (for example `PORT=3002` in the process environment, metrics 3003).

Process limits are built in; no setting changes them (the S04 `SERVER2_*` overrides were removed
in S10e because legacy has no equivalent and no documented operation needs another value):

| Limit | Built-in value | Removed S04 variable |
| --- | --- | --- |
| Worker threads | 2 | SERVER2_WORKER_THREADS |
| Blocking threads | 4 | SERVER2_BLOCKING_THREADS |
| CPU permits | 2 | SERVER2_CPU_LIMIT |
| In-flight requests | 40 | SERVER2_INFLIGHT_LIMIT |
| Volatile cache bytes | 16777216 | SERVER2_CACHE_BYTES |
| Public connections | 128 | SERVER2_CONNECTION_LIMIT |
| Connection lifetime | 9 seconds; 12 with the gateway enabled | SERVER2_CONNECTION_SECONDS |

Metrics connections have a separate fixed limit 16. Socket limits bound slow headers
and body draining; a connection expires at its maximum age even with keep-alive.
This is an absolute connection lifetime, distinct from the S10 per-request
9-second gateway deadline. With the gateway (complete-native or explicit development
coexistence), the lifetime is 12 seconds, which keeps the deadline `501` inside the connection lifetime
([#2730](https://github.com/WizardFactory/TodayWeather/issues/2730)). The guarantee covers a
request that starts within lifetime minus 9 seconds of the connection being accepted; a later
keep-alive request can still outlive its connection. Without the gateway, code-injected partial foundations retain the 9-second lifetime
and socket behavior; bare operational main no longer starts that foundation.
The foundation cache is a single byte-bounded slot; keyed/sharded cache algorithms
are S07. CPU permits remain reserved until blocking work ends after caller cancellation.

```sh
curl -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3001/internal/metrics
```

Health returns 200 with exact body OK, text/html; charset=utf-8 and CORS *. HEAD returns 200,
no body, Content-Length 2. Public /internal/metrics returns 404. Private metrics
returns 200 and no-store, without CORS access, with only finite counters and declared limits.
OPTIONS /health currently returns 405; legacy CORS preflight (204), session-cookie
and complete middleware-header parity are deferred to S02 and not asserted here;
S02 freezes the complete legacy oracle before route ports. In the health/metrics smoke
with no push writer or delivery workers, SIGTERM/SIGINT drain both listeners for at most 5 seconds; a signal-triggered timeout logs a forced stop
and exits successfully. Startup, signal-registration and unexpected serving failures
remain unsuccessful. Tokio
runtime shutdown then waits at most 1 second for blocking work, including error
paths, giving a total shutdown bound of 6 seconds plus scheduling overhead. A CPU
closure may outlive that wait until process exit; this does not claim a durable S3
or provider drain. Push-enabled main follows the shared 34-second drain plus up to
one-second teardown in the [runtime-services contract](server2-runtime-services.md);
the smoke's 6-second bound is not that operational guarantee.

## Enforce placement before task completion

Declare owned directories and exact outside exceptions in config/tasks/<task>.json
before editing and link the issue declaration. Use an exact reviewed task base:

```sh
cd server2
python3 tools/check_placement.py --root .. --declaration config/tasks/S04.json --base <exact-task-base>
python3 tools/test_placement.py
```

The gate scans full tracked server2 files, Cargo paths, symlinks and both rename
ends. Rust checks cover include*/path/cfg_attr (all delimiters and comment separators)
and direct read/read_to_string/read_dir/open/create/Path/PathBuf strings. Plain/raw and
borrowed/parenthesized literals are supported; encoded or unsupported compiler
arguments reject. Source-relative compiler paths are verified owned separately
from runtime-CWD paths. Other Rust literals retain the legacy/sibling path guard,
including Command arguments. Char/byte-char escape tokens and lifetimes stay aligned;
ambiguous apostrophes reject incomplete.

Python executable-call AST, decoded JSON/TOML and shell/deploy paths are checked,
including executable/shebang and .bash/.zsh scripts. Only validated task outside.path
identities and exact test_placement.py self.write/fixture_symlink data roles are
exempt; executable calls, runtime fields and invalid declarations still reject.
Root Cargo and undeclared outside implementation reject. Git/JSON/TOML failures
are incomplete checks. Binary executables, computed/aliased paths, custom loaders
and macro-generated runtime access need human dependency/provenance review. These
literal checks are a review aid, not an adversarial sandbox. The original S04 workflow
used checkout@v4/full history and one owned CI command with a 30-minute timeout on
server2-related PRs. That is historical setup; inspect the maintained
[workflow](../../.github/workflows/server2.yml) for current triggers and limits. Remote
branch protection is not configured by this task.

## Historical foundation usage capture (pre-#2819)

This historical [capture](../evidence/tasks/server2-foundation/usage.png) comes from the
2026-10-06 release smoke on ephemeral ports. Its
[manifest](../evidence/tasks/server2-foundation/manifest.json) records platform and
binary/capture hashes. This is local foundation evidence; providers, deployment
and full client parity were not exercised.

The [companion PDF](server2-foundation.pdf) and this capture predate the #2819 startup
guard and are not current startup proof. They were not regenerated for this correction.
Use this editable guide and the [current E1/E2 evidence](../evidence/tasks/issue-2819-startup-coverage/verification.md)
for the complete-configuration and isolated-smoke boundaries.
