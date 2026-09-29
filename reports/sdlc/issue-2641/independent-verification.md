# Issue #2641: independent final verification (stage iteration 2)

## Verdict

**PASS.** I found no open HIGH/MED/LOW defects in candidate `sha256:76e5b26c3aefbfaac52387c3163c5155b92df0a33c3c28fcbc4d83de7f066694` (manifest `reports/sdlc/issue-2641/candidate-v2.json`, base `39a3336fb2730dfbe9920c62165a2b632874af1e`). All initial findings F1–F5 are resolved. My independent Node tests, browser smoke and native project parse all pass. The candidate is suitable for the author to commit. PR review is a separate later stage.

## Verifier identity

- **Host-observed configuration**, from the author-captured `reports/sdlc/issue-2641/reviewer-host.json` at 2026-09-29T14:33:55Z: provider `claude`, model `claude-opus-5-5`, `thinkingOptionId`/`effectiveThinkingOptionId` = `medium`, mode `auto`, fast mode off, and session `f8e65d77-2e97-4803-8557-e274df4aa1fa`. The record's `runtimeInfo.model` is null.
- **My own introspection:** the system context identifies me as Opus 5.5 (`claude-opus-5-5`), an Anthropic Claude agent, running in auto mode and non-interactively. I can't directly observe my own reasoning-effort setting, so the effort level above is only the host's claim. I didn't verify it.
- **Independence:** this session ran separately from the OpenAI Codex author session. I treated the author tree as read-only: I made no repository edits, commits, pushes or publications. My scratch files and outputs are only in `/tmp/issue-2641-review/`.

## Candidate identity

- I recomputed the sha256 of all 32 manifest paths against the working tree. There were 0 mismatches, both before and after the test runs. The 4 deleted purchase files are absent.
- The candidate id is a manifest identifier. I didn't independently recompute how it is derived.
- Changes relative to v1: the native projects `tw.ios/TodayWeather.xcodeproj/project.pbxproj` and `ta.ios/TodayAir.xcodeproj/project.pbxproj`, `docs/architecture/service-overview.md`, the two zh locales, both test files, and the manifest.
- The tree also contains untracked SDLC artifacts (`intent/`, `plans/`, `specs/`, `reports/sdlc/...`). These are outside the manifest's product identity.

## Commands actually executed

| Command | Result | Log |
|---|---|---|
| Python sha256 check of `candidate-v2.json` paths (run twice) | 32 files, 0 mismatches | — |
| `node --test client/test/payment-removal.test.cjs` (Node v22.22.2) | exit 0, **8/8 pass** | `v2-node-test.log` |
| `PLAYWRIGHT_MODULE=/tmp/tw-2609/node_modules/playwright CHROMIUM_PATH=/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome SMOKE_OUTPUT=/tmp/issue-2641-review/smoke-v2 node client/test/payment-removal-smoke.cjs` | exit 0, `status: passed` | `v2-smoke.log`, `smoke-v2/smoke-result.json`, `smoke-v2/settings-menu.png` |
| `node /tmp/issue-2641-review/parse-native.cjs <tw,ta pbxproj>` using `xcode@3.0.1` from `/tmp/2641-native-check` (the author-provided install; the parse script is my own) | both parse; 15 sections each; StoreKit=false, InAppPurchase=false | `native-parse.log` |
| The same script on the base (`git show HEAD:`) pbxproj files | both parse; StoreKit=true, InAppPurchase=true; the same 2 orphan IDs as the candidate | `native-parse.log` |
| `git diff --check` | clean | — |
| `JSON.parse` on all 6 locale files | valid | — |

