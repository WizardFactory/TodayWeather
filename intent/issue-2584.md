# Intent — issue-2584: CORS headers on API error responses

| Field | Recorded value |
| --- | --- |
| Task / stage / owner | issue-2584 / intent / main (Claude Opus 5.5) |
| Date / revision | 2026-09-26 r1 |
| Source / authority | Issues #2584 and #2585; AK session 2026-09-26: "fix only the CORS of error responses first; follow the issue SDLC; skip other-provider review; comment on the issue if needed" |
| Consumed inputs | reports/sdlc/issue-2584/triage.md |
| Status / decision | complete / PROCEED |

## Problem
Overseas coordinate weather (#2585) and uncached coordinates return Lambda-wrapped HTTP 501 `text/plain` without `Access-Control-Allow-Origin`. API Gateway-generated errors (for example 403 `MissingAuthenticationTokenException`) also lack it. Browser clients such as the web PWA (`app.tdywx.xyz`) see an opaque network failure and cannot read the status or body.

## Desired outcome and acceptance criteria
- **AC1** A CORS request (`Origin` header) to `https://todayweather.wizardfactory.net/weather/v000903/coord/35.68,139.76` returns its error status with `access-control-allow-origin: *` while #2585 is unfixed.
- **AC2** `aws apigateway get-gateway-responses --rest-api-id 5hktkqusyb` shows `DEFAULT_4XX` and `DEFAULT_5XX` with `gatewayresponse.header.Access-Control-Allow-Origin` = `'*'`, and the production stage serves it.
- **AC3** Successful weather and geocode responses keep their current headers (`cache-control`, `Access-Control-Allow-Origin`, content type) and compression.
- **AC4** Status codes and error bodies are unchanged (the error body format, D50, is deferred).
- **AC5** Architecture documents record the new CORS behavior, the reason the Lambda code was not changed, and rollback.

## Scope
- In: CloudFront distribution `E3QLRH0LJD07QR` cache behaviors `weather/*` and `geocode/*`; API Gateway REST API `5hktkqusyb` gateway responses and a `production` redeployment; documentation and SDLC evidence.
- Out: the #2585 root cause (Dark Sky forecast/reverse-geocoding replacement), Lambda code or runtime changes, error body format, other CloudFront behaviors (EC2 default, push, photos).

## Authority
- AK requested the CORS fix to proceed. The issue's required changes exist only in AWS, so this task includes the production CloudFront/API Gateway configuration changes above, each with a recorded rollback.
- Prohibited: Lambda code/runtime changes, other AWS resources, merge, credential output.
- AK decision (2026-09-26): skip review by another provider model. This does **not** satisfy an independent-review gate; readiness is reported with that gap.

## Risks and questions
- The issue asked for the header in every Lambda error response. All four public Lambda functions run `nodejs6.10`, whose function-update block started 2019-08-12; a code change requires an irreversible runtime migration of a 2019 bundle. The CloudFront policy produces the same viewer-visible header without touching the Lambda. Direct `execute-api` calls that bypass CloudFront still receive Lambda errors without the header; no client is known to use that URL.
- The API Gateway redeployment snapshots current resource configuration. Mitigation: the current configuration was diffed against the only deployment (`jv0pui`, 2019-03-19) before redeploying; rollback re-points the stage to `jv0pui`.

## Revision 2 (2026-09-26)
AK approved the CloudFront change only ("comment on the issue and proceed with the CloudFront fix"). R1 was applied at 2026-09-25 23:22 UTC and verified (AC1, AC3, AC4, AC5). AC2 (API Gateway gateway responses and redeploy) is deferred and stays open in #2584.
