# Webapp implementation and release plan

Status: proposed, 2026-09-24. This document describes future work; commands/packages below do not exist as an implemented web application yet. Follow the [specification](specification.md), [technical design](technical-design.md) and [intent](intent.md).

## Sequence and estimates

Planning assumption: two engineers (frontend and full-stack/backend), part-time product/design, QA and operations; reusable live weather APIs; no provider replacement or extensive legacy data repair. **8–12 elapsed weeks** is a provisional parity-release estimate. Re-estimate after WP1. Work can overlap by dependency; this is not a promise based on measured team velocity.

| Package | Indicative window | Work / owner role | Exit evidence |
| --- | --- | --- | --- |
| WP1 Contract and product spike | Week 1 | API/frontend: current host and gateway ownership, KR/world/geocode/nation/warnings, all units, source freshness, CORS/headers, provider/search rights and quota; product: branding/commercial choices | Sanitized live/staging samples, fixture differences, named dependencies and updated estimate. Confirm upstream A04 precipitation behavior. Read EC2 access guidance before concluding access is absent. |
| WP2 UX and foundation | Weeks 1–2 | Design/frontend: responsive wireframes for 16-screen coverage; tokens, translations, router, state schemas, browser capability adapter; backend: typed contract and local fixture server | Clickable prototype at mobile/tablet/desktop widths, permission/error states, pinned builds and proposed test scripts |
| WP3 Weather and locations | Weeks 2–5 | Frontend/API: startup/search/favorites, request normalization, current/yesterday/hourly/daily/combined charts and detail, units, race handling | S01–S04/S07 and S15 flows pass; KR/world fixture contract coverage; **internal** read milestone only |
| WP4 Air, maps and preferences | Weeks 4–6 | Frontend: air-first, all pollutant/station views, nation weather/air, warnings, settings/themes/help/share/localization | S05–S08/S10–S12/S14/S16 coverage, optional-data and accessibility checks |
| WP5 PWA and notifications | Weeks 4–8 | Full-stack/frontend: manifest/service-worker updates, offline/eviction recovery, owned subscriptions/rules, durable scheduler/queue/sender and condition-rule parity | S09 actual staging delivery on supported devices; DST/overnight/dedupe/cancel/unsubscribe/expired-subscription checks, send kill switch |
| WP6 Hosting and hardening | Weeks 7–10 | Operations/QA/engineers: IaC, stage/prod isolation, edge rewrites/headers, observability, performance/load, provider budgets and rollback | Same immutable artifact promoted through staging, no API fallback masking, native consumer regression and rollback rehearsal |
| WP7 Parity acceptance and rollout | Weeks 9–12 | Product/QA/operations: complete ledger, decide commercial/native exceptions, supported-device matrix, canary launch and monitoring | Every promised feature passed or explicitly accepted exception; named owner and production handoff |

If paid web subscriptions/native entitlement linking are required at launch, add WP-C: managed identity, checkout, webhook processing, account/device linking, entitlement reconciliation, refunds and support. Budget **3–5 additional elapsed weeks provisionally**, depending on provider/native changes; do not claim paid parity before this passes. Full provider replacement, major server correction or a shared native rewrite is separately scoped and estimated.

## File and repository boundaries

| Proposed location | Intended operations |
| --- | --- |
| `web/package.json`, lockfile, TypeScript/Vite config | New independent modern web workspace; no implicit legacy install/build hooks |
| `web/src/app/`, `features/{weather,air,locations,nation,warnings,settings,notifications}/` | Routing, screen components and feature flows |
| `web/src/domain/`, `api/`, `platform/`, `storage/` | Typed model, source adapters, units/time selectors, fetch keys, browser interfaces and schema migrations |
| `web/public/`, service-worker entry | Audited assets/translations, manifest/icons, controlled cache/update behavior |
| `web-api/src/`, `web-api/openapi.yaml`, tests | Versioned BFF contract, upstream/search adapters, ownership and notification rule APIs |
| `web-api/src/notifications/` | Durable due-time scheduling, shared condition evaluation, queue/sender and subscription lifecycle |
| `infra/web/` | IaC for independent edge/static/API/push resources, environment parameters, budgets and monitoring |
| `.github/workflows/web-*.yml` | Scoped build/check/staging/release pipelines; actual deployment triggers require later authorization |
| `docs/webapp/`, `docs/architecture/`, corresponding diagram JSON | Update proposal status and actual new deployment/API behavior when implemented |
| `client/`, native bundles, legacy `server/` | Read as characterization sources; no bulk migration. Any required backend correction is a separately reviewed change. |

Do not restructure the whole repository or copy native config secrets to enable the web build. Start with fixtures from [rewrite examples](../rewrite/examples/README.md); version additional sanitized contract samples with provenance. Mocked provider success and a synthetic screenshot cannot establish current live availability.

## Verification plan

The following are planned checks, **not executions performed by this planning task**. Define runnable package scripts during WP2; proposed commands are `npm --prefix web run typecheck`, `npm --prefix web test`, `npm --prefix web run build`, `npm --prefix web run test:e2e` and `npm --prefix web-api test`. Choose current tools after version verification; use Vitest or equivalent for pure code and Playwright or equivalent for browser journeys.