**Smoke outcome:**
- Startup state `start`. The injector has no `Purchase` service and no `purchase` state.
- Navigation guide → units → start succeeded.
- 0 Angular errors, 0 page errors, 0 billing requests, 0 blocked external requests.
- The smoke seeds stale `purchaseInfo` (premium) and `twAdsInfo {enable:false}` and sets `clientConfig.isPaidApp = true`. The side menu is unaffected.
- It now asserts that no `.popup-container.active` remains. I viewed the screenshot: the menu is clear with no overlay, and 테마 설정 is followed directly by 의견보내기, with no purchase or remove-ads entry.
- The `$exceptionHandler` decorator in the smoke is effective because `index.html:68-69` bootstraps Angular manually on `deviceready`, after the decorator is registered.

## Finding resolution

| Finding | Status | Evidence |
|---|---|---|
| F1 zh-CN/zh-TW orphan `LOC_PLEASE_RESTORE_AFTER_1-2_MINUTES` | **Resolved** | Removed from both files. New test 8 asserts that both `[-_]` variants are absent from every locale. |
| F2 `mobile-api.md:42` "purchase requests set their own headers" | **Resolved** | Now reads "Push requests set their own headers." |
| F3 `service-overview.md:26` (and `:82`) purchase plugin selection | **Resolved** | Line 26 now says billing installers and native purchase declarations were removed in #2641. Line 82 now says server-side validation remains pending #2642 and the app and Gulp no longer include billing. Lines 23 and 57 describe server models and routes, which are unchanged and correct for this app-only scope. |
| F4 `client/www/lib` symlink not ignored | **Resolved** | It is now a real directory matching the `www/lib/` ignore, and it doesn't appear in `git status`. |
| F5 StoreKit / InAppPurchase in the legacy native projects copied by Gulp | **Resolved** | In both pbxproj files, the PBXBuildFile, PBXFileReference, Frameworks build-phase entry, Frameworks group child and `com.apple.InAppPurchase` capability were all removed consistently. No StoreKit ID remains. The files parse with xcode@3.0.1. Neither the entitlements files nor the Info.plists contain purchase or StoreKit keys. Test 8 guards against regression. |

## New observations (non-blocking, no action required)

- **O1 (informational):** both native projects reference two undefined IDs, `D2AAC07E0554694100DB518D` and `D2AAC07D0554694100DB518D` (these are standard Cordova template leftovers). They are identical in the base, so this change didn't introduce them.
- **O2 (limitation):** the smoke's billing `Proxy` check (`window.store`) is weak on its own, because the current `TwAds.init()` never touches `store`. The real guarantees come from the removed `Purchase` service/route assertions, zero billing requests and the static tests.
- **O3 (scope, as authorized):** the bundled legacy web trees `tw.ios/www` and `ta.ios/www` still contain purchase controllers and templates. Cordova prepare replaces `platforms/ios/www` from `client/www`, so they don't ship. Per the author's stated plan ("No bundled www/vendor changes") and the intent's exclusion of historical bundles, these are intentionally untouched. The server `/v000705/check-purchase` is out of scope (#2642).
- The new CI workflow `.github/workflows/client-offline.yml` runs only the Node test, with `contents: read` permission. It doesn't run the smoke.

## Acceptance criteria

- **AC1 – met:** no purchase, restore, renewal or paid entry, route or template remains. Confirmed by static tests 1 and 3, the live injector and state registry check, and the menu screenshot.
- **AC2 – met:** real Ionic/Angular startup and navigation work with no billing module and no billing requests.
- **AC3 – met:** the Gulp, npm and package files, config generator and legacy native projects contain no billing installers, keys, StoreKit or IAP capability. `inappbrowser` is retained.
- **AC4 – met:** TwAds no longer depends on TwStorage. Stale exemption, premium records and paid flags don't disable ordinary ads (tests 4–6 and the smoke seeding).

## Limitations

- I ran no native iOS or Android build, Xcode build, device run, AdMob consent flow, store operation or live provider call. The native project check is a parse plus reference audit, not an Xcode build.
- The browser smoke uses stubbed `cordova.js` and no native plugins.
- I didn't inspect server code, and I didn't check the hosted CI run. The verdict applies to the working-tree bytes pinned by `candidate-v2.json`. The final commit and PR head need to be re-mapped to this candidate in the later review.
