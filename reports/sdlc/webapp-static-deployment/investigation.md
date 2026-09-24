# Investigation

See docs/webapp/existing-infrastructure-review.md and its dated AWS/browser evidence. Read-side BFF functions can be ported using pure weather-core. Current E2E starts web-api and intercepts normalized responses; replace its main server with static-only serving and mock raw upstream endpoints. Preserve optional proxy transport and notification cleanup contracts. Existing browser storage/service-worker regressions must run against static transport. Existing CloudFront distribution must remain untouched.
