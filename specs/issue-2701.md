Task: issue-2701-s16; owner: Claude builder (S16 worktree); revision/base: 1d60f728; date: 2026-10-15.
Authority: AK authorized S16 on 2026-10-15 (relayed by the root coordinator); endpoint pre-merge.
Criteria: AC1-AC5 from [intent](../intent/issue-2701.md).

# Specification

`server2::summary` stores daily summaries in S3 and answers an internal last-year lookup. It adds
no response field. Legacy references are at `1d60f728`; KST is UTC+9.

## Sources

| Source | Basis | Legacy and provider evidence |
| --- | --- | --- |
| Grid | `_getDaySummaryList(pastList)` rows that `getPastMid` merges | `server/controllers/controllerTown.js:2697` (`getPastMid`, `requestTime = _getTimeValue(9-7*24)`), `:2677` (`_mergeMidByCurrent` filter `date >= requestTime.date`), `:5530` (`_getDaySummaryList`; `0000` becomes the previous day's `2400` at `:5539`; `historyRecovered` drops partial `rn1` at `:5638`); inputs from `getCurrent` `:692`, `updateCurrentListForValidation` `:979`, `mergeCurrentSkyByShortest` `:1252`, `mergeCurrentByStnHourly` `:1290` (station rows and `lib/history/service.js:66` `mergeHourly`). server2 port: `domestic/kma/mid.rs` `day_summary_list`, `get_past_mid` |
| ASOS | Station daily rows of `AsosDalyInfoService/getWthrDataList` (`dataCd=ASOS`, `dateCd=DAY`, one station, 1-7 days) normalized as `lib/history/policy.js:92` (`minTa`→`taMin`, `maxTa`→`taMax`, `avgTa`→`t1d`, `avgRhm`→`reh`, `sumRn`→`rn1`, `avgWs`→`wsd`; an item with `taMin > taMax` is dropped) and saved first-valid-wins (`store.js`) | data.go.kr 15059093 (ASOS daily); `policy.complete` `:86` (`taMin`, `taMax` valid and ordered); server2 `domestic/asos.rs`, `source/asos.rs` (S15b-2) |
| VC | Raw Visual Crossing Timeline bodies the world family stored (S11): `days[].datetime`, `days[].hours[].datetimeEpoch`, `temp` (°F, `unitGroup=us`), `days[].precip` (inches), `timezone` | Visual Crossing Timeline API documentation (hourly `datetimeEpoch`, `temp`; day `precip`; `timezone`, `tzoffset`); server2 `world/source.rs:90`, `world/store.rs` |

Legacy stores no daily summary; the grid rows are the response values that the tw_svc assembly
derives at `getPastMid`, so S16 adds storage only.

## Keys and S3 layout

| Source | Canonical key (JSON, this order) |
| --- | --- |
| grid | `{"source":"grid","town":[first,second,third]}` (the matched town; the body records `nx`, `ny`) |
| asos | `{"source":"asos","station":"108"}` (canonical legacy station id) |
| vc | `{"source":"vc","cell":[latHundredths,lonHundredths]}` (the S11 0.02-degree cell) |

Object key: `summary/v2/{source}/{key_sha256}/{YYYYMMDD}/{latestFetchedMs:013}-{count:06}-{revision_sha256}.json`,
where `key_sha256` hashes the canonical key and `revision_sha256` the body. The name orders
revisions: a later newest input, then more inputs. PUT uses `If-None-Match: *`; a 412 is
accepted only after a GET returns the identical bytes. No summary is deleted and no lifecycle
rule is added (retention at least three years; the role has no delete permission).

Body (exact key order): `{"schema":1,"source","key","date","values","inputs":{"count","latestFetchedMs","sha256","families":{name:count}}}`
plus `"grid":{"nx","ny"}` for grid. `inputs.sha256` is the SHA-256 of the sorted identity lines
`family|startMs|endMs|fetchedAtMs|contentSha256` of the input acquisitions relevant to the date;
the set is reproducible from the S3 raw records. The reader takes the greatest object name under
the date prefix whose body verifies (revision hash, schema, source, key, date, completeness).

## Completeness

- Grid: `observationHours` (usable `t1h` hours, `-50` sentinel excluded) >= 18. Stored dates are
  KST today-6..today-1 at the request instant: every hour has ended and every input window
  (192 current slots, 8-day station pages, ASOS D-7..D-1) covers the date.
- ASOS: `taMin` and `taMax` present, valid (`policy.valid`) and `taMin <= taMax`; `rn1` optional.
- VC: distinct hours with a finite `temp` in `[local midnight, next local midnight)` times 4 >=
  local hours times 3, where local hours come from the IANA `timezone` (23, 24 or 25); an unknown
  zone counts 24. Values (metric, one decimal): `taMin`, `taMax`, `t1d`, optional `rn1` (mm),
  `observationHours`, `localHours`. Only bodies fetched at or after the end of the local date
  count; the newest by `(fetchedAtMs, sha256)` is used.

Incomplete summaries are not stored.

## Complete published inputs and late revisions

The snapshot records summary inputs only when its reads were complete (a listed group that S06
excludes, not eligible or with a raw body missing, makes a grid, station-page, registry-seed, ASOS or VC read
partial): every grid family read from published S06 catalogs (otherwise the request forwards anyway); the station fold the answer
used is still current, every day of the page window was read and its latest read did not fail, and
no S3 load, fold, geocoding or unfolded page is pending; the history answer has no `cache-read-*`
reason; and the ASOS acquisitions it used were read under the same lock as "no recovery run in
flight, no failed read"; the latest registry seed read did not fail. Station pages are identified
by kind, hour, fetch time and raw hash; the station registry (an input of every date) by its
content hash and the instant it first appeared in the process.
Inputs relevant to KST date D: grid acquisitions published in `[D 00:00 - 24 h, D+1 00:00]`,
station pages for hours `(D 00:00, D+1 00:00]`, ASOS ranges covering D.

The recorder runs after a natively served response, outside the request wait. Per
(source, key, date) it skips an input digest it already examined. A new digest lists the date
prefix (another process may have written) and writes a revision when its newest input is newer
than the stored newest revision's (also with equal values, so the stored order follows the
inputs), or as new with other values; an older input set never supersedes a newer one. Record
work is serialized; at most two record tasks run at once (more are dropped and repeated by a
later request); memory keeps at most 65,536 entries. Before 01:00 KST yesterday is not stored
(its `2400` hour is still the live minute-updated row).

## Last-year lookup (internal)

`summary::Lookup::last_year(target, today, deadline)`: base date `(Y-1, M, D)` (Feb 29 →
Feb 28); offsets 0, -1, +1, -2, +2, -3, +3. At each date: the stored grid summary of the town, then
ASOS (stored; when missing, one on-demand acquisition of `[base-3, base+3]` for the mapped
station through the S15b-2 funded acquirer, published to S06, its complete days stored; a
concurrent lookup waits for it, a cancelled or failed one releases the range, a finished one is
not repeated for 24 h), then VC (derived from the stored raw VC records of that date each time;
stored under the same rule as the recorder, so newer records are stored also with equal values;
never from the VC provider). The
first complete summary wins. A failed S3 read, a provider failure or an unfinished concurrent
acquisition at the deadline returns an error instead of a lower-priority answer; `03`/empty means
absent. Nothing exposes the
result in a response (O-13).
