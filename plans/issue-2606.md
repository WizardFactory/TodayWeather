# Plan: #2606 direct CloudFront → tw-svc

Inputs:
- [intent](../intent/issue-2606.md)
- [spec](../specs/issue-2606.md) (revision 12)
- [test scenarios](../specs/issue-2606-test-scenarios.md)
- design diagram `reports/sdlc/issue-2606/design/gateway-direct-origin.{json,html}`

This plan defines the work; none of it is executed here.

## Ordered work

1. **Fixtures and failing tests.** Create `server/test/offline/fixtures/gateway/` (provider responses, per-version backend samples, parity goldens from tw-backend-functions `a4c1deb` with the command in a README). Write U-*, RT-* and IC-2 as failing tests and add them to `server/test/offline/run.js`. Add the RT dependencies to the offline CI workflow.
2. **Geocoder and cache:** `server/lib/geocoder/{index,format,kakao,google,keys,transport,cache}.js` and `server/models/modelGeocodeCache.js` (spec §3.4–§3.6). U-* green.
3. **Router and internal callers:** `server/routes/gateway.js` and the mount line in `server/app.js` (spec §3.1, §4.1, §5.3); the four URL changes (spec §4.2) and the existing tests that assert the old URLs (IC-3). RT-* and IC-* green.
4. **Local smoke:** LD-1 (`gateway-local-smoke.js`).
5. **Parity script:** `scripts/gateway-parity.mjs` (read-only) for DO-* and PC-1.
6. **Config inventory:** add the new environment names to `docs/rewrite/configuration-inventory.md` (DOC-0).
7. **PR and review** per the repository SDLC. Merging authorizes no production step.
8. **Operator steps**, each under its approval (spec §5.1):
   1. (A1) Set `GEOCODER_KAKAO_KEYS` (the 2 existing Kakao keys) and `GEOCODER_GOOGLE_KEY` (the key with fingerprint `ecd5fdb1`) on the host (OP-4).
   2. (A2) Confirm PM2 `www` runs Node ≥ 16 (`pm2 jlist`), then deploy to the service host by the patch procedure; gather and push URL changes (spec §5.2 steps 1–2); record the deployment in `docs/operations/` at this point.
   3. (A2) DO-2 first, then DO-1 and DO-3 to DO-6, including the DO-3 Lambda-era baseline; then OP-1 (the key-fingerprint line appears after a worker's first gateway request).
   4. (A3) Probe path change in `AttachEIPToSpot`; new AMIs, templates and fleets; full-map `AttachEIPToSpot` update (OP-3). CloudFront 5xx alarm with a us-east-1 topic (OP-2).
   5. (A4) Cutover with CO-1 (including the prepared RB-1 reverse edit) and CO-2; PC-1 at +5 min; PC-2 to PC-4 over 24 h. On failure, RB-1.
   6. Post-cutover docs PR (DOC-1).

## Files

| Action | Path |
| --- | --- |
| Add | `server/lib/geocoder/*.js`, `server/models/modelGeocodeCache.js`, `server/routes/gateway.js` |
| Add | `server/test/offline/gateway-{geocoder.test,route.test,callers.test,local-smoke}.js`, `server/test/offline/fixtures/gateway/**` (fixtures, `make-goldens.js`, `goldens.json`), `scripts/gateway-parity.mjs` (with `--self-test`) |
| Change | `server/app.js` (one mount line) |
| Change | `server/controllers/controllerTown24h.js`, `server/routes/v000903/route.geo.v000903.js`, `server/controllers/controllerPush.js`, `server/lib/kmaScraper.js` (versioned URLs) |
| Change | `server/test/offline/run.js`, `server/test/offline/README.md`, the offline CI workflow, and the existing tests asserting the old URLs |
| Change | `docs/rewrite/configuration-inventory.md` and the stale code statements listed in spec §7; after cutover the spec §7 topology docs |
| Outside the repository | `AttachEIPToSpot` probe path constant (spec §4.3) |

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A version answers differently from today | Per-version pass-through with no version branching and the Lambda's exact language, `loc` and retry rules (spec §2.3, §3.1); RT-2, RT-3, RT-5, U-16, DO-1 per version with real client queries and headers, PC-1 |
| Geocode output drift | Goldens (U-1–U-5); DO-2 on fresh coordinates |
| Replacement instance never receives the EIP after cutover | Probe path without geocoding (spec §4.3, DO-6, OP-3) |
| Spot replacement starts old code | New AMIs and templates before cutover (OP-3) |
| No alert after cutover | CloudFront 5xx alarm before cutover (OP-2) |
| Unrelated CloudFront settings changed | CO-1 diff; targeted RB-1 |

**Rollback:** RB-1 (edge). No code rollback is needed: after RB-1 the internal callers reach the Lambda through the public host again.

**Blast radius:** before cutover, only the four URL changes are live (same output from the Lambda). After cutover, all `weather/*` and `geocode/*` traffic.
