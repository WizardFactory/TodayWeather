Task: issue-2696-s11; base: ca8735cf937a634e7af57396d605e26db8bfc4ff; date: 2026-10-13.
Intent: [S11 intent](../intent/issue-2696.md). Paths: [S11 declaration](../server2/config/tasks/S11.json).

# Specification: server2 world weather (S11)

## Interface

`server2::world::WorldBackend` implements `gateway::BackendHandler` for
`Family::Dsf`. It receives the legacy backend path
`/{v000901|v000902|v000903}/dsf/coord/{lat},{lon}?{query}` and the gateway
language, and returns the exact legacy JSON body as `OrderedJson`. Errors map
to the S10 legacy classes: a 503 `EWEATHERUNAVAILABLE` becomes
`GatewayError::Unavailable(seconds)` using the gateway's
`floor((retryAt-now)/1000)` clamped to 1..3600; every other legacy non-200
outcome (400 invalid location, 500 provider/assembly failure) becomes
`GatewayError::Provider`. Registration uses `BackendDispatcher::register_native`;
`set_backend` keeps `Legacy` as the default and the rollback target.

Request semantics follow the route chain: Express/qs query decoding for the six
unit keys (missing or `(null)` -> default), `gcode = loc` split on `,`,
v000901 (no sky-icon lowercasing), v000902 (lowercased icons), v000903
(lowercased icons, rows from the day before yesterday, no 48 h end cap), and
i18n 0.8.3 Accept-Language selection over en/ko/ja/zh-CN/de/zh-TW with English
default and key fallback. The process clock zone is UTC, as in the S02 oracle.

## Data and storage

- Cell: legacy `_gridCell` (round to integer micro-degrees, floor by 20000,
  centre +10000, clamp to +-179.99 lon and +-89.99 lat, `toFixed(2)`). The cell
  is the lock/single-flight key, raw `ProviderKey::WorldCell`, and the VC
  request coordinate (`String(parseFloat(v.toFixed(6)))`).
- Raw record: source `vc`, kind `timeline`, period `{local_date: first
  days[].datetime, slot: combined|recent|forecast}`, `fetched_at_ms` = request
  instant used for conversion, exact decompressed provider bytes. One
  single-member fetch group per acquisition in partition
  `{local_date}-{range}`, published through S06 before a new success (O-9).
- Read: the 21 partitions for every range over first dates D-5..D+1 (D = UTC
  date of the request), which hold every fetch made within the 48 h decision
  window even when a body's first date differs from its requested range. An
  absent catalog is proved empty by a one-period S06 repair; Incomplete,
  Capacity, Timeout or corrupt reads are read failures, never provider-miss
  proofs.
- Derivation on read: replay fetches in `(fetched_at_ms, sha256)` order through
  the ported VC converter and `_parseData`, upserting records by `dateObj`; then
  apply legacy `_findDataFromDB` (4-day window, Intl/IANA offset rule,
  twoDaysAgo/yesterday/today/current/stale). No derived view is persisted. A
  bounded per-cell memory map retains derived records; records that cannot
  affect a later request (forecast-only records older than 6 h 15 min except the
  newest, anything older than 4 days) are pruned.
- No precise user coordinate, user/device identifier, query or language is
  stored in S3 keys, metadata or bodies; the response still echoes the
  requested `location` as legacy does.

## Acquisition chain

