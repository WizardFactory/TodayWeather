# Independent verification of review corrections

Date: 2026-09-24. Reviewer: separate OpenAI/Codex agent context (`offline_verifier`), same provider as implementation. This is independent local verification, **not** an eligible cross-provider PR-review PASS. No implementation, test, workflow, shared-state, or configuration file was edited by this reviewer; this report is the sole repository write.

Verdict: **PASS for the bounded correction scope**, with no unresolved blocking finding in the inspected candidate. The review-comment assessment and diff from `5e653285726e4035490ca13de532fdb8ccb7e218` were inspected. The source and tests were frozen by the implementing agent before the final command below. Candidate hashes bind this verdict to the inspected files; it is not a claim about later edits, hosted CI, deployment, or provider behavior.

## Commands and actual outcomes

```sh
NODE_PATH=/tmp/issue-2555-harness/node_modules /tmp/issue-2555-harness/node_modules/.bin/mocha server/test/offline/gather-code-drift.test.js
NODE_PATH=/tmp/issue-2555-harness/node_modules npm --prefix server run test:offline
sha256sum server/lib/collectTownForecast.js server/test/offline/gather-code-drift.test.js server/test/offline/harness.js server/test/offline/gather-smoke.js server/test/offline/run.js server/package.json .github/workflows/gather-offline.yml
node --version
npm --version
```

- Initial direct regression: exit 0, `103 passing (527ms)`.
- Final named runner after smoke freeze: exit 0, `103 passing (469ms)` and all four functional smoke messages below.
- Node `v22.22.2`; npm `10.9.7`. Existing isolated dependencies: Mocha `2.5.3`, xml2js `0.4.23`, async `2.6.4`. No dependency installation was performed by this reviewer.

```text
PASS synthetic XML -> requester -> events -> saveShort -> getShortFromDB (1 write, exact quantities/timestamps/grid)
PASS provider-error XML -> failed collection, no additional persistence; no key-bearing logs
PASS truncated XML page -> failed requestData -> no additional persistence; encoded/raw dummy keys safe
PASS sea XML -> requester -> events -> saveMid (26 distinct heights); later-day NaN prevents another write
```

## Independent challenges and findings

1. **Sea mapping resolved.** Inspected all 26 day/half-day/minimum/maximum wave assignments. Each now reads its own source field. An independent inline `NODE_PATH=/tmp/issue-2555-harness/node_modules node` probe generated fields from day/suffix loops, assigned distinct `(index + 1) / 10` values, serialized real XML and dispatched through the real `getData`. All 26 outputs matched. Each of the 26 fields was separately mutated to `NaN` and `Infinity` (52 cases): every case produced exactly one error callback, `recvFailed=true`, and no completed result. The final smoke additionally traverses the actual mid controller's save path with an in-memory model and verifies all 26 persisted values plus no second write after invalid day-7 input.
2. **Partial-page success prevented.** Count equality is checked before organizer dispatch. Regression cases cover counts below and above the actual item count, including 999 and 1000. The smoke supplies a valid complete forecast prefix with `totalCount=1000`; one request fails and no extra persistence occurs. This is a completeness safeguard, not pagination or proof of live response size.
3. **Key representation contract verified.** All seven URL builders preserve raw plus, slash and equals characters after query decoding, and normalize uppercase/lowercase percent escapes without double encoding. Malformed escapes fail with static diagnostics. Independent probes additionally verified `DUMMY%25tail` becomes the literal `DUMMY%tail`, and `DUMMY%252B` becomes `DUMMY%2B`, establishing exactly one decode rather than repeated decoding. Literal percent input must obey the documented `%25` exception; this does not claim arbitrary raw percent-containing strings are accepted. Asserted logs contain neither raw/encoded dummy keys nor key-bearing query URLs.
4. **Offline entrypoint and CI selection reviewed.** `test:offline` runs only the dedicated regression and smoke, leaving default legacy tests unchanged. Independent VM-isolated runner control-flow probes confirmed both-stage success, first-stage exit 7, second-stage exit 9, and null-status failure handling; failures stop/propagate instead of reporting success. The workflow selects Node 22.22.2, installs only the three isolated test dependencies with scripts disabled, uses read-only repository permissions, disables persisted checkout credentials and contains no deployment step. Hosted workflow execution and remote action-SHA provenance were not independently exercised under this offline review.
5. **Operational boundaries preserved.** Documentation explicitly holds hourly short-feed production activation pending separately verified consumer-period repair. Runtime schedules remain unchanged. No pagination, period conversion, credential renewal, policy activation, provider availability, production recovery, or database migration is claimed by this verdict.

All fixtures and probes were synthetic. HTTP, model methods and logging used injected boundaries; the real XML parser, collector exports and selected storage-controller exports were executed. No production config, credentials, provider, EC2, MongoDB, application startup, live timers, external API, commit or push was accessed or performed.

## Frozen candidate SHA-256

```text
a8de41fb633c67491b50b02b9bf88a1a744cd866a12c98d313a3a7be0c219c87  server/lib/collectTownForecast.js
b6e556fce9ac2857afec0e41f83749544e11ceefda8b2437e98e8e6a2b5b1271  server/test/offline/gather-code-drift.test.js
dae9d7276fb195457bd6e801b713face09e033b282dca4af6337a8ac91134a28  server/test/offline/harness.js
c273a33e13bd531a85913a50c067115104c0cd4dc69054a22da6ac035badd6d6  server/test/offline/gather-smoke.js
1da11e57554f2f7ab86b34f9d0e8ae9408cbfb92e328e5cec79ea3e96c74c106  server/test/offline/run.js
eee087a0ca3af077c4e861a8dd35e040d3e33ee3c29bdc2a3700ca56ac8a1de7  server/package.json
a6981b110bcce4c7d8e492056ae1788a3fd2f854ed6fb01f983f1b2cc8c54ef6  .github/workflows/gather-offline.yml
```
