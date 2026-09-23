# API traffic: last 30 days, observed on 2026-09-22

**220,583 product API requests across 19 method/path groups** were observed in CloudFront logs. Of these, 213,683 (96.87%) had Apple/Android-like user agents. HTTP 4xx/5xx responses totalled 34,461 (15.62%). The strongest issue is the September 16–20 5xx cluster, which accounts for 17,811 of 18,123 monthly 5xx responses (98.28%).

Requested 'one month' is interpreted as a rolling **30 days: 2026-08-23T19:53:45+00:00 <= timestamp < 2026-09-22T19:53:45+00:00**. All times and daily boundaries below are UTC. In Europe/Berlin this is August 23, 21:53:45 through September 22, 21:53:45 CEST. This is not the previous calendar month.

This updates the existing report in place. The original 24-hour observation is preserved in the appendix; it is not added to the monthly totals.

## Scope and evidence

- AWS account `141248341265`; CloudFront distribution `E3QLRH0LJD07QR`; standard access logs in `s3://tw-cloudfront/tw-cloudfront/`.
- Read **9,551 gzip objects**, 31,699,102 compressed bytes, across all 31 UTC calendar dates intersecting the window. Every date had objects. Filtered individual records to the exact window; no sample or object-count cap was used.
- Found **264,880 total viewer requests**: 220,583 product API requests and 44,297 other requests. There were zero duplicate request IDs and zero conflicting duplicates.
- Product API scope: `/weather/...`, `/geocode/...`, and `/vNNNNNN/...` with an exact six-digit version. Static assets, health probes, short `/v1`-style prefixes and other non-product paths are excluded. Photos account for 10,053 of the excluded requests. These are URL groups, not unique users or app sessions.
- Fetched through 2026-09-22T19:56:42.596977+00:00. Latest product API record: 2026-09-22T19:53:32Z.
- All operations were read-only AWS reads or CloudWatch Logs Insights queries. No application request, collection endpoint, deployment or configuration change was made.

## API paths and responses

Location segments are replaced with `{location}`. Counts include cache hits, retries, client disconnects and user agents that cannot be identified as the mobile app. The HTTP error percentage uses all logged requests for the row as its denominator; `000` is listed separately from HTTP errors.

| Method | Normalized API path | Requests | HTTP/log status counts | HTTP 4xx/5xx | Last observed (UTC) |
| --- | --- | ---: | --- | ---: | --- |
| GET | `/weather/coord/{location}` | 155,998 | 000: 3,270; 200: 141,992; 500: 1,544; 501: 9,192 | 6.88% | 2026-09-22T19:53:32Z |
| GET | `/weather/v000903/coord/{location}` | 39,254 | 000: 112; 200: 34,114; 501: 5,028 | 12.81% | 2026-09-22T19:50:42Z |
| PUT | `/v000902/push` | 18,872 | 000: 7; 200: 694; 403: 16,337; 502: 1,834 | 96.29% | 2026-09-22T19:51:03Z |
| POST | `/v000902/push-list` | 2,525 | 000: 2; 200: 2,313; 408: 1; 502: 209 | 8.32% | 2026-09-22T18:48:16Z |
| GET | `/v000901/kma/addr/{location}` | 1,853 | 000: 6; 200: 1,461; 304: 214; 502: 172 | 9.28% | 2026-09-22T19:27:13Z |
| GET | `/v000903/kma/addr/{location}` | 1,320 | 200: 1,320 | 0.00% | 2026-09-22T13:54:02Z |
| GET | `/geocode/v000903/coord/{location}` | 209 | 000: 1; 200: 204; 501: 4 | 1.91% | 2026-09-22T18:48:38Z |
| GET | `/v000803/town/{location}` | 205 | 200: 146; 304: 15; 502: 44 | 21.46% | 2026-09-22T13:28:46Z |
| GET | `/v000903/nation/KR` | 139 | 200: 102; 304: 25; 502: 12 | 8.63% | 2026-09-22T13:54:02Z |
| GET | `/weather/v000901/coord/{location}` | 51 | 200: 6; 501: 45 | 88.24% | 2026-09-22T02:26:58Z |
| GET | `/weather/v000902/coord/{location}` | 47 | 200: 41; 501: 6 | 12.77% | 2026-09-21T02:38:11Z |
| GET | `/geocode/v000903/addr/{location}` | 39 | 200: 28; 501: 1; 502: 10 | 28.21% | 2026-09-19T13:38:51Z |
| GET | `/v000903/kma/special` | 36 | 200: 27; 304: 2; 502: 7 | 19.44% | 2026-09-22T12:07:55Z |
| GET | `/v000705/town/{location}` | 12 | 200: 11; 502: 1 | 8.33% | 2026-09-18T10:46:21Z |
| POST | `/v000705/push` | 12 | 500: 12 | 100.00% | 2026-09-16T10:36:25Z |
| OPTIONS | `/v000902/push` | 7 | 204: 6; 502: 1 | 14.29% | 2026-09-20T21:53:17Z |
| DELETE | `/v000902/push` | 2 | 200: 2 | 0.00% | 2026-09-22T18:23:41Z |
| GET | `/geocode/v000901/addr/{location}` | 1 | 200: 1 | 0.00% | 2026-09-18T11:44:22Z |
| GET | `/v000901/nation/KR` | 1 | 502: 1 | 100.00% | 2026-09-18T11:42:02Z |

