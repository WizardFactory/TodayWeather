# TodayWeather deep link specification (`link.todayweather.ai`)

Date: 2026-11-21. Governs URL grammar, domain verification, static edge routing, Web PWA fallback, native iOS/Android parsing and navigation, and immediate replacement of legacy Branch (`twa.app.link`) share links. See [intent](../intent/deeplink.md) and [implementation plan](../plans/deeplink.md).

## 1. Domain topology and isolation

| Origin / scheme | Role | Universal / App Links | Notes |
| --- | --- | --- | --- |
| `https://link.todayweather.ai` | Canonical deep-link and share hub | **Enabled** (iOS AASA + Android `assetlinks.json`) | Dedicated private S3 + OAC + CloudFront stack (`infra/deeplink/`). Isolates deep links from marketing, policies, and PWA shell; enables future `/s/{code}` short links or dynamic OG previews without touching other hosts. |
| `https://todayweather.ai` | Brand landing, `/app-ads.txt`, `/mobile/*` policy pages | **Disabled** | Preserves [store policy and app-ads hosting](../docs/operations/cordova-store-release.md); prevents in-app policy links from looping back into the app. |
| `https://app.todayweather.ai` | Static Web PWA (`web/`) | **Disabled** | Preserves intentional browser/PWA access; web share buttons emit `https://link.todayweather.ai/...`. |
| `todayweather://` | Internal widget and legacy entry scheme | Custom scheme only (not for external sharing) | Retains iOS `todayweather://widget?place={id}` ([WidgetSharing.swift](../ios/TodayWeather/Weather/WidgetSharing.swift)) and Android `todayweather://{index}` ([ShareMessage.kt](../android/core-domain/src/main/kotlin/net/wizardfactory/todayweather/core/domain/share/ShareMessage.kt)). |

## 2. Canonical URL contract

All HTTPS deep links use scheme `https` and host `link.todayweather.ai` (case-insensitive host, lowercase path segments, optional single trailing slash tolerated on read, canonical generation omits trailing slash except root `/`). Unknown query parameters (e.g., campaign parameters) are ignored without failing parsing. Malformed paths or invalid required parameters must never crash any client; native apps fall back safely to opening the app on its default screen, and edge routing returns `404 Not Found` for unknown paths.

| Route | Canonical URL (`https://link.todayweather.ai`) | Query parameters | Native app target | Browser / PWA fallback (`https://app.todayweather.ai`) |
| --- | --- | --- | --- | --- |
| App open (Branch replacement) | `/` or `/open` | `lang` (optional BCP-47 primary tag, e.g. `ko`, `en`); `fallback=store` (optional edge-only store redirect hint, ignored by native) | Open app (preserve active/default startup tab) | `302` to `https://app.todayweather.ai/` (or OS-matched App Store / Google Play when `fallback=store` is present on mobile UA) |
| Catalog place weather | `/place/{slug}` | `view` = `hourly` (default) \| `daily` \| `air`; `pollutant` (used when `view=air`) | Resolve catalog slug; open matching saved place or ephemeral preview on requested tab | `302` to `/weather/{slug}/{view}?from=link` (`hourly` default or `daily`) or `/air/{slug}?from=link` with optional `pollutant` when reading the inbound alias `?view=air` |
| Arbitrary coordinate weather | `/loc` | `lat` (required), `lon` (required), `name` (optional), `view` = `hourly` (default) \| `daily` \| `air`, `pollutant` (optional) | Validate coordinates; match nearby saved place or open ephemeral preview on requested tab | `302` to `https://app.todayweather.ai/loc?lat={lat}&lon={lon}[&name=...][&view=...][&pollutant=...]` |
| Catalog air detail | `/air/{slug}` | `pollutant` = `aqi` \| `pm25` \| `pm10` \| `o3` \| `no2` \| `so2` \| `co` (optional, default `aqi`) | Resolve catalog slug; open Air tab (`S05`) with selected pollutant | `302` to `https://app.todayweather.ai/air/{slug}[?pollutant=...]` |
| Nationwide weather | `/nation/weather` | none | Open Nationwide Weather overlay (`S10`) | `302` to `https://app.todayweather.ai/nation/weather` |
| Nationwide air | `/nation/air` | none | Open Nationwide Air overlay (`S11`) | `302` to `https://app.todayweather.ai/nation/air` |
| Special warnings | `/warnings` | none | Open Weather Warnings overlay (`S12`) | `302` to `https://app.todayweather.ai/warnings` |

