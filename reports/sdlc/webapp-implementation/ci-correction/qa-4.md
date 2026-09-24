# QA-4 focused independent verification

Verdict: **PASS**. Proposed HOTL decision: **PROCEED** within authorized PR-correction publication. This is independent same-provider verification, not PR approval, cross-provider review, merge readiness or deployment authorization.

Candidate `sha256:581c30a167923fe326d94e33be92c72ff50511b7e6037f6388833707d73977e1`; base `01eb787b10cc2694ea52642b8b24ad8c5426503e`; prior head `bb23a7345d93f3435ff21669667f6f82ef09ebf2`. All 65 candidate hashes match before/after. Exactly one candidate file differs from QA-3: `web/e2e/web.spec.ts`, with one added assertion. All other 64 entries and the QA-3 production bundle hashes are identical. Delegation input hashes also match.

## Reconciliation and scope

This resumes the same independent-verification iteration 4. Visible context history showed the original intake interrupted before any QA-4 tool execution. Reconciliation found assignment/delegation/resume records but no earlier QA-4 report, execution log or verifier config. No earlier QA-4 approval request was pending in this context. The resumed mobile check below is the only evidenced QA-4 run. Verifier `/root/webapp_qa` is independent of builder `/root`, both OpenAI; exact inherited runtime model/effort were not independently exposed.

## Causal assessment

The actual retained CI trace starts the delete click at 8961.582 ms and reload at 8994.372 ms, about 32.79 ms later. The failed post-reload assertion expected one card but found two; 11 other scenarios passed. `deletePlace` awaits fresh notification capability and applicable server cleanup before changing local state, so a Playwright click completing does not establish completion of that asynchronous deletion.

The added `await expect(page.locator('.location-card')).toHaveCount(1)` observes completed local removal before reload. The original after-reload count assertion remains. This adds a necessary synchronization boundary without a sleep, skip or weakened persistence check. No evidence establishes that it conceals a persistence defect after completed deletion.

## Actual execution and reuse

`WEB_SCREENSHOTS=/tmp/qa4-browser-screens node_modules/.bin/playwright test --config=/tmp/qa4-playwright.config.mjs --grep 'mobile favorites' --repeat-each=3`: **3/3 passed in 12.9 seconds, exit 0**. This used actual Chromium and an isolated demo BFF on `127.0.0.1:4191`; both before/after reload assertions executed. Evidence: `qa-4-mobile.txt`. Playwright owned and stopped the test runtime; output paths were separate from main evidence.

QA-3 remains applicable for unchanged runtime, dependencies, configuration and tests: 39 unit/API tests, typecheck, broad browser/source review, scheduler and Origin probes. The production bytes also match, so no rebuild or unrelated full-suite rerun was necessary. Main's ten repetitions and full 12-case smoke were consumed as separate author evidence, not counted as independent runs.

No findings. Exact input/evidence digests are in `qa-4.json`. Three repetitions support this bounded synchronization change but are not a universal timing guarantee. Remote CI on the eventual published head remains for main to verify. All QA-3 device/provider/native/deployment/full-parity limits persist. Source, state, notebook and prior reports remained read-only.