Order matches `_requestDatas`: complete set -> no-yesterday marker (derived
from stored combined/recent fetches lacking yesterday or the day before,
expiring at that fetch's today record + 24 h) -> range combined/recent/forecast
-> provider-down marker (10 min after a VC 401/403 or limit 429) -> per-cell
owner: a request behind an
active fetch is a legacy waiter (stored current and today complete it), as is a
request during the failure backoff (2 s; 15 min after a funded 200 body that is
unusable); a waiter that would otherwise fail first checks funding eligibility
without HTTP (pooled funds, or a new reservation pooled for later fetches of any
range; concurrent checks share the outcome; awaited until the response deadline;
no exhaustion is cached outside the ledger) and answers 503 with the window end
when exhausted -> S08 funding of both attempts before HTTP (98/50/2 units, one
window per UTC day, serialized per window; unconsumed units are pooled and used
before a new reservation); an unfundable range retries with `forecast` only when no
current record exists -> VC request at the cell centre with the legacy requester
policy (8 s call budget, gzip, 4 MiB raw and 16 MiB decoded body; one retry after 300 ms of a
concurrency 429 within 1.5 s or of a reset socket; 401/403 and limit 429 mark
the provider down; other statuses and transport failures fail) -> validation (JSON, days, timezone, tzoffset
or hours) and conversion -> S06 publication -> merge. Control windows start when
the failure is handled. The waiter uses the gateway attempt deadline (at most 3 s);
the owned fetch may continue to 8 s and publish for the next request. Failures use
`_fallback`: serve current or stale (<= 6 h) records, else error; a provider-down
or exhausted funding without a stored current returns Unavailable with the marker
or window end as `retryAt`. Busy cells are not evicted from the bounded cell map;
idle cells are trimmed back to capacity when a request or a detached owned
load/fetch finishes.

## Assembly

Port, in order: convertDsfLocalTime, mergeDsfDailyData, mergeDsfCurrentDataNewForm,
mergeDsfHourlyData, mergeAqi, dataSort, skyIconLowCase (v2/v3), convertUnits,
makeAirInfo, makeSummary, sendResult. JavaScript semantics are explicit:
property insertion order, `undefined` omission, `NaN`/Infinity as `null`,
`toFixed` exact-binary rounding, `Math.round`, string date comparisons and
local-time parsing of `YYYY.MM.DD HH:MM` in UTC. Localized strings are a
provenance-recorded subset of the legacy locale files.

## Air

`AirSource` returns `Observation`, `None`, or `Pending`. The default source is
`Unconfigured`, reproducing legacy `no-provider` (no air fields). A supplied
normalized observation is evaluated (8 h freshness, 1 h future slack, 30 km
station distance, PM required) and rendered exactly like
`_applyAirObservation`/`makeAirInfo`/`makeSummaryAir`; `Pending` sets
`airStatus {state: pending, retryAfterSeconds: 3}`. Live air providers
(Google, OpenWeather, WAQI, VC air), their S08 funding identities and air raw
persistence are not implemented: they require a recorded decision.

## Failure behavior

| Condition | Result |
| --- | --- |
| S3 read failure, cell cold in memory | Provider error (no unfunded/unproved fetch) |
| S3 read failure, cell warm in memory | Serve from memory state |
| VC success, publication failure or ambiguity | No new success; fallback to stored records or error; 2 s backoff |
| VC 401/403 or limit 429 | Provider down 10 min; fallback or Unavailable |
| VC concurrency 429 | One retry after 300 ms within 1.5 s; then 2 s backoff |
| VC other status/transport/deadline | 2 s backoff; fallback or error |
| Unusable funded 200 body | 15 min backoff; fallback or error |
| Funding exhausted | Forecast funding retry when permitted; else fallback or Unavailable(window end) |

## Observability and migration

Counters only: requests, memory hits, cold loads, repairs, fetches by range,
publications, fallbacks and failures; no coordinates, keys or query strings in
logs. Startup defaults are unchanged; native world is enabled only by explicit
library registration or the local loopback runtime option. Rollback is
`set_backend(..., Legacy)`. Legacy Mongo DSF records are not imported; a cell
served natively starts from S3 history (cold-cell behavior equals a legacy cell
with no stored records).

## Alternatives rejected

- Persisting derived DSF records: violates the no-normalized-view rule.
- Keying raw records by precise coordinates: violates privacy and the cell rule.
- One partition per cell or per fetch UTC date: breaks S06 period-to-partition
  repair ownership or the first-local-date placement rule.
- Porting the air provider chain now: requires S08 identities owned by S13 and
  an undecided air-cell key and persistence policy.

## Verification strategy

Byte parity against S02 world goldens and new oracle recordings (pinned Node
v16.20.2, legacy revision ca8735cf, recorded VC bodies corrected to the
requested cell's echo fields) covering negative coordinates, cell boundaries,
dateline, poles, DST, half-hour zones, missing fields, precipitation, missing
current conditions, stale fallback, provider failures and air observations.
Restore tests rebuild every recorded successful (200) weather response from the
S3 test peer with empty memory and VC disabled; the air observation is supplied
separately by the recorded WAQI fixture because air raw persistence is not
implemented, and non-200 steps are not restore cases. Privacy tests inspect all stored keys, metadata and bodies and the
provider request URLs. Chain tests cover funding, provider-down, backoff,
single flight and publication failure. A release-binary smoke uses loopback S3,
VC and geocoder peers.