### 2.1 Validation, rounding, and privacy rules

1. **Slug (`{slug}`):** ASCII `[a-z0-9-]{1,64}`. The edge maps syntactically valid slugs to the requested `/weather/{slug}/{view}` or `/air/{slug}` PWA route. The PWA and native navigation resolve the slug using their shared or mirrored `PLACES` catalog from `packages/weather-core`. If it is unknown, the PWA shows its not-found state and native navigation stays on the current or startup screen without saving a place.
2. **Coordinates (`lat`, `lon`):**
   - Must parse as finite decimal numbers with `lat ∈ [-90, 90]` and `lon ∈ [-180, 180]`. `0` is valid (must not use truthiness checks).
   - **Wire order:** always explicit named query keys `lat` and `lon` (never ambiguous comma arrays).
   - **Privacy rounding on share generation:** round coordinates to **3 decimal places** (≈110 m, matching [webapp technical design](../docs/webapp/technical-design.md#public-api-contract)). When sharing the user's current GPS position, prefer matching a curated catalog city within `0.04°` when appropriate, or emit rounded coordinates (3 decimals, or 2 decimals if coarsened) without exposing exact GPS precision or device identifiers.
3. **Display hint (`name`):**
   - Optional UTF-8 URL-encoded string, trimmed, control characters (`U+0000`–`U+001F`, `U+007F`) stripped, truncated to 80 Unicode scalar values.
   - Always rendered as plain text (never interpolated into HTML). Weather fetches always use `lat,lon`, never trusting `name` as an API path.
4. **View and pollutant normalization:**
   - `view`: only `hourly`, `daily`, `air` are accepted; unknown or missing values default to `hourly`.
   - `pollutant`: only `aqi`, `pm25`, `pm10`, `o3`, `no2`, `so2`, `co` are accepted; unknown or missing values default to `aqi`.
5. **No private or mutable state in URLs:**
   - Never include favorite list indexes (`0`, `1`, `2`), push tokens, device IDs, or user preferences in HTTPS deep links.
6. **Path traversal and malformed encoding:**
   - Edge function rejects invalid percent-encoding, `..`, `\`, or NUL (`\u0000`) with `400 Bad Request`, matching [route-request.js](../infra/web/static/route-request.js).

## 3. OS domain verification files (`.well-known`)

Both files must be served directly over HTTPS from `https://link.todayweather.ai/.well-known/...` with **HTTP `200 OK`**, **`Content-Type: application/json`**, **no HTTP redirect**, and `Cache-Control: public, max-age=3600`.

### 3.1 iOS Universal Links (`/.well-known/apple-app-site-association`)

Served without a file extension, ≤ 128 KiB:

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["<APPLE_TEAM_ID>.net.wizardfactory.todayweather"],
        "components": [
          { "/": "/" },
          { "/": "/open" },
          { "/": "/open/" },
          { "/": "/place/*" },
          { "/": "/loc" },
          { "/": "/loc/" },
          { "/": "/air/*" },
          { "/": "/nation/weather" },
          { "/": "/nation/weather/" },
          { "/": "/nation/air" },
          { "/": "/nation/air/" },
          { "/": "/warnings" },
          { "/": "/warnings/" }
        ]
      }
    ]
  }
}
```

- `<APPLE_TEAM_ID>` is injected at deploy/generation time from operator configuration (never committed if private; validated against `[A-Z0-9]{10}`).
- iOS app entitlements ([TodayWeather.entitlements](../ios/Support/TodayWeather.entitlements) and [TodayWeatherRelease.entitlements](../ios/Support/TodayWeatherRelease.entitlements)) declare:
  ```xml
  <key>com.apple.developer.associated-domains</key>
  <array>
      <string>applinks:link.todayweather.ai</string>
  </array>
  ```
- Apple Developer Portal App ID for `net.wizardfactory.todayweather` must have **Associated Domains** enabled prior to archive/signing.

### 3.2 Android App Links (`/.well-known/assetlinks.json`)

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "net.wizardfactory.todayweather",
      "sha256_cert_fingerprints": [
        "<PLAY_APP_SIGNING_SHA256>"
      ]
    }
  }
]
```

