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

## AK amendment: target-host performance campaign (2026-10-22)

After the local/CI endpoint at0c163912, AK explicitly requested Seoul t3.small measurement and performance improvements like #2849, then approved the dedicated-host proposal and instructed proceeding without further questions while total spending remains below USD100. This amendment supersedes the earlier exclusion of new cloud resources only for this task's isolated benchmark resources.

Use one dedicated Linux x86_64 t3.small (2vCPU/2GiB), CPU Unlimited, at most32GiB disposable root storage and at most2hours per host. The campaign ceiling is USD100; keep an internal USD2 per-host spending stop. Temporary task-owned SSH key/security-group resources and verified termination/root-volume cleanup are included. Do not modify production hosts, IAM/account permissions or call real S3/weather/geocoder providers. Fixture services run on loopback. No merge, auto-merge, queue or production deployment is authorized.

Compare base307defeb and source-bound current/corrected candidates with the same Seoul corpus and HTTP reference. Record independent sample counts, nearest-rank p95, failures, CPU/RSS, per-phase costs and LIST/catalog/descriptor/raw operations at modeled S3 delays0/5/10/20ms. Cover empty memory, valid memory reuse, unchanged identity renewal, SSD restore after eviction/restart and selector boundaries. Product deadlines remain3s caller/8s owner; any diagnostic-only relaxed copy must be identified separately. Report the2.5s benchmark target separately from the actual3s request ceiling; do not infer target-host gains from Mac results or relabel a target miss as a runtime timeout.

Select performance fixes from reproduced costs in #2850's retention/identity/restore paths, preserve canonical S3 authority, bounded work/memory, all13view goldens and exact HTTP bytes. Compare #2849's separately owned cold-read/fold work before overlapping it. Renew affected regression/smoke checks, independent review and current CI. Keep historical completion evidence revision-bound and do not claim this extended endpoint complete until the target measurements, selected fixes and task-only resource cleanup are verified.
