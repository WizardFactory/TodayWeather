Task: issue-2697-s12; source: [intent](../intent/issue-2697.md); base ca8735cf; date 2026-10-13.

# Specification: server2 warnings (S12)

## Legacy behavior ported (source revision ca8735cf)

| Legacy source | server2 port |
| --- | --- |
| `server/lib/kmaWarningRequester.js` (URL parameters, JSON/XML classification, short-page paging, 20-page cap) | `server2/src/warnings/provider.rs` on the S08 `FundedExecutor` (budget reservation, data.go.kr rejection rules, key rotation) |
| `server/lib/kmaWarningCollector.js` (getPwnStatus change signal, getWthrWrnMsg bulletin match, getPwnCd day sync and plan, 20-cycle pending, hourly resync, type 2-4 latest item of yesterday/today, quota ends the cycle) | `server2/src/warnings/collector.rs`; the Mongo `_exists`/upsert/`_sync` state becomes catalog reads and in-memory progress derived from catalogs |
| `server/models/modelKmaSpecialWeatherSituation.js` (situation parsing) | `server2/src/warnings/text.rs` |
| `server/lib/kmaWarningZones.js` and `server/utils/data/kma_warning_zones.csv` | `server2/src/warnings/zones.rs` and `server2/src/warnings/data/kma_warning_zones.csv` (copied with provenance) |
| `server/controllers/kma.specialweather.controller.js` (`getCurrent`, `getSpecialInfo`) and route `GET /v000903/kma/special` | `server2/src/warnings/special.rs`, `server2/src/warnings/service.rs` |

Push warning feed export (`_publishPushFeed`) is S18 scope and is not ported.

## Durable records and catalogs

All objects use the S05 raw-record and S06 catalog/fetch-group contracts.
Source `kma-warning`; provider key `Named{id:"national"}` (KMA nationwide `stnId=108`).

| Kind | Content | Period / owning partition |
| --- | --- | --- |
| `bulletin-1` | getPwnStatus page, then getWthrWrnMsg pages of that announcement day | announcement KST date, slot `announcement` / partition `YYYYMMDD` |
| `bulletin-2`, `bulletin-3`, `bulletin-4` | getWthrPwn, getWthrInfo, getWthrBrkNews pages | same |
| `bulletin-N` legacy seed | one exported legacy `KmaSpecialWeatherSituation` document | its stored announcement date |
| `pwn-cd` | getPwnCd page for one KST day | that day, slot `day` / partition `YYYYMMDD` |
| `zone-seed` | exported legacy `KmaSpecialWeatherZone` documents (state + `_sync`) | export KST date, slot `seed` / partition `seed` |

One provider acquisition (all pages) is one fetch group owned by one partition.
Members carry `Pagination{page,pages,complete:true}` in fixed role order and the
content type `application/json; tw-role=<role>`. Raw bytes are exact provider or
export bytes; no normalized bulletin or zone state is persisted. The type
catalog is the only latest authority: there is no separate latest marker.
An acquisition is acknowledged only after `CatalogStore::publish` returns its
complete set (O-9). Gateway error bodies, NoData and failed pages are never
published.

## Latest bulletin per type

- Derive each complete acquisition into `(announcement, document)`: provider
  pages use the legacy latest item `(tmFc desc, tmSeq desc)` and `announcementOf`;
  seeds use their stored announcement. The derived date must equal the partition.
- Type t: walk partitions from KST tomorrow backwards in bounded concurrent waves.
  The first partition with a derived acquisition contains the greatest
  announcement. Equal announcements keep the earliest fetch, matching legacy
  `_exists` skip-on-duplicate.
- A missing catalog is repaired with S06 `repair` for that exact period.
  `CompleteEmpty`, `Incomplete` and a failed repair (for example rejected catalog
  writes) continue to the previous day: an acknowledged group always has its
  published catalog, and catalogs are never deleted, so none of them can hide an
  acknowledged bulletin. Catalog lookup errors (transport, timeout, capacity or
  corruption) fail the request (no invented success).
- Types 1-3 have no age expiry. After the recent wave (KST tomorrow back seven
  days, probed directly so orphans are repaired), older published days are
  discovered year by year from complete `raw/v2/kma-warning/<kind>/<YYYY>/` LISTs
  back to 1970, the earliest storable period date; an unfinished LIST fails closed.
  Announcements later than KST tomorrow cannot come from the provider and are not scanned. Nothing found gives
  legacy 501 `data is empty`. Seed import is a precondition.
- A day is read with one full lookup; if its accumulated history exceeds the
  per-operation output bound, whole acquisitions are paged (halving the page down
  to one acquisition, which always fits because its publication fit), restarting
  on a concurrent catalog change.
