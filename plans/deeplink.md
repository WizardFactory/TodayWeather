# TodayWeather deep link implementation plan (`link.todayweather.ai`)

Date: 2026-11-21. Scope: [intent](../intent/deeplink.md), [specification](../specs/deeplink.md), and parent tracking issue [#3092](https://github.com/WizardFactory/TodayWeather/issues/3092). Immediate replacement of legacy Branch (`twa.app.link`) share links is in scope. Production AWS execution, DNS cutover, and store releases remain separately authorized operator actions.

## Task breakdown, PR boundaries, and tracker map

GitHub owns live task status via parent [#3092](https://github.com/WizardFactory/TodayWeather/issues/3092) and its six linked sub-issues. Each sub-issue maps 1:1 to one coherent, independently reviewable PR targeting `master` with non-overlapping write scopes:

| Task ID | GitHub Sub-Issue | Owned write scope | Depends on | PR base & parallelism | Acceptance coverage |
| --- | --- | --- | --- | --- | --- |
| `DL-01` | [#3093](https://github.com/WizardFactory/TodayWeather/issues/3093) | `intent/deeplink.md`, `specs/deeplink.md`, `specs/deeplink.golden.json`, `plans/deeplink.md`, golden schema test | none | `master` (**Ready frontier**) | AC1 (contract), AC13 |
| `DL-02` | [#3094](https://github.com/WizardFactory/TodayWeather/issues/3094) | `infra/deeplink/**`, `scripts/deploy-deeplink-static.mjs`, `scripts/deeplink-live-smoke.mjs`, edge tests | `DL-01` (#3093) | `master` (parallel wave after `DL-01`; deploy first) | AC1 (edge), AC2, AC3, AC4, AC5, AC6, AC13 |
| `DL-03` | [#3095](https://github.com/WizardFactory/TodayWeather/issues/3095) | `infra/web/static/route-request.js`, `web/**`, `docs/architecture/web-client.md` | `DL-01` (#3093) | `master` (parallel wave after `DL-01`; deploy before mobile) | AC1 (web), AC7, AC12 (web), AC14 (`web-client.md`) |
| `DL-04` | [#3096](https://github.com/WizardFactory/TodayWeather/issues/3096) | `android/**` | `DL-01` (#3093) | `master` (parallel wave after `DL-01`) | AC1 (Android), AC9 (auto), AC10 (manifest), AC11 (Android) |
| `DL-05` | [#3097](https://github.com/WizardFactory/TodayWeather/issues/3097) | `ios/**` | `DL-01` (#3093) | `master` (parallel wave after `DL-01`) | AC1 (iOS), AC8 (auto), AC10 (entitlements), AC11 (iOS) |
| `DL-06` | [#3098](https://github.com/WizardFactory/TodayWeather/issues/3098) | `docs/rewrite/decisions-and-open-questions.md`, `docs/architecture/mobile-api.md`, rollout verification record | `DL-02`–`DL-05` (#3094–#3097) | `master` (final integration & live rollout gate) | AC3–AC6, AC8–AC12 (live/device), AC13, AC14 |

- **Critical path:** `DL-01` (#3093) → (`DL-02` #3094 + `DL-03` #3095 live deploy; `DL-04` #3096 + `DL-05` #3097 builds) → `DL-06` (#3098 live smoke + physical iOS/Android verification + `D35` closure).
- **Available parallelism:** Once `DL-01` (#3093) merges, `DL-02`, `DL-03`, `DL-04`, and `DL-05` have disjoint write scopes and can proceed concurrently across 4 PRs.
- **Connector / rollout handoff:** `DL-04` and `DL-05` immediately switch `ShareMessage` to `https://link.todayweather.ai/...`, so store release of those builds is explicitly gated on `DL-06` confirming live `DL-02` + `DL-03` deployment first.

## Critical rollout order (immediate Branch replacement safety)

Because iOS and Android `ShareMessage` switch immediately from `twa.app.link` to `https://link.todayweather.ai/...`, **infrastructure and Web PWA fallback MUST be deployed and live-verified before shipping updated mobile app builds**:

1. Deploy and verify `link.todayweather.ai` S3 + CloudFront + `.well-known` files + `/open.html` + redirect function.
2. Deploy `app.todayweather.ai` PWA update (`/loc` route, `from=link` banner, updated `route-request.js`, share URLs).
3. Verify live Universal Link / App Link resolution on physical iOS and Android devices (TestFlight / Internal Testing).
4. Ship iOS and Android releases containing both deep-link receiving and immediate `ShareMessage` cutover to `https://link.todayweather.ai/...`.
5. Keep legacy Branch forwarding active during a post-release grace period for historical messages already shared by older app versions.

## Operator prerequisites (outside Git)

Gather these operator-supplied values before deploying `infra/deeplink/` (never commit private values to Git):
- **Apple Team ID** (`APPLE_TEAM_ID`, 10-char alphanumeric) and Apple Developer Portal **Associated Domains** capability enabled for `net.wizardfactory.todayweather`.
- **Google Play App Signing SHA-256 fingerprint** (`PLAY_APP_SIGNING_SHA256`, plus any authorized internal-test key fingerprint).
- **ACM certificate ARN in `us-east-1`** covering `link.todayweather.ai` (existing `*.todayweather.ai` wildcard certificate may be reused if already `ISSUED`).
- **DNS control** for `todayweather.ai` (Route 53 Hosted Zone ID or external DNS CNAME/Alias for `link.todayweather.ai`).
- **Canonical store URLs** for App Store and Google Play (used by `/open.html` and PWA app banner).

## Milestones and tasks

### M1. Shared contract and Golden Test Vector
1. Create `specs/deeplink.golden.json` covering every route, coordinate edge case (`0,0`, out-of-bounds, `NaN`), `name` sanitization/truncation, unknown query/path, wrong-host rejection, and legacy `todayweather://` scheme.
2. Define exact canonical serialization rules (catalog match threshold `0.04°`, saved-place match threshold `0.01°`, 3-decimal coordinate rounding).

### M2. `link.todayweather.ai` static edge stack (`infra/deeplink/`)
1. Author CloudFormation template `infra/deeplink/stack.json` (private S3 + OAC + CloudFront + strict response headers/CSP + `cloudfront-js-2.0` viewer-request function, following [infra/web/static/stack.json](../infra/web/static/stack.json)).
2. Implement `infra/deeplink/route-request.js` and Node unit tests running directly against `specs/deeplink.golden.json`.
3. Create static `/open.html` (localized Korean/English smart fallback with App Store / Google Play / Web PWA buttons, OG metadata, external CSS/JS compliant with strict CSP, in-app browser open action).
4. Create deployment/generation scripts (`scripts/deploy-deeplink-static.mjs` dry-run by default + `--execute` preflight checks; parameterized `.well-known` generator; read-only live smoke script `scripts/deeplink-live-smoke.mjs` checking `200`/`application/json`/no-redirect on both `.well-known` files, `200` on `/open`, `302` mappings, and `404` on unknown paths).
5. Document runbook in `infra/deeplink/README.md`.

### M3. Web PWA integration (`web/` + `infra/web/static/`)
1. Extend [infra/web/static/route-request.js](../infra/web/static/route-request.js) and its tests to allow `/loc\/?$`.
2. Add `/loc` route and `CoordinatePlace` ephemeral preview view to [web/src/App.tsx](../web/src/App.tsx) with nearby saved-place matching and explicit "Add to favorites" button.
3. Enhance `/place/:publicId` to honor optional `view` and `pollutant` query parameters.
4. Add dismissible "Open in app / Install" top banner triggered on `from=link` arrivals (mobile & in-app browsers).
5. Update [web/src/Weather.tsx](../web/src/Weather.tsx) share logic to emit `https://link.todayweather.ai/place/{slug}` or `https://link.todayweather.ai/loc?...`.
6. Add Vitest unit tests (against `specs/deeplink.golden.json`) and Playwright E2E tests covering `/loc`, ephemeral preview → add favorite, `from=link` banner dismissal, and share URLs without live network requests.

### M4. Android native integration (`android/`)
1. Implement `DeepLink` parser & URL builder in `android/core-domain/` and verify against `specs/deeplink.golden.json` (`DeepLinkTest.kt`).
2. Update [AndroidManifest.xml](../android/app/src/main/AndroidManifest.xml) `.MainActivity` with `android:autoVerify="true"` HTTPS intent filter scoped strictly to `host="link.todayweather.ai"` and canonical paths.
3. Extend [Share.kt](../android/app/src/main/java/net/wizardfactory/todayweather/Share.kt) (`EntryLinks`) and [MainActivity.kt](../android/app/src/main/java/net/wizardfactory/todayweather/MainActivity.kt) (`OpenedModel` + `AppContent`) to:
   - Accept both `https://link.todayweather.ai/...` and legacy `todayweather://N` while preserving `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY` protection;
   - Route tabs (`HOURLY`/`DAILY`/`AIR` + `airCode`) and overlays (`NationRoutes.NATION`/`NATION_AIR`/`WARNINGS`);
   - Match nearby saved places or present ephemeral preview with "Add to favorites";
   - Bypass `S01` when a location deep link opens a fresh install.
4. Immediately replace Branch URLs in [ShareMessage.kt](../android/core-domain/src/main/kotlin/net/wizardfactory/todayweather/core/domain/share/ShareMessage.kt) with `https://link.todayweather.ai/...`; update `ShareMessageTest.kt`, `ShareTest.kt`, and [android/parity.md](../android/parity.md).

### M5. iOS native integration (`ios/`)
1. Implement `DeepLink` parser & URL builder in `ios/Core/Sources/TWDomain/Share/DeepLink.swift` and verify against `specs/deeplink.golden.json` (`DeepLinkTests.swift`).
2. Add `com.apple.developer.associated-domains` (`applinks:link.todayweather.ai`) to [TodayWeather.entitlements](../ios/Support/TodayWeather.entitlements) and [TodayWeatherRelease.entitlements](../ios/Support/TodayWeatherRelease.entitlements).
3. Update [AppScenes.swift](../ios/TodayWeather/AppScenes.swift) (`NSUserActivityTypeBrowsingWeb` filter) and [AppLaunch.swift](../ios/TodayWeather/Shell/AppLaunch.swift) to:
   - Handle `DeepLink` alongside `WidgetSharing.Link` (`todayweather://widget?place=...`);
   - Dismiss open overlays/menus, route tabs/overlays, match nearby saved places or display ephemeral preview with "Add to favorites";
   - Bypass `S01` on location deep links when zero places are saved.
4. Immediately replace Branch URLs in [ShareMessage.swift](../ios/Core/Sources/TWDomain/Share/ShareMessage.swift) with `https://link.todayweather.ai/...`; update `ShareMessageTests.swift`, `ShareTests.swift`, and [ios/parity.md](../ios/parity.md).

### M6. Documentation, policy verification, and live rollout checks
1. Update [docs/rewrite/decisions-and-open-questions.md](../docs/rewrite/decisions-and-open-questions.md) (`D35`), [docs/architecture/web-client.md](../docs/architecture/web-client.md), and `docs/architecture/mobile-api.md` (if route/share contract summaries reference Branch or deep links).
2. Run `python3 scripts/check-artifact-policy.py --staged` and all platform automated test suites.
3. After operator deploys `infra/deeplink/` and `web/dist`, run `scripts/deeplink-live-smoke.mjs` and physical device verification on iOS and Android (cold start, warm start, KakaoTalk in-app browser, `pm get-app-links`, and non-hijacking check for `todayweather.ai/mobile/privacy.html` and `app.todayweather.ai`).

## User scenarios and coverage

| ID | User and goal | Prerequisites / ordered actions | Expected result and failure path | Acceptance / evidence |
| --- | --- | --- | --- | --- |
| S1 | Existing mobile app user taps shared city link | App installed (cold or warm). Tap `https://link.todayweather.ai/place/seoul?view=daily` from Messages/KakaoTalk | OS opens TodayWeather directly (no browser bounce); opens Daily tab for Seoul (matched favorite or ephemeral preview with Add button). Unknown slug opens safely to default screen | AC1, AC3, AC4, AC8, AC9 |
| S2 | Existing mobile app user taps shared neighborhood coordinate link | App installed. Tap `https://link.todayweather.ai/loc?lat=37.556&lon=126.979&name=회현동` | Nearby saved place opens if within `0.01°`; otherwise ephemeral preview renders without mutating saved list, offering 1-tap "Add to favorites". Invalid coords fall back safely | AC1, AC8, AC9 |
| S3 | Freshly installed user opens location deep link | Fresh install with 0 saved places (`S01` not completed). Open `/place/busan` or `/loc?...` | Temporarily bypasses `S01` and opens a preview. Explicit Add saves the first location and completes onboarding. Leaving without adding returns to `S01` with zero saved places | AC8, AC9 |
| S4 | Browser user without app taps shared weather link | No native app (or desktop). Open `https://link.todayweather.ai/loc?...` or `/place/seoul` | Edge redirects `302` to `https://app.todayweather.ai/...`; weather renders immediately with a dismissible "Open in app / Install" banner. Invalid coords recover cleanly | AC5, AC6, AC7, AC12 |
| S5 | User taps general app link or QR code | Tap `https://link.todayweather.ai/` or `/open` | Installed mobile opens app directly; uninstalled mobile or desktop receives `/open.html` with App Store, Google Play, and Web PWA buttons plus OG preview | AC3, AC4, AC5, AC8, AC9 |
| S6 | User shares current place from iOS, Android, or Web | Tap share on Hourly/Daily/Air screen | Share sheet/clipboard contains `https://link.todayweather.ai/...` (zero `twa.app.link`), rounded to 3 decimals for coordinates; tapping that link re-opens the same location | AC7, AC11 |
| S7 | User taps policy link in app or visits PWA directly | Tap Privacy/Terms in app settings (`todayweather.ai/mobile/*`) or visit `app.todayweather.ai` in mobile Safari/Chrome | Always opens in browser/PWA; never triggers Universal Links or App Links | AC10 |
| S8 | Existing widget user taps home-screen widget | Tap iOS widget (`todayweather://widget?place=...`) or Android widget (`todayweather://N`) | Existing widget navigation continues unchanged with zero regression | AC8, AC9 |