- `<PLAY_APP_SIGNING_SHA256>` is injected at deploy/generation time from operator configuration (colon-separated uppercase hex SHA-256). Optional internal-testing / debug signing fingerprints may be added only in authorized test environments, never hardcoded secrets.
- [AndroidManifest.xml](../android/app/src/main/AndroidManifest.xml) adds an explicit `android:autoVerify="true"` intent filter on `.MainActivity`:
  - `ACTION_VIEW` + `CATEGORY_DEFAULT` + `CATEGORY_BROWSABLE`
  - `scheme="https"`, `host="link.todayweather.ai"`
  - Explicit paths matching the canonical contract (`/`, `/open`, `/place/`, `/loc`, `/air/`, `/nation/weather`, `/nation/air`, `/warnings`).

## 4. `link.todayweather.ai` static edge infrastructure (`infra/deeplink/`)

Modeled on [infra/web/static/stack.json](../infra/web/static/stack.json): private S3 bucket (public access blocked, versioning enabled, SSE-S3), CloudFront OAC, TLS 1.2+ (`sni-only`), `redirect-to-https`, strict security headers/CSP, and a `cloudfront-js-2.0` `viewer-request` function (`infra/deeplink/route-request.js`).

### 4.1 Viewer-Request Function behavior

1. Allow only `GET` and `HEAD`; return `405 Method Not Allowed` otherwise.
2. Decode URI; reject malformed encoding, `..`, `\`, or NUL with `400 Bad Request`.
3. **Verification files (served from S3, 200 OK, no redirect):**
   - `/.well-known/apple-app-site-association`
   - `/.well-known/assetlinks.json`
   - No HTML landing page or static web assets are served on `link.todayweather.ai`.
4. **Store fallback redirect (`?fallback=store` on any recognized deep-link route):**
   - When `fallback=store` is present on a recognized deep-link route (`/`, `/open`, `/place/{slug}`, `/loc`, `/air/{slug}`, `/nation/weather`, `/nation/air`, `/warnings`) and the request reaches the edge (app not installed, or Universal/App Links suppressed):
     - Return `302 Found` with `Cache-Control: no-store` and `Vary: User-Agent`:
       - iOS `User-Agent` (`/iPhone|iPad|iPod/i`) or explicit `store=ios` (for desktop-class iPadOS Safari UA) → `https://apps.apple.com/app/id1041700694`.
       - Android `User-Agent` (`/Android/i`) or explicit `store=android` → `https://play.google.com/store/apps/details?id=net.wizardfactory.todayweather`.
       - Desktop or unknown `User-Agent` → fall through to the normal WebApp `302` destination below.
   - Native apps ignore unknown query parameters (`fallback`, `store`) and still open the requested place/tab directly when Universal Links or App Links fire.