- Type 4 uses the latest announcement whose partition lies in the walk window;
  it is omitted when `stored_ms + 10 h < now_ms` (stored = KST wall clock as UTC),
  i.e. strictly after actual + 19 h. Only partitions on or after the KST date of
  now - 19 h are examined for type 4; an older latest flash is always omitted.
  Legacy answered 501 when no type 4 document had ever existed; after seed import
  that state is unreachable, so server2 omits type 4 instead.
- Memory keeps the derived latest per type with a 30-second refresh. A refresh
  walks only down to the cached partition. A failed refresh serves memory younger
  than 300 s (O-9 outage rule); otherwise 501. Empty memory always uses S3.
  The per-type lock makes one walk serve concurrent cold requests.

## Response contract

`GET|HEAD /v000903/kma/special` (Express case-insensitive path, optional
trailing slash, query ignored): order types `[4,1,2,3]`, omit expired type 4,
apply `name` (locale `ko` -> Korean names; any other selected locale -> English
names), shift `announcement` by -9 h to ISO `...Z`, delete `_id` in situations/info,
and apply `_insertLineChange` on UTF-16 units. Locale selection follows i18n
0.8.3: cookie `twcookie`, otherwise the first exact configured locale in
q-sorted `accept-language`, otherwise the first configured parent, otherwise `en`.
Success: 200 JSON, `Cache-Control: max-age=300`, weak MD5 ETag, 304 on match.
Failure: 501 `text/html; charset=utf-8` with the legacy message. Express session
cookies are an application-wide header and are not produced by this handler.

Provider-derived documents use the S02 seed shape: `type`, `announcement`,
`situationList`, `comment`, optional `bulletin`; types 3 and 4 carry
`situationList: []`. Seeded documents keep their exported key order. Production
byte order of newly collected documents is not covered by a golden and must be
checked by S19 shadow comparison.

## specialInfo

`special_info(town{first,second,third})` returns the legacy list
(`weather`, `weatherStr`, `level`, `levelStr`, `locationName`) or an empty list.
Zone state is derived in memory: newest `zone-seed` acquisition, then every
published `pwn-cd` revision since the seed's `_sync.lastSyncAt` (or export time, if
earlier) minus two days. A seed without a valid marker, or with an unfinished legacy
bootstrap (`oldestSyncedTmFc` later than sync - 59 days), replays every published day.
Older days are discovered by LIST; recent 60 days are probed directly. The rows are
replayed through `prepareEvents/applyEvents`, so releases and issues older than
60 days persist as in the legacy collection. One owned task refreshes it (the
request may time out; the task still fills memory): every 300 s it re-applies the
last 60 days the collector can still publish; every 24 h it replays fully. Memory stays
readable during a refresh: a failed or timed-out refresh serves memory younger than 600 s. S15 attaches it to
`current.specialInfo` only when nonempty; errors leave the field absent, as legacy.

## Collector

`WarningCollector::gather(now)` performs the legacy steps in order with a
pluggable funded fetcher. Existence checks read type catalogs; zone sync
progress is derived from published `pwn-cd` catalogs and kept in memory.
A quota rejection ends the cycle. Scheduling is not wired into the server2
process by this task.

## Legacy seeds

`server2/tools/migration/export_warning_seeds.py` converts an operator-provided
`mongoexport --jsonArray` file offline into canonical seed files; it opens no
network or database connection. `warning_seed_import` publishes seeds through
S06 and refuses non-loopback S3 endpoints. Neither tool runs against production.

## Failure behavior

| Condition | Result |
| --- | --- |
| S3 unavailable, valid memory | Serve memory within refresh interval |
| S3 unavailable, empty memory | 501 (legacy error contract) |
| Raw PUT, descriptor or catalog CAS interrupted | Not acknowledged; previous acknowledged latest still served |
| Ambiguous catalog CAS | Reported as ambiguous; later reads use actual catalogs |
| Provider quota/auth | Cycle ends (quota) or step fails (auth); nothing published |
| Status-200 JSON gateway envelope (`OpenAPI_ServiceResponse`, code 30) | Classified as auth (key rotation), as in legacy; S13 (#2726) aligned the shared S08 classifier. Nothing published. HTTP 401/403 also rotate as auth |

## Verification strategy

Golden byte parity for the five `warning-*` cases and `domestic-special-info`
using seeds; parser/zone unit tests against recorded fixtures; local S3 peer
tests for week-old recovery, type 4 boundaries and fault injection on raw,
descriptor and catalog keys; loopback provider stub collector tests; release
example smoke against the local S3 peer and loopback provider stub.
