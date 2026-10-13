Task: issue-2704-s19; owner: S19 builder (Claude); revision/base: ca8735cf937a634e7af57396d605e26db8bfc4ff; date: 2026-10-13.
Authority: AK authorized S19 (#2704) on 2026-10-13 as part of the server2 sequence after S10; endpoint pre-merge (reviewed, unmerged PR).
Criteria: SMOKE, METRICS, REPLAY, ROLLBACK, PLACEMENT.
Issue update assessment: intake declaration posted before dependent edits; one status comment after PR readiness.

# Intent

Give the server2 cutover work (S20, S10a) one repeatable local verification path per family. This first increment covers the gateway/geocode family only. The tooling is structured so S11/S12/S13 families add a module rather than a new harness.

- SMOKE: `server2/deploy/smoke.sh` drives the actual release binary with a local S3-compatible peer and recorded provider/legacy peers. It covers cold, warm and empty-memory restore; outages; budget exhaustion; cancellation; memory/admission pressure; Spot-style drain; and switches.
- METRICS: the smoke asserts process metrics and peer counters. It shows no unnecessary provider or legacy work (single-flight, warm hits and no work after rejection). It also shows correct failure counters. The gateway family performs no S3 publication, and the smoke asserts that no request reaches the S3 peer.
- REPLAY: offline paired replay runs the same frozen workload against a baseline and a candidate configuration. It classifies every difference as declared (with a reason) or unexplained, and records revision, binary, workload, cold/warm percentiles and acquisition counts. Any unexplained difference makes the run fail.
- ROLLBACK: a cache-aware rehearsal moves `/weather` and `/geocode` together through legacy -> native(mock) -> legacy. It preserves Cache-Control, ETag/304 validity across the switch, no-store errors and the 9s/5s/3s deadline contract, and it reports the empty-memory re-acquisition cost after each restart.
- PLACEMENT: all paths match `server2/config/tasks/S19.json`; there are no legacy runtime imports or reads.

In scope: tooling, tests, an additive aggregate metrics hook, operator guide/PDF with actual capture, the cutover/shadow paragraph in `docs/architecture/server2.md`, commit/push/PR/CI and independent cross-provider review with corrections.

Out of scope: live shadow configuration, traffic mirroring, live provider calls, AWS resources, deployment, cutover, merge/auto-merge/queue, `server2/src/providers/` (S13), `.github/workflows/server2.yml` and `plans/issue-2614.md` (root coordinator). Local fixture timings and counts are not production latency, quota or seven-day shadow evidence.

Scoped code, tests and SDLC evidence may be shared with the configured Codex reviewer (public repository). No secrets, new accounts or permission changes.
