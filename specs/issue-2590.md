# Spec: Paginate KMA grid responses before the completeness check — issue 2590

Revision 1, 2026-09-26. Consumes [intent](../intent/issue-2590.md) r1 and `reports/sdlc/issue-2590/investigation.md`.

## Requirements

| ID | Requirement | AC |
| --- | --- | --- |
| R1 | `getData` validates page 1 exactly as today (transport, HTTP 2xx, XML, `resultCode` 00, positive numeric `totalCount`, non-empty object items). If `items.length === totalCount`, it organizes immediately (one request). | AC2 |
| R2 | If page 1 has fewer items than `totalCount`, pagination continues only when the request URL has `pageNo=1` and `numOfRows=N`, page 1 holds exactly N items and `ceil(totalCount / N)` ≤ 5 (`KMA_MAX_PAGES`). Otherwise it fails with `KMA incomplete or inconsistent response` without another request. | AC2, AC3 |
| R3 | Pages 2..k are requested sequentially with only `pageNo` replaced. Each page passes the R1 envelope checks and additionally: same `totalCount` as page 1; exactly `min(N, totalCount − collected)` items; not identical to an earlier page; echoed body `pageNo`/`numOfRows`, when present, equal the requested values (also checked on page 1 when paginating). Any failure fails the grid. | AC1, AC3 |
| R4 | The merged items replace `response.body[0].items[0].item` of page 1; the existing `totalCount === items.length` check then runs on the merged list before organization. Organizers, events and callback arguments are unchanged. | AC1, AC4 |
| R5 | Failure of any page produces exactly one `fail()` (one `recvFail`, one callback) with a static reason; no URL, key, raw error or body is logged. The requester retry re-runs from page 1. | AC3 |

## Interfaces and data

No change to `getUrl` output, `requestData`/`requestDataByBaseTimeList` signatures, events, organizers, storage or `DB_DATA_VERSION`. The page limit is a module constant.

## Normal and failure behavior

- Short 1,016: 2 requests → complete. Shortest 60, current 8, mid 1: 1 request (unchanged).
- A 999-item page 1 with `totalCount` > 4,995 fails without continuation.
- Page 2 transport/HTTP/XML/`resultCode` failure → the grid fails; Manager recursion retries it as today.

## Security, observability

Diagnostics keep the static `meta` object (`method`, `index`, `dataType`); page URLs are never logged. No new configuration.

## Compatibility

Callers observe only more complete results. Request count rises for multi-page products (short: ×2). Rollback: revert the commit (restores single-page failure).

## Verification strategy

- Unit (`gather-code-drift.test.js`, VM-loaded real module, stub HTTP returning per-`pageNo` XML): AC1 two-page success and exact URLs; AC2 single page and existing mismatch cases (request count 1); AC3 each inconsistency and page-2 error with one callback and no key in logs.
- Functional smoke (`gather-smoke.js`): AC4 two-page XML → `requestData` → `saveShort` → `getShortFromDB`.
- Red on base for AC1/AC4, Green on candidate; `test:offline` on Node 16.20.2 and 22.22.2; CI.

## Alternatives

- `numOfRows=totalCount` second request: rejected; refetches page-1 rows and relies on an unverified maximum.
- Larger fixed `numOfRows` (one request): deferred; unverified KMA limit (AK decision).
- Parallel page requests: rejected; sequential keeps load bounded and matches the ASOS precedent.

## Amendment 1 — 2026-09-26

R3 (revised): instead of a whole-page signature, every row in a paginated product must have a unique identity (all fields except `fcstValue`/`obsrValue`, i.e. category, base/forecast date and time, grid). A repeated or shifted page therefore fails. Single-page responses are not checked (unchanged).
