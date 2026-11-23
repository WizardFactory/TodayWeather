# `todayweather.ai` Brand Landing Page — Intent

Date: 2026-11-21
Authority: AK planning session (`/sdlc todayweather.ai 랜딩페이지 planning`, `plan-only` endpoint).
Related tracks: [Product lifecycle](../docs/architecture/service-overview.md#product-lifecycle) · [Design system](design-system.md) · [Webapp specification](../docs/webapp/specification.md) · [Store policy & developer website](../docs/operations/cordova-store-release.md#privacysupport-hosting-on-the-landing-site) · [21 priority markets & 48 focus cities](../docs/operations/mobile-focus-cities.md) · [#2613](https://github.com/WizardFactory/TodayWeather/issues/2613) · [#2651](https://github.com/WizardFactory/TodayWeather/issues/2651) · [#2660](https://github.com/WizardFactory/TodayWeather/issues/2660) · [#2871](https://github.com/WizardFactory/TodayWeather/issues/2871) · [#3092](https://github.com/WizardFactory/TodayWeather/issues/3092).

## Problem

`https://todayweather.ai` served a Korean-only coming-soon placeholder (1,771 bytes, dated 2026-09-29) at planning intake and serves these roles:

1. The official **Developer Website** for Google Play and App Store listings (`#2871`) and host of `/app-ads.txt`.
2. The host of localized mobile legal and support documents under `/mobile/{privacy,terms,support}{,.en,.ja}.html` (`#2660`).
3. The root brand domain alongside the live static PWA (`https://app.todayweather.ai`) and the planned deep-link hub (`https://link.todayweather.ai`, `#3092`).

Now that TodayWeather is expanding across 21 priority countries and 7 UI languages (`#2613`) with maintained WebApp (PWA/desktop), native iOS and native Android clients, `todayweather.ai` needs a production-ready, multilingual, static brand landing page that introduces the product, routes visitors to the right platform, preserves co-located store/legal assets, and supports analytics with regional privacy compliance.

## Intended Outcome

Replace the coming-soon placeholder at `https://todayweather.ai` with a fast, accessible, static multilingual landing site that:

1. **Showcases the maintained TodayWeather product** — highlighting today-vs-yesterday hourly comparison charts, daily min–max temperature bars, mobile home-screen widgets, air quality and pollutant detail, nationwide weather/warnings, Korean solar-term/daily summaries, and multi-platform support across WebApp (`app.todayweather.ai`), native iOS, and native Android.
2. **Acts as the multi-platform entry hub** — offering a single hero link to `https://link.todayweather.ai/open` for native handoff or browser and store choices, plus official operator, weather/air data-source attribution, and `/mobile/*` policy/support links.
3. **Serves all 7 supported languages** (`/ko/`, `/en/`, `/ja/`, `/de/`, `/fr/`, `/pt/`, `/es/`) covering the 21 priority markets in `#2613`, with zero-flicker CloudFront `viewer-request` `302` auto-redirect at `/` only (respecting explicit user switcher choice via cookie and never force-redirecting direct locale URLs).
4. **Aligns `/mobile/*` policy documents** to the same 7 languages while keeping existing `/mobile/{privacy,terms,support}{,.en,.ja}.html` URLs unchanged for backward compatibility.
5. **Preserves all co-located production assets** (`/app-ads.txt` and `/mobile/*`) through an allowlist-only safe static uploader (never bucket-root `sync --delete`) reusing the existing `$LANDING_BUCKET` and `$LANDING_DISTRIBUTION`.
6. **Measures acquisition and CTA conversions** via GA4 with Consent Mode v2 (EEA/UK/CH consent banner and analytics preference control), linked to privacy-policy updates under `#2660`.
7. **Establishes the corrected cross-platform locale principle** — separating language from country/region so unsupported languages (such as `zh-TW` or `it-CH`) never discard country context, distinguishing mobile OS settings from browser `language-REGION` tags.

## Scope

In scope for this planning deliverable and the planned implementation:

- Separate static npm workspace `landing/` sharing refreshed design tokens from `packages/design-tokens/`.
- Static multi-language landing pages for `/ko/`, `/en/`, `/ja/`, `/de/`, `/fr/`, `/pt/`, `/es/`, plus `/robots.txt`, `/sitemap.xml`, `hreflang` alternates, and Open Graph metadata.
- CloudFront `viewer-request` function under `infra/landing/` for `/` language auto-redirect and clean-URL resolution, plus an isolated landing-specific Response Headers Policy and deployment runbook.
- Allowlist-based safe uploader `scripts/deploy-landing-static.mjs` (dry-run default, explicit `--execute`) and post-deploy smoke script `scripts/landing-live-smoke.mjs`.
- Expansion of `/mobile/{privacy,terms,support}` templates/slots from 3 languages (9 files) to 7 languages (21 files) with full URL backward compatibility.
- GA4 + Consent Mode v2 integration with EEA/UK/CH consent, an opt-in fallback when classification is unknown, and global footer preference control.
- Documentation of the cross-platform locale contract clarification and linked `#2613` / `#2660` follow-ups.

## Exclusions

- **No production deployment or AWS mutation** in this planning task.
- **No implementation code, package edits, or GitHub issue publication** in this planning task (stops after `intent/landing.md`, `specs/landing.md`, and `plans/landing.md`).
- **No live weather API calls** from `todayweather.ai` (zero runtime requests to `todayweather.wizardfactory.net`; real-time weather lives on `app.todayweather.ai` and native apps).
- **No Universal Links / App Links** on `todayweather.ai` (owned exclusively by `link.todayweather.ai` under `#3092`).
- **No country-split landing URLs** (no 24-path `/{lang}-{country}/` duplication; 7 language paths suffice because store links and the PWA handle country-specific storefronts/units).
- **No TodayAir or Cordova promotion** (retired / historical per [product lifecycle](../docs/architecture/service-overview.md#product-lifecycle)).
- **No direct changes to mobile app `S07` unit settings or `#2613` code** inside the landing-page delivery (tracked as linked follow-ups).
- **No server-side backend, database, login, or ads** on `todayweather.ai`.

## Prerequisites & Hard Constraints

1. **Design-token prerequisite (Gate 0)**: Confirm the landing roles in `packages/design-tokens/` before `landing/` UI styling and component implementation begins (AK, 2026-11-21). Architecture/edge/scaffolding prep may proceed only up to non-visual contracts.
2. **Co-located asset preservation**: `$LANDING_BUCKET` hosts `/app-ads.txt` and `/mobile/*`. Bucket-root `sync --delete` is strictly forbidden; deployment must upload only allowlisted landing artifacts and preserve prior S3 versions/metadata.
3. **Domain separation**: `todayweather.ai` (brand landing + `/app-ads.txt` + `/mobile/*`), `app.todayweather.ai` (static PWA), `link.todayweather.ai` (deep links/sharing).
4. **Policy isolation**: Never modify shared CloudFront cache or response-headers policies in place; create landing-specific policies when updating `$LANDING_DISTRIBUTION`.
5. **No secrets or environment IDs in Git**: `$LANDING_BUCKET`, `$LANDING_ACCOUNT_ID`, `$LANDING_DISTRIBUTION`, and production `LANDING_GA_ID` remain operator/build-time inputs. The measurement ID is public in the built page.

## High-Level Acceptance Criteria

- **AC1**: Three-domain separation and co-located asset preservation (`/app-ads.txt`, `/mobile/*`) are enforced by design and automated preflight/uploader tests.
- **AC2**: `landing/` builds all 7 canonical language routes (`/ko/`, `/en/`, `/ja/`, `/de/`, `/fr/`, `/pt/`, `/es/`) statically from refreshed `packages/design-tokens/` with light/dark support and zero runtime weather API calls.
- **AC3**: Root `/` CloudFront Function (`viewer-request`) redirects via `302` using `tw_locale` cookie → `Accept-Language` → `/en/`, while direct locale routes, `/app-ads.txt`, `/mobile/*`, `/robots.txt`, and `/sitemap.xml` pass through without redirect.
- **AC4**: One cross-platform hero action (`/open` on the link host), a contextual forecast link, a direct WebApp link, product showcase sections, real screenshots, operator info, and data-source attribution render cleanly across mobile, tablet, and desktop viewports in all 7 languages without layout overflow.
- **AC5**: `/mobile/{privacy,terms,support}` supports all 7 languages (21 files) with existing `ko`/`en`/`ja` URLs unchanged and every landing locale linked to its matching language documents.
- **AC6**: GA4 + Consent Mode v2 fires pageview and CTA outbound events according to consent state, blocks all GA4 requests before consent in EEA/UK/CH and when classification is unknown, keeps ad signals denied globally, and offers a persistent footer preference control, and passes strict landing CSP without console violations.
- **AC7**: SEO and discoverability metadata (`hreflang`, canonical URLs, `x-default`, `robots.txt`, `sitemap.xml`, localized Open Graph tags) validate cleanly.
- **AC8**: Allowlist-only uploader (`scripts/deploy-landing-static.mjs`), dry-run/dirty-commit guards, rollback runbook (`infra/landing/README.md`), and live read-only smoke (`scripts/landing-live-smoke.mjs`) are verified locally before any authorized production deployment.
- **AC9**: Cross-platform locale contract clarification (two-axis language vs country/region; mobile OS settings vs browser `language-REGION`) and linked `#2613` / `#2660` follow-ups are documented without blocking landing delivery.

## Settled Decisions (AK, 2026-11-21)

| ID | Decision | Rationale |
| --- | --- | --- |
| DL-L1 | Unified product showcase + multi-platform entry hub (WebApp + iOS + Android) + official developer/policy hub | Serves store visitors, search traffic, and web/mobile users from one clear entry point |
| DL-L2 | 7 language routes (`/ko/`, `/en/`, `/ja/`, `/de/`, `/fr/`, `/pt/`, `/es/`) with no country-split landing URLs | Avoids 24-path duplicate-content SEO/translation overhead; Storefront availability is checked at release and the WebApp handles its own regional defaults |
| DL-L3 | Root `/` auto-redirect via CloudFront `viewer-request` `302` (`tw_locale` cookie → `Accept-Language` → `/en/`); direct locale URLs never force-redirected | Zero-flicker UX, respects manual switcher choice, protects shared URLs and crawler indexing |
| DL-L4 | Pure static showcase with zero runtime weather API calls | Instant load, strong SEO, full isolation from backend outages; live weather is one click away on `app.todayweather.ai` |
| DL-L5 | Design-system alignment consuming refreshed `packages/design-tokens/` + real product screenshots; select the shared roles used by landing before implementation | Visual consistency across landing, PWA, and native apps |
| DL-L6 | Separate root npm workspace `landing/` + allowlist uploader reusing `$LANDING_BUCKET` / `$LANDING_DISTRIBUTION` | Clean separation from PWA (`web/`) while sharing workspace tokens and protecting `/app-ads.txt` and `/mobile/*` |
| DL-L7 | Expand `/mobile/{privacy,terms,support}` to all 7 languages while preserving existing `ko`/`en`/`ja` URLs | Consistent policy experience across all supported languages without breaking shipped apps |
| DL-L8 | GA4 + Consent Mode v2 with EEA/UK/CH opt-in, opt-in for unknown classifications, and global preferences coordinated with `#2660` | Unifies acquisition/CTA funnel analytics with Google/Firebase while respecting 21-market privacy rules |
| DL-L9 | Separate language and country/region axes; mobile follows OS settings, browser follows `language-REGION`; log `#2613` wording correction & mobile `S07` unit-setting review as linked follow-ups | Fixes the "region ignored" flaw (e.g., `zh-TW`, `it-CH`) without blocking landing-page delivery |

## Risks & Linked Follow-Ups

- **Token readiness**: The first landing layout depends on selecting shared roles for typography, controls and charts (Gate 0).
- **App Store non-KR availability**: As observed on 2026-11-21, `apps.apple.com/us/app/id1041700694` returns `404` while `/kr/` returns `301 → 200`. Until 21-country App Store distribution launches (`#2613`), all landing translations must present the same verified availability. Verify storefront availability on the link host’s fallback page before making regional availability claims.
- **Legal review dependency (`#2660`)**: The 4 new policy languages (`.de`, `.fr`, `.pt`, `.es`) and GA4 web-analytics disclosure clauses require legal/operator review under `#2660` before removing draft notices or activating GA4. Confirm the jurisdictions eligible for default measurement and qualify the region signal before using it.
- **Native policy links & `#2613` cleanup**: Updating native iOS/Android policy URLs to open all 7 languages, correcting `#2613` / `docs/webapp/specification.md` "region ignored" wording, and deciding mobile `S07` unit-setting simplification remain separate follow-up tasks.
