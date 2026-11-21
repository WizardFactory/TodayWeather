# Spec: server2 granular KMA weather warning zone matching — issue 3085

Revision 3, 2026-11-21. Consumes [intent/issue-3085.md](../intent/issue-3085.md) r1 and mirrors `#3084` (`specs/issue-3084.md`) under the `server2` placement contract ([server2.md](../docs/architecture/server2.md#implementation-placement)).

## Placement declaration

Declared in `server2/config/tasks/Issue3085.json`:
- `server2/` paths: `server2/config/tasks/Issue3085.json`, `server2/src/warnings/data/kma_warning_subzones.json`, `server2/src/warnings/data/PROVENANCE.md`, `server2/src/warnings/zones.rs`, `server2/tests/warnings/legacy.rs`, `server2/tests/warnings/golden.rs`, `server2/tests/warnings/recovery.rs`, `server2/tests/warnings/seed.rs`, `server2/tests/warnings/fixtures/oracle-expected.json`, `server2/tests/warnings/fixtures/PROVENANCE.md`, `server2/tests/delivery/warnings.rs`, `server2/tests/domestic/parity.rs`, `server2/tests/domestic/recorded.rs`.
- Outside paths (documentation only): `intent/issue-3085.md`, `specs/issue-3085.md`, `plans/issue-3085.md`, `docs/architecture/server2.md`, `docs/architecture/diagrams/server2-warning-push.json`, `docs/architecture/diagrams/server2-warning-push.html`.
- Zero runtime imports, includes, symlinks, or file reads into `server/`.

## R1 Embedded sub-zone data (`server2/src/warnings/data/kma_warning_subzones.json`)

- Byte-identical copy of the KMA 2026-06-01 235-zone mapping dataset (`warning_zone_detailed_guide_2.pdf`, SHA-256 `eaf04636385cfc475dc2f7c6d5980ce00e8383f4c2442e6c6a5b61a9d5e38086`), embedded via `include_str!("data/kma_warning_subzones.json")` and recorded with its SHA-256 in `server2/src/warnings/data/PROVENANCE.md`.

## R2 Rust `ZoneTable::zones_for_town` (`server2/src/warnings/zones.rs`)

- Mirrors `specs/issue-3084.md` R2/R3 step-for-step:
  1. Trim `first`, apply `PROVINCE_ALIASES`, and classify `전남광주통합특별시` into `광주광역시` or `전라남도` using the exact district table ported from `#3078` (unrecognized/empty returns `vec![]`).
  2. Trim `second` and strip ECMAScript `\s` whitespace (`js::collapse_space(trim(&town.second), "")`, matching JS `trim().replace(/\s+/g, '')` so `U+FEFF` is removed and `U+0085` is preserved), trim `third`, extract `third_base = third.split('/').next().unwrap_or("").trim()`.
  3. If `second.is_empty() && third_base.is_empty()`, return `self.expand(&[province])`.
  4. Resolve `(province.name, second, third_base)` against `SubzoneTable::shared()` (`township_splits` first — exact `by_third` lookup only, falling back to `fallback` for empty or unrecognized `third_base` with no blind suffix narrowing and before substring `ISLAND_ZONES`, including external island sub-zones on empty/unrecognized `third_base` for 제주시/옹진군/신안군/여수시 — else `district_splits`). Expand matched zone IDs via `self.expand(&matched)`.
  5. Else apply `ISLAND_ZONES` (`울릉` -> `울릉도.독도`, plus legacy non-canonical second fallbacks).
  6. Otherwise fall through to existing `second.is_empty()` / `city_zones` + `SHARED_ZONES` / cross-province / metropolitan fallback logic.

## R3 Consumers, tests, and oracle parity

- `special_info_for` and `server2/src/push/deliver/warnings.rs` consume `ZoneTable::zones_for_town` unchanged.
- Update `server2/tests/warnings/recovery.rs` (Seoul `L1100200` query town `노원구` + negative check for `종로구`), `server2/tests/warnings/golden.rs` (if needed when `domestic-special-info` reflects `L1100400`), `server2/tests/warnings/fixtures/oracle-expected.json` (regenerated against `#3084` legacy output), and add granular sub-zone + push-targeting tests under `server2/tests/warnings/legacy.rs` and `server2/tests/delivery/warnings.rs`.
