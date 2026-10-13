Task: issue-2736-s10c; owner: Claude builder (S10c worktree); revision/base: 8c3a703c929b0c62b00ed3b510f0aa804b850877; date: 2026-10-13.
Authority: AK decided on 2026-10-13 that server2 has no runtime mode that legacy lacks (relayed by the root coordinator); endpoint pre-merge (no merge, auto-merge or queue).
Criteria: AC1 (no mode variable or loopback-only endpoint rule), AC2 (real configuration serves the goldens; legacy without native configuration), AC3 (real native geocoder funding), AC4 (compatibility, smokes, placement and documents).
Issue update assessment: path declaration posted before dependent edits
([comment](https://github.com/WizardFactory/TodayWeather/issues/2736#issuecomment-6147750708)); one concise status at readiness.

# Intent

S10, S11, S13a, S12 and S14 added settings that exist only for verification: the geocoder
`mock` mode with a built-in 10,000-unit counter, `SERVER2_WORLD_MODE=native-local`,
`SERVER2_WORLD_AIR=live-local|restore-local`, and loopback-only endpoint checks in the world
runtime and the two seed importers. With these settings the native geocoder, world weather and
world air cannot run against real providers and S3. AK decided on 2026-10-13 that server2 must
not have such modes: implement the real path, test it with test doubles inside the tests, and
apply it. This rule also binds this task: no new mode, flag or dry-run path.

- AC1: no runtime code path reads `SERVER2_GEOCODER_MODE`, `SERVER2_WORLD_MODE`,
  `SERVER2_WORLD_AIR` or a mock/dry-run flag. No runtime path or migration tool refuses a
  non-loopback HTTPS endpoint. The transport rule "HTTPS, or plain HTTP only to a loopback
  address" stays.
- AC2: with real-format configuration that points at test peers, the native geocoder, world
  weather and world air serve the S02, S11 and S13a golden responses; restore from S3 is
  ordinary behavior. Without native configuration the legacy backend stays selected.
- AC3: the native geocoder uses the existing `GEOCODER_KAKAO_KEYS` and `GEOCODER_GOOGLE_KEY`
  names, the Kakao/Google endpoints from configuration (legacy production defaults) and
  `FundedQuota` with limits from configuration. A missing limit is a configuration error; an
  exhausted quota fails closed without a provider call.
- AC4: existing workspace tests, `server2/deploy/smoke.sh`, the release smokes and the S04
  placement gate pass; the operations guides and `docs/architecture/server2.md` describe the
  real configuration.

In scope: server2 runtime wiring, geocoder funding, world/air runtime configuration, seed
importer endpoints, tests and smoke tools, documentation and regenerated PDFs, commit/push, PR,
CI and Codex review/correction.

Out of scope: measuring quota values (#2724), runtime credential discovery or rotation (static
configured credentials stay), live provider calls, AWS actions, deployment, cutover, merge,
reading `.env` values, edits to `plans/issue-2614.md`, and historical S09 benchmark tooling.

Risks: S15 (#2700) edits `server2/src/gateway/` in parallel, so `gateway/runtime.rs` may need
reconciliation; the shadow gateway family asserted that no S3 request occurs, which no longer
holds once geocoder funding uses S3 budgets.
