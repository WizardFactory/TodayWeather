# SR-3 verification: provider rejections are evidence; storage authorization stops (#3001)

Revision `76d1d17e`, stacked on SR-2 (`1554bccd`) over master `ca3eb0f2`. Run on 2026-11-16: macOS with Python 3.11.15 and Rust 1.99.0 for the offline checks; a disposable Lima VM (Ubuntu 24.04 aarch64) for the Linux check, with server2 built in the VM from this branch. Nothing contacted AWS, a provider or production.

## Behaviour

- **Server (opt-in qualification metrics).** `server2_runtime_provider_http_rejections_total{source,status}` counts each provider HTTP 401, 403 or 429 response once, under a fixed source: each data.go.kr API (from the request URL), `data_go_kr_other`, `visual_crossing`, and the keyless public hosts `public_kma_web`, `public_airkorea_web`, `public_mfds`, `public_other`. `server2_runtime_storage_auth_failures_total` counts authorization failures recorded by the S3 (including instance credentials), budget-object (`quota`), history and summary components. Existing counters are unchanged.
- **Guard.** Provider auth/quota counts and local paid-budget exhaustion never stop the run; the latest counts, including per-source rejections (`provider_http`), are kept in the decision diagnostics (schema 5). At 20 storage/credential authorization failures the guard stops with `s3_authorization`; below that it continues.
- **Vocabulary.** The guard's source set equals the labels of `allowance.rs` `source_label` (a test reads the Rust source, as it already does for components, stages and providers).

## Checks

- Red first (retained locally): guard/supervisor tests 9 failures and 4 errors, simulator subset 7 failures and 1 error. Green: `test_shadow_supervisor.py` and `test_shadow_simulation.py` OK; `cargo test --lib` 245 passed (the allowance wire tests check one count per response, the storage counter and the rendered lines); `cargo clippy --lib --tests -D warnings` and `rustfmt --check` clean. The Rust wire test came with the implementation from the preserved patch, so no separate Rust red run exists.
- Linux check (`server2/deploy/shadow/linux_check.py`, six scenarios, server2 SHA-256 `80e5bcb7…` built in a fresh VM from `59da7d9e`; `76d1d17e` changes only the check's expectations): provider-rejection 27/27, storage-authorization 15/15, config-change 12/12, frozen-guard 11/11, collector-broken 6/6, tampered 2/2; overall PASS. Report: [linux-check.json](linux-check.json).
  - `provider-rejection`: the providers' 401 was counted by the guard 10.1 s after start (first rejection `geocode`, a geocoding provider, so `provider_http` stays empty); no stop, all acquisition units active 30 s later; the candidate's rejection record, the reader's summary and the collector's records reached the destination; the guard ships no record without a stop.
  - `storage-authorization`: once the run's data buckets answered 403, the guard stopped with `s3_authorization` after 165.3 s (storage count 20, first rejection from the budget object); its stop record and the candidate's authorization records were shipped.
  - The first run at `59da7d9e` failed two expectations of the check itself (a guard record without a stop; storage denial only from the `s3` component); both were corrected in `76d1d17e` and the rerun used the same binary.
- Placement gate with `server2/config/tasks/ShadowSignals3001.json` and artifact policy: PASS.

## Simulation against SR-2

20 seeds per scenario at `76d1d17e` (Python 3.11.15, one process per scenario); summary [simulation.json](simulation.json) (full per-seed report SHA-256 `7fdad400bf28fa7f265fa76d3f045185bc39e62a76b466e7f38f8611179e9f8d`, retained locally). SR-2 values are from `1554bccd`.

| Scenario | Full runs /20 (SR-2) | Median hours (SR-2) | Evidence retrievable /20 (SR-2) | First stop cause |
| --- | --- | --- | --- | --- |
| `ideal` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `observed-quota-at-3min` | 20 (0) | 168.0 (0.05) | 20 (20) | `guard:collection_deadline` 20 |
| `shared-key-daily-429` | 20 (0) | 168.0 (14.925) | 20 (20) | `guard:collection_deadline` 20 |
| `production-429-1e-4` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `production-transient-1e-3` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `poll-failure-1e-4` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `poll-failure-1e-3` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `sample-failure-1e-5` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `mac-sleeps-night-1` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `operator-ip-change-day-3` | 20 (20) | 168.0 (168.0) | 0 (0) | `guard:collection_deadline` 20 |
| `tx-observed-early-rate` | 0 (0) | 27.739 (27.739) | 20 (20) | `guard:network_ceiling` 20 |
| `s3-measured-high` | 0 (0) | 45.0 (45.0) | 20 (20) | `guard:s3_allowance` 20 |
| `candidate-exit-day-3` | 0 (0) | 60.0 (60.0) | 20 (20) | `candidate-exit` 20 |
| `storage-auth-broken-role` | 0 (—) | 3.0 (—) | 20 (—) | `guard:s3_authorization` 20 |
| `realistic-combined` | 20 (0) | 168.0 (14.925) | 20 (20) | `guard:collection_deadline` 20 |

Provider quota scenarios (`observed-quota-at-3min`, `shared-key-daily-429`) and `realistic-combined` now reach 168 hours in 20 of 20 seeds; the new `storage-auth-broken-role` scenario stops at the first sample after the role breaks. Remaining stops belong to later slices: transmit and S3 rates to SR-4; the address change still loses the evidence (SR-5). A candidate exit still ends the run, by design.
