# Investigation

Inspected 2026-09-24 at `87b8855f308611a07897cd3a39c45fefb3088d77`. All architecture below is a proposal unless explicitly described as observed source.

## Repository evidence

| Observed fact | Evidence | Design implication |
| --- | --- | --- |
| Existing reference defines S01–S16, including TodayAir, alarms, national maps and purchases | [screen inventory](../../../docs/rewrite/screen-specifications.md); rechecked [routes](../../../client/www/js/app.js) | Use a complete parity ledger, including non-core screens. |
| Cordova startup and native integrations; Gulp selects platform/product configs and purchases | [entry](../../../client/www/index.html), [app](../../../client/www/js/app.js), [build](../../../client/gulpfile.js), [package](../../../client/package.json) | Independent web build and browser adapters. |
| Six units and KAQ source query; versioned public coordinate paths | [WeatherUtil](../../../client/www/js/service.weatherutil.js), [Units](../../../client/www/js/controller.units.js) | Explicit query/cache identity and provider adapters. |
| Public gateway paths are outside Express; backend mounts differ | [router](../../../server/routes/v000903/index.js), [mobile API](../../../docs/architecture/mobile-api.md) | New BFF wraps the deployed public contract, not an assumed local Express equivalent. |
| Express enables CORS | [app](../../../server/app.js) | Does not prove gateway CORS/cache behavior; recommend same-origin web API. |
| City storage/index and native app-preference coupling | [storage](../../../client/www/js/service.storage.js), [WeatherInfo](../../../client/www/js/service.weatherinfo.js) | Web storage schema and stable IDs; no automatic native migration. |
| Push settings are native token-oriented; purchase uses plugin receipts | [Push](../../../client/www/js/service.push.js), [purchase](../../../client/www/js/controller.purchase.js), [push architecture](../../../docs/architecture/push-notifications.md) | Web subscriptions/ownership need separate endpoints and delivery proof. |
| Known race, zero-latitude, unit and partial-data risks | [decision ledger](../../../docs/rewrite/decisions-and-open-questions.md) | Preserve semantics, not bugs; add targeted characterization during implementation. |

Historical AWS findings from 2026-09-20 and traffic from 2026-08-23 through 2026-09-22 are not freshly verified here. Gateway weather-by-address returned application 501 in that inspection. Current provider coverage, external gateway repository, paid entitlements and actual mobile release configs remain unknown.

## Official documentation checked

Checked 2026-09-24; no verbatim excerpts are needed. Recommendations are design judgments, not vendor endorsements.

- [WebKit Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/): iOS/iPadOS 16.4 introduced home-screen web-app push, with permission requested through user interaction. Design an installation/permission journey and verify actual target devices.
- [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API): web push uses service-worker subscriptions containing endpoint/key material. These are not native device tokens.
- [MDN periodic sync](https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API): availability and scheduling depend on browser conditions. Do not use it to promise exact-time alarms.
- [MDN geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API): HTTPS and user permission are required; manual search must remain usable.
- [MDN storage](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria): origin storage can be evicted; persistence requests and graceful recovery matter.
- [React build guidance](https://react.dev/learn/build-a-react-app-from-scratch): a Vite SPA is possible but routing/data/loading need deliberate libraries; SSR/SSG needs additional architecture. React recommends considering frameworks. SPA is proposed here because feature parity is the priority and a separate server API already exists.
- [Vite static deployment](https://vite.dev/guide/static-deploy.html): a static build can be hosted separately; development preview is not the production serving layer.
- [AWS SPA guidance](https://docs.aws.amazon.com/solutions/improved-single-page-application-performance-using-amazon-cloudfront/): CloudFront can route static content and an API origin through one domain.
- [AWS S3 origin access](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-overview.html): protect the static origin using OAC; proposed bucket is private.
- [AWS viewer URL rewriting](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/example_cloudfront_functions_url_rewrite_single_page_apps_section.html): request rewriting is available; our proposed rewrite is scoped to known UI routes, excluding API/assets.
- [Google Place Autocomplete](https://developers.google.com/maps/documentation/javascript/place-autocomplete-overview): a current web integration is a separate dependency; production API configuration, permitted usage and quota require verification.

## Outcome and limitations

Recommended direction: responsive React/TypeScript PWA in `web/`, dedicated same-origin BFF and new web push components, reusing existing weather API contracts and assets where permitted. Include full read features and notification capability in the parity target. Commercial/native-only features stay explicit decisions with alternatives.

No application/server execution, production request, provider call, native test, cloud configuration inspection or deployment occurred. Prior synthetic fixtures/captures inform design, not current production availability. This is main-agent investigation, not independent review.