| ID | Layer / coverage | Expected outcome and important failure case |
| --- | --- | --- |
| V1 | Adapter fixtures: KMA/world/current/hourly/daily/air, source discriminators | Correct comparable values/time/unit provenance; reject HTML, 200 application errors, unknown source and malformed core arrays |
| V2 | Units/time: all supported sets, yesterday/local midnight/DST, rain durations, sentinel/zero | No double conversion or wrong precipitation unit; missing is not zero; timezone uncertainty explicit |
| V3 | State/concurrency: city switch/delete/reorder, unit change, late response, duplicate refresh | Only matching city/key/generation updates; no overlapping retry storm; changed key cannot display stale units |
| V4 | Browser read workflows S01–S08, S10–S12, S14–S16 | Manual/current location, search, charts, station/pollutant/map modes/settings restore; keyboard/table equivalents and responsive containment |
| V5 | Offline/storage/PWA lifecycle | First/offline return, corruption/quota/eviction, update with unsaved form, previous-schema rollback; snapshot retains actual age |
| V6 | BFF integration with controlled upstream | Method/path/parameter allowlist, bounded timeout, rate limit, forwarding/cache separation, partial products, safe errors, no open proxy |
| V7 | Notification persistence/ownership | Cross-install access denied; idempotent save/delete, revision conflicts, no success UI on partial/server failure, subscription expiry and endpoint validation |
| V8 | Notification timing/condition semantics | Weekdays, overnight/DST, fixed versus last-saved current location, rain/snow/air fixtures, duplicate event suppression, backpressure and kill switch |
| V9 | Actual staging push smoke | User permission + save + schedule/test → queue/provider acceptance → observed notification → click opens correct city; then unsubscribe and verify no further sending |
| V10 | Edge/security/release smoke | Direct deep link works; API 404 remains JSON/status, missing JS remains an error; private S3; no secret/source-coordinate leakage; staging/prod isolation |
| V11 | Load/freshness/compatibility | Representative agreed traffic within legacy-provider budgets, correct source-age display, mobile legacy API samples unaffected, cost/latency thresholds met |
| V12 | Commercial branch if selected | Server-authoritative entitlement, webhook replay/idempotency, expiry/refund, denied/unavailable checkout, explicit native linking; no fabricated purchase success |

Behavior implementation follows targeted failing regression → passing tests → refactor checks → separate functional smoke. Unit tests can use fixtures; real browser/service wiring needs separate evidence. Do not run legacy `npm test` indiscriminately: it includes integrations; importing/starting the legacy server can connect databases and begin collection. Never probe `/gather/*` as health.

Required device evidence: exact release-time browser versions, iPhone browser plus installed PWA, Android Chrome browser plus installed PWA, desktop Safari/Chrome/Edge/Firefox read flows; separately state any unsupported push combination. Use consented staging recipients, isolated data and cleanup; one provider HTTP success is not proof of display. Visual comparison uses existing synthetic captures for information coverage, not pixel lock-in.

## Release gates and decisions

| Gate | Decision/evidence owner | Timing and fallback |
| --- | --- | --- |
| Product brand and commercial scope | AK/product | Before final navigation/membership implementation. Default proposal: unified weather/air product, free beta; paid production policy remains explicit. |
| Current API/provider availability and units | API owner | WP1 before promising live parity. Missing international/air capability cannot be silently removed; repair or revise accepted scope. |
| Assets/data/search permission and quota | Product/API owner | Before provider integration/production exposure. Prefer audited assets and provider-supported web configuration. |
| Domain/region/budget/on-call | AK/operations | Before infrastructure promotion. No domain/resource purchases implied by this plan. |
| Privacy/location/subscription retention | Product/operations | Before push beta. Confirm log redaction, deletion, owned access, anonymous-install retention and help text. |
| Native widget/Watch and purchase transfer limits | AK/product | Before parity sign-off. Native apps continue; exceptions described to users rather than labeled identical. |
| External/independent implementation verification | QA/reviewer | Before production readiness. This plan received main-agent document checks only. |

## Rollout and rollback

1. Fixture-only local/preview prototype. No production provider writes or notifications.
2. Staging with isolated upstream access/config, subscribed test devices and realistic recorded payloads. Prove mobile routes remain compatible.
3. Invite-only parity beta with full required/adapted features. Commercial/native exceptions must already be visible; core read milestone is not relabeled full parity.
4. Authorized production canary, proposed 5% → 25% → 100% of eligible new web exposure after at least one observation window at each step. Use stable cohort assignment and define window length/stop thresholds from WP1 data; do not affect native traffic routing.
5. Revert on wrong-city/unit/date mapping, unexpected push recipients, deployment startup failure, cache isolation failure, agreed error/freshness threshold breach or upstream overload. Disable web sends first for notification incidents, then restore prior BFF alias/static release. Confirm installed service-worker recovery as well as fresh sessions.

Restore only web resources; keep previous immutable assets, notification records and compatible read schemas. Test old/new client coexistence. A rollback that restores HTML but leaves a broken installed worker is incomplete. Document owner, version, trigger, measured result and follow-up before resuming exposure.

## Immediate implementation starting point

WP1 plus a fixture-backed responsive skeleton is the smallest useful next implementation scope: verify contracts/risks while proving hourly/daily/air/favorites on mobile and desktop. Keep the complete parity ledger as the release target throughout the work.
