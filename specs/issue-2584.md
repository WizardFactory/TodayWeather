# Spec — issue-2584

| Field | Recorded value |
| --- | --- |
| Task / stage / owner | issue-2584 / spec / main (Claude Opus 5.5) |
| Date / revision | 2026-09-26 r1 |
| Consumed inputs | intent/issue-2584.md, reports/sdlc/issue-2584/triage.md |
| Acceptance criteria | AC1–AC5 |
| Status / decision | complete / PROCEED |

## Requirements
| ID | AC | Requirement |
|---|---|---|
| R1 | AC1, AC3, AC4 | Attach the AWS managed response headers policy `Managed-SimpleCORS` (`60669652-455b-4ae9-85a4-c4c02393f86c`: `Access-Control-Allow-Origin: *`, no credentials, `OriginOverride=false`) to the `weather/*` and `geocode/*` cache behaviors of distribution `E3QLRH0LJD07QR`. No other distribution field changes. |
| R2 | AC2 | `put-gateway-response` for `DEFAULT_4XX` and `DEFAULT_5XX` on REST API `5hktkqusyb` with `gatewayresponse.header.Access-Control-Allow-Origin` = `'*'`. Status codes and templates stay at their defaults. |
| R3 | AC2 | Create one deployment to stage `production` so the gateway responses take effect. Pre-check: current methods/integrations equal the deployed export. Post-check: the new stage export differs from the old one only by gateway responses. |
| R4 | AC5 | Update `docs/architecture/aws-code-correlation.md` and `mobile-api.md` (error-response headers), and record timestamped evidence in `reports/sdlc/issue-2584/`. |

## Behavior
- CORS requests to `weather/*` / `geocode/*` whose origin response has no CORS header (Lambda 501/404, API Gateway 4XX/5XX) now include `Access-Control-Allow-Origin: *` from CloudFront. Successful Lambda responses already carry `Access-Control-Allow-Origin: *`; with `OriginOverride=false` CloudFront keeps the origin value and adds nothing.
- The CloudFront CORS configuration applies only to requests with an `Origin` header; non-browser clients see no change.
- API Gateway-generated errors carry the header from the gateway itself, including direct `execute-api` requests.
- Lambda proxy error responses (for example 501) are integration responses, not gateway responses; only the CloudFront policy covers them.

## Security
`*` is the value the service already returns on every successful response; no credentials are allowed. No new request surface.

## Alternatives
- Change the Lambda wrapper. Rejected for this task: `nodejs6.10` updates are blocked; migration is irreversible and out of the CORS-only scope. Recommended with the #2585 Lambda rework.
- Custom response header instead of CORS config. Rejected: the managed CORS policy has the same effect with origin precedence and no new resource.

## Verification strategy
Before/after `curl` with and without `Origin` for: overseas 501, uncached 501, API Gateway 403, successful weather and geocode (headers, compression), and direct `execute-api` 403. AWS read-back of the distribution behaviors, gateway responses, stage deployment and export diff.

## Revision 2
R1 and R4 implemented. R2/R3 deferred; AC2 remains open.
