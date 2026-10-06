# server2 foundation

S04 implements the isolated Rust host foundation, not weather API parity or cutover.
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
and metrics loopback3003. Configure only with the `SERVER2_*` environment variables
listed in the [operator manual](../docs/operations/server2-foundation.md).
Do not route production to this binary: only health is mounted, all weather paths404.

Declare task paths in `config/tasks/<task>.json` before changes and link the issue
intake declaration. CI selects the one changed declaration; local runs can set
`SERVER2_BASE` and `SERVER2_DECLARATION`. Static enforcement scans tracked layout,
Cargo local dependencies, literal resources and symlinks, plus both rename ends.
Computed filesystem paths still require human review. Existing unrelated legacy
maintenance remains allowed; this checker is for server2 tasks.

No local serving persistence, provider calls, S3 implementation, background collection,
shared-instance cache, container deployment or production changes are introduced.

Private loopback metrics omit CORS. OPTIONS/preflight and complete legacy middleware
parity are deferred to S02; this foundation does not establish client API parity.
The placement gate checks supported direct literals, with conservative rejection of
encoded Rust resource strings. Computed/aliased access and custom loaders require
manual review. It is a review aid, not an adversarial filesystem sandbox.

Compiler resource checks use comment/string-aware tokens for all include macro
delimiters and nested cfg_attr paths. Rust-wide static legacy references and direct
Path/PathBuf paths remain guarded. Executable/shebang and .bash/.zsh scripts are
also checked; compiled fixture tests require the pinned Rust toolchain on PATH.
