# Issue #2635 verification

Base: d4858b5926c1b27a82da96f3a7329dbeffe408e4. Scope: implementation through pre-merge, never merge/deploy.

The provider guard now returns EWEATHERUNAVAILABLE plus an absolute retry deadline for an active marker or exhausted daily budget. The shared DSF handler serializes that typed failure; the public gateway returns generic 503, bounded Retry-After, CORS and no-store without immediate retries. Stored-current fallback and unrelated 400/404/501 behavior remain unchanged. An asynchronous quota lookup crossing UTC midnight rechecks the new usage day.

## Executed checks

- Red: 70 targeted tests, 67 passed and three intended new regressions failed before the fix.
- Green and post-refactor: 93/93 VC, gateway and shared world-air tests passed on Node 22.22.2. Initial VM wiring failures were fixed by adding the shared module to the explicit dependency map.
- Separate functional smoke: real Express/HTTP loopback through the production provider guard and shared response middleware. Marker delays 75s/3600s/1s and quota midnight delay 40s; all 503, CORS, no-store and one backend attempt. Unclassified failure 501 with three attempts; zero coordinates 404. Isolated model/provider adapters; no live DB or provider calls.
- Archify: nine artifact checks and delivery passed. Chromium containment/readability passed at 1440×900, 1600×1000, 1920×1080, 2048×1320; light 2048×1320 screenshot visually inspected with legible labels/cards and no clipping.
- `git diff --check` passed.

Reproduce with existing isolated dependencies on NODE_PATH:

```sh
node --test server/test/offline/vc-weather.test.js server/test/offline/gateway-route.test.js server/test/offline/world-air.test.js
node server/test/offline/weather-unavailable-smoke.js
```

The offline CI runner includes the new smoke. The gateway CI job also exercises production Node 16.20.2; see PR checks for its actual outcome.

## Compatibility and limits

[Pre-change client inspection](https://github.com/WizardFactory/TodayWeather/issues/2635#issuecomment-5884077414): Cordova routes every HTTP error to its error callback; the checked-in iOS widget parses bodies without distinguishing status. No native runtime or device build is claimed. Native clients do not gain Retry-After support.

The minimum positive Retry-After is one second, including a remaining fractional second or expiry crossed during loopback. All other delays round down and cap at one hour. This is the documented integer-resolution edge to the deadline bound.

No schema migration. Rollback by reverting the task commit. Existing CI has tests/builds; legacy Travis has an Elastic Beanstalk deployment recipe on master (current activation unverified). This task does not tag, merge, enqueue or deploy. Independent verification/review and current CI readiness are recorded on the PR; this builder report alone is not approval.
