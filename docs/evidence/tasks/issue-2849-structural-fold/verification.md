# Structural cold-build verification — 2026-10-22

Incremental CPU optimization for #2849, stacked on PR #2852 at
`bd7122ae55fa87106b607e67c0b38f5e733219b2`. This does not complete the overall
<=2.5-second p95 objective. No EC2, real S3, TLS or live provider was used.

## Candidate and behavior

- Short/Shortest keep eager Row materialization, strict casting and pre-retention
  admissions. They index schema-cast data Docs by coordinate/forecast identity and
  construct only the retained outer Docs. Current keeps its original eager merge.
- The ledger preserves the eager outer Doc and root-vector charges, including
  update-time coordinate input capacity. The index and slot metadata have at most
  4,096 keys; raw Row unknown fields do not remain in the accumulator.
- The parser moves validated Node keys/scalar Strings into Items. It retains the
  original conservative budget, unknown-field identity, page and duplicate rules.
- No cache lifetime, S3 representation/work count, owner/request deadline,
  admission limit, runtime flag or dependency changes.

An additional coordinate characterization caught the prototype treating NaN and
infinity as one key. The production candidate distinguishes infinities, unifies
signed zero and never looks up a NaN coordinate. Original failed tests are retained
in the local task record; they are not reported as passing.

## Checks

- Full release library: 178 passed, 0 failed, 0 ignored. Includes differential
  revision/fence/order/retention, invalid-date stopping, superseded Row Capacity,
  pre-retention byte overflow, exact ledger after replacements, coordinate identity,
  DOCS count boundary and scalar/escape/duplicate/unknown-field parser cases.
- `cargo clippy --offline --release --all-targets -- -D warnings`: passed.
- Existing functional smoke: seed, diagnostic and HTTP exited 0. Three diagnostic
  phases each matched all 13 view goldens. Three native HTTP phases matched the
  reference body. Owned peer exited; source hashes remained unchanged.
- Focused forecast-cache integration: 5 passed, 0 failed. Whole-workspace tests
  are delegated to the existing CI and reported in the PR before readiness.

The characterization before implementation was exercised in the earlier bounded
prototype work. The faster naive deferred variant failed the original Capacity
contract and was rejected. Its timings are not this PR's evidence.

## Final candidate timing

macOS arm64, 10 logical CPUs, release mode, original full-window synthetic corpus,
owned Python loopback S3 peer on the same host. Five interleaved fresh processes
per binary, modeled delay 0 ms; no compilation during timing. Native deadlines
remain 3 seconds per request and 8 seconds per owner.

| Run | #2852 baseline cold HTTP (ms) | Structural fold (ms) |
| --- | ---: | ---: |
| 1 | 1012 | 898 |
| 2 | 1011 | 894 |
| 3 | 1278 | 895 |
| 4 | 1010 | 899 |
| 5 | 1015 | 882 |
| Median | **1012** | **895** |

The median improvement is about 11.6%. All 30 HTTP phases (cold plus two warm
requests per process) returned 200 with the reference body. The matrix reported
no harness problems. Each cold request still used 7 forecast LISTs, 700 catalog
GETs, 700 descriptor GETs and 820 raw GETs. The small sample is not a service p95
or production-capacity claim; run 3 of the baseline was slower than its neighbors.

The baseline executable was preserved from the preceding #2852 measurement. Its
SHA matches that original manifest. `git diff 54aad593 bd7122ae -- server2/src
server2/examples/domestic_warm_cache_smoke.rs` is empty: product/example source
matches this PR's parent. Build-path/toolchain history is not identical, so the
comparison is empirical evidence on this machine rather than a controlled CPU
microbenchmark. The final candidate carries no timing instrumentation.

The earlier checked prototype's 10/20 ms fresh requests still hit the 3-second
deadline. These latency cases were not rerun for the productionized candidate;
no reliable <=3-second or <=2.5-second claim is made. Schema data and metadata
ownership changed after the prototype, so its 17.6% fold reduction is not reused
as a measurement of this candidate. No peak-memory capacity proof is claimed.

## Identities and reproduction

- Candidate smoke SHA-256: `8393a7ec55296cef5bc3b570c600d030cacfb5a9f6dabd2b23300bdc88d4722f` (22,252,504 bytes).
- Baseline smoke SHA-256: `cc165e3045bdc6ed844be0a59533722e86baa1bb151f8c8840b4bfc52c1db5e5`.
- Reference HTTP SHA-256: `a6462aba8ad9ec34d8efdcab4ccd2f37b00339a301fd17caa7c1e5485d45b283` (42,549 bytes).
- Seed manifest file SHA-256: `11606b79c26365e4ba8a5a906d5801f717845f853bafc971c2f099d27b7bbe3f`.
- `grid.rs` SHA-256: `c12f4a493213f2d6caa05363a06c047775ce4680b828edb92b7c782bff9d3aa3`.
- `grid_fold.rs` SHA-256: `21bad66fe8fdea8a8eec5ef4eb8aae9d36c65c47e16725233d759279c67a5848`.
- `items.rs` SHA-256: `cbaf7a4799fb824edd7053e5f30cb0552b504a33108041f58d5d6fb066761a6f`.
- `forecast_cache.rs` SHA-256: `085ee9707c221a85e3fa544beebe39a0f2edabeac5232aba0ad571a84b166ae9`.

From `server2/`, use the pinned Rust toolchain and an ignored, owned target:

```sh
cargo test --offline --release --lib -- --test-threads=2
cargo test --offline --release --test domestic forecast_cache -- --test-threads=2
cargo clippy --offline --release --all-targets -- -D warnings
cargo build --offline --release --example domestic_warm_cache_smoke
python3 tools/domestic_warm_cache_smoke.py --binary <copied-smoke> --output <new-report-dir> --build-variant release --modes seed diagnostic http
python3 tools/cold_build_matrix.py --binary base=<copied-parent-smoke> --binary fold=<copied-candidate-smoke> --output <new-report-dir> --delays 0 --runs 5 --modes http
```

Full manifests, original failed/corrected logs, binary and matrix records are kept
in ignored task reports. This selected record and the reusable repository runners
remain sufficient to understand and reproduce the comparison after CI artifacts
expire. Rollback is this child PR only; no stored-data migration is required.
