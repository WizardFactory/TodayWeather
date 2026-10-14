Task: issue-2742-s15b (slice S15b-1); owner: Claude builder (S15b worktree); revision/base: ae21b6cc (origin/master, S15 merge); date: 2026-10-14.
Authority: AK authorized S15b on 2026-10-14 and decided the four-PR split, D2-D6 and the fill rule the same day (relayed by the root coordinator); endpoint pre-merge for each slice.
Criteria: AC1-AC6 below (S15b-1), derived from the #2742 completion criteria and the split.
Issue update assessment: the split, decisions and fill rule are posted on #2742 (issuecomment-6167282481); one status comment at S15b-1 readiness.

# Intent

S15 ported the v000903 KMA assembly at the legacy store-read boundary (`KmaStore`). Legacy is shut
down when server2 goes live, so server2 must answer every `KmaStore` call from its own S3 raw
records and provider APIs, without a MongoDB migration and without pre-collection before cutover
(AK, 2026-10-14). S15b delivers that source in four reviewable PRs; this record covers S15b-1 and
fixes the plan for the rest.

S15b-1 delivers the S3 input source framework and the inputs whose legacy data comes from
repository files, the S13/S13b raw records and S12:

- AC1: an S3-backed `KmaSource` builds one in-memory `KmaStore` snapshot per request from the
  shared `SERVER2_S3_*` settings. `kma` in `SERVER2_NATIVE_FAMILIES` selects it. No other setting,
  mode or verification flag is added. Every S3 operation of the process stays behind the shared
  12-request admission, below the 16-connection test peer limit.
- AC2: reference inputs reproduce legacy from repository data. The town list is rebuilt from
  `part.csv` and `base.csv` with a port of `coordinate2xy`, in the legacy load order. `region_code`
  is `getRegIdByTown` over `region.csv`. `forecast_zone` is `findForecastZoneByName` over the zone
  state that legacy `getFromKma` builds from S13b `forecast-zone` records. `special_zones` reads the
  S12 zone state. Pinned-legacy oracle fixtures show the outputs match.
- AC3: grid and mid rows reproduce legacy documents from raw records. Applied in fetch order,
  S13 `ultra-srt-ncst`, `ultra-srt-fcst`, `vilage-fcst`, `town-rss` and `mid-*` raw records build
  the DB 2.0 `kma.town.{current,shortest,short,short.rss}` and `kma.town.mid.{forecast,land,temp}`
  documents that legacy stores: organizers, publication checks, fenced or merged saves, retention
  and Mongoose 5.1.2 key materialization. Oracle fixtures recorded with legacy code, Mongoose 5.1.2
  and an in-memory collection double show identical documents. Normalized weather is never stored;
  documents are derived in memory per request.
- AC4: a store snapshot answers each S15b-1 method with the legacy result for the request instant.
  Methods owned by S15b-2/3, a missing latest publication (request-time acquisition is S15b-4) and
  an unknown town (geocoding is S15b-4) end the assembly with a named temporary forward. The
  family stays off until S15b-4, whose completion criterion is zero legacy forwards.
- AC5 (D4): the S15 oracle is recorded again with `MAX_CURRENT_COUNT` 192, the legacy runtime value.
  The S02 v000903 goldens still match, and the tests use the runtime default.
- AC6: all added and modified paths match `server2/config/tasks/S15b-1.json`. Outside changes are
  limited to the declared documentation. No runtime dependency reaches legacy files: repository
  data is copied into `server2/` with provenance.

In scope (S15b-1): the source, snapshot, reference data, raw-record converters, oracle fixtures,
the D4 re-recording, the release KMA smoke over a task-owned S3 test peer, design text, commit,
push, PR, CI and independent review/correction.

Out of scope (later slices, see the plan):
- Station observations, ASOS history composition and on-demand ASOS acquisition (S15b-2).
- Air, life index, area numbers, KASI, MFDS and the KAQ/AirKorea image pipeline (S15b-3).
- Request-time acquisition, unknown-town geocoding, warm memory and packs, the two S15 declared
  forwards, and full end-to-end parity (S15b-4).
