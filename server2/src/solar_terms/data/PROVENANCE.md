# Solar-term embedded assets provenance

All files in this directory are owned by `server2` and embedded at compile time via `include_str!`.

## `kr.json`
- Content: Version 1 Korean editorial priority groups for the 24 solar terms (`featured`: 6, `spare`: 9, `calendar`: 9), keyed by stable ecliptic longitude IDs (`solar-0`..`solar-345`).
- Source: Issue #3050 / PR #3070 (`e271d8e3`), mirrored verbatim into `server2`.
- License: Repository MIT license.

## `published.json`
- Content: Independently checked official Korean almanac (월력요항) identity, source URL, PDF SHA-256 digest, and 24 KST civil dates for 2026 and 2027 cold starts.
- Official public sources:
  - 2026 edition: KASA Notice `2025-0044`, published 2025-06-30, electronic gazette PDF SHA-256 `6b42224a6a993e846426a20a841dbe3e5e1bc7436142786b969fcc0df4852aff`
  - 2027 edition: KASA Notice `2026-0078`, published 2026-06-29, electronic gazette PDF SHA-256 `10412c8632ab2e8e9937cbd3a8fa6ee184e08cbd9aa541dd4d44229cb11a67b3`

## `astro.rs`
- Algorithm: Pure-Rust port of CosineKitty Astronomy Engine `2.1.19` (`SearchSunLongitude`, Earth VSOP87 truncated series, IAU 2000B nutation, precession, Espenak–Meeus Delta-T).
- Upstream: https://github.com/cosinekitty/astronomy (MIT License, Copyright (c) 2019-2025 Don Cross).
