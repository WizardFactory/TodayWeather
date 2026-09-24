# Test plan

Red: direct dispatcher local capabilities/catalog, weather canonical queries/display conversion, raw geocode mapping, invalid/error/oversize responses and abort; static deployment dry-run refusal of demo/proxy.
Green/post-refactor: existing domain/API/notification/native/storage regressions plus new transport, routing and deployment tests.
Functional: production build served by static-only harness, all existing browser flows with raw mocked public endpoints, no /api requests in direct mode, unavailable upstream error/recovery, address search, offline/PWA/cache update. Optional proxy rule-cleanup independently unit tested.
Infrastructure: JSON/template reference validation, CloudFront handler simulation, CLI dry-run and upload ordering; no production execution. Archify artifact/browser/visual checks separately recorded.