5. **App-open and content-link browser fallback (`302 Found` with `Cache-Control: no-store`):**
   - `/` or `/open` or `/open/` → `https://app.todayweather.ai/`.
   - `/place/{slug}` → `https://app.todayweather.ai/weather/{slug}/{view}?from=link` (`view` normalized to `hourly` or `daily`), or `https://app.todayweather.ai/air/{slug}[?pollutant=...]&from=link` when `view=air` (omitting `pollutant` when default `aqi`).
   - `/loc` (with valid `lat` and `lon`) → `https://app.todayweather.ai/loc?lat={lat}&lon={lon}[&name=...][&view=...][&pollutant=...]&from=link` (normalizing coordinates, stripping control chars / 80-char capping `name`, omitting default `view=hourly` and default `pollutant=aqi`). If `lat`/`lon` are missing or invalid, redirect `302` to `https://app.todayweather.ai/`.
   - `/air/{slug}` → `https://app.todayweather.ai/air/{slug}[?pollutant=...]&from=link` (omitting `pollutant` when default `aqi`).
   - `/nation/weather` → `https://app.todayweather.ai/nation/weather?from=link`.
   - `/nation/air` → `https://app.todayweather.ai/nation/air?from=link`.
   - `/warnings` → `https://app.todayweather.ai/warnings?from=link`.
6. **All other paths:** return `404 Not Found` (including removed `/open.html` and `/assets/*`). Never fall back unknown paths to `200 OK` or `/`.

## 5. Web PWA behavior (`web/` + `infra/web/static/`)

1. **New `/loc` route:**
   - Add `/loc\/?$` to [infra/web/static/route-request.js](../infra/web/static/route-request.js) and `<Route path="/loc" element={<CoordinatePlace />} />` to [web/src/App.tsx](../web/src/App.tsx).
   - Parse and validate `lat`, `lon`, `name`, `view`, `pollutant` using the shared contract.
   - Check saved places in `localStorage` for a nearby match (within `0.01°` on both axes; catalog match within `0.04°` when applicable). If matched, navigate to that place's requested view.
   - If unmatched, load coordinate weather directly in an **ephemeral preview** (without auto-saving to favorites) with a clear "내 지역에 추가 (Add to favorites)" button and the requested `view` (`hourly`/`daily`/`air`).
   - Invalid coordinates render a recoverable error state with a link to `/locations`.
2. **Existing `/place/:publicId` route enhancement:**
   - Support optional `view` (`hourly`/`daily`/`air`) and `pollutant` query parameters while preserving current behavior when absent.
3. **Mobile "Open in app" (`앱에서 보기`) action & iOS Smart App Banner:**
   - On mobile web visitors (dismissible per browser session via `sessionStorage`), display a slim top bar offering **"앱에서 보기"** ("Open in app") that targets the **current screen's canonical `link.todayweather.ai` URL** (preserving place, coordinates, view, and air pollutant rather than hard-coding `/open`):
     - **Android:** `intent://link.todayweather.ai/{pathAndQuery}#Intent;scheme=https;package=net.wizardfactory.todayweather;S.browser_fallback_url=<encoded Google Play URL>;end` (launches the installed app on the current screen, or falls back directly to Google Play if uninstalled).
     - **iOS / iPadOS:** `https://link.todayweather.ai/{pathAndQuery}?fallback=store` (appending `&store=ios` when desktop-class iPadOS Safari reports a Macintosh User-Agent). In Safari, Universal Links open the installed app on the current screen and uninstalled devices receive `302` to the App Store. Because iOS does not expose app installation state to web pages, in-app browsers that suppress Universal Links redirect to the App Store (where installed users see "Open" with no error popup, though the place context is not carried across the Store).
   - Include `<meta name="apple-itunes-app" content="app-id=1041700694, app-argument=https://link.todayweather.ai/...">` in [web/index.html](../web/index.html) and keep `app-argument` synchronized with the current route's canonical deep link for Safari's native Smart App Banner.
4. **Desktop fixed QR code:**
   - On desktop browsers (hidden on mobile/compact viewports), render a scannable static SVG QR code in the sidebar encoding the fixed URL `https://link.todayweather.ai/open?fallback=store`. Scanning with a phone camera opens the installed mobile app directly or redirects to App Store (iOS) / Google Play (Android) automatically.
5. **Default Open Graph metadata ([web/index.html](../web/index.html)):**
   - Include static `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image` (`https://app.todayweather.ai/icons/icon-512.png`), and `twitter:card` so link previews render cleanly when crawlers follow `302` redirects from `link.todayweather.ai`.
