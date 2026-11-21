# Intent: server2 granular KMA weather warning zone matching — issue 3085

Revision 1, 2026-11-21. Owner: main agent for AK. Source: sub-issue [#3085](https://github.com/WizardFactory/TodayWeather/issues/3085) of [#3084](https://github.com/WizardFactory/TodayWeather/issues/3084) and AK instruction: "#3084 / #3085 각각 별도 PR을 pre-merge까지 병렬 진행".

## Problem

`server2/src/warnings/zones.rs` currently mirrors legacy `#2609` Decision 8 over-warning across split metropolitan areas and split cities/counties. To maintain exact parity with `#3084` across domestic `current.specialInfo`, forecast summaries, and `server2` warning push delivery (`server2/src/push/deliver/warnings.rs`), `server2` must apply the identical KMA 2026-06-01 granular sub-zone mapping and conservative over-warn fallback rules while strictly honoring the `server2/` placement contract.

## Desired outcome and acceptance criteria

- AC1: `server2/src/warnings/data/` holds its own provenance-recorded copy of `kma_warning_subzones.json` (embedded via `include_str!`), and `server2/tools/check_placement.py` passes with zero references or runtime reads into `server/`.
- AC2: Rust tests under `server2/tests/` verify exact separation across Tier A (서울·부산·울산·광주 + `전남광주통합특별시`), Tier B (인천 pre/post-2026-07-01, 세종, 강원/경북 평지·산지, 21 directional city/county splits, `낙월면`, `위도면`, `우도면`), Tier C partial splits + safe over-warn fallbacks (empty `third`, `속초시 대포동`, `구례군` mountain townships, `강화군 서도면`, `보령시 오천면`, `군산시 옥도면`, `완도군 청산면`, 제주도), and `special_info_for` + `server2` warning push selection (`서울동북권` + `서울서남권` 건조주의보 warns `노원구`/`영등포구` and excludes `강남구`/`종로구`).
- AC3: Cross-implementation parity confirms `server2::warnings::zones::ZoneTable::zones_for_town` produces identical `areaCode` sets to `server/lib/kmaWarningZones.js` across the shared town corpus, and `cargo fmt --check`, `cargo clippy --locked --workspace --all-targets -- -D warnings`, `cargo test --locked --workspace`, and `server2` placement checks pass.

## Host capability limitation (2026-11-21)

The pinned Rust `1.99.0` toolchain (`cargo`/`rustc`/`rustup`) is not installed on this host. Per SDLC policy (never silently download tools; local verification required before commit/PR), implementation and placement checks are prepared locally, while Rust compile/test/clippy/smoke and PR publication wait for AK's authorization to install Rust `1.99.0` (or pull a Rust Docker image).
