# Intent — issue-2576: never show "undefined" in the current-weather summary

| Field | Recorded value |
| --- | --- |
| Task / stage / owner | issue-2576 / intent / main (Claude Opus 5.5) |
| Date / revision | 2026-09-25 r1 |
| Source / authority | Issue #2576; AK session 2026-09-25 (pre-merge endpoint; skip cross-provider review) |
| Consumed inputs | reports/sdlc/issue-2576/triage.md |
| Candidate / base | PR #2577 head 3f35bd35 / base bd6640f2 |
| Status / decision | complete / PROCEED |

## Problem
Since #2573/#2575, KMA `currentweather.jsp` city text reaches `current.weather`. Its 2021+ wording (`비끝`, `약한비연속적`, `약한비단속적`) is not in the legacy `makeWeatherType` vocabulary. The app shows `어제보다 -3˚, undefined` (service-host logs: `Fail weatherStr=비끝` ×115, `약한비연속적` ×52 in one day). Affected: KMA `/v000903/kma/...` consumers (`current.weather`, `current.summary`, `current.summaryWeather`) and world-weather `desc`, which uses the same helper.

## Desired outcome and acceptance criteria
- **AC1** Modern KMA wording maps to the legacy weather types. This covers the observed `비끝`, `약한비연속적`, `약한비단속적`, `구름적음` and the same suffix/intensity family for rain, snow, drizzle, sleet, showers and fog. Legacy Korean, English and bare KMA AWS `비`/`눈` (65/66) mappings are unchanged.
- **AC2** `getWeatherStr` never returns `undefined`. A missing, negative or out-of-range type yields `""`.
- **AC3** When KMA text still cannot be mapped (`weatherType -1`), `updateWeather` falls back to sky (no precipitation) or pty (precipitation) instead of keeping `-1`.
- **AC4** Neither `current.summary` nor `current.summaryWeather` contains `undefined` or an empty weather item. Valid weather text is still included.
- **AC5** The regression runs in `npm run test:offline` / CI. An additional v000903 route smoke exercises the integrated path.
- **AC6** The architecture doc (`docs/architecture/mobile-api.md`) and the operations record accurately describe the contract, the deployment state and the limitations.

## Scope
- In: `server/controllers/controller.weather.desc.js`, `controllerKmaStnWeather.js`, `controllerTown.js`, `controllerTown24h.js`, offline tests/smoke/CI step, docs, SDLC evidence.
- Out: production deployment or host changes, native widget/app changes, new KMA collectors, the `DB_DATA_VERSION` storage format, and other summaries.

## Authority (pre-merge contract)
- Repository `WizardFactory/TodayWeather`, PR #2577, branch `ak-ongyeol:fix/weather-desc-undefined-summary` via the configured `gh` account `ak-ongyeol`.
- Allowed: implement, test, smoke, commit, push, PR update/comment, CI read, corrections, spawning a verifier inside this host.
- Prohibited: merge, auto-merge, merge queue, production deploy, permission changes, credential transfer, new accounts.
- AK decision (2026-09-25): no other provider is available, so skip cross-provider review. This does **not** satisfy the PR-review gate. Readiness is reported with that gap.

## Risks and questions
- `weather`/world `desc` becomes `""` rather than being omitted when a type is unknown. App/widget handling of the empty field is unverified.
- Future KMA wording outside the normalization rules still logs `Fail weatherStr=` but degrades to sky/pty text.
- The service host runs f40002d7 only. Redeployment after merge is a human decision.
