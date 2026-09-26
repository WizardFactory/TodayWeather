# Intent: Overseas weather on Visual Crossing instead of Dark Sky — issue 2585

Revision 1, 2026-09-26. Owner: main agent for AK. Source: issue [#2585](https://github.com/WizardFactory/TodayWeather/issues/2585), its [direction](https://github.com/WizardFactory/TodayWeather/issues/2585#issuecomment-5843882675), [owner actions](https://github.com/WizardFactory/TodayWeather/issues/2585#issuecomment-5843882799) and [launch plan](https://github.com/WizardFactory/TodayWeather/issues/2585#issuecomment-5844031496) comments, and AK ("앞에 논의한 내용 바탕으로 SLDC에 따라 구현 진행, 다른 provider model로 리뷰하는 것은 skip하고 pre-merge까지 진행").

## Problem

Every overseas coordinate request fails. `/v000903/dsf/coord` (and v000901, v000902 and the widgets' `/ww/010000/current/2`) runs `DsfController`, which calls `api.darksky.net`; Dark Sky was shut down in March 2023. The apps, widgets and web show no weather outside Korea.

## Decisions already made (AK, 2026-09-26)

- Provider: Visual Crossing Timeline API. Plan: the cheapest one (Free, then Metered when a launch-plan trigger fires), with attribution.
- The response `source` changes from `DSF` to `VC` and `pubDate.DSF` to `pubDate.VC`. No separate `provider` field. Apps and web are updated to match.
- Environment variable: `VC_SECRET_KEY`.

## Desired outcome and acceptance criteria

- **AC1** — `/v000903/dsf/coord/{lat},{lon}`, `/v000902/…`, `/v000901/…` and `/ww/010000/current/2?gcode=…` return 200 JSON built from Visual Crossing data for Tokyo, London and New York: yesterday's same-hour `thisTime[0]`, current `thisTime[1]`, hourly and daily rows with values in the existing units. The response carries `source: "VC"` and `pubDate.VC`; no response carries `DSF`.
- **AC2** — Provider usage: the first fetch of a location on a local day is one combined call (yesterday through +7 days, 25 records measured live). While yesterday is stored, a stale refresh is one forecast-only call (1 record). A fresh cache makes no call. The Google time-zone lookup is no longer called on this path.
- **AC3** — At most one provider fetch per location at a time across all worker processes (Mongo lock). Other requests wait for the stored result within the Lambda budget. An abandoned lock is taken over after it expires.
- **AC4** — The Visual Crossing requester uses a keep-alive agent and a 2.5 s timeout, retries a 429 once, and logs `queryCost` and latency. The key never appears in logs or errors. A missing key fails fast without a network call.
- **AC5** — No runtime server source contains a `darksky.net` URL. The legacy Dark Sky requester fails fast without network access.
- **AC6** — Push daily summaries and weather alerts work for `VC` locations and for existing registrations stored with `DSF`.
- **AC7** — The apps (`client/www`, `tw.ios`, `ta.ios`) and the web (`packages/weather-core`, `web`) recognise `VC` and show "Weather Data Provided by Visual Crossing", linked to visualcrossing.com, instead of "Powered by Dark Sky".
- **AC8** — Offline unit tests and a route smoke using live-recorded Visual Crossing fixtures pass, together with `test:offline` and the existing smokes, on Node 16.20.2 and 22. The web/core unit tests pass. A live smoke with the configured key succeeds.
- **AC9** — The architecture and rewrite docs, configuration inventory, `.env.example` and affected Archify JSON describe the Visual Crossing path. The HTML is regenerated through Archify.
- **AC10** (post-deployment, human-owned) — With `VC_SECRET_KEY` set on the EC2 service host and the server deployed, `http://tw-svc-spot.wizardfactory.net/v000903/dsf/coord/35.68,139.76` returns 200. Public `/weather/v000903/coord` for London additionally depends on the Lambda geocoder (#2601).

## Scope

In scope: server provider, conversion, caching, locking and response source; push handling; app, widget-path and web attribution/source handling; tests; docs and diagrams; issue reference comment.

Out of scope: Lambda code (#2601, #2584), the Phase 2 observation/forecast hourly model, the 0.01° cache grid and the freshness window (open AK decisions; current exact-coordinate key and 15-minute window stay), the legacy `/ww/010000/{current,forecast}` two-segment route and the `v000803` `/geo` collector (they fail fast instead of calling Dark Sky), native widget code (it reads the same `/ww` JSON), EC2 deployment, store releases, Visual Crossing account changes.

## Constraints

Node 16.20.2 service runtime; existing `DsfForecast` Mongo documents and response shape (except `source`/`pubDate` key); Free plan concurrency of 1; Lambda 3 s per-attempt timeout; no secrets in code, fixtures, logs, docs or commits; attribution required by the plan.

## Authority and endpoint

Endpoint pre-merge. Covered: implementation, tests, local and live-provider smoke with the configured key, commits, push to the `ak-ongyeol/TodayWeather` fork, PR to `WizardFactory/TodayWeather` `master`, CI reading, issue comment. Excluded: merge, auto-merge, merge queue, deployment, production reads/writes, key or account changes. AK decision: skip the other-provider review.

## Risks and open questions

- Visual Crossing `conditions`/`icon` differ from Dark Sky summaries; weather descriptions are derived from Visual Crossing fields and may read differently.
- Released apps do not recognise `VC`: no attribution until updated, and new push registrations from them carry no overseas source. Overseas weather is fully down today, so this is not a regression.
- Latency from EC2 (Seoul) to Visual Crossing is estimated, not measured.

## Consumers

Spec, plan, builder, verifier, PR description, issue comment.
