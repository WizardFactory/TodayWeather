# Implementation and verification plan — #2600

Owner: OpenAI builder /root. Endpoint: pre-merge. Intent and spec: [intent](../intent/issue-2600.md), [spec](../specs/issue-2600.md). Execution notebook: selected issue-2600 plan in ignored .planning; stage index under ignored reports/sdlc/issue-2600.

1. Introduce offline tests and recorded MFDS fixture, confirm intended missing-module failure.
2. Add lib/foodPoisoning.js and models/modelFoodPoisoning.js. Validate full response before conditional dated upserts; total network deadline and size cap; per-process schedule guard.
3. Connect Manager's gather-only queued work and ControllerTown's independent optional daily/current/label enrichment. Preserve legacy fsn exclusion and UV/pollen.
4. Extend existing Express offline harness only at model and HTTP boundaries. Exercise success, missing, failed and late stores for both DB versions, unit regressions under UTC and Asia/Seoul.
5. Run a distinct loopback HTTP and real isolated Mongo smoke, inspect actual readback and HTTP response. Update architecture/API/operations docs and diagram; inspect affected documentation. Existing contract restoration has no new user workflow or UI, so no new feature manual is applicable.
6. Stage scoped files, verify artifact policy, commit and check outgoing range; create PR, observe CI, independently review/correct until PASS. Final head/base and protections must be observed; stop without merge/deployment.

## User scenarios and acceptance

| ID | User / goal | Prerequisites and ordered actions | Expected / failure | Coverage |
| --- | --- | --- | --- | --- |
| S1 | Seoul user / three daily risk levels | Valid recorded publication; collect; request Jongno coordinate; inspect matching dates/current/labels | Provider percent and page grade; missing dates omitted | AC1, AC3, unit + Express + Mongo smoke |
| S2 | Gwangju or Jeonnam user / correct regional level | Renamed province; collect; request district; repeat absent district and named county | Gwangju match, correct province fallback; ambiguous district omitted | AC2, unit + Express |
| S3 | Domestic user / weather survives optional outage | Missing/failed provider/store; request same coordinate; compare other fields | HTTP 200 and unchanged weather; no expired or late-added fsn | AC4, unit + Express + Mongo smoke |
| S4 | Operator / bounded scheduled collection | Gather/local Manager; run scheduled/startup slot; repeat while running/failed | One request per process/slot; no legacy fsn, UV/pollen intact | AC5, unit + manager wiring |

The riskiest part is treating a regional or dated forecast as another area's current value. Reject ambiguous merged-province requests, match by exact date, enforce the source interval and current date window, and test zero/malformed/future/expired values. A shared lifeIndexKma2 store was rejected because KMA areaNo and host-local dates have different semantics. Distributed scheduling and production activation are outside this change. Rollback reverts the feature; the additive store can remain and expire naturally. Other weather fields are compared against the failure baseline. Live provider acceptance remains limited by the observed stale publication, and must be checked after deployment by an authorized operator.

External review correction: test a withheld write callback and late completion, reception-clock publication rollover, reverse-order same-scope rows and Incheon province fallback. Bound batch completion to 30 seconds without claiming Mongo cancellation. Run full offline/KST regressions and actual HTTP/Mongo smoke, then re-review and push.