No `/weather/.../addr/...` request was observed. Address-based geocoding was used: `/geocode/v000903/addr/{location}` 39 times and `/geocode/v000901/addr/{location}` once.

## Main findings

1. **Unversioned weather dominates:** `/weather/coord/{location}` received 155,998 requests (70.72% of product API traffic). The path alone does not establish which backend version ran.
2. **Push PUT mostly failed:** `/v000902/push` received 18,872 PUT requests: 16,337 HTTP 403, 1,834 HTTP 502, 694 HTTP 200 and 7 disconnects. HTTP failure rate was 96.29%. The 403 rejection cause is not established by this investigation.
3. **5xx responses concentrate on September 16–20:** 17,811 responses, 98.28% of all monthly 5xx. September 19 had 6,201 5xx out of 6,459 API requests (96.01%). September 21 and the partial September 22 window each show 10 5xx; this is an observed reduction, not proof of full service recovery.
4. **The latest weather path also had substantial failures:** `/weather/v000903/coord/{location}` returned 5,028 HTTP 501 out of 39,254 requests (12.81%). Its last-24-hour snapshot looked much healthier and did not represent the month.
5. **Old public versions remain active:** v000705, v000803, v000901 and v000902 all appear. In particular, all 12 POST requests to `/v000705/push` returned HTTP 500. The samples for the least-used routes are small.
6. **Identity remains approximate:** 213,683 API requests were Apple/Android-like; 6,899 were other/unknown and one matched a bot/tool signature. The unknown requests comprise 5,579 unversioned weather calls and 1,320 `/v000903/kma/addr/{location}` calls. CFNetwork/Darwin can include Apple desktop clients; Android/OkHttp and other strings are also not authenticated app identity.

These are observations from request logs. This report does not attribute root causes to a provider, Lambda implementation, EC2 process, cache setting or mobile release.

## Response, version and client breakdowns

| HTTP/log status | API requests | Share |
| --- | ---: | ---: |
| 000 | 3,398 | 1.54% |
| 200 | 182,462 | 82.72% |
| 204 | 6 | 0.00% |
| 304 | 256 | 0.12% |
| 403 | 16,337 | 7.41% |
| 408 | 1 | 0.00% |
| 500 | 1,556 | 0.71% |
| 501 | 14,276 | 6.47% |
| 502 | 2,291 | 1.04% |

HTTP 4xx: 16,338 (7.41%); HTTP 5xx: 18,123 (8.22%); status `000`: 3,398 (1.54%). Status `000` means a viewer closed the connection before CloudFront could respond; it is not an HTTP status. HTTP 304 is a cache-validation response, not a 4xx/5xx error.

| Version present in public URL | API requests | Share |
| --- | ---: | ---: |
| unversioned | 155,998 | 70.72% |
| v000903 | 40,997 | 18.59% |
| v000902 | 21,453 | 9.73% |
| v000901 | 1,906 | 0.86% |
| v000803 | 205 | 0.09% |
| v000705 | 24 | 0.01% |

| User-agent classification | API requests | Share |
| --- | ---: | ---: |
| Apple-like | 138,444 | 62.76% |
| Android-like | 75,239 | 34.11% |
| Other/unknown | 6,899 | 3.13% |
| Bot/tool-like | 1 | 0.00% |

| CloudFront result | API requests | Share |
| --- | ---: | ---: |
| Miss | 138,357 | 62.72% |
| Error | 37,861 | 17.16% |
| Hit | 33,244 | 15.07% |
| RefreshHit | 11,121 | 5.04% |

`Hit` denotes a cache response. `RefreshHit` includes origin revalidation and must not be counted as an origin-free response. `Error` is a CloudFront result classification and is not equivalent to an HTTP 4xx/5xx count.

## Daily API traffic