- Route switches (S20), any `server/` edit, live provider calls, AWS, deployment, merge, and edits
  to `plans/issue-2614.md`.

Decisions consumed:
- D1: the split.
- D4: re-record with 192.
- D5/D6 as corrected on 2026-10-14: no migration, no pre-collection, no steady-state forward, and
  reference data from repository and provider data.
- The fill rule: the latest 23 hours come from the KMA current backfill and older hours from ASOS.

Risks: legacy timing cannot be reproduced exactly. Legacy collected every grid on timers;
server2 applies its own captured publications in fetch order with the legacy save rules. That is
the intended native semantics after cutover, not a shadow-parity claim. The JSON provider form
replaces legacy XML; the oracle feeds legacy the same item values in xml2js form.

# S15b-3 (air and life inputs), 2026-10-15

Task: issue-2742-s15b-3; owner: Claude builder (S15b-3 worktree); base: 05c06c67 (S15b-1 merge).
Authority: AK authorized S15b-3 on 2026-10-14 (relayed by the root coordinator), endpoint
pre-merge, with these directions: the request waits at most 3 s and omits late parts with the
legacy absent-data output while the owned acquisition continues; national datasets shared by all
requests (AirKorea `sidoName=전국` once per publication hour, single-flight by dataset and hour);
every acquisition method confirmed by small live calls with keys from `server/.env`; decisions
cite the provider documentation, the legacy collection method and the tw_svc assembly; a
read-only look at the production configuration for the KAQ calibration.

Split (scope too large for one reviewable PR): **S15b-3a** AirKorea and the air fallback (this
PR), **S15b-3b** area numbers, life index, KASI and MFDS, **S15b-3c** the KAQ/AirKorea image
forecasts.

S15b-3a criteria:
- A3-1: `arpltn`, `dust_forecast` and `air_fallback` answer from server2 data with the legacy
  readers; the documents and answers equal a pinned legacy oracle byte for byte, directly and
  from the S3 test peer with empty memory.
- A3-2: AirKorea data are national datasets (observations per data hour, station list, dust
  forecast) acquired by one owned single-flight acquisition through S08 and published through S06
  before use; nothing is fetched per request, cell or station.
- A3-3: a request never waits past its deadline for an acquisition; it answers with the stored
  data (the legacy output for missing data), and the acquisition finishes for the next request.
- A3-4: settings are real configuration only (`AIRKOREA_SECRET_KEYS`,
  `SERVER2_AIRKOREA_DAILY_UNITS`, `SERVER2_DATA_GO_KR_URL`); the KMA fallback shares the world air
  chain; no mode or verification flag.
- A3-5: paths match `server2/config/tasks/S15b-3.json`; outside changes are the declared documents.

S15b-3b criteria (base `7ca6f002`, after #2750; same directions, coordinator 2026-10-15):
- B3-1: `area_no` and `area_no_near` answer from the repository area-number lists rebuilt with the
  legacy scripts' rules; `life_index`, `rise_set` and `food_poisoning` answer from server2 records
  with the legacy savers and readers; documents and answers equal a pinned legacy oracle byte for
  byte, directly and from the S3 test peer with empty memory.
- B3-2: UV V5, pollen V3, KASI and MFDS are national datasets acquired by owned single-flight
  acquisitions (S13d `OwnedFlights`) and published through S06 before use; MFDS is a new keyless
  acquisition with the S08 keyless transport bounds.
- B3-3: a request never waits past its deadline (at most 3 s); it answers with the stored data
  (the legacy output for missing data) while the acquisition finishes for the next request.
- B3-4: the provider's pollen day+3 (`twodaysaftertomorrow`) is kept in server2 data while the
  legacy answer stays byte-identical.
- B3-5: settings are real configuration only (`DONGNAE_SECRET_KEYS`,
  `SERVER2_DONGNAE_DAILY_UNITS`, `SERVER2_DATA_GO_KR_URL`, `SERVER2_MFDS_URL`); no mode or flag.
- B3-6: paths match `server2/config/tasks/S15b-3b.json`; outside changes are the declared documents.
