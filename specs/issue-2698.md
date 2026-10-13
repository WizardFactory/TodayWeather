Task: issue-2698-s13; owner: Claude builder (S13 worktree); revision/base: ca8735cf937a634e7af57396d605e26db8bfc4ff; date: 2026-10-13.
Authority: AK authorized S13 on 2026-10-13 (relayed by the root coordinator); endpoint pre-merge.
Criteria: AC1, AC2, AC3 from [intent](../intent/issue-2698.md).

# Specification

## Families and request arguments (AC2)

Legacy sources at `ca8735cf`: `collectTownForecast.js` (getUrl, `_requestPage`,
`_requestRemainingPages`), `controllerManager.js` (query-time helpers),
`PastConditionGather.js` (`makePubDateList`), `lifeIndexKmaRequester.js`,
`kma.town.short.rss.controller.js`, `kmaScraper.js`, `dataGoKrKeys.js`,
`dataGoKrRejection.js`, `kmaWarningRequester.js` (JSON gateway envelope).

| Kind (source) | Operation | Query (transport appends `serviceKey`, `dataType=JSON`) | Pages |
| --- | --- | --- | --- |
| `ultra-srt-ncst`, `ultra-srt-fcst`, `vilage-fcst` (data-go-kr) | `VilageFcstInfoService_2.0/getUltraSrtNcst`, `getUltraSrtFcst`, `getVilageFcst` | `base_date, base_time, nx, ny, pageNo, numOfRows=999` | ≤5 |
| `mid-fcst`, `mid-land-fcst`, `mid-ta`, `mid-sea-fcst` (data-go-kr) | `MidFcstInfoService/getMidFcst` (`stnId`), `getMidLandFcst`, `getMidTa`, `getMidSeaFcst` (`regId`) | `stnId|regId, tmFc, pageNo, numOfRows=999`; tmFc ends `0600`/`1800` | ≤5 |
| `uv-idx-v5` (data-go-kr) | `LivingWthrIdxServiceV5/getUVIdxV5` | `pageNo, numOfRows=1000, areaNo=, time=YYYYMMDDHH` | ≤8 |
| `oak-pollen-v3`, `pine-pollen-v3`, `weeds-pollen-v3` (data-go-kr) | `HealthWthrIdxServiceV3/getOakPollenRiskIdxV3`, `getPinePollenRiskIdxV3`, `getWeedsPollenRiskndxV3` | as UV | ≤8 |
| `town-rss` (kma-web) | `wid/queryDFS.jsp` | `gridx, gridy` | 1 |
| `aws-minute`, `aws-hourly` (kma-web) | `cgi-bin/aws/nph-aws_txt_min` | none, or raw `YYYYMMDDHH00&0&MINDB_60M&0&m` | 1 |
| `city-obs` (kma-web) | `weather/observation/currentweather.jsp` | raw `tm=YYYY.MM.DD.HH:00` | 1 |

Publication helpers take wall-clock UTC milliseconds and use KST (UTC+9):
short `<0210` previous day `2300`, else the latest of 02,05,…,23 at HH10; ultra-short
minute `<45` previous hour `HH30`, else `HH30`; current minute `<40` previous hour `HH00`;
mid KST hour `<08` previous day `1800`, `<20` `0600`, else `1800`; past current: 23
hourly `HH00` slots from KST hour (UTC minute `>40`) or KST hour−1; UV: five 3-hour slots
newest first; pollen: current KST hour; RSS expected latest: KST hour ≤2 previous day
`2300`, else `((h/3)−1)*3+2`; AWS hourly/city: current KST hour `HH00`.

Keys follow `dataGoKrKeys.parse`: JSON array; strings with trimmed length ≥20, not starting
`You have to set`, first occurrence kept. Each key is percent-decoded once
(`decodeURIComponent`); a malformed encoding is rejected at configuration (legacy forecast
URLs became empty; the life-index fallback encoded the raw key). The transport encodes
once. A per-service ring (`VilageFcstInfoService`, `MidFcstInfoService`,
`LivingWthrIdxServiceV5`, `HealthWthrIdxServiceV3`) keeps a sticky current key; a call
offers the current key and the next key with a distinct quota owner to the S08 executor.
After a quota/auth rejection or a successful rotation the ring advances, matching the
#2604 per-service stickiness. Credential-to-quota-owner mapping remains operator
configuration (O-10: separate server2 data.go.kr key set).

## Rejection and validity (AC1, AC2)

S08 `classify` precedence is kept. Added: the JSON gateway envelope
`OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode` is recognized (legacy
`kmaWarningRequester`/life-index), so a JSON auth/quota envelope stops or rotates the key
instead of a funded retry. A per-call validator adds a family no-data hook: forecast `00`
with zero `totalCount` or empty `items` (`""`), life-index `99`, and a forecast page whose
rows all echo a different publication (stale) are terminal NoData without a second
attempt. They are never records. Valid pages require `resultCode` `00`/`0`, digits
`totalCount>0`, nonempty `items.item`, echoed `pageNo`/`numOfRows` when present, the
requested grid/region/station echo where the family carries it, and forecast rows that all
echo one accepted publication (ultra-short HH30 also accepts HH00; the echoed value becomes
the record period). XML and HTML bodies are never valid data.go.kr data.

