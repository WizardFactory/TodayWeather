# Issue #2641 — independent initial verification (read-only)

- Verifier: Claude Code agent; model observable in session context as Opus 5.5 (`claude-opus-5-5`), provider Anthropic. Reasoning effort not independently observable. Mode: auto mode, non-interactive, read-only against the author worktree.
- Worktree: `/root/.paseo/worktrees/08mqediz/filthy-lion`, HEAD `39a3336fb2730dfbe9920c62165a2b632874af1e` (base), uncommitted author working tree (24 tracked files changed, +30/−1272, plus untracked tests/docs/SDLC artifacts). The author was concurrently adding files (diagram visual-check artifacts appeared during review), so this covers the working tree as observed on 2026-09-29, not a final commit.
- Inputs read: AGENTS.md, intent/specs/plans for issue-2641, reports/sdlc/issue-2641/test-plan.md and authority.json, investigation.md (scope line), full non-deletion code diff, deleted `controller.purchase.js` (HEAD), `service.twads.js`, `client/test/payment-removal.test.cjs`, locale diffs, `client/package.json` scripts, gulp tasks, `tw.ios` Xcode project, and the docs diff.
- No repository modification. No commits, pushes, or publications. No server, network, or provider calls.

## Commands actually run

```
git rev-parse HEAD; git status --short; git diff --stat; git diff -- <client code files>
grep -rnIi -E "purchase|inapp|storeReceipt|twAdsInfo|accountLevel|ACCOUNT_LEVEL|isPaidApp|PaidAppUrl|BILLING|saveTwAdsInfo|loadTwAdsInfo|REMOVE_ADS|hasInAppPurchase|fovea" client (excl. node_modules/lib/platforms/plugins)
grep for TwAds.init / setEnableAds callers (working tree and HEAD)
node -e JSON.parse(...) for each client/www/locales/*.json          -> all 6 valid
removed en.json keys grepped against js/, templates/, index.html     -> none still referenced
grep of tw.ios/ta.ios project.pbxproj for StoreKit/InAppPurchase
git status --short --ignored client/www/lib; git check-ignore -v client/www/lib
node --version                                                       -> v22.22.2
node --test client/test/payment-removal.test.cjs                     -> 7/7 pass, 0 fail (log: /tmp/issue-2641-review/node-test.log)
```

Not run: `client/test/payment-removal-smoke.cjs` (browser smoke; the main agent is running it), gulp/cordova/npm builds, and device or store checks.

## Confirmations (no defect)

- AC1: the purchase route, menu item (`hasInAppPurchase`/`clickMenu('purchase')`), `<script>` include, module registration, `Purchase` injections (app.run, Forecast, Guide, Setting, Start), template, and all three controllers are removed. Grepping `client/www/js`, templates, and index.html finds no remaining `Purchase`/`PurchaseCtrl` reference.
- AC2: `Purchase.init()` was the only caller of `store.*` and `/v000705/check-purchase`. It is removed, and no `window.store` or check-purchase reference remains in `client/www`. `TwAds.init()` is still called from `controller.tabctrl.js:63`, so removing Purchase does not lose ad initialization.
- AC3: gulp no longer installs `cordova-plugin-inapppurchase` or `cc.fovea.cordova.purchase`, copies purchase controllers, or references `*_BILLING_KEY`. The modern npm scripts (`build:*`, `scripts/build-release.mjs`) contain no billing or tw.ios reference. `package.json`, `package-lock.json`, and `tw/ta.package.json` list only `cordova-plugin-inappbrowser`, which is unrelated to billing and is kept. `make-client-config.mjs` now drops `isPaidApp` and the paid URLs from imported config; the test exercises this.
- AC4: `TwAds` no longer depends on `TwStorage`. `onAdapterReady` enables ads unless an explicit in-memory `requestEnable` exists. The account analytics events were removed. Start and guide `_setShowAds(true)` no longer depend on accountLevel. Before this change, a missing or unknown accountLevel (for example no `window.store`) could suppress guide/start banners, so the new behavior is intentionally more permissive. The storage migration lists no longer contain `purchaseInfo`, `storeReceipt`, or `twAdsInfo`, and no code in `client/www/js` reads these keys.
- Locales: all six files parse, and 22 purchase keys were removed from each. The removed `LOC_PRIVACY_POLICY`/`LOC_TERMS_OF_USE` keys have no remaining consumers.

