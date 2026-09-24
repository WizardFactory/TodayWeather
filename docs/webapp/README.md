# TodayWeather webapp

Prepared 2026-09-24 for AK. The [implemented client](implementation.md) now defaults to direct existing-API calls and has a [static S3/CloudFront deployment recipe](../../infra/web/static/README.md) for `app.tdywx.xyz`. Production resources are not deployed. The documents below preserve the original mobile-parity proposal and its remaining scope.

Original proposal: build a **responsive PWA in a separate `web/` client**, reuse the existing versioned weather service through a small web API adapter, and add web-specific push delivery. Preserve hourly/daily weather, yesterday comparisons, air quality, saved locations, nationwide views, warnings and settings. Treat native widgets and store purchases as explicit product decisions.

| Read | Purpose |
| --- | --- |
| [Specification](specification.md) | Product scope, all 16 legacy screens, responsive flows and acceptance |
| [Technical design](technical-design.md) | Stack choices, API/data contracts, web push, hosting and release behavior |
| [Implementation plan](implementation-plan.md) | Work packages, dependency gates, estimates, tests and rollout |
| [Interactive architecture](diagrams/webapp-architecture.html) | Proposed components and existing API boundary; [editable JSON](diagrams/webapp-architecture.json) |
| [Intent](intent.md) | User request, authority and planning acceptance |
| [Verification](../../reports/sdlc/webapp-parity-design/completion.md) | Executed checks and remaining limitations |
| [Existing-infrastructure deployment review](existing-infrastructure-review.md) | September 24 feasibility review: static hosting and existing public APIs without an additional persistent Node service; Web Push migration boundary |

The design covers TodayWeather plus TodayAir's air-first/combined-weather experience in one web product by default. International weather remains in scope where the existing service supports it. A read-only internal milestone is useful for integration testing, but is **not** the final parity release.

The main choices before implementation are product branding, web monetization/native-purchase linking, operations budget. Default recommendation: one combined product, local favorites without mandatory login, and an ad-free beta while commercial policy is decided. Exact-time delivery and native home-screen widgets are not browser parity promises.

Planning estimate: **8–12 elapsed weeks** for two engineers with part-time design/QA/operations, assuming the current API/providers are usable. Paid account/entitlement work may add **3–5 weeks**; provider replacement or legacy backend repairs require separate estimation after the first spike. These are estimates, not measured commitments.

Source baseline: `87b8855f308611a07897cd3a39c45fefb3088d77`. Existing [rewrite references](../rewrite/README.md) contain synthetic screenshots and fixtures; historical AWS observations retain their original dates. Current provider availability, production routing and browser support must pass release checks.