## Pagination and raw records (AC1)

Page 1 decides the page count: single page when rows equal `totalCount`; otherwise rows
must equal `numOfRows` and `ceil(total/numOfRows)` must be within the family cap. Pages
2..n are requested in order with the same key ring and caller deadline. Each page repeats
`totalCount`, echoes `pageNo`, holds `min(numOfRows, remaining)` rows and adds no
duplicate row (all fields except `fcstValue`/`obsrValue`; life index: `areaNo` with one
issuance `date`). Any failure discards every page. Only after all pages pass are raw records
created with `Pagination{page, pages, complete: true}` and one `GroupDeclaration` in one
owning partition `YYYYMMDD-HHMM`. The result is `resolver::Acquisition`; publication through
S06 (O-9) stays with the caller. Record identity: source `data-go-kr` or `kma-web`, the kind
above, provider key `grid`, `named` (lower-cased region/station code) or `named` constant
for all-area/national pages, period from the echoed or requested publication.

KMA web bodies are stored byte-for-byte with the received content type (an absent header is
labelled `application/octet-stream`). EUC-KR bodies must form strict KS X 1001 byte pairs
(`A1–FE` lead and trail, as legacy `iconv('euc-kr')` decodes); UTF-8 declared bodies must be
valid UTF-8 (legacy rule: UTF-8 when declared in the content type or first 2 KiB, else EUC-KR;
the city page alone falls back to UTF-8). RSS must be UTF-8 (legacy decoded it as UTF-8) with
root `wid`, no DTD, a 12-digit `header/tm`, the requested `x`/`y` and at least one `body/data`.
AWS requires an `ehead` element whose last token is `YYYY.MM.DD.HH:MM` and a nested table;
city requires a topinfo (or `tm` input) publication and the observation table. A missing
publication is NotPublished; a publication older than the requested one is Stale; neither is
stored. Catalog partitions: data.go.kr and RSS by publication `YYYYMMDD-HHMM`; AWS and city
observation pages by KST day `YYYYMMDD` (minute pages would otherwise create a catalog each).

## Transport, deadline, budget and metrics (AC2)

Funded data.go.kr calls use the S08 executor unchanged in admission, prefunding, two-attempt
and rotation rules, with an additive per-call validator and attempt report. KMA web calls use
a keyless public transport with the same body/header bounds, HTTPS or literal loopback,
redirects only to the same scheme/host (legacy request followed redirects), at most two
attempts (retry only status-less transport failure or 5xx) inside the caller deadline.
Legacy unbounded RSS retries and 10×1 s scrape loops are not reproduced; scheduling belongs
to S14 capture. Metrics count funded calls, reserved and consumed units, attempts by
outcome, public attempts, completed groups and rejected incomplete page sets; they render
as Prometheus text without wiring a route.

Differences recorded: HTTPS instead of HTTP for apis.data.go.kr VilageFcst/Mid/UV and KMA web
hosts (S08 policy; live KMA-web HTTPS reachability unverified); JSON instead of XML; one
funded retry per page call instead of whole-pass retries; codes 10/12 terminal.

Out of scope with owner to confirm: AirKorea/KECO (`returnType=json`, separate key list),
KASI rise/set (`_type=json`), forecast-zone codes (`newsky2`, `type=json`), warnings (S12).

## Verification

Unit and loopback tests with recorded and synthetic fixtures; release-mode smoke over real
loopback HTTP with the S03/S06 S3 peer (budget authority, raw PUT, catalog publication and
exact readback). fmt, clippy, full test suite, placement gate and artifact policy.

## 2026-10-13 amendment (PR #2726 review S13-R1..R8)

Source: Codex review of head `9f734972`. Tightened, not widened: `pageNo`/`numOfRows` echoes
are mandatory for any multi-page set and for the life index (a complete single forecast page
may still omit them, as legacy did); forecast rows need `fcstDate`/`fcstTime` (not current);
UV rows need an `hN` field and pollen rows a daily grade field; ultra-short echoes are only
HH00/HH30 of the requested hour. HTML pages must end with `</html>`; the city table must be
closed with a data cell and the AWS innermost table closed with a data row; the city timestamp
is extracted from the topinfo characters so an EUC-KR label cannot hide it. `WebRequest::not_before`
lets callers reject an older RSS or minute page as `Stale` (legacy skipped current grids before
fetching). Each consumed unit is reported as `Unsettled` before HTTP and settled in place, and a
drop guard records the call, so cancellation after funding or sending is counted. Key-ring
settlement re-advances when a concurrent call left it on a key this call saw rejected.
