# Daily forecast contract and operator handoff — issue #2560

## Available horizons and compatibility

The captured `mid-land-captured.json` contains real day 4–10 data; its XML envelope and all other test records are synthetic. No provider contract-change date or national coverage is inferred.

Collectors validate success envelopes, region, 06:00/18:00 KST publication identity and available individual fields. Unknown Korean weather descriptions cannot become clear weather: acceptance and conversion share one mapping, including `구름많고 소나기` and `흐리고 소나기` with the existing rain-compatible precipitation/icon category (pty=1). Missing/invalid fields are absent. A record with no usable weather/temperature fails; partial valid records are retained for their actual horizons. Both DB formats preserve region, publication, `wf*`, optional `rnSt*`, and valid `taMin*`/`taMax*`. Temperature schema defaults are removed; preexisting -100/-999 values are rejected at read composition. No migration or DB cleanup is required.

The service emits a mid daily row only when both recognized AM/PM weather and a valid ordered min/max pair exist for the same KST date. This preserves the previous complete-row consumer contract. A missing date means unavailable, with additive `midData.dailyStatus.unavailableDates` explaining gaps for today through today+10. No placeholder row, guessed clear weather, zero temperature or shifted horizon is inserted. The 2026-09-24 captured land starts on **20260928**. If short ends 20260926 and temperature has no valid day 3, **20260927 remains unavailable**. Legacy day-3 fields retain publication date+3.

`rnStAm`/`rnStPm` are optional additive precipitation probabilities. Existing weather/date fields remain. Before presentation the service uses `taMin`/`taMax`; v000903's existing presentation converts these into `tmn`/`tmx`. Celsius and Fahrenheit flows are covered. The client iterates actual daily rows and identifies today by `fromToday`, rather than requiring a fixed array index. Bundled native applications/builds are not executed or claimed verified.

## Publication, target and precedence policy

- Land and temperature: independently require age 0–36 hours (inclusive), allowing a missed twice-daily cycle. No future publication, malformed date, or mismatch between the DB publication and the row's date/time is accepted. Date, timezone-bearing ISO and `YYYYMMDDHHmm` KST representations normalize to the same epoch. Unequal valid publications can join by actual target date.
- Use the newest publication; do not reuse hidden older fields when the newest publication is partial. DB v2 selects descending publication. Each horizon offsets its own publication's Korean calendar date; UTC arithmetic over KST calendar values avoids host-timezone/DST shifts.
- Short overlays: each contributing source uses its own publication age (0–24 hours inclusive) and KST target ceiling (publication date+4). Short RSS is independently checked before overlay; future, malformed or expired RSS publications are unavailable. Older RSS cannot override a fresh primary, equal publications fill missing fields, and newer RSS or a missing/expired primary permits usable RSS fields to replace their counterparts. Valid complete weather/temperature summaries replace matching daily dates. Invalid weather, nonfinite/sentinel values and unsupported zero sums/lightning cannot erase usable mid data. This is a conservative service policy, not a claim about a newly verified provider SLA.
- Final daily output is chronological and unique. The prior seven-day recent observation window is retained, with future targets bounded at today+10. `getPastMid` still supplies observation-derived history; 2025-era RSS is never history in September 2026.
- `dailyStatus.healthy` separately checks land/temp freshness, target window, ordering/uniqueness and usable future mid rows. A healthy result requires usable rows without gaps from today through the last usable future target. Missing internal dates produce `forecast-gap`; malformed/incomplete rows produce `invalid-daily-row`. Unsupported trailing horizons remain listed in `unavailableDates` and do not alone degrade health. This check executes before unit/presentation conversion. Degraded results emit a sanitized diagnostic at most once per minute per process (no timer or provider URL). Present current/short publications alone do not make it healthy.

## Mid RSS disposition

No replacement source was verified. The historical mid RSS scheduled/network-to-storage entry points and service cache overlay are explicitly retired. `getMidRss` middleware continues without DB lookup. The controller's `overwriteData` is a no-op for both empty and populated lists; all older/equal/newer cached publications have no precedence. Cached RSS is never advertised with a new `rssPubDate`. Low-level HTTP/XML parsing rejects HTML and unexpected envelopes even on HTTP 200. Retired persistence entry points reject writes, and no invalid content advances scheduling/publication. Short RSS is independent and remains active.

