# TodayWeather deep link architecture (`link.todayweather.ai`)

Approved design direction: AK, 2026-11-21. Establish a unified, zero-backend-server deep linking and sharing system across iOS, Android, and the static Web PWA using a dedicated subdomain, `https://link.todayweather.ai`, and immediately replace the legacy Branch (`twa.app.link`) share URLs. See [specification](../specs/deeplink.md) and [implementation plan](../plans/deeplink.md).

## Scope and locked decisions

1. **Dedicated deep-link host (`https://link.todayweather.ai`):**
   - `https://link.todayweather.ai` is the sole HTTPS host registered for iOS Universal Links and Android App Links and the canonical origin for external share links.
   - `https://todayweather.ai` remains dedicated to the brand landing page, `/app-ads.txt`, and store/in-app policy documents (`/mobile/privacy*.html`, `/mobile/support*.html`, `/mobile/terms*.html`) with no app-link association, eliminating policy-browser redirect loops and landing-page blast radius.
   - `https://app.todayweather.ai` remains the pure static PWA origin with no app-link association so browser and PWA users are never hijacked back into the native app.
   - `todayweather://` remains strictly for internal home-screen widgets and legacy compatibility, never for external sharing.
2. **Purpose-split fallback UX for browsers without the app installed:**
   - `/` and `/open` serve a lightweight static smart fallback page with App Store / Google Play links and a direct "Open in Web (`app.todayweather.ai`)" option.
   - Content deep links (`/place/*`, `/loc`, `/air/*`, `/nation/*`, `/warnings`) immediately route browser visitors to the corresponding view on `https://app.todayweather.ai/...`, paired with a dismissible in-page "Open in app / Install" banner that also handles Korean in-app browsers (e.g., KakaoTalk).
3. **Catalog and arbitrary coordinate support with non-destructive app entry:**
   - Support both privacy-friendly catalog slugs (`/place/{slug}`, `/air/{slug}`) and rounded arbitrary coordinates (`/loc?lat=&lon=&name=&view=`) so neighborhood-level Korean and overseas locations remain shareable.
   - When a native app receives a location deep link, it selects an existing nearby saved place if one matches; otherwise it opens an ephemeral preview with an explicit "Add to favorites" action rather than silently mutating the user's saved list.
   - On a fresh install where the startup gate (`S01`) is active (zero saved places), a valid location deep link opens directly into that location to avoid onboarding friction.
4. **Immediate Branch (`twa.app.link`) replacement:**
   - Replace the hard-coded Branch URLs in iOS and Android `ShareMessage` directly with `https://link.todayweather.ai/...` in the same rollout rather than deferring to a later phase, resolving [D35](../docs/rewrite/decisions-and-open-questions.md).
   - Deploy and live-verify `link.todayweather.ai` static hosting before shipping app builds that emit the new URLs so every shared link resolves cleanly on both old and new clients. Retain legacy Branch forwarding temporarily only for historical links already shared prior to cutover.

## Boundaries

- Static AWS infrastructure only (private S3 + OAC + CloudFront + Viewer-Request CloudFront Function); no persistent compute server, database, or backend API change.
- No secrets, real Apple Team IDs, Android signing key fingerprints, or private AWS account/resource identifiers are stored in the repository; operator inputs remain parameterized at build/deploy time.
- Production AWS provisioning, DNS changes, and store releases remain separately authorized operator actions.