August 23 and September 22 are partial UTC days; the 29 intervening dates are full days. Counts are not normalized to 24 hours. The daily average across the exact 30-day window is 7,352.77 API requests.

| UTC date | Covered hours | API requests | HTTP 4xx | HTTP 5xx | 5xx share | Status 000 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-08-23 | 4.10 | 1,098 | 125 | 0 | 0.00% | 18 |
| 2026-08-24 | 24.00 | 7,370 | 762 | 14 | 0.19% | 80 |
| 2026-08-25 | 24.00 | 7,652 | 712 | 12 | 0.16% | 50 |
| 2026-08-26 | 24.00 | 7,504 | 800 | 19 | 0.25% | 86 |
| 2026-08-27 | 24.00 | 8,064 | 938 | 8 | 0.10% | 60 |
| 2026-08-28 | 24.00 | 8,543 | 1,088 | 13 | 0.15% | 59 |
| 2026-08-29 | 24.00 | 8,124 | 883 | 19 | 0.23% | 71 |
| 2026-08-30 | 24.00 | 9,231 | 1,155 | 5 | 0.05% | 68 |
| 2026-08-31 | 24.00 | 8,590 | 969 | 2 | 0.02% | 66 |
| 2026-09-01 | 24.00 | 8,675 | 918 | 31 | 0.36% | 65 |
| 2026-09-02 | 24.00 | 7,597 | 700 | 28 | 0.37% | 79 |
| 2026-09-03 | 24.00 | 7,639 | 563 | 41 | 0.54% | 115 |
| 2026-09-04 | 24.00 | 7,160 | 519 | 27 | 0.38% | 118 |
| 2026-09-05 | 24.00 | 6,832 | 437 | 0 | 0.00% | 98 |
| 2026-09-06 | 24.00 | 6,508 | 467 | 2 | 0.03% | 88 |
| 2026-09-07 | 24.00 | 6,275 | 411 | 0 | 0.00% | 98 |
| 2026-09-08 | 24.00 | 7,034 | 496 | 6 | 0.09% | 71 |
| 2026-09-09 | 24.00 | 6,729 | 503 | 20 | 0.30% | 86 |
| 2026-09-10 | 24.00 | 6,138 | 516 | 3 | 0.05% | 74 |
| 2026-09-11 | 24.00 | 5,907 | 388 | 7 | 0.12% | 58 |
| 2026-09-12 | 24.00 | 6,071 | 438 | 14 | 0.23% | 54 |
| 2026-09-13 | 24.00 | 6,272 | 530 | 8 | 0.13% | 38 |
| 2026-09-14 | 24.00 | 6,168 | 449 | 4 | 0.06% | 53 |
| 2026-09-15 | 24.00 | 6,163 | 409 | 9 | 0.15% | 63 |
| 2026-09-16 | 24.00 | 12,409 | 311 | 1,918 | 15.46% | 1,428 |
| 2026-09-17 | 24.00 | 7,562 | 0 | 2,409 | 31.86% | 35 |
| 2026-09-18 | 24.00 | 7,286 | 0 | 3,712 | 50.95% | 25 |
| 2026-09-19 | 24.00 | 6,459 | 0 | 6,201 | 96.01% | 18 |
| 2026-09-20 | 24.00 | 7,077 | 228 | 3,571 | 50.46% | 52 |
| 2026-09-21 | 24.00 | 7,216 | 378 | 10 | 0.14% | 67 |
| 2026-09-22 | 19.90 | 5,230 | 245 | 10 | 0.19% | 57 |

## API Gateway cross-check: recent seven days only

Live log retention is **7 days**, so API Gateway is not a 30-day comparison. The queries cover **2026-09-15T19:53:45+00:00 through 2026-09-22T19:53:45+00:00** in `ap-northeast-2`, log group `API-Gateway-Execution-Logs_5hktkqusyb/production`.

The route query completed and matched **39,932 HTTP Method request records**, scanning 359,886 records / 50,793,271 bytes. The completion-status query matched **39,914 Method completed records**, scanning 359,850 records / 50,788,185 bytes.

| Method | API Gateway route group | Request records |
| --- | --- | ---: |
| GET | `/weather/coord/{location}` | 33,769 |
| GET | `/weather/v000903/coord/{location}` | 6,074 |
| GET | `/geocode/v000903/coord/{location}` | 51 |
| GET | `/weather/v000901/coord/{location}` | 28 |
| GET | `/weather/v000902/coord/{location}` | 7 |
| GET | `/geocode/v000903/addr/{location}` | 2 |
| GET | `/geocode/v000901/addr/{location}` | 1 |

