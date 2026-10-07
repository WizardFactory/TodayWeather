# S08 provider reservations and funded acquisition

Issue: [#2693](https://github.com/WizardFactory/TodayWeather/issues/2693), parent #2614.
Base: `94019cf5460a898bdb315ca7a443e879770e79ce` (S06 integrated).
Owner: S08 builder. Endpoint: reviewed **unmerged pre-merge PR**.

## Problem and outcome
Concurrent misses, retries and Spot replacement must not overspend a provider quota
or send a provider HTTP request before durable reservation. Count data.go.kr calls
and Visual Crossing records (49/25/1), with the existing rejection/rotation rules.

## Acceptance
- **AC1:** global provider/key/window ceiling holds across concurrent callers and replacements.
  Exhaustion, reservation outage or unverified admission sends no provider HTTP.
- **AC2:** reserve each operation's maximum eligible cost before its first HTTP attempt;
  quota/auth rotation and at most one funded subsequent attempt obey classification and deadline.
- **AC3:** raw-only weather constraints and declared server2 placement hold; no runtime legacy
  dependency, SQLite, shared cache, route port or normalized weather persistence is introduced.
- **AC4:** real isolated HTTP concurrency/crash/deadline smoke, current Rust/placement/artifact/CI
  checks, screenshot/PDF operator manual and eligible actual review demonstrate unmerged readiness.

## Scope and authority
AK authorized the next implementation and parallel execution after S06 merge.
This task may implement/test/smoke/commit/push/create-update PR and material task comments,
read CI, transfer scoped evidence and correct review findings using existing configured accounts.
Root dispatches independent review (medium effort unless AK changes it).
No merge/auto-merge/queue, deployment/resources/route switch, liveAWS/provider/Mongo/push,
new accounts, secrets or permission/settings changes. Actual key provisioning remains external.
O-5 retention/no deletion, O-9 fail-closed durability and O-10 separate server2 keys apply.

All runtime/assets stay in `server2/`. The exact declaration is
[6046166349](https://github.com/WizardFactory/TodayWeather/issues/2693#issuecomment-6046166349)
and `server2/config/tasks/S08.json`. Root owns shared architecture/diagram/parent-plan.
S07 independently owns resolver/cache; adapters integrate after both modules exist.

## Durability boundary and limits
Use a CAS high-water authority under `budgets/v2/`, then a write-once range witness,
then a private in-memory request permit. A new host never reclaims old block leftovers.
A committed grant remains spent even if later publication/HTTP/caller completion is abandoned.
An unknown CAS result cannot authorize HTTP. A request never recorded remotely cannot be
identified after replacement; no implementation claims to permanently charge that unknowable
attempt. Persisted unknown-commit ranges are retained and cannot be reused.

## Risk and exclusions
Ambiguous/cancelled writes and policy/window drift are the critical risks. Quota state is
separate from weather catalogs. No acceptance of production parity, mobile build, liveAWS
signatures/IAM, deployed quotas or route cutover is implied by local peers.
