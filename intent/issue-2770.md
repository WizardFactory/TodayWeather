# Intent: stored AirKorea fallback for KAQ requests

Source: [#2770](https://github.com/WizardFactory/TodayWeather/issues/2770). Owner: AK. Endpoint: pre-merge, explicitly requested 2026-10-16.

Existing clients explicitly request KAQ and display an empty future air chart when its stored forecasts have expired. Select usable future KAQ forecasts when available for the requested station, otherwise use stored AirKorea forecasts, preserving observations, response fields and real source/publication timestamps.

- AC1: Valid future KAQ remains selected; absent, expired or invalid KAQ falls back for the same station.
- AC2: Legacy KAQ requests populate existing forecast fields with actual AirKorea attribution/times, preserving observations and explicit AirKorea behavior.
- AC3: Neither source usable yields safe missing forecasts; an isolated route-to-client check proves future chart slots populate on fallback.

Authorized: implementation, isolated tests/smoke, scoped commits/push, PR updates, CI and required independent review/correction using existing configured accounts/agents. Merge authorization: false. No auto-merge or queue. No production/provider calls, collector enablement, KAQ acquisition repair, client builds or server2 work. Risks: timestamp/value boundaries and mixed publication timelines. No new accounts or permission changes. Required reviewer effort: medium.
