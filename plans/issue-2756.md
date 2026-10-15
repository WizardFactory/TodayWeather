# AirKorea image recovery implementation (#2756)

## Scope and sequence

1. Preserve dated read-only diagnosis and characterize current PM10/PM2.5 GIFs locally; downloaded binaries stay in ignored reports.
2. Add failing isolated image regressions. Implement a versioned layout/legend/date helper under `server/lib/`, update config defaults, image parser and AirKorea station decoding/writer only.
3. Verify synthetic GIF decode, controller storage/readback, rejection-before-write, existing AirKorea regression suites, Node 16 compatibility and replay of the two current GIFs.
4. Update collection architecture, operations/evidence and the affected Archify source; regenerate and validate artifact/browser/visual output. Publish a concise outcome on the explicitly requested issue. No production rollout or source-selector change.

Intended implementation paths: `server/lib/airkoreaImageLayout.js`, `server/config/config.js`, the existing AirKorea parser/controllers and `server/test/offline/` tests/runner/docs. Outside implementation: this intent/spec/plan, maintained `docs/architecture/`, `docs/operations/`, selected `docs/evidence/` and existing diagram JSON/HTML. No `server2/` or unrelated package changes.

Generated-state wiring: add the exact weather-collection Archify delivery sidecar
to root `.gitignore`, matching the existing mobile diagram exclusion. This keeps
active provenance/recovery metadata locally without committing generated state.

Pre-merge amendment: AK authorized commit/push/PR/CI and independent review after
the local result. Preserve the same branch, worktree and execution plan. The existing full offline runner already covers the image regression on Node22;
add its command to the existing Node16 job in `.github/workflows/gather-offline.yml`
so CI exercises it on both supported runtimes; this is shared CI wiring only, with all test
logic under `server/`. Commit/push only intended task files. Required reviewer is
an isolated alternate-provider context with verified model/medium/auto settings;
also attempt the installed policy's optional Grok/Gemini reviewers. Apply selected
findings, renew relevant evidence and review until PASS; do not merge or deploy.

## Scenarios and acceptance mapping

| User / goal | Prerequisites and ordered actions | Expected outcome / failure | Coverage |
| --- | --- | --- | --- |
| Gather operator: store current image forecasts | Current supported GIFs and station coordinates; fetch paths, decode frames, derive stations, write and read isolated store | 48 nonnegative finite hourly values for a station with recognized colours, correct KST text/UTC instants | Synthetic decode-to-store/read regression and current-GIF smoke |
| Gather operator: preserve explicit calibration | Set explicit geometry, decode matching input; repeat with mismatched/invalid config or altered image | Explicit values honored; invalid/unknown input rejected before writes | Override, shape, bounds, legend and no-write regressions |
| API consumer: read stable hours | Replay an animation reused by a later original publication under different host clocks/zones | Same dates from image issue path, no wall-clock relabelling; missing colours omitted | Date rollover/TZ and unknown-pixel regressions |
| Release operator: assess readiness | Read evidence and runbook; reconcile private config, validate decoder, deploy only with separate authorization, inspect scheduled logs/store/readback | Local evidence distinguished from production recovery; rollback available | Maintained runbook and evidence/link checks |

## Risks, rejected alternative and rollback

The riskiest part is accepting a geometrically valid image with incorrect colour/date/geographic interpretation. Changing only height was rejected after current-image inspection exposed map/palette drift. Fail closed on unsupported geometry/legend/path; retain the inherited geographic approximation as an explicit limitation and verify sampled locations. Future label-only provider changes require recharacterization. Quantization uses lower thresholds and can understate values within a bin; document this rather than claiming exact concentrations.

Roll back the scoped code and private operator configuration through the existing deployment procedure. Do not delete production rows automatically. Existing valid observations/original forecasts and KAQ behavior remain independent.

Execution ledger: `.planning/2026-10-15-airkorea-image-runtime/`; generated runs: `reports/airkorea-runtime-20261015/`. These local paths are recovery metadata, not maintained dependencies.

Review correction: apply REQ-1 (valid counterpart in both invalid-path loops and missing-path cases), REQ-2 (document paired rejection and remove dead guards), and REQ-3 (clarify characterized size and remove unused parser helper). Preserve existing runtime behavior; renew regression, mutation-oracle check, real-GIF smoke and independent review.
