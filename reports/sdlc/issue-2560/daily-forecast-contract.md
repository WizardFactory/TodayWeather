# Daily forecast contract and operator handoff — issue #2560

## Available horizons and compatibility

The captured `mid-land-captured.json` contains real day 4–10 data; its XML envelope and all other test records are synthetic. No provider contract-change date or national coverage is inferred.

Collectors validate success envelopes, region, 06:00/18:00 KST publication identity and available individual fields. Unknown Korean weather descriptions cannot become clear weather: the recognized vocabulary is the existing service formatter's vocabulary. Missing/invalid fields are absent. A record with no usable weather/temperature fails; partial valid records are retained for their actual horizons. Both DB formats preserve region, publication, `wf*`, optional `rnSt*`, and valid `taMin*`/`taMax*`. Temperature schema defaults are removed; preexisting -100/-999 values are rejected at read composition. No migration or DB cleanup is required.

The service emits a mid daily row only when both recognized AM/PM weather and a valid ordered min/max pair exist for the same KST date. This preserves the previous complete-row consumer contract. A missing date means unavailable, with additive `midData.dailyStatus.unavailableDates` explaining gaps for today through today+10. No placeholder row, guessed clear weather, zero temperature or shifted horizon is inserted. The 2026-09-24 captured land starts on **20260928**. If short ends 20260926 and temperature has no valid day 3, **20260927 remains unavailable**. Legacy day-3 fields retain publication date+3.

`rnStAm`/`rnStPm` are optional additive precipitation probabilities. Existing weather/date fields remain. Before presentation the service uses `taMin`/`taMax`; v000903's existing presentation converts these into `tmn`/`tmx`. Celsius and Fahrenheit flows are covered. The client iterates actual daily rows and identifies today by `fromToday`, rather than requiring a fixed array index. Bundled native applications/builds are not executed or claimed verified.

## Publication, target and precedence policy

- Land and temperature: independently require age 0–36 hours (inclusive), allowing a missed twice-daily cycle. No future publication, malformed date, or mismatch between the DB publication and the row's date/time is accepted. Date, timezone-bearing ISO and `YYYYMMDDHHmm` KST representations normalize to the same epoch. Unequal valid publications can join by actual target date.
- Use the newest publication; do not reuse hidden older fields when the newest publication is partial. DB v2 selects descending publication. Each horizon offsets its own publication's Korean calendar date; UTC arithmetic over KST calendar values avoids host-timezone/DST shifts.
- Short overlays: publication age 0–24 hours, targets no later than publication date+4. Valid complete weather/temperature summaries replace matching daily dates. Invalid weather, nonfinite/sentinel values and unsupported zero sums/lightning cannot erase usable mid data. This is a conservative service policy, not a claim about a newly verified provider SLA.
- Final daily output is chronological and unique. The prior seven-day recent observation window is retained, with future targets bounded at today+10. `getPastMid` still supplies observation-derived history; 2025-era RSS is never history in September 2026.
- `dailyStatus.healthy` separately checks land/temp freshness, target window, ordering/uniqueness and usable future mid rows. A healthy result does **not** promise continuity: consult `unavailableDates`. This check executes before unit/presentation conversion. Present current/short publications alone do not make it healthy.

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

Restore the recorded prior application revision without overwriting local secrets/configuration. No destructive data migration was made. Existing persisted schema fields are backward compatible; old clients ignore additive status/probability fields. A rollback reintroduces the original missing-day-3 parser and stale RSS risk; explicitly monitor daily health and decide operational mitigation rather than declaring recovery from a restart.
