# RSS CI clock correction — 2026-10-01

Owner: TodayWeather backend/CI maintainer. Author: root Codex/OpenAI. Scope: the offline Node 10 air-provider-chain check in PR #2658; production quota behavior remains unchanged.

## Diagnosis and change

[RSS PR run 36794428808](https://github.com/WizardFactory/TodayWeather/actions/runs/36794428808) on `44fb5a0c77cee4638ebf9ab5f1441a4ab53297fc` failed the air-chain provider-order assertion: Google was selected instead of OpenWeather. The test seeded a September monthly cap from its historical request timestamp, while the budget read the actual October wall clock. Production correctly starts a new monthly budget; the fixture mixed clocks.

The [offline check](../../../server/test/offline/air-chain-node10-check.js) now injects one fixed clock into its VM-loaded providers, budgets and fallback, and derives paid fixture keys from that clock. Explicit timestamp construction is preserved. Six assertions cover capped current months and uncapped previous months at September/October and December/January UTC boundaries. Each case uses isolated usage records; the original clock is restored afterward. No provider, quota policy, route or storage implementation changed.

Changed test SHA-256: `91ce5ce4f92ee0b2880e5f22af965b20dc66b82037b3d17218919a9d66fc36f6`. Candidate source aggregate: `5e18fb29130545e18d4e6a76e284c5f8cfb3e9734b9d5676a495193f3e5dd052` (`sha256(json.dumps(files, sort_keys=True))`, the existing 37 design source digests plus this test). The [design manifest](source-digests.json) remains historical and all 37 source files still match it; no new gallery run or independent PASS is implied by this correction.

## Local validation

Environment: macOS, Node 24.19.0, `TZ=UTC`, isolated offline dependencies. No live provider calls or MongoDB connections. Loopback HTTP uses fake provider responses.

| Check | Observed result |
| --- | --- |
| Original unmodified air-chain check | Assertion failure: actual `google`, expected `openweather` (intended Red; not a dependency/setup failure) |
| Corrected air-chain check, Green and final rerun | Passed, including six month/year boundary cases, paid admission/concurrency and one loopback WAQI request |
| Existing air-chain regressions | 32 passed; 0 failed |
| Additional full v000903 router smoke | 16 scenarios passed; 25 loopback provider requests |

Reproduce from a clean checkout using the isolated dependencies listed in [RSS workflow](../../../.github/workflows/rss-offline.yml):

```sh
TZ=UTC NODE_PATH=/tmp/rss-smoke/node_modules node server/test/offline/air-chain-node10-check.js
TZ=UTC NODE_PATH=/tmp/rss-smoke/node_modules node server/test/offline/air-chain.test.js
TZ=UTC NODE_PATH=/tmp/rss-smoke/node_modules TW_SMOKE_OUTPUT_DIR=/tmp/rss-output node server/test/offline/air-chain-smoke.js
```

Actual Node 10.15.3 execution is pending the new CI run; local Node 24 success is not Node 10 certification. Prior design tests and browser evidence apply only to their recorded, unchanged source hashes. Raw executions and stage receipts remain in ignored reports; this note preserves the diagnosis, source identity and reproducible results.

The separate earlier push-run Mongo `null.calls` failure was not reproduced: a same-head PR run passed. An asynchronous-write timing hypothesis is not established and no speculative Mongo change is included. Pre-merge still requires current CI and eligible independent verification/review; no merge or deployment is authorized.
