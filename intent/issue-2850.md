# Forecast view retention (#2850)

Source: [#2850](https://github.com/WizardFactory/TodayWeather/issues/2850).
Baseline: PR #2841 at `307defeb706886217ab67ea858dc7c7b0435752f`.
AK requested SDLC implementation on 2026-10-22 and selected PR creation, independent
review and CI, excluding merge. Work stacks on `fix/domestic-warm-cache-2819`.

A forecast view should survive until an input or pure selector can change it.
Replace global invalidation and repeated full rebuilds with key-local writer
fences, selector-boundary expiry, inexpensive authoritative identity checks and
bounded disposable SSD restoration. Response bytes, original summary identities,
own-write overlays and caller/owner deadlines remain compatible.

Acceptance:
- **AC1:** An acquisition affects only its grid/family, RSS grid or mid key.
  Unrelated towns reuse memory with no raw read/parse/fold; cancellation and panic
  cannot install a stale affected view.
- **AC2:** Reuse crosses arbitrary minutes up to the exact next relevant pure
  selector/future-fetch boundary. Wall rewind misses. All 13 goldens retain bytes.
- **AC3:** External changes become visible within an explicit bounded delay.
  Unchanged authoritative identities renew without raw GET, parse or fold; changed
  identities rebuild. Document the delay and S3 control request cost.
- **AC4:** Evicted and process-restart views restore from hash-verified, bounded
  disposable disk only after authoritative identity validation. Missing, corrupt,
  stale, schema-mismatched and over-cap files rebuild. Measure all 13 serialized
  views, restoration and memory/8 GiB capacity; preserve HTTP bytes.
- **AC5:** Update D2 architecture, operator instructions and Archify source/output;
  no verification runtime flag or legacy dependency. Audit placement/dependencies.

S3 stays authoritative. No durable normalized-weather store, provider behavior
change, API/UI feature, new cloud resource, real S3/provider call, production
operation, merge, auto-merge or queue enrollment is authorized. Disk remains opt-in
through the existing local-cache configuration, with the existing shared cap and
ownership rules. Single API process first; distributed invalidation is excluded.

## Placement declaration (before implementation)

Implementation: `server2/src/domestic/kma/source/forecast_cache.rs`,
`server2/src/domestic/kma/source/forecast_manifest.rs`,
`server2/src/domestic/kma/source/forecast_disk.rs`,
`server2/src/domestic/kma/source/records.rs`,
`server2/src/domestic/kma/source/mod.rs`,
`server2/src/domestic/kma/source/doc.rs`,
`server2/src/cache/disk.rs`, `server2/tests/domestic/forecast_cache.rs`,
`server2/tools/kma_cache_measure.py`. If shared serialization is necessary,
`server2/src/summary/mod.rs` may add traits only; no summary behavior change.
Tests may live alongside these modules. No dependency addition is planned.

Outside paths: this intent, `specs/issue-2850.md`, `plans/issue-2850.md` and
`plans/issue-2850.scenarios.json` retain canonical task contracts;
`docs/architecture/server2.md`, `docs/operations/server2-domestic-cache.md`,
`docs/architecture/diagrams/server2-domestic-cache.json` and its generated `.html`
maintain the affected lifecycle; `docs/evidence/tasks/issue-2850/verification.md`
retains selected measurements/reproduction and review references. Generated state,
logs, captures and notebook remain ignored under `reports/sdlc/issue-2850/`,
`.planning/2026-10-22-issue-2850-forecast-cache-retention/` and `.archify/`.
Path changes must be declared before dependent edits.

Risks: catalog/build races, writer ABA after state eviction, clock boundaries,
non-finite document values during serialization, shared disk-cap contention and
restore memory admission. Verify each with isolated dependencies; local evidence
cannot establish t3.small or production performance.