## Findings

| # | Severity | Location | Evidence | Impact | Requirement |
|---|---|---|---|---|---|
| F1 | LOW | `client/www/locales/zh-CN.json:137`, `zh-TW.json:137` | Orphan purchase string `"LOC_PLEASE_RESTORE_AFTER_1-2_MINUTES"` (hyphen variant, "restore purchase after 1-2 minutes"). The test regex and the removal list only cover the underscore variant `..._1_2_...`. | Dead payment copy remains in maintained locales. No runtime effect because nothing references it. | AK "complete payment removal"; spec "purchase-only translation keys" |
| F2 | LOW (doc accuracy) | `docs/architecture/mobile-api.md:42` | Still says "Push and some purchase requests set their own headers." | This doc is stale after the change. | AGENTS.md: update affected architecture docs |
| F3 | LOW (doc accuracy) | `docs/architecture/service-overview.md:26` | Build-variant row still says "(TodayAir, widgets, purchase plugins); ... select purchase plugin". | The service overview contradicts the new gulp behavior. | AGENTS.md: update affected architecture docs |
| F4 | LOW (process hazard) | `client/www/lib` (untracked symlink → `/tmp/tw-2609-client/lib`) | `git status --ignored` shows it as `??`. The `.gitignore` patterns `www/lib/` and `/client/www/lib/` use a trailing slash, which matches only directories and not a symlink. | A broad `git add -A`/`git add client` would commit a symlink to a machine-local `/tmp` path. Stage explicit paths only. | Scope and preservation hygiene |
| F5 | LOW / informational (scope decision) | `tw.ios/TodayWeather.xcodeproj/project.pbxproj:33,121,144,361` (and the same in `ta.ios/TodayAir.xcodeproj`); copied by the still-present gulp `build_tw_ios`/`build_ta_ios` (`cp -a ../tw.ios/* platforms/ios/`) | The native project still links `StoreKit.framework` and has `com.apple.InAppPurchase` enabled. `tw.ios/www` and `ta.ios/www` still contain purchase controllers and templates. Cordova prepare overwrites `platforms/ios/www`, so the JS copies are not shipped. | This is not a JS billing plugin and makes no billing calls. It is residual in-app-purchase capability and linkage in a legacy gulp iOS path. The intent explicitly excludes "historical native bundles", and the modern `npm run build:ios` path does not use tw.ios. AK's "including app billing plugins" statement may or may not extend to the StoreKit capability. Recommend AK confirm, or record the exclusion in the PR. | Intent "Excluded: historical native bundles" vs AK "complete app payment removal" |

No HIGH or MEDIUM defects were found. I found no dangling Angular injection, missing module, or ad-gating regression by source inspection.

## Test-source observations (non-blocking)

- The AC4 test executes the real `service.twads.js` with adapter doubles. It passes when stale `{enable:false}` and premium records are present, and `TwStorage.set` throws. Because the factory no longer injects `TwStorage`, the stale fixtures are never consulted. The test still guards against reintroducing a `TwStorage` dependency: a reintroduced read of `{enable:false}` would make `enableAds` false.
- The AC1 regex covers `www/index.html` and `www/js/*` but not `www/templates/*`. A manual grep confirmed that templates are clean.

## Limitations

- Source inspection and Node unit tests only. I did not run the browser smoke, a Cordova/gulp build, the Angular runtime, a device, AdMob consent, or a store.
- The author working tree was changing during the review. The final tested candidate and PR head need separate verification.
- I did not inspect the server (`/v000705/check-purchase` remains server-side by design, #2642).
