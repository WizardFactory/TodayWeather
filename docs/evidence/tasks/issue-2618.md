# Issue 2618 verification — 2026-10-03

Base: `1bc5669c2dbf50b1ccc9ece8734d85fcebf31d06`. Candidate changes are
identified by the PR commit containing this record; review/CI receipts belong
to the PR and are bound to its head. This record reports builder execution only.

- Initial config regression failed because retired config slots still existed.
  The added parser/requester matrix initially had no implementation. No provider
  or DB was accessed during Red. Environment/harness failures were corrected
  separately and are not counted as intended Red.
- `NODE_PATH=<isolated>/node_modules node server/test/offline/data-go-kr-keys.test.js`:
  33 passing checks for parsing, list-only source, warning sanitation and each
  UV/pollen/KASI/warning/zone auth/quota rotation, exhaustion/empty list/non-key
  failure. HTTP auth overrides provider no-data responses. Separate Green and
  post-refactor executions passed.
- `NODE_PATH=<isolated>/node_modules npm --prefix server run test:offline`:
  passed the complete selected offline suite (including the 136-test legacy
  gather subset and existing forecast, UV/pollen, warning and response coverage).
- `data-go-kr-keys-smoke.js`: 20 real loopback HTTP requests through `request`,
  production URL builders and response/error handlers. Five clients each succeed
  after XML quota rejection, then terminate when both keys reject. Exact URI
  key encoding and sanitized logs asserted. Models are inert/in-memory.
- `gather-quota-smoke.js`: real Manager/collector/HTTP cycle saved all 2,032
  synthetic grids after rotating, with max 101 requests in flight. A second
  cycle exhausted both keys and stopped. No production DB/provider calls.
- Non-test JavaScript scan found no retired slot references. Diff whitespace
  check passed. Staged/outgoing artifact checks are required before publication.
- Archify collection source/HTML: artifact validation, delivery, provenance and
  actual Chrome browser checks passed. Visual capture passed; the builder
  inspected the 2048px light capture for readable layout. Generated receipts and
  captures remain local; maintained JSON/HTML are in the PR.

Local runtime: Node 24.19.0, isolated dependencies; production Node 16.20.2 and
CI Node 22 compatibility require CI results, not this local result. The first
sandboxed loopback and Chrome attempts were denied by the environment; authorized
sandbox escalation enabled local-only checks. No application startup occurred.
Artifact hooks were available but not installed at intake; no hooks/configuration
were changed. The repository workflow supplies the artifact CI check.

Operations acceptance remains **not run**: candidate gather-host UV, KASI,
warning and shortest runs require AK's explicit production authorization and
approved subscriptions. The historical 2026-09-27 comment does not satisfy that
acceptance. Forecast-zone endpoint availability is also unverified. AirKorea
and opt-in ASOS keys are outside this issue's enumerated migration scope.
See [operator runbook](../../operations/data-go-kr-keys.md).

Independent review found and reproduced two missing entrypoint cases. R2618-1
(empty-list life-index callback hang) and R2618-2 (coordinate/past forecast paths
bypassing rotation) were corrected with failing regression tests before the fix.
The 33-test key matrix and 30-test forecast quota suite passed after corrections.
The renewed forecast HTTP smoke also checked current/shortest/short/past success
and all-key exhaustion (16 additional real HTTP requests), exact storage counts,
non-key retry preservation and no key-bearing logs. Review disposition and final
candidate CI remain recorded on the PR rather than claimed by this builder note.

## Review 5399434418 corrections

Required R2618-3 (storage failure concurrent with quota rejection) now returns
the storage error before rotating, completes once for resultless collector errors,
and treats an empty past work list as complete without HTTP. Required R2618-4
reuses the bounded collector pump for past base times: no new requests after
auth/quota rejection, in-flight requests settle, and only unfinished times rotate.
Recommended R2618-5 retains the successful service key for subsequent coordinates.

Six new regressions failed before these corrections; the quota suite then passed
36/36 in separate Green and post-refactor runs. The complete selected offline
suite passed. Its historical drift assertion was updated from the old immediate
200-request cutoff to bounded 101 admission with all 202 times eventually processed.
The renewed real HTTP smoke saved seven base times, retried only the six unfinished
times on the next key, used that successful key alone for the next coordinate,
and returned the original injected storage error exactly once without rotation.
Two configured in-flight slots limited the rejecting key to three requests.
Models/storage errors and provider responses were synthetic; no production host
or live provider was used. Current review/CI disposition remains on the PR.
