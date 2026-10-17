# server2

S04 established the isolated Rust host foundation. Later tasks add bounded memory,
S3 raw/catalog storage, provider budgets and an opt-in S10 gateway. None of these
changes authorizes production cutover.
All server2-owned code, configuration, dependencies, tests, tools and deployment
assets stay here. The repository root is not a Cargo workspace.

Use the pinned Rust toolchain and Python3.11+:

```sh
cd server2
cargo fmt --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo build --locked --release
python3 tools/smoke.py --binary target/release/server2
python3 tools/check_placement.py --root .. --declaration config/tasks/S04.json --base <exact-task-base>
```

Start the foundation with `target/release/server2` from `server2/`; the listener follows the
legacy `config.js` rule (`OPENSHIFT_NODEJS_IP`, `OPENSHIFT_NODEJS_PORT` or `PORT`; default
127.0.0.1:3000) and metrics listen on loopback at the next port (3001 by default). During
coexistence set another port, for example `PORT=3002` as in `.env.example` (metrics 3003). Use the [foundation operator manual](../docs/operations/server2-foundation.md)
for listener/runtime settings. By default only health is mounted and weather paths
return404. For the opt-in gateway, injected existing geocoder environment,
local mock verification and legacy rollback, follow the
[gateway guide](../docs/operations/server2-gateway.md). Native live geocoder
acquisition stays disabled; production traffic/cutover needs separate authority.

Declare task paths in `config/tasks/<task>.json` before changes and link the issue
intake declaration. CI selects the one changed declaration; local runs can set
`SERVER2_BASE` and `SERVER2_DECLARATION`. Static enforcement scans tracked layout,
Cargo local dependencies, literal resources and symlinks, plus both rename ends.
Computed filesystem paths still require human review. Existing unrelated legacy
maintenance remains allowed; this checker is for server2 tasks.

The runtime has no verification-only mode. `SERVER2_NATIVE_FAMILIES` selects ordinary
native ownership, including `geocode`, `dsf`, KMA version/town entries, `push` and `notice`.
Selected native services start without a legacy URL. An explicit
`SERVER2_GATEWAY_LEGACY_URL` retains coexistence for unselected families; with neither
selection nor legacy URL the process keeps the health foundation. Selected native
errors never forward. S20a shares one S3 transport and native dependency handles,
serves durable push registration and read-only notices, and starts no delivery loops.
See the [runtime services manual](../docs/operations/server2-runtime-services.md) and
[visually checked PDF](../docs/operations/server2-runtime-services.pdf). Since S10e the settings are the
legacy `server/.env` names and values, read from `server2/.env` in the working directory (a
private copy of the legacy file; see [.env.example](.env.example) for every variable), plus
the server2-only `SERVER2_S3_BUCKET`, `SERVER2_S3_REGION` and coexistence routing. Endpoints and
quotas without a legacy setting are built in. Since S10f, when `AWS_ACCESS_KEY` and
`AWS_SECRET_KEY` are unset or the legacy placeholder, S3 requests are signed with EC2
instance-role credentials (IMDSv2, cached and refreshed before expiry); the operator check
`cargo run --locked --release --example s3_readiness -- LABEL` (from `server2/`) proves the bucket
writes and absent-key reads with the configured credentials. See the
[gateway operations guide](../docs/operations/server2-gateway.md). The smokes run the release
`loopback_server` example (the same process with its roots on owned loopback test peers) and
the release binary in empty working directories:

```sh
cargo build --locked --release --example loopback_server
python3 tools/gateway_smoke.py --binary target/release/server2
python3 tools/world_smoke.py --binary target/release/server2
```

Private loopback metrics omit CORS. S10 consumes S02 gateway/geocode wire goldens
and implements HEAD/304/preflight; this does not establish native weather-family
ports or production parity.
The placement gate checks supported direct literals, with conservative rejection of
encoded Rust resource strings. Computed/aliased access and custom loaders require
manual review. It is a review aid, not an adversarial filesystem sandbox.

Compiler resource checks use comment/string-aware tokens for all include macro
delimiters and nested cfg_attr paths. Rust-wide static legacy references and direct
Path/PathBuf paths remain guarded. Executable/shebang and .bash/.zsh scripts are
also checked; compiled fixture tests require the pinned Rust toolchain on PATH.

Character/byte-character escapes and lifetime/label tokens remain distinct; unsupported apostrophes fail incomplete without hiding later resource calls.

Native API release recovery rehearsal: see the [operator guide](../docs/operations/server2-native-recovery.md). It uses an explicitly identified current/previous release pair and owned peers, never a legacy fallback. A passing API rehearsal does not qualify whole-service production rollback; S19/S20 remain separate gates.
