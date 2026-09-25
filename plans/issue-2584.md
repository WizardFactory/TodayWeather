# Plan — issue-2584

| Field | Recorded value |
| --- | --- |
| Task / stage / owner | issue-2584 / plan / main (Claude Opus 5.5) |
| Date / revision | 2026-09-26 r1 |
| Consumed inputs | intent/issue-2584.md, specs/issue-2584.md, reports/sdlc/issue-2584/triage.md |
| Status / decision | complete / PROCEED |

## Operations
| Target | Change | Req |
|---|---|---|
| CloudFront `E3QLRH0LJD07QR` | `ResponseHeadersPolicyId` on `weather/*` and `geocode/*` → Managed-SimpleCORS | R1 |
| API Gateway `5hktkqusyb` | `DEFAULT_4XX`, `DEFAULT_5XX` response parameter `Access-Control-Allow-Origin: '*'` | R2 |
| API Gateway stage `production` | New deployment | R3 |
| docs/architecture/aws-code-correlation.md, mobile-api.md | CORS behavior, Lambda runtime constraint, rollback | R4 |
| reports/sdlc/issue-2584/ | Triage, before/after evidence, verification | R4 |

## Order
1. Capture baseline headers and AWS configuration (saved outside the repository; sanitized summary in the report).
2. CloudFront update with the saved ETag; wait for `Deployed`; verify.
3. Gateway responses; deployment; export diff; verify.
4. Documentation, commit, push, PR, issue comments.

## Rollback
- CloudFront: `update-distribution` removing `ResponseHeadersPolicyId` from both behaviors (the pre-change config is saved).
- API Gateway: `update-stage --patch-operations op=replace,path=/deploymentId,value=jv0pui`, then `delete-gateway-response` for `DEFAULT_4XX` and `DEFAULT_5XX`.

## Risk analysis
- Could break: a changed success-response header set. Mitigation: `OriginOverride=false`; verified after the change.
- Riskiest part: the API Gateway redeployment. Mitigation: pre-diff and post-diff of the export; rollback to `jv0pui`.
- Proof: before/after `curl` evidence and AWS read-back.

## Execution record (r2)
- CloudFront applied 2026-09-25 23:22:16 UTC (ETag `E1M3F8JUH3OYXF` → `EJZXMZM9QGKUQ`); config diff before/after shows only the two `ResponseHeadersPolicyId` fields; status `Deployed` after about 60 s.
- The first probe right after `Deployed` (23:23:33 UTC) still lacked the header on errors; probes from 23:24 UTC on show it. Edge propagation lag, not a policy limitation.
- API Gateway steps not executed (deferred by AK).
