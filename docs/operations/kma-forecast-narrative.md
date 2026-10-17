# Forecast narratives in weather responses (#2798)

AK's 2026-10-17 amendment replaces the earlier special-screen design. Existing
weather APIs gain an optional `forecastNarrative` field. No endpoint, client code,
translation or push behavior is added. `/v000903/kma/special` keeps types 1–4.
Mobile parsing and presentation are [#2803](https://github.com/WizardFactory/TodayWeather/issues/2803);
installed clients do not display the new field until an app update consumes it.

## Provider and regional selection

The official [short-term notification service](https://www.data.go.kr/data/15058629/openapi.do)
returns the latest `getWthrSituation` publication within 24 hours. Request HTTPS,
JSON, `pageNo=1`, `numOfRows=10`, and the office below. `wfSv1` is optional;
`wn`/`wr` never drive warning or push state. The attached 241128 guide's station
workbook, sheet `단기예보통보문지점목록`, category **개황**, rows 2–11 is the source.
The source ZIP is [publicly downloadable](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003616524&fileDetailSn=1).

| Office | Coverage |
| --- | --- |
| 108 | Nationwide |
| 109 | Seoul, Incheon, Gyeonggi |
| 159 | Busan, Ulsan, Gyeongnam |
| 143 | Daegu, Gyeongbuk |
| 156 | Gwangju, Jeonnam |
| 146 | Jeonbuk |
| 133 | Daejeon, Sejong, Chungnam |
| 131 | Chungbuk |
| 105 | Gangwon |
| 184 | Jeju |

`kmaForecastRegions` matches exact Korean province aliases, including historical
and renamed Gangwon/Jeonbuk names and the Gwangju/Jeonnam integrated name. A
Gwangju city inside Gyeonggi uses its resolved Gyeonggi province (109), not the
Gwangju office (156). Unknown/foreign provinces have no guessed fallback. These
are complete regional bulletins, not excerpts extracted from nationwide prose.

Only the original sampled key's nationwide access was live-proven in #2798.
Regional access, every configured key and future quota remain unverified.

## Collection and persistence

After each scheduled warning cycle, dispatch the independent narrative batch,
including when warning work stops on its service quota. The warning callback
never waits for narratives; narrative errors cannot change warning results,
zones or push. The existing scrape/local scheduler enqueues the warning work at
three-minute intervals. The same narrative instance coalesces overlapping batches.

The ten-office batch is serial. Each office tries each consolidated data.go.kr
key at most once on auth/quota rejection, with a 30-second absolute timeout per
key, exact HTTP 200 / result `00` and no redirects. Other errors are not retried.
One office's failure does not prevent other offices. The bound is at most
`10 × keyCount` provider requests and `10 × (30s × keyCount + 2s)` for their request
and persistence deadlines, plus event-loop scheduling. Slow/outage batches can
span several ticks; overlapping ticks do not duplicate them. No weather request
calls a provider. Logs/errors never include keys, key-bearing URLs or raw provider
messages.

`KmaForecastNarrative` is separate from `KmaSpecial`. Its deterministic string
`_id` is `office:tmFc`; documents contain `stationId`, `announcement` and `text`.
The collector validates returned office, real twelve-digit KST publication,
nonfuture age under 24 hours and nonempty text before writing. It stores the true
UTC instant (17:00 KST = 08:00 UTC), normalizes CRLF only, and uses `$setOnInsert`
so repeat/concurrent acquisition cannot rewrite a publication. Duplicate-key
races mean the publication already exists. Each write has a two-second deadline;
a late write retains its true publication time and can never make stale text fresh.

There is no destructive migration. Unreleased historical type-5 `KmaSpecial` rows
are ignored by the restored warning reader and may remain during rollback.

## Existing API response extension

The shared nationwide route (`v000803`, reused by `v000901`–`v000903`) adds office
108 at the root of `GET /v000903/nation/KR`. Representative-city weather items
retain their existing fields and omit redundant regional narrative fields.

The shared `ControllerTown24h` sender adds the matching office to assembled
regional KMA responses, including v000901, v000902 and v000903 address paths and
the corresponding coordinate-resolution paths. Selection uses resolved
`regionName`; it does not guess a province from coordinates or a city substring.
Older raw formats without this assembled result stay unchanged. Overseas weather
and unknown regions do not gain Korean prose.

```json
{
  "forecastNarrative": {
    "stationId": 109,
    "region": "서울·인천·경기도",
    "announcement": "2026-10-16T08:00:00.000Z",
    "expiresAt": "2026-10-17T08:00:00.000Z",
    "text": "Original provider prose\nwith original line breaks",
    "language": "ko",
    "source": "KMA",
    "textFormat": "plain"
  }
}
```

The example dates explain the contract; they are not a current live publication.
Text is original, untrusted plain text, including literal markup characters.
Future clients must bind it as text, never trusted HTML. The server does not
translate prose or convert embedded units. Existing weather units/fields remain
unchanged. A two-second DB-only read deadline, query failure, invalid/wrong-office,
future, empty or age ≥24h data omits only this field. Late reads cannot mutate a
sent response. Cache max-age/s-maxage is capped at 300 seconds and the publication's
remaining whole seconds, retaining restrictive directives and removing stale
extensions. CDN minimum TTLs and public-path propagation need deployed readback.

## Local verification

Use an isolated dependency prefix; never start the application or use `/gather/*`
as a health probe. Tests use synthetic prose and dummy keys, not captured complete
provider bulletins or live provider access.

```sh
NODE_PATH=/tmp/issue2798-deps/node_modules node server/test/offline/kma-narrative.test.js
TZ=America/Los_Angeles NODE_PATH=/tmp/issue2798-deps/node_modules node server/test/offline/kma-narrative.test.js
NODE_PATH=/tmp/issue2798-deps/node_modules node server/test/offline/kma-warning-node10-check.js
TW_MONGOD=<local-compatible-mongod> NODE_PATH=/tmp/issue2798-deps/node_modules node server/test/offline/kma-narrative-smoke.js
```

Dependencies: async 2.6.4, request 2.88.2, Express 4.13.4,
`mongoose-smoke@npm:mongoose@5.13.23`, mongodb-memory-server-core 10.1.4. The smoke
uses real loopback HTTP and Mongo 7.0.14, with unrelated weather/geocoder/air
collaborators isolated. It exercises actual collection, storage, shared weather
assembly/sending and mounted national/regional/special routes. Fake-ODM/schema
checks do not establish production Mongoose 5.1.2 casting or persistence. Local
Node 24 execution of the Node-10-compatible script is not an actual Node 10 run;
CI records the actual versions. See [verification](../evidence/tasks/issue-2798/verification.md)
and the [editable API manual](kma-forecast-narrative-manual.html) / PDF.

## Operator deployment/readback and rollback

Deployment/restart requires separate operator approval. Production uses selective
overlays: inspect deployed behavior, Node/ODM versions, mode/DB connection and
scheduler wiring first. Save exact deployed copies and hashes of every affected
runtime file, including the shared town sender, nation route, collector/requester,
new office/response helpers and narrative model. Preserve existing host config.

After approved rollout, let a normal scheduled batch run. Record actual office
coverage/publication times without secrets. Compare origin and public national
weather (108), Seoul/Incheon/Gyeonggi weather (109) and every other available
regional office, including coordinate requests and normal cache behavior. Verify
special types 1–4 and current warning state remain intact. Do not infer success
from HTTP 200, one nationwide key or unchanged client screens. Keep #2798 open
while scheduled acquisition or deployed readback is missing/blocked; mobile
presentation remains a separate #2803 app release.

For rollback, restore the saved overlays and remove the new helper/model files
only after restoring their callers; with operator approval restart affected
workers. The separate narrative collection can remain unused. Do not delete
warning/zone documents, rewrite publication dates or send pushes to roll back.
