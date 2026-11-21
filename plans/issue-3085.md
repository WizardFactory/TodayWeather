# Plan: server2 granular KMA weather warning zone matching — issue 3085

Revision 1, 2026-11-21. Consumes [intent/issue-3085.md](../intent/issue-3085.md) r1 and [specs/issue-3085.md](../specs/issue-3085.md) r1.

## Ordered work

1. Add task placement declaration `server2/config/tasks/Issue3085.json`.
2. Embed provenance-recorded copy `server2/src/warnings/data/kma_warning_subzones.json` and update `server2/src/warnings/data/PROVENANCE.md`.
3. Update `server2/src/warnings/zones.rs` to parse `SUBZONE_TABLE` via `OnceLock<SubzoneTable>`, classify `전남광주통합특별시`, and resolve sub-zones in `ZoneTable::zones_for_town` with exact parity to `#3084`.
4. Update `server2/tests/warnings/legacy.rs`, `server2/tests/warnings/recovery.rs`, `server2/tests/warnings/golden.rs`, `server2/tests/warnings/seed.rs`, `server2/tests/warnings/fixtures/oracle-expected.json` (and `PROVENANCE.md`), `server2/tests/delivery/warnings.rs`, and `server2/tests/domestic/{parity,recorded}.rs` to cover Tier A/B/C separation, fallbacks, 116 split-leaf integrity, Seoul `서울동북권`+`서울서남권` push targeting, and narrowed Seoul sub-zone domestic assembly.
5. Run `python3 server2/tools/check_placement.py --root . --declaration server2/config/tasks/Issue3085.json --base $(git merge-base HEAD origin/master)`, `python3 server2/tools/test_placement.py`, and `python3 scripts/check-artifact-policy.py --staged`.
6. With AK-authorized pinned Rust `1.99.0`: run `cargo fmt --check`, `cargo clippy --locked --workspace --all-targets -- -D warnings`, `RUST_MIN_STACK=8388608 cargo test --locked --workspace`, `cargo build --locked --release` (+ `--example loopback_server`), integrated release smokes (`tools/smoke.py`, `tools/kma_smoke.py`), push branch `feat/3085-server2-warning-subzones`, open PR to `WizardFactory/TodayWeather` `master`, verify CI + independent PR review, and record `merge-ready` receipt (`merge_authorized: false`).
