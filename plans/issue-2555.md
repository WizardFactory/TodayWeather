# Implementation plan
Owner: /root. Selected notebook: .planning/2026-09-24-issue-2555/. Intent/spec: ../intent/issue-2555.md and ../specs/issue-2555.md.
1. Add isolated CommonJS VM harness and Mocha tests for seven URLs/dispatch, bad envelopes/XML/status/count, strict quantities, RN1, upstream defaults and secret-free logs. Observe baseline Red.
2. Edit only server/lib/collectTownForecast.js runtime: migrate URLs, guard response, normalize new categories/RN1, remove key-bearing diagnostic paths. Preserve operating policy and legacy fields/categories.
3. Green regression and post-refactor checks. Add independent functional smoke: real XML → requestData/events → short controller save/read with in-memory model boundary; invalid response produces failed collection, no persistence. No HTTP/provider/DB startup. Characterize current merge and consumer period assumptions.
4. Document all 16 inventory paths (config excluded), legacy policy values and schedule, retained defaults, limitations and operator deployment/rollback. Update collection docs/Archify; validate links/artifact/browser/visual.
5. Independent verifier examines exact diff and executes checks; fix relevant findings. Commit/push to topic branch and create PR on master. No merge/deploy. Eligible cross-provider review assessed separately; incomplete review never becomes PASS.
Temporary dependencies: npm install --prefix /tmp/issue-2555-harness --ignore-scripts --no-audit --no-fund --package-lock=false mocha@2.5.3 xml2js@0.4.23 async@2.6.4.
Regression: NODE_PATH=/tmp/issue-2555-harness/node_modules /tmp/issue-2555-harness/node_modules/.bin/mocha server/test/offline/gather-code-drift.test.js
Smoke: NODE_PATH=/tmp/issue-2555-harness/node_modules node server/test/offline/gather-smoke.js
Rollback: revert source PR and operator restore prior artifact/config securely. No database schema migration. Reject wholesale EC2 diff and speculative period conversion because both remove known fixes or invent policy.