## Deployment checklist (operator only, after approval)

1. Reinspect deployed revision/local edits, preserve production configuration and record rollback revision. Local implementation does not establish production recovery.
2. Securely renew/choose a valid provider credential; do not print keys or key-bearing URLs. No credentials are copied/rotated by this change.
3. Deploy reviewed code to gather and service under the operator's change process. Confirm the schema module is present on both hosts; no dependency upgrade or migration is necessary.
4. Observe the normal scheduled MID_LAND and MID_TEMP collection. Confirm sanitized success envelopes, actual `recvData` records and persisted publication/values, not just HTTP 200 or process health. Check DB write failures.
5. Query origin then CDN after normal TTL for Seoul plus representative other regions. Verify chronological unique dates, actual day-4–10 calendar offsets, no 2025-era dates, truthful unavailable day 3, valid values and dailyStatus. Preserve current/short, yesterday and seven-day comparisons. Check both temperature units and representative legacy clients.
6. Keep the expired-key incident, code deployment and demonstrated production recovery as separate operational states.

## Rollback

Restore the recorded prior application revision without overwriting local secrets/configuration. No destructive data migration was made. Existing persisted schema fields are backward compatible; inspected shared JS and native dictionary readers select known daily fields; native binaries and every shipped client were not executed. A rollback reintroduces the original missing-day-3 parser and stale RSS risk; explicitly monitor daily health and decide operational mitigation rather than declaring recovery from a restart.

## Short RSS fallback after PR review

`shortRssPubDate` remains the accepted feed publication, including a feed with no matched slots. It does not establish daily validity. `getShortRss` separately keeps a request-local snapshot of only matched, future slots and the fields actually copied from RSS. If the primary short publication is unusable, daily summarization selects that snapshot and its own publication for age and target-date checks. Later hourly/current merges cannot authorize untouched stale fields. This RSS provenance object stays request-local and is neither exposed nor persisted.

RSS-only daily rows require the existing complete weather and explicit min/max contract; humidity is optional and absent humidity is omitted, not converted to zero. Sampled t3h extrema do not replace missing provider min/max; partial wind-only, unmatched, or incomplete feeds leave unavailable dates. KST midnight is normalized with the same helper as the public route. The primary publication and hourly response field names remain unchanged. With a valid primary publication, existing observation-adjusted summaries and RSS precedence remain supported. A rejected RSS publication logs a sanitized unavailability reason; logs never include a provider URL/key. No live RSS SLA or new provider contract is claimed.

RSS-only daily fallback omits `r06`/`s06` aggregates: accepted RSS values are overlapping six-hour amounts and have not passed the mixed-hourly precipitation redistribution. Summing them would overstate the daily amount. Hourly precipitation remains unchanged; missing daily aggregates mean unavailable, not zero.

## Stored short forecasts beyond the hourly template

The hourly response retains its41-slot template. Additional daily targets beyond D+2 are composed separately from raw stored short inputs, with each source's 0–24h publication age, valid KST target and publication-date+4 ceiling. Latest per-slot publication wins before freshness filtering; a partial newest slot never borrows fields from its older copy. Valid raw daily rows use the same weather/explicit-extrema contract and omit unadjusted rain/snow aggregates.

DB2 retains each short document's publication in the internal read result. DB1 adds optional `dailySource:{pubDate,rows}` to modelShort: the current raw batch replaces the entire snapshot on every successful collection/save, separately from the existing partial hourly merge. No backfill or migration relabels historical values. Existing DB1 documents without this snapshot cannot supply extra daily horizons until a normal successful short collection populates it. If the provider has no complete D+3, it stays unavailable and an internal gap degrades health. The snapshot is never part of the public response. No production collection was triggered to populate it locally.

Operators should verify the first normal DB1 short collection creates the snapshot and that an available D+3 crosses the short/mid boundary. On rollback, the optional snapshot can remain; no destructive cleanup is needed. The retired midrss task is removed from startup/hourly queues; manual legacy endpoint behavior remains explicitly unavailable.
