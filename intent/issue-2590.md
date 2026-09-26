# Intent: Paginate KMA grid responses before the completeness check — issue 2590

Revision 1, 2026-09-26. Owner: main agent for AK. Source: AK session request and issue [#2590](https://github.com/WizardFactory/TodayWeather/issues/2590).

## Problem

`CollectData.getData` in `server/lib/collectTownForecast.js` requests one page (`pageNo=1&numOfRows=999`) and rejects the response when `totalCount !== items.length`. The issue reports a live `getVilageFcst` `totalCount` of 1,016, so master fails every such `TOWN_SHORT` grid and cannot replace the 2021 overlay still running on the gather host (issue-supplied observation; the referenced operations documents are not in this checkout).

## Desired outcome and acceptance criteria

- AC1: A `TOWN_SHORT` response with `totalCount` 1,016, served as page 1 (999 items) and page 2 (17 items), is requested as exactly `pageNo=1` then `pageNo=2` with otherwise identical query, merged, passes the unchanged `totalCount === items.length` check, and completes with records from both pages (the last forecast hour is present).
- AC2: Single-page behavior is unchanged: `totalCount === items.length` needs one request and yields the same organized data; a first page shorter than `numOfRows` whose `totalCount` differs (existing counts 1/10/12/999/1000) still fails after one request.
- AC3: An inconsistent continuation fails the whole grid with exactly one failure callback/`recvFail`, no completed result and no key-bearing log: a changed `totalCount`, a wrong item count on any page, a repeated page, a mismatching echoed `pageNo`/`numOfRows`, an HTTP/transport/XML/provider error on page 2, and a product needing more than the page limit.
- AC4: Functional smoke: a 1,016-item two-page XML flows through `requestData` → events → the real `saveShort` → `getShortFromDB` with in-memory HTTP/Mongo boundaries and stores every forecast hour.
- AC5: `npm --prefix server run test:offline` passes on Node 16.20.2 and 22.22.2 locally, and the PR's Gather/RSS offline CI passes.
- AC6: Architecture/rewrite documents describe bounded pagination instead of the single-page limit. Human-owned after deployment: the gather host replaces its `collectTownForecast.js` overlay with master and confirms `TOWN_SHORT` grids complete (handoff only; this workflow does not deploy).

## Scope

In scope: pagination and continuation validation inside `getData`; offline unit tests and smoke; documentation.

Out of scope: page size change (stays 999), requester/Manager retry policy, schedules, key rotation, organizers and period semantics (hourly short activation hold stays), gather-host deployment, and the issue's other overlay differences (key encoding guard and `rn1` zero handling are already on master).

## Constraints

Node 16.20.2 gather runtime; no timers in the requester path (offline harness forbids them); no provider or DB access in tests; no key or URL in diagnostics; `DB_DATA_VERSION` unaffected.

## Authority and endpoint

Endpoint pre-merge (AK, 2026-09-26, same contract as issue-2578). Covered: implementation, tests, smoke, commits, push to `ak-ongyeol/TodayWeather` (remote `ak-fork`), PR creation/updates against `WizardFactory/TodayWeather` `master`, CI reading, corrections, independent verification in a fresh subagent context, an issue comment if needed. Excluded: merge, auto-merge, merge queue, deployment, permission changes, secrets. AK decision: skip the other-provider PR reviewer; the review gate stays incomplete and is reported, not claimed.

## Risks and open questions

- Request volume: `TOWN_SHORT` makes two sequential requests per grid while `totalCount` is 1,000–1,998 (quota cost). Raising `numOfRows` could keep one request but is unverified against KMA limits (open, AK decision).
- Echoed `pageNo`/`numOfRows` are checked only when present; live shape is unverified here.

## Consumers

Spec, plan, builder, independent verifier, PR description, completion.

## Amendment 1 — 2026-09-26

Source: independent verification round 1 (F1, F2). AC3 (revised): "a repeated page" also covers any continuation row whose identity (all fields except `fcstValue`/`obsrValue`) already appeared on an earlier page, e.g. page 2 repeating the tail of page 1. Each AC3 failure asserts its static reason. Downstream impact: spec R3, tests, docs; earlier build/verification receipts are stale.
