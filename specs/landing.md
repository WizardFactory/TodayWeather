# `todayweather.ai` Brand Landing Page — Specification

Inputs: [Landing intent](../intent/landing.md) · [Product lifecycle](../docs/architecture/service-overview.md#product-lifecycle) · [Static web client](../docs/architecture/web-client.md) · [Store release & landing hosting](../docs/operations/cordova-store-release.md#privacysupport-hosting-on-the-landing-site) · [21 priority markets & 48 focus cities](../docs/operations/mobile-focus-cities.md) · [Webapp specification](../docs/webapp/specification.md#supported-languages-and-screen-sizes) · [Design system](../docs/design-system/README.md).

Status: Planning baseline. UI work starts with the landing token selection in the [implementation plan](../plans/landing.md). Analytics activation also requires the consent and policy checks in §6.

---

## 1. Domain Architecture & Ownership Boundaries

TodayWeather separates public web responsibilities across three hostnames:

| Hostname | Role | Universal / App Links | Runtime Weather API Calls |
| --- | --- | --- | --- |
| `https://todayweather.ai` | Brand landing page, Developer Website (`#2871`), `/app-ads.txt`, `/mobile/*` legal/support documents | **Forbidden** | **None** |
| `https://app.todayweather.ai` | Static responsive PWA & desktop web app (`web/`) | **Forbidden** | Direct public API (`todayweather.wizardfactory.net`) |
| `https://link.todayweather.ai` | Universal Links, App Links & share hub (`#3092`) | **Yes (`/.well-known/*`)** | None (edge fallback / PWA redirect) |

`www.todayweather.ai` had no DNS record at planning intake (2026-11-21) and is out of scope unless separately provisioned as a `301` redirect to `https://todayweather.ai`.

---

## 2. URL Contract & CloudFront Edge Routing (`AC1`, `AC3`, `AC7`)

### 2.1 Canonical Public Routes on `https://todayweather.ai`

| Path | Origin Object / Handling | Status | Cache-Control |
| --- | --- | --- | --- |
| `/` | CloudFront `viewer-request` function resolves locale and returns `302` to `/{lang}/` | `302` | `private, no-store` |
| `/{lang}/` (`ko`, `en`, `ja`, `de`, `fr`, `pt`, `es`) | Rewritten in `viewer-request` to `/{lang}/index.html` | `200` | `public, max-age=0, must-revalidate` |
| `/{lang}` (no trailing slash) | `301` redirect to `/{lang}/` (preserves query string such as UTM parameters) | `301` | `public, max-age=3600` |
| `/landing-assets/*` (hashed CSS/JS/fonts/images) | Served directly from S3 | `200` | `public, max-age=31536000, immutable` |
| `/og/*.png`, `/favicon.ico`, `/apple-touch-icon.png` | Served directly from S3 | `200` | `public, max-age=86400` |
| `/robots.txt`, `/sitemap.xml` | Served directly from S3 | `200` | `public, max-age=3600` |
| `/landing-release.json` | Build descriptor (commit, builtAt, siteOrigin, languages) | `200` | `public, max-age=0, must-revalidate` |
| `/app-ads.txt` | **Pass-through untouched** (owned by `#2871` release script) | `200` | Managed externally (`public, max-age=300`) |
| `/mobile/*` | **Pass-through untouched** (owned by `#2660` / policy workflow) | `200` | Managed externally (`public, max-age=300`) |
| Any unknown path | Pass through to S3 (403/404) or dedicated static `/404.html` without rewriting arbitrary paths to `200` | `404` / `403` | — |

### 2.2 Root `/` Language Auto-Redirect Rules (`infra/landing/route-request.js`)

The `viewer-request` CloudFront Function (`cloudfront-js-2.0`) runs on `$LANDING_DISTRIBUTION` with zero external calls:

1. **Protected pass-through first**: Requests for `/app-ads.txt`, `/mobile/*`, `/robots.txt`, `/sitemap.xml`, `/landing-assets/*`, `/og/*`, `/landing-release.json`, and known static icons pass directly to S3 without redirect or URI rewrite.
2. **Root `/` redirect precedence** (preserves parameter names and values, including repeats and escaped values, within the CloudFront event format):
   - **Priority 1 — Explicit user choice cookie (`tw_locale`)**: If cookie `tw_locale` is one of `ko | en | ja | de | fr | pt | es`, redirect `302` to `/{tw_locale}/`.
   - **Priority 2 — Browser `Accept-Language` header**: Parse ordered `Accept-Language` entries by `q`-weight (default `1.0`, ignoring `q=0`, preserving input order on ties). For each entry, extract the primary language subtag (case-insensitive, split on `-` or `_`, e.g., `pt-BR` → `pt`, `fr-CA` → `fr`, `es-MX` → `es`, `ko-KR` → `ko`, `zh-TW` → `zh`). Return the first primary subtag present in `{ko, en, ja, de, fr, pt, es}` and redirect `302` to `/{lang}/`.
   - **Priority 3 — Default fallback**: Redirect `302` to `/en/`.
   - **Response caching safety**: Edge-generated `302` responses include `Cache-Control: private, no-store` so CloudFront and intermediary caches never cache one visitor's language redirect for another visitor.
   - **Origin fallback**: Keep the default root object at `index.html`. The static fallback links to all seven explicit `/{lang}/index.html` objects so language navigation works during first cutover or if the function is detached.
3. **Direct locale URLs never force-redirect**:
   - `GET /ko/`, `GET /en/`, `GET /ja/`, `GET /de/`, `GET /fr/`, `GET /pt/`, `GET /es/` rewrite internally to `/{lang}/index.html` and return `200` regardless of `Accept-Language` or `tw_locale`.
   - Shared links and crawlers reach the requested translation directly. Canonical links and the sitemap use the clean paths.
   - `GET /{lang}` (without trailing slash) returns `301` to `/{lang}/` (preserving query string) to keep canonical URLs consistent.
4. **Manual language switcher behavior**:
   - Selecting another language in the header/footer switcher sets `tw_locale=<lang>; Path=/; Max-Age=31536000; SameSite=Lax; Secure` (functional cookie) and navigates to `/{lang}/`.

The root function uses the language preference only. It serializes query parameters from the [CloudFront Functions event object](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html) into a fixed same-origin destination. Test duplicate values, escaped delimiters, and empty values. Browser region handling for product defaults is described in §3. Analytics eligibility is described in §6.

---

## 3. Cross-Platform Locale Contract & `#2613` Clarification (`AC9`)

This specification records the settled cross-platform locale direction (AK, 2026-11-21) so `todayweather.ai`, `app.todayweather.ai`, and native mobile apps stay aligned:

1. **Two independent axes — never discard country/region on unsupported languages**:
   - **Language axis**: Selects UI prose and translations from the 7 supported languages (`ko, en, ja, de, fr, pt, es`), falling back to `en` for any unsupported language (such as `zh-TW`, `zh-CN`, `it`, `nl`).
   - **Country/Region axis**: Selects regional defaults (units, date/time/number conventions, AQI standard, storefront/regulatory context) across the 21 priority countries (`KR, JP, US, DE, GB, CA, AU, FR, BR, ES, MX, CH, AT, BE, IE, NZ, PT, AR, CL, CO, UY`) and international fallback.
   - **Correction to `#2613` / `docs/webapp/specification.md`**: Earlier wording stating "region ignored" for tags such as `zh-TW` or `pt-BR` is superseded. For example:
     - `zh-TW` → UI language `en`, country/region `TW` (preserved, not discarded).
     - `it-CH` → UI language `en`, country/region `CH` (Swiss regional defaults apply).
     - `ko-US` → UI language `ko`, country/region `US` (US regional defaults apply).
2. **Platform signal sources**:
   - **Native mobile apps (iOS / Android)**: Read **OS device language** (including OS per-app language on iOS 13+ / Android 13+), **OS device region/country**, and **OS regional symbols/preferences** (12/24h clock, measurement/temperature preferences, number separators).
   - **WebApp**: Resolve display language from the supported browser preferences and resolve country independently. Prefer the first valid explicit BCP 47 country subtag in browser preference order, including tags whose language is unsupported. For example, `["de", "en-US"]` yields German UI and US defaults. With no explicit country, `ko` and `ja` may supply KR and JP defaults. Other cases use the international default unless #2613 qualifies a first-party country signal for that fallback. An unmanaged region such as TW is retained and uses international units until a regional profile exists.
   - **Brand landing**: Use the seven language routes in §2. The selected language and any browser region stay independent. The language route does not encode country, switch storefronts, set product units, or determine analytics eligibility.
3. **Linked follow-ups outside landing-page implementation**:
   - **Follow-up F1 (`#2613` / `web/src/locale.ts` / `docs/webapp/specification.md`)**: Update `#2613` and web locale resolution so region extraction preserves explicit country context even when the primary language is unsupported or paired across tags.
   - **Follow-up F2 (`#2613` mobile settings review)**: Evaluate moving the mobile language picker to OS device or per-app settings. For `S07`, evaluate automatic defaults from OS preferences, then device region, then international defaults. Consider optional overrides for OS-absent dimensions such as AQI, wind speed and pressure. Verify older supported OS versions and migration of saved preferences before deciding which settings to remove.

---

## 4. Information Architecture, Content & Visual Contract (`AC2`, `AC4`)

### 4.1 Page Structure (All 7 Languages)

Each `/{lang}/index.html` is a single semantic, accessible document with clear landmark regions (`<header>`, `<main>`, `<footer>`):

1. **Top Navigation (`<header>`)**:
   - TodayWeather brand mark + localized product name (`오늘날씨` / `TodayWeather` / `HeuteWetter` where established, else `TodayWeather`).
   - Anchor links: Features (`#features`), Platforms (`#platforms`), Data Sources (`#sources`).
   - Compact language switcher (`한국어`, `English`, `日本語`, `Deutsch`, `Français`, `Português`, `Español`) with `aria-current="page"` on active locale and cookie persistence.
   - Primary quick-open button to `https://app.todayweather.ai`.
2. **Hero Section**:
   - Core product promise ("어제보다 오늘은" / "Understand today's weather at a glance compared to yesterday").
   - Use one primary action, **Open TodayWeather**, linking to `https://link.todayweather.ai/open` on every platform. The OS can open an associated app. Browser visitors can choose the WebApp or a store on the link host's fallback page, as specified in [#3092](https://github.com/WizardFactory/TodayWeather/issues/3092).
   - Link the hourly chart caption to `https://link.todayweather.ai/place/seoul` so visitors can open the Seoul forecast in the app or via the web fallback. Use a responsive native hourly chart capture in the hero. Offer direct browser entry in the WebApp section.
3. **Core Feature Showcase (`#features`)**:
   - **Hourly Yesterday Comparison**: Visual showcase of today vs. yesterday temperature curve, precipitation amounts, and wind/humidity details.
   - **Daily Min–Max Bars**: Shared-scale multi-day temperature range bars (`#9bcdf0` → `#f0c77f` cool-to-warm gradient) with past-day context and AM/PM icons.
   - **Air Quality & Pollutants**: Multi-standard AQI (AirKorea, WHO, AirNow, AQICN), PM2.5/PM10/O₃/NO₂/SO₂/CO breakdown, and station attribution.
   - **Worldwide Coverage & Regional Fit**: 21 priority markets & worldwide cities, regional units, official warnings, and Korean nationwide weather and air maps and solar-term summaries. Verify feature availability by client and market before publishing the claims.
   - **Home-screen widget**: Show a released native widget on the phone’s home screen with a localized caption about checking the weather at a glance. The [Korean store review summary](../docs/evidence/research/landing-store-voice-2026-11-21.md) documents the use case.
4. **Cross-Platform Availability (`#platforms`)**:
   - Side-by-side summary of **WebApp (PWA & Desktop)**, **iOS Native App**, and **Android Native App** (explicitly noting offline snapshot support on WebApp and scheduled/alert notifications on native mobile apps; no claims of web push or retired TodayAir/Cordova).
5. **Weather & Air Data Attribution (`#sources`)**:
   - Transparent source credits matching [cordova-store-release.md](../docs/operations/cordova-store-release.md#L143-L155): KMA (Korea Meteorological Administration), AirKorea (Ministry of Environment / Korea Environment Corporation), Visual Crossing, Google Air Quality / Pollen, OpenWeather (and provisional-data / official-warning caution).
6. **Footer (`<footer>`)**:
   - Official Developer / Operator identification matching [support.html](../client/fastlane/privacy/support.html): Flying Inc. (주식회사 플라잉) · Product Team · `mailto:todayweather@wizardfactory.net`.
   - Language-matched legal & support links to `/mobile/{privacy,terms,support}{suffix}.html`.
   - Persistent **"Analytics & Cookie Settings"** button (opens the consent preference modal in every region, allowing opt-in/opt-out at any time).
   - Language switcher repeat for mobile convenience.

### 4.2 Visual & Design-System Contract (`Gate 0` Dependency)

- **Prerequisite**: Consumes tokens emitted by the shared `packages/design-tokens/` package (color surfaces, typography scale, spacing, radii, cool-to-warm gradient, light/dark themes). Do not duplicate raw hex/type values when a token exists.
- **Typography**: Self-hosted Pretendard Variable for Korean/Latin (matching `web/`), paired with clean system CJK fallback for Japanese (`Hiragino Sans`, `Yu Gothic`, `Noto Sans JP`) and accessible responsive sizing (16px minimum body floor on touch devices, readable at 200% browser zoom, WCAG 2.2 AA contrast targets).
- **Theme**: Respects `prefers-color-scheme` (light/dark) automatically with zero FOUC; respects `prefers-reduced-motion`.
- **Zero weather API calls**: No runtime requests to `todayweather.wizardfactory.net`.
- **Responsive layout**: Verified at mobile (`360×800`, `390×844`), tablet (`768×1024`), and desktop (`1280×800`, `1440×900`) across all 7 languages (including long-string languages `de`, `fr`, `pt`, `es`) with zero horizontal overflow (`scrollWidth <= clientWidth`).

---

## 5. Policy Documents Alignment (`/mobile/*`, `AC5`)

To align `/mobile/*` legal and support pages with the 7 supported languages without breaking shipped iOS/Android apps or existing store submissions:

| Language | Privacy URL | Terms URL | Support URL | Status |
| --- | --- | --- | --- | --- |
| `ko` | `/mobile/privacy.html` | `/mobile/terms.html` | `/mobile/support.html` | Existing (preserve exact URL) |
| `en` | `/mobile/privacy.en.html` | `/mobile/terms.en.html` | `/mobile/support.en.html` | Existing (preserve exact URL) |
| `ja` | `/mobile/privacy.ja.html` | `/mobile/terms.ja.html` | `/mobile/support.ja.html` | Existing (preserve exact URL) |
| `de` | `/mobile/privacy.de.html` | `/mobile/terms.de.html` | `/mobile/support.de.html` | New (add) |
| `fr` | `/mobile/privacy.fr.html` | `/mobile/terms.fr.html` | `/mobile/support.fr.html` | New (add) |
| `pt` | `/mobile/privacy.pt.html` | `/mobile/terms.pt.html` | `/mobile/support.pt.html` | New (add) |
| `es` | `/mobile/privacy.es.html` | `/mobile/terms.es.html` | `/mobile/support.es.html` | New (add) |

Rules:
- Existing `ko`/`en`/`ja` URLs and `/mobile/styles.css` remain unchanged in path and compatible with existing mobile app links.
- Each policy page updates its language `<nav>` to link across all 7 languages and includes a back-link to `https://todayweather.ai/{lang}/`.
- Legal text finalization, draft-banner removal, and GA4 web-analytics disclosure clauses remain governed by `#2660` (draft banners remain until AK/legal review approves final text).
- Uploading `/mobile/*` remains a separate explicit allowlisted step (never deleted by the landing uploader).

---

## 6. Analytics, Consent Mode v2 & Security / CSP Contract (`AC6`)

### 6.1 GA4 + Basic Consent Mode v2

- **Measurement ID**: Supply `LANDING_GA_ID` at build time. With the ID absent, the site works without loading any Google analytics resources.
- **Events while measurement is enabled**:
  - Send one `page_view` per document load with the locale path and approved campaign fields. Filter incoming query parameters to an explicit campaign allowlist for measurement. Exclude arbitrary queries, fragments, identifiers and any user-supplied personal data from analytics payloads.
  - Send `cta_click` with enums for link target (`open`, `place`, `webapp`), placement (`hero`, `chart`, `header`, `platforms`) and locale. Send optional `language_switch` with from/to language codes.
  - Disable automatic collection that duplicates these events or sends unreviewed URLs or identifiers. Verify the actual tag payload, including built-in parameters, in browser tests.
- **Consent before tag load**:
  1. Initialize all four Consent Mode v2 signals to `denied` locally. A saved denial blocks the Google tag globally. A valid explicit grant enables analytics storage. The three advertising signals stay denied in every state.
  2. For visitors in EEA/UK/CH with no saved choice, show an accessible localized banner with equal access to acceptance and rejection. Apply the same opt-in behavior when the classification is missing, invalid, stale or unverified.
  3. Apply default measurement only when a qualified first-party visitor-region decision identifies a jurisdiction approved for default measurement in the policy review. Keep the footer preference control available. The region classification never changes the language or canonical URL.
  4. Follow [Google's basic consent mode](https://developers.google.com/tag-platform/security/concepts/consent-mode). Before eligibility or a grant, defer all Google resources, including the tag and measurement requests. On revocation, persist denial, stop event dispatch, clear identified first-party analytics cookies, and transition to a tag-free page. Verify the revocation path and subsequent requests.
  5. Persist explicit consent choices separately from language in `tw_consent=granted|denied` with `Path=/; Max-Age=15552000; SameSite=Lax; Secure`. A default measurement decision does not create a saved grant. The localized footer opens preference controls in every region.
- **Region qualification**: Browser language, timezone and OS describe preferences and cannot establish a visitor's jurisdiction. CloudFront can derive a coarse viewer country from IP. The current static landing does not expose a trusted classification to page JavaScript. LP-04 owns a qualification check for a first-party edge signal within the approved hosting scope. Record the signal source, handling of spoofed and missing inputs, any cache isolation, and the policy-reviewed country allowlist. If that check is incomplete at cutover, leave GA4 disabled. [AWS viewer location headers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-cloudfront-headers.html) · [AWS edge header availability](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html#lambda-at-edge-function-restrictions-cloudfront-headers)
- **Policy approval**: Before production enables `LANDING_GA_ID`, publish the reviewed disclosures in all seven privacy pages under #2660. The operator records approved regional defaults, consent persistence and revocation, data handling and disclosure coverage. Region classification and Consent Mode configuration alone do not establish legal compliance.

### 6.2 Security Headers & Isolated CloudFront Policy

Use a landing-specific Response Headers Policy. Preserve headers and behavior for `/app-ads.txt` and `/mobile/*` through explicit path behaviors where needed. Verify these routes, including computed styles and external links, before changing the default behavior.

- Retain the verified HSTS policy. Review subdomain scope before adding `includeSubDomains`.
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy`:
  - `default-src 'self'`
  - `script-src 'self' https://www.googletagmanager.com` (external scripts only — **no `'unsafe-inline'`**; move GA4 bootstrap and language/consent scripts into external hashed files under `/landing-assets/`)
  - `style-src 'self'` (**no `'unsafe-inline'`** — verify `/mobile/styles.css` and `/mobile/*.html` use external CSS only before dropping `'unsafe-inline'`)
  - `img-src 'self' data: https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com`
  - `connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://region1.google-analytics.com https://*.analytics.google.com` (**no `todayweather.wizardfactory.net`**)
  - `font-src 'self'`
  - `object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests`

Use only tested GA4 endpoint origins. Verify CSP on the actual browser routes, including GA4 acceptance, rejection and revocation.

---

## 7. SEO & Metadata Contract (`AC7`)

- Every `/{lang}/index.html` declares:
  - `<html lang="{lang}">`
  - `<link rel="canonical" href="https://todayweather.ai/{lang}/">`
  - `<link rel="alternate" hreflang="{l}" href="https://todayweather.ai/{l}/">` for all 7 languages plus `<link rel="alternate" hreflang="x-default" href="https://todayweather.ai/en/">`.
  - Localized `<title>`, `<meta name="description">`, `og:title`, `og:description`, `og:url`, `og:locale`, `og:image` (absolute `https://todayweather.ai/og/...`), and `twitter:card=summary_large_image`.
  - Structured data describing `SoftwareApplication` and `Organization`. Validate the markup and browser behavior under the deployed CSP.
- `/robots.txt`: Allows crawling of `/ko/`, `/en/`, `/ja/`, `/de/`, `/fr/`, `/pt/`, `/es/`, `/mobile/`, references `Sitemap: https://todayweather.ai/sitemap.xml`.
- `/sitemap.xml`: Lists all 7 canonical locale URLs with `xhtml:link` `hreflang` alternates (and `/mobile/*` policy pages if desired).

---

## 8. Build, Hosting Reuse, Safe Upload & Rollback Contract (`AC1`, `AC8`)

### 8.1 Workspace & Build Outputs

- New npm workspace `landing/` added to root `package.json` workspaces (consuming `@todayweather/design-tokens` after `Gate 0`).
- Build output (`landing/dist/`) contains ONLY landing-owned paths:
  - `index.html` (static fallback for `/`), `{ko,en,ja,de,fr,pt,es}/index.html`, `404.html`
  - `landing-assets/*` (hashed CSS/JS/fonts/images)
  - `og/*`, `favicon.ico`, `apple-touch-icon.png`
  - `robots.txt`, `sitemap.xml`, `landing-release.json`
- Build refuses to emit any file under `mobile/`, `app-ads.txt`, or `.well-known/` (guarded by build test and uploader allowlist).

### 8.2 Safe Allowlist Uploader (`scripts/deploy-landing-static.mjs`)

Modelled on `scripts/deploy-web-static.mjs` with stricter co-location guards:

- **Dry-run by default**; `--execute` required for AWS mutations.
- **Dirty-commit rejection**: Refuses `--execute` if `landing-release.json` `commit` ends in `-dirty` or lacks `siteOrigin === "https://todayweather.ai"`.
- **Preflight before writes**: Verify account and bucket ownership, versioning, distribution alias `todayweather.ai`, OAC, empty origin path, HTTPS redirection, protected-path behaviors and the absence of any 403/404-to-200 rewrite. Validate the approved edge function and response policy for activation. On routine releases the matching associations must already be live. On first cutover the approved baseline may have neither association.
- **Allowlisted upload**: Stage verified build bytes only. Refuse protected or out-of-manifest paths, symlinks, path traversal and wrong site origin before AWS access. Upload immutable assets before referencing HTML, then metadata. Never delete objects. Verify the exact keys and hashes before enabling redirects. Reconcile partial uploads before retrying.
- **Activation and caching**: On first cutover attach the tested function and isolated policy after the route targets exist. Wait for CloudFront deployment and invalidate changed mutable URLs and rewritten object paths, including root and locale index objects. Preserve immutable assets and leave the protected-path invalidations to their own procedures. Verify routing and no cached cross-visitor language redirects. [CloudFront invalidation guidance](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/invalidation-specifying-objects.html)
- **Rollback**: Before any cutover or update, record the known-good distribution configuration and associations, a restorable previous function version or source, and the version IDs and metadata of every landing-owned mutable key to be overwritten. Record absent keys separately. Restore edge settings using the current ETag and restore changed mutable content from the recorded versions. Preserve old hashed dependencies. Verify the previous public behavior and protected assets after targeted invalidation. Document how newly added keys without prior versions are handled during first-cutover rollback before activation.

---

## 9. Verification Strategy (Planned, Not Yet Executed)

| Layer | Planned Verification | Covered AC |
| --- | --- | --- |
| Edge function unit tests | Node test harness exercising `infra/landing/route-request.js` across `Accept-Language` weights, `tw_locale` cookie precedence, `zh-TW`/`it-CH` fallback, query preservation, direct locale pass-through, and `/app-ads.txt` + `/mobile/*` pass-through | AC1, AC3 |
| Build & allowlist guard tests | Verify all 7 locale HTML files, `hreflang`/canonical/`sitemap.xml`/`robots.txt`, zero runtime weather API calls, forbidden-path rejection (`app-ads.txt`, `mobile/*`, `.well-known/*`), and dry-run/dirty-commit uploader preflight mismatches | AC1, AC2, AC7, AC8 |
| Browser & layout tests (Playwright + axe) | Local static preview with production CSP and edge function: check all 7 languages across mobile/tablet/desktop viewports (`scrollWidth <= clientWidth`), light/dark mode, zero CSP violations, zero weather API calls, switcher cookie persistence, and GA4 eligibility, unknown or conflicting region signals, and zero Google requests before grant on opt-in paths and after denial | AC2, AC4, AC6 |
| Policy HTML check | Link/structure/CSP check on all 21 `/mobile/{privacy,terms,support}` files (no inline script/style regressions) | AC5 |
| Post-deploy live smoke (`scripts/landing-live-smoke.mjs`) | Read-only HTTPS checks against `https://todayweather.ai` verifying `302` at `/`, `200` on all 7 locales + `/robots.txt` + `/sitemap.xml`, protected-path `200` responses and byte hashes against the approved policy-release baseline, and CSP headers | AC1, AC3, AC5, AC8 |

---

## 10. Assumptions & Unresolved Dependencies

1. **Landing token selection (`Gate 0`)**: Confirm the roles needed for the first layout before LP-02 consumes token outputs and LP-03 implements the visual design.
2. **Global App Store storefront readiness**: `apps.apple.com/us/app/id1041700694` currently returns `404` (observed 2026-11-21); global iOS CTA copy/link strategy must align with `#2613` App Store release status at launch.
3. **Production GA4 Measurement ID & `#2660` privacy update**: Operator supplies `LANDING_GA_ID` at build time; production GA4 activation requires the published #2660 disclosures and the reviewed, qualified consent path in §6.
4. **Native speaker & legal review**: Non-Korean marketing copy (`en, ja, de, fr, pt, es`) and the 4 newly added policy language files (`.de, .fr, .pt, .es`) require human/legal review prior to removing review notices.
5. **Existing `$LANDING_DISTRIBUTION` inspection**: Read-only AWS inventory of `$LANDING_BUCKET` and `$LANDING_DISTRIBUTION` (current policies, TLS cert, `OriginPath`, `CustomErrorResponses`, live `/mobile/*` inline-style check) must run before production cutover.
