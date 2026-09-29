# Intent: #2606 design and test scenarios

Source: AK, 2026-09-26. Requested: the design and test scenarios for [#2606](https://github.com/WizardFactory/TodayWeather/issues/2606), iterating reviews "until nothing is missing". Scope is limited by the [traffic-based scope comment](https://github.com/WizardFactory/TodayWeather/issues/2606#issuecomment-5846716189): APIs with 0 calls in 30 days are excluded, and every called API is kept. Triage: `reports/sdlc/issue-2606/triage.md` (design-task evidence, not in the repository).

## Problem

Public `weather/*` and `geocode/*` requests pass through Lambdas that cannot be updated. The design must move these paths to the service EC2 (Express) behind the same CloudFront distribution without any client change.

## Acceptance criteria (for this design deliverable)

- **AC1 — Route contract.** `specs/issue-2606.md` defines every implemented and excluded public route and its exact response contract: status, body fields and headers.
  - Implemented routes must match current Lambda behavior.
  - Every deliberate deviation is listed with the reason it is safe for clients.
- **AC2 — Geocoder and internal callers.** The spec defines:
  - the geocoder module: provider order, output-parity rules, timeouts, key failover, cache model and key provisioning
  - the change for every server-side caller of the gateway paths
- **AC3 — Operations.** The spec defines the deployment prerequisites, the CloudFront change set, verification gates, rollback, monitoring and alarms, capacity limits and security constraints.
- **AC4 — Test scenarios.** `specs/issue-2606-test-scenarios.md` maps every requirement to scenarios. Each scenario has an ID, a layer, prerequisites, actions or a command, the expected result, the failure condition and cleanup. The scenarios cover offline, direct-origin, cutover, post-cutover and operational checks.
- **AC5 — Diagram.** An Archify diagram of the target request flow passes validation, delivery, the browser check and visual review.
- **AC6 — Review loop.** Fresh-context review rounds repeat until one round has no HIGH or MEDIUM finding. No exploitable specifics appear in tracked files.

## Scope

- **In:** design specification, test scenarios, implementation plan, diagram, SDLC evidence.
- **Out:** implementation, deployment, AWS or CloudFront changes, issue edits, commits.

## Scope decisions (AK, 2026-09-26)

- The design keeps only what the goal needs: routing `weather/*` and `geocode/*` from CloudFront to tw-svc with no client change, plus the minimum for a safe cutover (replacement image, one 5xx alarm, deadline and in-flight limit, rollback). Operational hardening added during review rounds 1–8 is listed as follow-ups (spec §9).
- Internal callers use option A: versioned public URLs only, no in-process geocoder.
- Versions return different results, so per-version behavior must be reproduced exactly (spec §3.1).
- AC3 is read in this reduced sense. For AC6, review findings count as HIGH/MEDIUM only when they concern route/version parity, client compatibility, or the cutover and rollback themselves; anything else is a follow-up.
- `Accept-Language` keeps the Lambda's rule (cut at the first `-`) so that successful responses stay identical; the issue's request to use the primary subtag becomes a follow-up (AK, 2026-09-26).
