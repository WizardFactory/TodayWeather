# TodayWeather webapp

Prepared 2026-09-24 for AK. The [implemented client](implementation.md) now defaults to direct existing-API calls and has a [static S3/CloudFront deployment recipe](../../infra/web/static/README.md) for `app.tdywx.xyz`. Production resources are not deployed. The documents below reflect the static-only implementation and distinguish remaining mobile-parity scope.

Current decision: maintain a **responsive PWA in a separate `web/` client** and call the existing versioned weather service directly from the browser. The Node API workspace, Docker recipe and web sender are removed; browser notifications are unavailable. Preserve hourly/daily weather, yesterday comparisons, air quality, saved locations, nationwide views, warnings and settings. Treat native widgets and store purchases as explicit product decisions.

| Read | Purpose |
| --- | --- |
| [Specification](specification.md) | Product scope, all 16 legacy screens, responsive flows and acceptance |
| [Technical design](technical-design.md) | Static-only components, direct API/data contracts, future notification boundary and release behavior |
| [Implementation plan](implementation-plan.md) | Current scope, remaining release gates, tests and rollback |
| [Interactive architecture](diagrams/webapp-architecture.html) | Static hosting components and existing API boundary; [editable JSON](diagrams/webapp-architecture.json) |
| [Intent](intent.md) | Original request, current decisions and planning acceptance |
| [Implementation and verification](implementation.md) | Reproducible checks and remaining limitations |
| [Existing-infrastructure deployment review](existing-infrastructure-review.md) | September 24 feasibility review: static hosting and existing public APIs without an additional persistent Node service; Web Push migration boundary |

The design covers TodayWeather plus TodayAir's air-first/combined-weather experience in one web product by default. International weather remains in scope where the existing service supports it. A read-only internal milestone is useful for integration testing, but is **not** the final parity release.

Remaining product/operations choices include branding, web monetization/native-purchase linking and operating budget. The domain is `app.tdywx.xyz`; deployment method selection is deferred. Default recommendation: one combined product, local favorites without mandatory login, and an ad-free beta while commercial policy is decided. Exact-time delivery and native home-screen widgets are not browser parity promises.

The original 8–12-week parity estimate included a notification backend and is not a remaining-duration estimate. Alerts, paid account/entitlement work and provider repair require separate scoping; no new backend is required to host the current browser client.

Original planning source baseline: `87b8855f308611a07897cd3a39c45fefb3088d77`. Existing [rewrite references](../rewrite/README.md) contain synthetic screenshots and fixtures; historical AWS observations retain their original dates. Current provider availability, production routing and browser support must pass release checks.