6. **Unified share URL generation ([web/src/Weather.tsx](../web/src/Weather.tsx)):**
   - Sharing a catalog city generates the view-specific URL defined in §7, including `/air/{slug}` from the Air tab.
   - Sharing a non-catalog place generates `https://link.todayweather.ai/loc?lat={roundedLat}&lon={roundedLon}&name={encodedName}` (using 3-decimal coordinate rounding; current GPS location applies the privacy rule in §2.1).

## 6. Native iOS and Android behavior

### 6.1 Shared domain parser (`TWDomain` & `core-domain`)

Both iOS (`ios/Core/Sources/TWDomain/Share/DeepLink.swift`) and Android (`android/core-domain/.../share/DeepLink.kt`) implement an identical pure parser producing a typed `DeepLinkTarget`:
- `open(lang: String?)`
- `place(slug: String, view: WeatherView, pollutant: String?)`
- `coordinate(lat: Double, lon: Double, name: String?, view: WeatherView, pollutant: String?)`
- `nationWeather`
- `nationAir`
- `warnings`
- `legacyWidget(placeID: String?)` (iOS `todayweather://widget?place=...`) / `legacyWidgetIndex(index: Double)` (Android `todayweather://N`)

### 6.2 Navigation, overlay cleanup, and ephemeral preview