| UTC date | Request-start records | Completion records | HTTP 200 | HTTP 500 | HTTP 501 | HTTP 502 | 5xx share of completions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-09-15 | 799 | 794 | 788 | 0 | 6 | 0 | 0.76% |
| 2026-09-16 | 8,857 | 8,852 | 5,475 | 413 | 2,960 | 4 | 38.15% |
| 2026-09-17 | 5,658 | 5,658 | 9 | 0 | 5,649 | 0 | 99.84% |
| 2026-09-18 | 5,496 | 5,496 | 13 | 0 | 5,483 | 0 | 99.76% |
| 2026-09-19 | 4,941 | 4,939 | 4 | 0 | 4,934 | 1 | 99.92% |
| 2026-09-20 | 5,403 | 5,400 | 2,640 | 0 | 2,760 | 0 | 51.11% |
| 2026-09-21 | 5,118 | 5,116 | 5,109 | 0 | 7 | 0 | 0.14% |
| 2026-09-22 | 3,660 | 3,659 | 3,655 | 0 | 4 | 0 | 0.11% |

The Gateway logs independently show severe 5xx rates on September 17–19 (over 99% of logged completions each day). These origin-layer results must not replace the CloudFront viewer results: successful cache responses, direct-EC2 paths, disconnects, different event timestamps and log delivery can produce different totals and rates. Request-start and completion records are different events; the counts do not establish a one-to-one match. No per-request correlation was performed. Gateway counts are not added to monthly viewer totals.

## Coverage, limitations and verification

- CloudFront standard log delivery can be delayed by up to 24 hours, and delivery is best-effort. The current-window counts are observations from available files, not a finalized exhaustive billing or unique-user total. A date with objects does not prove every request for that date was logged.
- CloudFront date/time records response completion; daily boundaries use that timestamp. Queries use start-inclusive/end-exclusive filtering locally. CloudWatch queries operate at the requested second resolution.
- No raw location, address, query string, cookie, client IP, request ID or credential is included in the report or exported evidence. Public route structure, aggregate counts and timestamps are retained.
- Validation passed: all 9,551 listed objects read; record field counts checked; zero duplicate/conflicting IDs; group/status/cache/user-agent/day totals reconcile; all daily route sums reconcile; CSV totals and exported JSON agree with this report. Both Gateway queries completed and parsed all matched request/completion records.
- Error investigation is bounded to observed paths/statuses and daily concentration; no root-cause or mobile-release attribution is claimed.

Definitions and delivery behavior: [AWS CloudFront standard logging reference](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logs-reference.html) and [AWS access log delivery](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html).

## Downloadable aggregates

- [Route counts, status, device and cache breakdown (CSV)](api-traffic-2026-09-22-routes.csv)
- [Daily traffic and errors (CSV)](api-traffic-2026-09-22-daily.csv)
- [Sanitized evidence, exact windows and completed Gateway queries (JSON)](api-traffic-2026-09-22-evidence.json)

## Appendix: original 24-hour snapshot

Original window: **2026-09-21T19:44:24Z through 2026-09-22T19:44:24Z**, fetched at 2026-09-22T19:46:48.097588Z. This snapshot remains unchanged and was not added to monthly totals. It observed 6,878 viewer requests, 6,461 product API requests, and 6,431 Apple/Android-like API requests. The 24-hour Gateway route query matched 4,551 request records.

| Method | Normalized API path | Requests | HTTP/log status counts |
| --- | --- | ---: | --- |
| GET | `/weather/coord/{location}` | 5,181 | 000: 60; 200: 5,121 |
| GET | `/weather/v000903/coord/{location}` | 694 | 000: 1; 200: 679; 501: 14 |
| PUT | `/v000902/push` | 378 | 200: 23; 403: 355 |
| GET | `/v000901/kma/addr/{location}` | 92 | 000: 1; 200: 58; 304: 33 |
| POST | `/v000902/push-list` | 61 | 200: 61 |
| GET | `/v000903/kma/addr/{location}` | 30 | 200: 30 |
| GET | `/geocode/v000903/coord/{location}` | 11 | 200: 11 |
| GET | `/v000803/town/{location}` | 7 | 200: 6; 304: 1 |
| GET | `/v000903/nation/KR` | 3 | 200: 3 |
| GET | `/weather/v000901/coord/{location}` | 2 | 200: 2 |
| GET | `/v000903/kma/special` | 1 | 200: 1 |
| DELETE | `/v000902/push` | 1 | 200: 1 |

The earlier statements that no address-based geocoding was observed and that only 14 HTTP 501 responses occurred on v000903 weather apply to this 24-hour window only. They do not describe the full 30-day window.
