# Weather response narrative verification (2026-10-17)

AK amended #2798 after the initial special-screen implementation/review: national
and regional narratives now extend existing weather responses. No new endpoint
or client parser/template is introduced. The prior special/type-5 PASS is
historical; this candidate requires renewed review. Issue #2803 owns a later app
update for display/localization. #2798 remains open for separately approved live
scheduled acquisition and origin/public readback.

## Local checks on the revised implementation

| Check | Actual result |
| --- | --- |
| Intended pre-implementation regression | Failed as expected; regional mapping/read/response/independent-dispatch behavior absent. First unbounded dispatch assertion was interrupted; bounded rerun retained the intended failures. |
| `kma-narrative.test.js` after implementation | 17 passed, including the final write/read deadline and callback guards |
| Same regression in America/Los_Angeles | 17 passed; publication conversion is host-timezone independent |
| Existing warning regression | 18 passed; warning/zone behavior preserved |
| Existing data.go.kr key regression | 33 passed |
| Node10-compatible warning/narrative replay | Passed locally on Node24.19.0, not an actual local Node10 execution |
| Existing town coordinate response regression | Passed after explicitly isolating the unrelated narrative helper in its existing harness |
| Separate real HTTP/Mongo smoke | Passed: 71 synthetic provider requests, 20 immutable publications across 10 offices, all17province mappings, v000901/2/3, coordinate selection, national root, unchanged types1–4 and exact24h expiry |
| API manual | Chrome PDF/screenshot renewed from actual isolated response excerpts; both PDF pages rendered and visually inspected |

The first local HTTP attempts were blocked by the restricted execution sandbox
(`listen EPERM`); loopback-only reruns used the approved execution environment.
A smoke harness initially mounted v000901 at the wrong prefix; it now matches
`/v000901/kma/addr` and passes. The first town-regression command used an incorrect
filename, then lacked its isolated sprintf dependency and port access; these
failures are retained separately, not reported as passes. Adding a no-op narrative
boundary to that coordinate-focused fixture resolved its explicit dependency-map
failure. No production config, credentials or services were used.

## Scope and limitations

The real persistence/HTTP smoke uses Mongoose **5.13.23** and Mongo **7.0.14**.
Unrelated weather acquisition, geocoding and air collaborators are isolated, while
the actual collector, new schema, shared weather makeResult/sendResult, existing
national/regional/special routes and request transport are exercised. Fake-schema
replays do not establish production Mongoose **5.1.2** casting/persistence for the
new model. Actual Node10/16/22 coverage is established only by current CI results,
not by a locally successful compatibility script on Node24.

Provider prose is a **synthetic excerpt**, with the issue-reported October16 17:00
metadata and precipitation example. It is not the complete captured October16
response. Official guide category 개황 rows2–11 supply the national/regional office
mapping; no live regional provider call or quota/access guarantee is claimed.
Original Korean markup-bearing text stays untrusted plain text; no mobile parsing,
HTML binding, app build or deployed device behavior was verified in this task.
No merge, restart, deployment, new push, production collection or readback occurred.

See the [operating contract](../../../operations/kma-forecast-narrative.md),
[editable API manual](../../../operations/kma-forecast-narrative-manual.html),
[PDF](../../../operations/kma-forecast-narrative-manual.pdf), and
[capture provenance](../../../operations/kma-forecast-narrative-assets/manifest.json).
Current exact-head review/CI and retained machine evidence are recorded in
[PR #2805](https://github.com/WizardFactory/TodayWeather/pull/2805).