When a valid `DeepLinkTarget` arrives (cold start or warm start, after Cordova migration completes):
1. **Dismiss transient UI:** close the side menu, settings stack, nationwide/warning overlays, and alarm editor (preserving unsaved-alarm confirmation semantics on iOS as in [AppLaunch.swift](../ios/TodayWeather/Shell/AppLaunch.swift#L269-L273)).
2. **Route execution:**
   - `open`: bring app forward on the current/default tab; no destructive state change.
   - `nationWeather` / `nationAir` / `warnings`: open `S10` / `S11` / `S12` overlay directly (on non-KR regions, allow viewing the explicitly linked Korean nationwide/warning page without crashing).
   - `place(slug, view, pollutant)` / `coordinate(lat, lon, name, view, pollutant)`:
     - Resolve catalog `slug` to canonical `(lat, lon, localizedName)`.
     - Search enabled saved places for a nearby coordinate match (threshold `0.01°` on both latitude and longitude; catalog ID match takes precedence if stored).
     - **If matched:** select that saved place, switch to the requested tab (`HOURLY` / `DAILY` / `AIR` with `pollutant` when `AIR`), and reload weather (reason `.deeplink`).
     - **If unmatched (ephemeral preview):** open the target weather/air screen in an **ephemeral preview state** (not written to persisted `places[]`), displaying a prominent non-blocking **"즐겨찾기 추가" (Add to favorites)** bar/button. Tapping "Add" persists the place (respecting the existing 30-place limit and showing the existing limit message if full) and promotes the preview to a normal saved place. Navigating away via the Locations tab or swiping to another saved place clears the ephemeral preview cleanly.
3. **Onboarding gate (`S01`) bypass on location deep link:**
   - If the app starts in `S01` (`startShows == true`, zero saved places) and a valid `place` or `coordinate` deep link is queued:
     - Temporarily bypass `S01` and open the requested tab in an ephemeral preview. Keep the saved list empty and onboarding pending until the user explicitly taps Add to favorites. A successful Add uses the existing first-place completion path. Leaving the preview without adding returns to `S01`.
   - For `open` or non-location deep links (`nation*`, `warnings`) while `S01` is active: keep `S01` visible and defer or ignore until onboarding completes.
4. **Platform-specific guards:**
   - **iOS ([AppScenes.swift](../ios/TodayWeather/AppScenes.swift)):** accept `userActivity` only when `activityType == NSUserActivityTypeBrowsingWeb` and `webpageURL != nil`, submitting into `AppLaunch.shared.entries`.
   - **Android ([Share.kt](../android/app/src/main/java/net/wizardfactory/todayweather/Share.kt), [MainActivity.kt](../android/app/src/main/java/net/wizardfactory/todayweather/MainActivity.kt)):** preserve `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY` filtering so reopening from Recents never replays an old deep link.

## 7. Immediate Branch (`twa.app.link`) replacement in `ShareMessage`

Both iOS ([ShareMessage.swift](../ios/Core/Sources/TWDomain/Share/ShareMessage.swift)) and Android ([ShareMessage.kt](../android/core-domain/src/main/kotlin/net/wizardfactory/todayweather/core/domain/share/ShareMessage.kt)) replace the hard-coded Branch links (`https://twa.app.link/wgVmUTfVoM`, `https://twa.app.link/II1JstpVoM`) immediately with `https://link.todayweather.ai/...`:

1. **URL selection per shared place:**
   - If the shared place matches a curated catalog city (within `0.04°` or exact ID) → `https://link.todayweather.ai/place/{slug}` for Hourly, `/place/{slug}?view=daily` for Daily, or `/air/{slug}` for Air. For Air, append `?pollutant=...` only when the selected pollutant differs from `aqi`. Accept inbound `/place/{slug}?view=air` as an alias.
   - Else if the shared place has valid finite `lat`/`lon` → `https://link.todayweather.ai/loc?lat={roundedLat}&lon={roundedLon}&name={encodedDisplayName}` (coordinates rounded to 3 decimal places; omit empty `name`, default Hourly view, and default AQI pollutant). Append `view=daily` or `view=air` when selected and a non-default `pollutant` only for Air.
   - Else (fallback when location metadata is missing/unusable) → `https://link.todayweather.ai/open` (language is auto-detected).
2. **Message text preservation:**
   - Preserve the existing multi-line weather summary format (`cityName`, current temperature + emoji, high/low, weather/air summary, blank line, `{appName} {url}`) so existing user expectations stay intact while replacing only the URL portion.
3. **Parity, deferred deep-link exclusion, and golden test updates:**
   - Record the intentional departure from Cordova's Branch links — including that **post-install deferred deep linking is not supported** (installing the app after tapping a shared link opens the normal startup flow rather than restoring the shared location; Android Play Install Referrer may be considered separately later) — in [decisions-and-open-questions.md](../docs/rewrite/decisions-and-open-questions.md) (`D35`), [ios/parity.md](../ios/parity.md), and [android/parity.md](../android/parity.md).
   - Update `ShareMessageTests` (iOS) and `ShareMessageTest` (Android) golden expectations to test the new `link.todayweather.ai` URL generation rules alongside legacy message formatting.
   - Keep existing Branch redirects live during a post-release grace period for historical messages shared by older app versions.

## 8. Cross-platform Golden Test Vector contract

Maintain one shared JSON fixture ([deeplink.golden.json](deeplink.golden.json)), verified for schema/catalog parity and reference-parser consistency by [deeplink-golden.test.mjs](../scripts/verification/deeplink-golden.test.mjs) and consumed by:
- CloudFront Function unit tests (`infra/deeplink/`),
- Web PWA unit/browser tests (`web/`),
- Android `core-domain` unit tests (`DeepLinkTest.kt`),
- iOS `TWDomain` unit tests (`DeepLinkTests.swift`).

Required vector categories:
- Root `/` and `/open` (with and without trailing slash, with `?lang=ko`, with unknown UTM params),
- Valid catalog `/place/seoul`, `/place/tokyo?view=daily`, `/place/busan?view=air&pollutant=pm25`,
- Valid `/air/seoul?pollutant=o3` and unknown pollutant fallback to `aqi`,
- Valid `/loc?lat=37.566&lon=126.978&name=%EC%84%9C%EC%9A%B8&view=hourly`, equator/prime meridian `lat=0&lon=0`, negative southern/western hemispheres,
- Invalid coordinates (`lat=91`, `lon=-181`, `lat=NaN`, missing `lon`), control chars & >80-char truncation in `name`,
- Nationwide `/nation/weather`, `/nation/air`, `/warnings`,
- Unknown catalog slug (syntactic parse succeeds, catalog lookup fails; edge redirects to the matching PWA route),
- Unknown paths (`/unknown`, `/mobile/privacy.html` on `link.todayweather.ai`), path traversal (`/../etc/passwd`, `%00`),
- Non-matching hosts (`https://todayweather.ai/mobile/privacy.html`, `https://app.todayweather.ai/weather/seoul/hourly`) → rejected by native deep-link parser,
- Legacy custom schemes (`todayweather://widget?place=...`, `todayweather://2`, bare `todayweather://`).

## 9. Acceptance criteria

| ID | Observable check |
| --- | --- |
| AC1 | Shared golden test vector passes identically across CloudFront Function, Web, iOS `TWDomain`, and Android `core-domain`. |
| AC2 | `infra/deeplink/` CloudFormation template validates cleanly (private S3 + OAC + CloudFront + `cloudfront-js-2.0` function + strict CSP, zero backend compute). |
| AC3 | Live `https://link.todayweather.ai/.well-known/apple-app-site-association` returns HTTP `200`, `Content-Type: application/json`, zero redirects, valid JSON with expected `appIDs` and components. |
| AC4 | Live `https://link.todayweather.ai/.well-known/assetlinks.json` returns HTTP `200`, `Content-Type: application/json`, zero redirects, valid JSON with `net.wizardfactory.todayweather` and release SHA-256 fingerprint. |
| AC5 | Browser `GET https://link.todayweather.ai/` and `/open` return `302` to `https://app.todayweather.ai/`; adding `?fallback=store` returns `302` to App Store on iOS UA, Google Play on Android UA, and WebApp on desktop/unknown UA (`Cache-Control: no-store`, `Vary: User-Agent`). |
| AC6 | Browser `GET` to `/place/*`, `/loc?...`, `/air/*`, `/nation/*`, `/warnings` returns `302` to the exact mapped `https://app.todayweather.ai/...` path (or OS store when `?fallback=store` is set on mobile UA); unknown paths (including `/open.html` and `/assets/*`) return `404`. |
| AC7 | Web PWA renders `/loc?lat=...&lon=...` in ephemeral preview with "Add to favorites", matches existing saved places when nearby, offers a mobile "Open in app" action preserving the current route (Android `intent://`, iOS `?fallback=store` + Safari Smart App Banner), shows a fixed desktop QR code (`https://link.todayweather.ai/open?fallback=store`), carries default OG metadata, and shares `https://link.todayweather.ai/...`. |
| AC8 | iOS real device opens `link.todayweather.ai` Universal Links directly in app (cold and warm start), routes tabs/overlays/ephemeral preview, temporarily bypasses `S01` without saving until explicitly requested, and keeps `todayweather://widget?...` working. |
| AC9 | Android real device reports `verified` via `adb shell pm get-app-links net.wizardfactory.todayweather`, opens `link.todayweather.ai` App Links directly (cold and warm start), ignores history replay, temporarily bypasses `S01` without saving until explicitly requested, and keeps `todayweather://N` working. |
| AC10 | Opening `https://todayweather.ai/mobile/privacy.html`, `support.html`, `terms.html`, and `https://app.todayweather.ai/` from inside the native app or browser NEVER triggers Universal Links or App Links. |
| AC11 | iOS and Android share buttons emit `https://link.todayweather.ai/...` (zero `twa.app.link` URLs in active share output) with 3-decimal rounded coordinates and updated golden/parity records (`D35`). |
| AC12 | Korean in-app browser smoke (e.g., KakaoTalk) renders weather cleanly on fallback and provides a working "Open in app / Install" action. |
| AC13 | No secrets, real Team IDs, real signing fingerprints, or private AWS IDs are committed; `python3 scripts/check-artifact-policy.py --staged` passes. |
| AC14 | Affected architecture docs (`docs/architecture/web-client.md`, `docs/architecture/mobile-api.md`, `docs/rewrite/decisions-and-open-questions.md`) are updated to match shipped behavior. |
