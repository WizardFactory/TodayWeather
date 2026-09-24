# Implementation intent
Source: AK: "이슈 발행하고 구현 진행". Issue #2558 created. Continue the accepted product direction in docs/webapp/specification.md and technical-design.md.
Deliver a locally runnable responsive PWA and isolated BFF with real integration wiring, meaningful tests, deployment preparation and honest external-capability boundaries. Default product is unified weather/air and free local use; paid subscriptions and production release require remaining choices.
Acceptance:
- AC1 issue published and linked to implementation/evidence.
- AC2 hourly/daily/combined weather, air/pollutants/stations, favorites/search, maps/warnings, settings/help/sharing work in responsive browser flows.
- AC3 KMA/world normalization preserves units/zero/sentinel/time and isolates requests by city/settings; live failures never become synthetic success.
- AC4 explicit demo/live API modes, constrained upstream routing, bounded requests and safe error/cache behavior.
- AC5 PWA install/offline/update and notification capability/rule integration with truthful unavailable states; native purchase/widget differences visible.
- AC6 reproducible build, CI/deployment preparation, docs and architecture accurately describe actual coverage and external release gates.
- AC7 passing targeted tests, separate real local browser smoke and independent assessment on matching candidate.
No production deployment, paid onboarding, native purchase entitlement invention, provider migration, merge or secret publication.
