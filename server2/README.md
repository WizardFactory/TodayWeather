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

Start the foundation with `target/release/server2`; defaults are public loopback3002
and metrics loopback3003. Use the [foundation operator manual](../docs/operations/server2-foundation.md)
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

No local serving persistence or shared-instance cache is introduced. Library S3
and funded provider adapters are explicit capabilities, not startup deployment or
production activation. S10 smoke uses owned loopback peers only:

```sh
python3 tools/gateway_smoke.py --binary target/release/server2
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
