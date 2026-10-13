Task: issue-2698-s13; owner: Claude builder (S13 worktree); revision/base: ca8735cf937a634e7af57396d605e26db8bfc4ff; date: 2026-10-13.
Authority: AK authorized S13 on 2026-10-13 as part of the server2 sequence after S10 (relayed by the root coordinator); endpoint pre-merge.
Criteria: AC1 (raw formats and pages), AC2 (request, publication, rejection, retry and metrics parity), AC3 (placement).
Issue update assessment: post the path declaration before dependent edits and one concise status at readiness; no duplicate intake comments.

# Intent

server2 must acquire the domestic provider inputs that the later S14 history and S15
v000903 assembly tasks consume, using the S08 funded executor and the S05/S06 raw
record and fetch-group contracts. Legacy collectors request data.go.kr XML and store
normalized rows; server2 requests `dataType=JSON` and stores exact provider bytes.

- AC1: recorded data.go.kr JSON, KMA RSS XML, KMA HTML (EUC-KR and declared UTF-8)
  and multi-page fixtures produce exact raw objects with the provider bytes unchanged.
  Pages are stored in order and labelled complete only when the provider page counts
  prove completeness. No gateway `OpenAPI_ServiceResponse`, quota/auth/error body,
  stale publication or truncated/invalid body is returned as weather data.
- AC2: per-family request arguments (operation path, base date/time, grid, region,
  station, `numOfRows`/`pageNo`), publication-time boundaries, key normalization and
  order, #2604 rejection classification, the S08 two-attempt/rotation rule, the
  caller deadline and budget prefunding match the current legacy contracts or a
  recorded, reasoned difference. Metrics count every funded provider attempt,
  reservation and outcome, including failures.
- AC3: all added/modified paths match `server2/config/tasks/S13.json`; outside changes
  are limited to declared documentation; no runtime dependency reaches legacy files.

In scope: acquisition library code, recorded fixtures, loopback provider and S3 stubs,
tests and a release-mode functional smoke, the server2 design text for the domestic
acquisition contract, commit/push, PR, CI and independent review/correction.
Code, tests and SDLC evidence may pass to the configured Codex reviewer.

Out of scope: route wiring and response assembly (S15), demand/history capture and
legacy export (S14), warnings (S12), world providers (S11), live provider calls,
AWS resources, deployment, cutover, merge, auto-merge or merge queue, reading or
copying `.env` secrets, and edits to `plans/issue-2614.md`.

Decisions consumed: O-9 (raw PUT plus complete fetch-group publication before a new
success; no undurable success) and O-10 (data.go.kr uses a separate server2 key
set; credential-to-quota-owner mapping is operator configuration).

Risks and open questions: live data.go.kr JSON field shapes are taken from recorded
or documented fixtures, not live calls; HTTPS reachability of the KMA web hosts
that legacy calls over HTTP is unverified; real quotas remain unmeasured.
