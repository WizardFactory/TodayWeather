# Plan: Granular KMA weather warning zone matching — issue 3084

Revision 1, 2026-11-21. Consumes [intent/issue-3084.md](../intent/issue-3084.md) r1 and [specs/issue-3084.md](../specs/issue-3084.md) r1.

## Ordered work and file operations

1. **Authoritative data (done & audited)**: `server/utils/data/kma_warning_subzones.json` — add official 2026-06-01 KMA 235-zone sub-zone mapping with PDF SHA-256 provenance.
2. **TDD Red (`server/test/offline/kma-warning.test.js`)**: Add failing tests covering AC1–AC3 (Seoul 4-zone separation, Busan/Ulsan/Gwangju+`전남광주통합특별시`, Incheon pre/post-2026-07-01, Sejong, 강원/경북 평지/산지, directional splits, named island townships, straddling/altitude/리-level over-warn fallbacks, and full 3,689-row `areaNoKma.csv` invariant audit). Run to observe intended Red failures before editing implementation.
3. **Implementation (`server/lib/kmaWarningZones.js`)**: Load `kma_warning_subzones.json`, implement ES5/Node 10-safe `resolveSubzones` in `zonesForTown` per Spec R2/R3 while preserving all ancestor expansion and fallback invariants.
4. **Update affected legacy assertions & add smoke scenario**:
   - `server/test/offline/kma-warning.test.js`: update old Decision 8 over-warn assertions (`강남구`, `파주시 문산읍`, `서귀포시 성산읍`) to reflect granular matching + add empty-`third` over-warn assertions.
   - `server/test/offline/kma-warning-node10-check.js`: update `서귀포시 성산읍` assertion and add Seoul `서울동북권` vs `서울동남권` Node 10 check.
   - `server/test/offline/kma-warning-smoke.js`: update `서귀포시 성산읍` expectation and add real end-to-end Seoul 건조주의보 (`서울동북권`+`서울서남권` active → `노원구`/`영등포구` get `건조주의보` in `specialInfo` & summary, `강남구`/`종로구` do not) + `pushCoordinator/region.js` verification.
5. **Docs update**: Update `specs/issue-2609.md`, `docs/rewrite/server-response-assembly.md`, and `docs/architecture/push-s3-design.md`.
6. **Verification & pre-merge**:
   - TDD Red → Green → full offline suite (`test:offline`)
   - Docker `node:10.15.3-stretch` check (`kma-warning-node10-check.js`)
   - Real Docker `mongo:3.4.15` smoke (`kma-warning-smoke.js`)
   - `python3 scripts/check-artifact-policy.py --staged`
   - Commit, push `feat/3084-kma-warning-subzones`, open PR to `WizardFactory/TodayWeather` `master`, observe CI, run independent PR review, resolve findings if any, record `merge-ready` receipt (`merge_authorized: false`).

## Risks and rollback

- Risk: stale township names in `areaNoKma.csv` or future administrative renames could miss an exact match. Mitigation: all `areaNoKma.csv` historical names audited to 0 unexpected fallbacks, `dong_default`/`other_default` handle newly created dongs, and unknown names conservatively fall back to all child zones (never under-warn).
- Rollback: reverting the PR restores the single-file `#2609` Decision 8 behavior with no schema or stored-data migration needed.

## User scenarios

Canonical structured scenarios live in `reports/sdlc/issue-3084/user-scenarios.json` covering US1–US5 mapped to AC1–AC5.
