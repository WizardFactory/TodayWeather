# Intent: air quality provider chain (PR 1: adapters, budgets, domestic fallback) — issue 2628

Revision 1, 2026-09-27. Owner: main agent for AK. Source: issue [#2628](https://github.com/WizardFactory/TodayWeather/issues/2628) and its decision log (comment 5857739303, D1–D10); AK: proceed and record decisions as issue comments.

## Problem

Air quality depends on one provider per path (AirKorea, WAQI fallback #2622; WAQI overseas). WAQI is free-only, republishes AirKorea for Korea and restricts for-profit use. AK wants four providers behind one adapter interface with free-tier-aware ordering and cost control.

## Desired outcome and acceptance criteria (PR 1)

- AC1: Each adapter (Google, OpenWeather, Visual Crossing, WAQI) maps its documented body to the normalized observation with the stated units and classifies timeout, transport, HTTP 401/403 (`auth`), 429 (`quota`) and malformed bodies without throwing or logging the key.
- AC2: With free budgets available and every provider answering, a domestic fallback request calls Google only; with Google at its monthly cap, OpenWeather only; with both capped, WAQI only.
- AC3: With all free budgets exhausted and `AIR_PAID_PROVIDERS_ENABLED` unset, only WAQI is called; with `true` and WAQI failing, OpenWeather → Visual Crossing → Google is followed and stops at the first success; each paid provider stops at `AIR_PAID_MONTHLY_CALL_CAP`.
- AC4: Budget counters are shared across worker processes through Mongo; the OpenWeather minute cap blocks the 61st call in a minute across two processes.
- AC5: An `auth` or `quota` failure marks the provider down for 10 minutes for all workers; the next request skips it.
- AC6: v000903 route smoke (coord/addr, DB 1.0/2.0, airkorea/airnow): `current.arpltn.source` is the answering provider, `pm25Value`/`pm10Value` are concentrations, grades/`summaryAir` follow `airUnit`, `airInfoList[0].source` matches; fresh AirKorea calls no provider.
- AC7: Every provider failing leaves the response without air and completes the route; a second request within 2 minutes calls no provider.
- AC8: `test:offline`, route smoke and Mongo budget smoke pass on Node 16.20.2 and 22.22.2; Node 10.15.3 check passes; PR CI green.
- AC9: Docs describe chain order, budgets, environment variables, `source` values and prerequisites.

The issue's last criterion (overseas path) belongs to PR 2 and is out of this task's scope.

## Scope

In: `server/lib/air/**` (adapters, observation, budgets, chain), `server/config/air.js`, `server/models/air.*.model.js`, `server/lib/AQI/airFallback.js` replacing `waqiAirFallback.js`, `controllerTown24h.js` source handling, tests/smokes/CI, docs and diagram.
Out: overseas path (`controllerWorldWeather`, `aqi` collection), client changes, WAQI terms, key provisioning, deployment.

## Constraints

Node 10.15.3 host runtime syntax; no key in logs/cache/errors; public repository (no project IDs or key material in docs); Mongo additions are new collections only; PM2 × 10 workers share budgets.

## Authority and endpoint

Pre-merge contract as for #2622 (pre-merge-authority in reports). No merge/auto-merge/queue/deployment; no account or permission changes.

## Risks and open questions

- Google/OpenWeather cannot be exercised live until AK enables the API / issues a key (D9).
- Google billing month is not UTC; the UTC calendar month with a 5 % reserve approximates it.
- WAQI for-profit terms (D10) are AK's decision.
- Stacked on #2625: this PR contains the #2622 commits until #2625 merges.
