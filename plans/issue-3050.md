# Issue 3050 · Korean solar terms in the current weather summary

Planned for server1 (legacy Node.js), with a later Rust server2 port. The clients in scope are the WebApp in PWA and desktop modes, native iOS and native Android. TodayAir and Cordova are outside delivery and operational verification. [Product lifecycle](../docs/architecture/service-overview.md#product-lifecycle)

For a forecast place in Korea, the normal v000903 weather request returns the day's ranked text in the existing `current.summary` string. A solar term can win one of two message slots. The annual resource lists all 24 terms regardless of their summary priority. The other 20 markets in #2613 remain future work. [Issue](https://github.com/WizardFactory/TodayWeather/issues/3050) · [Country research](https://github.com/WizardFactory/TodayWeather/issues/3050#issuecomment-6992743829) · [Market and language scope](https://github.com/WizardFactory/TodayWeather/issues/2613#issuecomment-5851673892) · [Delivery sequence](../docs/architecture/diagrams/issue-3050-client.html) · [Diagram source](../docs/architecture/diagrams/issue-3050-client.json)

## Forecast delivery

The app issues its normal `GET /weather/v000903/coord/{lat},{lon}` with its existing language and unit settings. With two selected candidates, a synthetic Korean response excerpt is:

```json
{"current":{"summary":"오늘 최저 영하 3도, 최고 6도, 입춘","summaryForDate":"2026-02-04"}}
```

The server owns the order, localized wording and punctuation. Clients render the string intact. A comma may appear inside one message. The annual endpoint is independent of the forecast refresh. No capability parameter or extra calendar fetch is needed.

**Server integration.** Implement the first release in `server/`. At `b3b31011`, the domestic v000903 KMA route invokes `getSummaryAfterUnitConverter` after unit conversion. It sets `current.summary` from `makeSummary`, which sorts graded candidates and combines up to two strings. Apply the KR policy here before selection and guard the version when reusing shared controllers. Preserve split-field semantics, older routes and world responses. Qualify the actual ingress separately. During the later Rust port, use the same observable behavior and fixtures at the corresponding domestic presenter. [Server1 route](../server/routes/v000903/route.kma.v000903.js) · [Field assembly](../server/controllers/controllerTown24h.js) · [Candidate selection](../server/controllers/controllerTown.js) · [Server2 presenter](../server2/src/domestic/kma/present.rs)

**Visible two-line summary.** The proposed companion field `current.summaryForDate` carries the KST ISO date when server1 has generated the ranked string. All maintained clients render fresh `current.summary` intact in the two-line summary area. On a missing marker, empty string, wrong place or stale day, each client falls back to its existing same-place presentation. Discard dated text on cache replacement or expiry. Keep dedicated AQI details accessible.

- **WebApp, PWA and desktop.** Extend the weather-core model and parser to retain the combined string and its date. The existing mapper exposes a separate air summary. Update persisted snapshot validation and render the combined text once in both layouts. Exercise offline reopen in the PWA and place changes in desktop mode. [Web mapper](../packages/weather-core/src/index.ts) · [Persistence](../web/src/state.ts) · [Weather presentation](../web/src/Weather.tsx)
- **Native iOS and Android.** Both forecast screens currently prefer `summaryWeather` and render `summaryAir` separately. Give the fresh marked string precedence in the hero and suppress the duplicate air row. Keep the combined text free of the air-only tap action. [Swift field preference](../ios/Core/Sources/TWDomain/Forecast/ForecastScope.swift) · [Kotlin field preference](../android/core-domain/src/main/kotlin/net/wizardfactory/todayweather/core/domain/forecast/ForecastScope.kt)

## Korean editorial policy

The groups below are initial editorial choices for a two-line forecast. The group controls a term's competition with weather. Annual dates and verification status are independent of these choices.

| KR group | Term membership | Admission and Korean copy |
|---|---|---|
| Featured (6) | 입춘, 춘분, 하지, 처서, 추분, 동지 | Show the Korean term name alone. On a quiet day rank ahead of routine commentary. Examples: “입춘”, “동지”. |
| Spare slot (9) | 우수, 경칩, 청명, 입하, 소서, 대서, 입추, 입동, 대한 | Admit after useful weather, even on a quiet day. If a slot remains, use a short label such as “경칩”. |
| Calendar only (9) | 곡우, 소만, 망종, 백로, 한로, 상강, 소설, 대설, 소한 | Available in the year lookup. In this proposal they never consume a daily summary slot, even when weather is quiet. |

Maintain one versioned KR table under `server/config/solar-terms/kr.json` on server1, keyed by the 24 stable astronomical IDs such as `solar-315`. Each entry assigns a priority group to a term ID. Use the annual snapshot’s canonical name for the Korean label. Keep frequency decisions in this table, apart from date calculation and annual API output. Validate exact coverage, unique IDs, known groups before activating a policy revision. A bad update keeps the last valid policy; with no valid policy, serve the weather summary normally. A future #2613 country gets its own eligibility, groups and wording; there is no default inheritance of the Korean ranking. The forecast place selects policy, the effective UI language controls label eligibility. V1 qualifies Korean copy. When a locale has no reviewed label, omit the term for that request while keeping localized weather. Do not turn a name such as 우수 or 대설 into a claim that rain or snow is forecast.

**Selection procedure**

1. On the normal domestic read, use the active complete KR year snapshot in memory. Match the effective date (including official corrections) to today in Asia/Seoul and ensure the weather belongs to that day. A failed lookup, non-term day, overseas place or unknown country contributes no calendar candidate. Use fresh structured values in requested units; preserve existing missing-value and publication-time checks.
2. Form the existing weather candidates. Include a single daily temperature-range candidate when both current-day minimum and maximum are valid. Group overlapping reports about the same hazard. Reserve highest precedence for active warnings and actionable weather or health risks, including dangerous air, extreme temperatures and high UV when the appropriate source/grade is available. Keep established weather order within a band, with stable insertion order for ties. No unconditional slot is reserved for the calendar.
3. For the first policy, sort the remaining candidates in this order: meaningful day-specific weather (including a valid daily range), a featured term, routine weather commentary, a spare-slot term. Select the first two distinct messages. Higher-priority risks from step 2 precede them all. For example, two risks displace even 입춘. On a calm 입춘, a valid range and the term can both appear. Two useful weather messages displace 경칩, and clearing one of those messages only admits 경칩 when no routine weather takes the slot. Calibrate risk classifications against recorded KMA fixtures; keep the term out when risk precedence cannot be established.
4. Calculate the final response ETag after formatting. Bound summary freshness by the weather TTL and the next KST midnight, including caches that hold serialized domestic responses. Partition by place, locale, units and civil date; invalidate derived summaries when policy, templates, weather inputs or the active annual revision change. A changed grade or correction must take effect on revalidation. Recheck date/expiry on native resume, browser reopen and city switch, even during a refresh throttle. Do not reuse a prior place's text.

## Calendar contract and reconciliation


Proposed public `GET /calendar/v1/kr/solar-terms/{year}` serves the Korean civil calendar, in Korean, independent of UI language. No coordinates or remote provider calls are required. First release covers the current KST year plus the next 20 complete years, configurable up to 50 future years; refresh the horizon before January rollover. The following excerpt shows **one representative entry**. A 200 response must contain 24.

```json
{
  "year": 2026,
  "timeZone": "Asia/Seoul",
  "status": "calculated",
  "revision": "example-r1",
  "officialEdition": null,
  "terms": [
    {"id": "solar-315", "nameKo": "입춘", "date": "2026-02-04", "corrected": false}
  ]
}
```

Return 400 for a malformed year, 404 for a well-formed year outside the published horizon, and 503 for an in-range year with no complete snapshot. Use the selected year's last complete snapshot during source outages. ETag covers content **and verification metadata**. Specify conditional GET/304, bounded freshness (proposed one hour for annual reads), and atomic replacement of one cached year on clients. A calculated year is usable offline with its recorded status. A validated edition sets `status` to `verified` and `officialEdition` to an object with edition ID, public source URL and publication date. Each row reports its effective Korean date and whether an override was applied. Keep verification time, edition digest, algorithm version and before/after dates internally.

1. A server1 offline generator finds each crossing of the Sun's apparent geocentric ecliptic longitude at 15° intervals. Pin algorithm, ephemeris, time scale, UTC conversion and license, bracket wraparound at 360°, sort by instant and check 24 unique IDs per Korean year. Select the astronomical dependency after comparing reference years, including near-midnight events. Record uncertainty where it could change a civil date. The original UTC instant remains separate from Korean date overrides.
2. Seed immutable complete calculated snapshots for a cold start. Starting in June, check the official publication for the following year, retry delayed or revised editions, and support a replay using a retained source fixture. Check edition identity, uniqueness, date range and completeness of all 24 rows from the official almanac. A preliminary calendar, corrupt source or partial parse keeps the prior revision. [Official almanac archive](https://astro.kasi.re.kr/life/post/almanac)
3. Stage and validate a new snapshot, publish the complete year under a content revision, then switch its active pointer atomically with a version check. Concurrent or repeated runs cannot publish an older edition over a newer one or partially replace a year. Preserve unchanged dates, update verification status even on a perfect match, and reuse the prior revision on an identical replay. Restore the previous complete revision on failed publication. Retain enough source provenance to review later official corrections.
4. Apply an official date override only to the Korean calendar and Korean-place candidates. A discrepancy does not determine a new physical instant. Other places project the calculated UTC instant into their own local zone. Index adjacent UTC years for date boundaries. Holiday text needs a confirmed local civil-calendar record for that year. Without it, use ordinary astronomical wording where eligible.

The projection rules above are a boundary for later country work. Only the KR forecast policy ships in this issue.

## Implementation order and checks

| Slice | Owner, deliverable and dependency | Acceptance scenarios |
|---|---|---|
| S1 · Annual lookup | Server1 calendar owner generates complete years and serves the annual handler. | A1 and A2 |
| S2 · Official verification | Calendar owner adds the June check, immutable yearly revisions and atomic restore. Depends on S1. | A3 |
| S3 · Korean selection | Domestic presenter owner adds the validated KR policy, KST snapshot lookup, ranked text, date marker and cache invalidation. Can work alongside S2 after S1; use a correction fixture until reconciliation is integrated. | A4–A6 |
| S4 · Client forecast display | WebApp owners update weather-core, persisted data and both PWA and desktop presentations. Native iOS and Android owners adapt the KR hero. Each client keeps the dated text with the place record and handles stale and legacy data. Start in parallel against frozen S3 fixtures. | A6–A7 |
| S5 · Integrated smoke | Integration owner joins S2–S4. Exercise the ordinary coordinate route and the separate year route in an isolated gateway through all maintained client adapters and caches. Verify the serving origin, CDN freshness and rollback before public enablement. | A1, A3–A7 |

Server1 owns the first-release calendar generator, reconciliation, policy, summary integration, fixtures and operational tooling under `server/`. WebApp changes belong in `packages/weather-core/` and `web/`; native app changes belong in `ios/` and `android/`. Capture the annual response, ranked summary, KST rollover, correction and fallback cases as regression fixtures. During the future migration, port the required assets with provenance into `server2/` and replay those cases against Rust before switching the serving origin. Clients keep the same two API contracts. [Server2 placement](../docs/architecture/server2.md#implementation-placement) · [Migration task contract](issue-2614.md#common-contract-for-every-implementation-task)

| ID · user and prerequisite | Actions and expected result | Failure path or regression check |
|---|---|---|
| A1 · Calendar user, unpublished year | GET year → verify 24 consecutive-in-time distinct ID/name/date entries → revalidate ETag → 304. Test current KST year and both horizon boundaries. | Malformed, outside-horizon and missing-snapshot statuses retain the annual contract. |
| A2 · Calendar maintainer, independent reference years | Generate horizon → compare against official dates → inspect midnight, leap year and longitude wraparound. | Near-midnight ambiguity is recorded; group changes leave annual bytes and ETag identical. |
| A3 · Operator, last complete snapshot | Import matching edition → correct one date → replay the same edition → race an older import → restart with the official source offline. | Read one complete revision throughout. Only the effective date moves; the text becomes eligible on the corrected KST day only. Invalid/partial input preserves last-good output. |
| A4 · Seoul user, featured-term fixture | Fetch 입춘 with warning and dangerous air → fetch again on an otherwise calm fixture with a valid daily range. | First response carries both risks, second carries range and 입춘 in current.summary. Invalid temperature extrema never produce a range. |
| A5 · Editor, three group fixtures | Replay a quiet 경칩 with one other message → add routine weather → replay a quiet 곡우 → promote 곡우 in a test policy and revalidate. | Spare-slot rule, exclusion and promotion match the table. Each term is assigned once. Unknown IDs, duplicate rows and bad templates fail policy validation. Annual lookup still returns each of the 24 terms. |
| A6 · Traveller, Seoul and Tokyo saved | Fetch Seoul in Korean → change language → switch to Tokyo with Korean UI → cross Seoul midnight offline → resume and revalidate. | Country controls eligibility. Untranslated term is omitted. Foreign/unknown places, stale local days and unavailable calendar retain weather. Validators and cached summaries respect place, day, language and units. |
| A7 · WebApp and native users | In PWA, desktop, iOS and Android, replay old server, new server and old stored records; include both split fields with a fresh marked summary. Open forecast → tap AQI detail → narrow width/enlarged fonts → repeat after offline date change. | New hero selects current.summary once; calendar text has no air action. Existing AQI details open. With old payloads the original split presentation works. Preserve full accessible text when visible space is constrained. |

Verification during implementation must use one normal KR coordinate GET through the served v000903 route and the WebApp mapper and both PWA and desktop presentations as well as the native iOS and Android converter/view models, plus an overseas control and a KST-midnight cache replay. Qualify direct domestic routes that share the presenter explicitly. Record rendered outcomes separately from a successful JSON response.
