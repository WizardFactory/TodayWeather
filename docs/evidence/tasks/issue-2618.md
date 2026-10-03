# Issue 2618 verification — 2026-10-03

Base: `1bc5669c2dbf50b1ccc9ece8734d85fcebf31d06`. Candidate changes are
identified by the PR commit containing this record; review/CI receipts belong
to the PR and are bound to its head. This record reports builder execution only.

- Initial config regression failed because retired config slots still existed.
  The added parser/requester matrix initially had no implementation. No provider
  or DB was accessed during Red. Environment/harness failures were corrected
  separately and are not counted as intended Red.
- `NODE_PATH=<isolated>/node_modules node server/test/offline/data-go-kr-keys.test.js`:
  32 passing checks for parsing, list-only source, warning sanitation and each
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
