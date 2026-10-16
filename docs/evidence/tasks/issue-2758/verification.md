# AirKorea observation/page repair evidence (#2758)

Analysis date: 2026-10-16 KST. Inspected repository base: `c48b29aa`.
This records actual diagnosis and local repair verification, not a production release.
Source issue: [#2758](https://github.com/WizardFactory/TodayWeather/issues/2758).
[Published diagnosis](https://github.com/WizardFactory/TodayWeather/issues/2758#issuecomment-6203999374).

## Actual read-only investigation

Existing AWS credentials confirmed the intended account; EC2 inventory and svc DNS
were rechecked. No secrets, SSH details, private configuration, URLs containing
keys, raw request logs or provider bodies are retained here. Selected svc PM2 logs
contained no `AIRKOREA` outcomes. Actual gather PM2 logs contained 10,242 outcome
records in nine selected current/retained files. File retention is not a complete
calendar-window census. Latest station errors for all eight affected provinces
were still present around **2026-10-16 07:53 KST**; Gwangju/Jeonnam city-statistics
errors persisted at 07:44 KST. The other six had successful city-statistics runs
for 07:00 KST, which do not generate province-average rows.

Direct provider diagnostics from svc used the host's existing key in memory: three
initial attempts (Gwangju timed out), followed by **16 successful page requests**
for the eight affected provinces, Seoul control and Gwangju/Jeonnam city statistics.
No collection route, app startup, Mongo/S3 write, restart or deployment was invoked.

| Province | Actual rejected station shape |
| --- | --- |
| Incheon | 운서 |
| Gyeonggi | 대야동, 산본동 |
| Gangwon | 양양읍 |
| Chungnam | 격렬비열도 |
| Jeonbuk | 금마면 |
| Gyeongnam | 남상면 |

Each named row has **`dataTime: null` and all nine supported value fields explicitly
null**. Identity exists; the timestamp check precedes unavailable handling and
rejects the whole province. This establishes the current reproducible condition;
yesterday's complete rejected bodies were not retained. It does not establish a
maintenance/closure reason or absence of stations.

| Operation | Gwangju page-1 items | Jeonnam page-1 items |
| --- | ---: | ---: |
| Station realtime | 13 | 51 |
| City statistics | 5 | 22 |

All four responses report **`totalCount: 0`, `pageNo: 1`, `numOfRows: 100`**.
All four requested page-2 responses report the same zero total and **zero items**.
The old count predicate expects zero items and rejects page one. This differs from
quota errors; the provider was accessible during these diagnostics.

## Reproduction and local verification

[Sanitized fixtures](../../../../server/test/offline/fixtures/airkorea/rejections-20261016.json)
retain selected observation fields only. Null-time samples contain a usable urban
control plus every null-time row on that province's first page; their original
item counts remain provenance. Zero-total fixtures retain complete projected
pages and the observed empty terminal page. No key, URL or provider message is
stored. Seoul is a valid control.

- Baseline regressions: 64 passed on Node 24.19.0 with isolated dependencies.
- New recorded/strict regressions reproduce the old failure. Initial test setup
  mistakes (fixture wrapper/control choice) were corrected and their attempts
  retained locally; they are not implementation regressions.
- Final affected regression set: **79 tests passed** on Node 24.19.0.
  Node **16.20.2** passed all four test files under UTC and Asia/Seoul.
- Distinct real loopback HTTP/disposable Mongo smoke passed on Node 24.19.0 and
  **16.20.2**: **17 persisted average rows, 17 direct-reader/nation rows, 71 station
  rows, zero external fallback calls**. PM2.5/PM10 averages, requested grades and
  original KST/BSON observation times were asserted. City-only rows did not satisfy
  the reader; failed terminal paging produced zero station/average writes.
- Smoke inputs: nine provinces use captured observations; eight unaffected
  provinces use relabeled Seoul controls. Reduced station fixtures use synthetic
  envelope counts. The test clock follows captured times; no observation time is
  rewritten. This is isolated wiring proof, not a live nationwide data audit.
- A separate full-capture replay (in-memory stores, no network/production writes)
  accepted all nine captured province batches, including both Gyeonggi pages,
  and produced these average PM10/PM2.5 pairs at 07:00 KST: Incheon 23/11,
  Gyeonggi 21/10, Gangwon 20/9, Chungnam 22/9, Jeonbuk 23/11, Gyeongnam 22/13,
  Gwangju 21/12, Jeonnam 20/11 and Seoul 18/8.
- Archify schema/render/provenance/browser gates and automated viewport checks
  passed. The 1440px light screenshot was visually inspected: labels/arrows are
  readable and unclipped. Initial Chrome sandbox execution failure was retained,
  then resolved with the same diagram outside that process sandbox.

Commands and prerequisites are in the [offline test guide](../../../../server/test/offline/README.md#airkorea-observation-and-paging-rejection-repair-2758).
The smoke uses production schema/query code with Mongoose 5.13 and disposable
Mongo 7.0.14; the historical 5.1 driver cannot connect to Mongo 7. Unit tests use
production Mongoose 5.1 schema statics. No runtime dependency change is introduced.

## Operator boundary

No merge, production rollout, restart or collection activation is authorized by
these results. The [rollout gate](../../../operations/airkorea-recovery.md#observationpage-repair-rollout-gate-2758)
requires a separately authorized scheduled collection and public response readback
for all 17 identities, especially the eight affected provinces. Check actual
`cityName: ""` rows and fresh valid PM/grades/times; city-only/fallback rows and HTTP
200 do not prove recovery. If access or collection fails, record the live gate as
blocked. Production recovery is **pending operator verification**.
