# Plan: Push registrations in SQLite on tw-svc — issue 2626

Revision 1, 2026-09-27. Consumes intent r1, spec r1, design (updated `docs/architecture/diagrams/push-notifications.json`). Owner: main agent. Branch `feat/2626-push-sqlite` from master `1ff466b0`.

## File operations

| File | Change | Req |
| --- | --- | --- |
| `server/lib/sqliteFileStore.js` (new) | sql.js init, async lock with dead-owner takeover, mutate/read, atomic write | R1, R2 |
| `server/lib/pushStore/index.js`, `mongo.js`, `sqlite.js` (new) | store selection; Mongo queries moved from controllers (+ D7); SQLite implementation | R3–R5 |
| `server/controllers/controllerPush.js`, `alert.push.controller.js` | DB calls → store; drop direct model requires | R3, R4 |
| `server/routes/v000705/routePushNotification.js`, `v000902/route.push.update.list.js` | unknown category → 403 | R6 |
| `server/bin/push-worker` (new) | worker entry point | R7 |
| `server/package.json`, `package-lock.json` | `sql.js` 1.8.0 exact | R8 |
| `server/test/offline/push-store.test.js`, `push-store-concurrency.js`, `push-worker-smoke.js` (new), `run.js` | tests | AC1–AC7 |
| `.github/workflows/rss-offline.yml` | run new tests on Node 16/22 and in the Node 10.15.3 job | AC6 |
| `docs/architecture/push-notifications.md`, `diagrams/push-notifications.{json,html}`, `docs/operations/push-sqlite.md` (new), `server/.env.example`, `server/CONFIGURATION.md` | docs and env | AC8 |

## Order

1. Tests first against master: route/semantics tests fail (no store module; D7 defects; 403).
2. `sqliteFileStore` → `pushStore` (sqlite, mongo) → controllers → routes → worker.
3. Green on Node 22; post-refactor on Node 16.20.2 and Node 10.15.3 (Docker).
4. Smokes: concurrency and worker on Node 10.15.3 and 16.20.2.
5. Regression: `test:offline` with CI deps; runtime tests.
6. Docs, Archify validate/deliver/visual check.
7. Commit, push, PR, CI; independent verification; decisions/progress comments on #2626.

## Commands

```sh
NODE_PATH=<deps> node server/test/offline/push-store.test.js
NODE_PATH=<deps> node server/test/offline/push-store-concurrency.js
NODE_PATH=<deps> node server/test/offline/push-worker-smoke.js
docker run --rm -v $PWD:/w -v <deps10>:/deps -w /w -e NODE_PATH=/deps/node_modules node:10.15.3-stretch node server/test/offline/push-store.test.js
```

## Rollback and blast radius

Default unchanged (Mongo). With `PUSH_STORE=sqlite`: push registration writes on tw-svc and delivery. Rollback: unset `PUSH_STORE`, restart workers, stop `push-worker`. Mongo-path changes: D7 fixes and 403 for unknown category.

## Risks

- Lost update through lock recovery: covered by stale-lock tests.
- Controller refactor regressions in Mongo mode: existing runtime tests plus Mongo adapter query-shape tests.
- Riskiest part: token-update collisions on the unique key.
- Rejected: single writer process with IPC; native SQLite.

## Gate

PROCEED within the `pr` endpoint.

## Revision 2 — S3 and burst delivery implementation plan (2026-09-28)

**Supersedes the r1 implementation order for future work. This turn ends with design artifacts; do not execute these implementation steps yet.** Consumes intent/spec r2 and [the proposed architecture](../docs/architecture/push-s3-design.md). Existing SQLite source, PR #2629 and its tests remain historical; their PASS does not verify S3 or warning fan-out.

### Ordered work and file ownership

| Phase | Planned files / change | Proof before advancing |
| --- | --- | --- |
| 0. Runtime and baseline | Read-only target Node/OS/SDK/FCM quota inventory, aggregate device/region counts; synthetic fixtures and sender harness under `server/test/offline/` | Existing payload/tap contract replayed; no raw device data exported; target workload and runtime recorded |
| 1. Performance prototype | New isolated dispatch limiter/queue, memory recipient index and synthetic provider benchmark; do not connect real tokens | 10k warning submissions within 30s at declared peer latency under normal backlog; 100k/1m exploratory memory/capacity; correct retries and fairness |
| 2. S3 + coordinator | `server/lib/pushStore/s3.js` (new), `server/lib/pushCoordinator/` (identity, registration index, IPC, restore), `server/bin/push-coordinator` (new); configure separate S3 prefixes | Red/Green contract tests for partial POST, token rotation/merge interleaved with POST/DELETE, global acceptedSequence ordering, zero IDs, cold restore, corrupt objects and PUT ambiguity |
| 3. API adapter | Existing push routes call coordinator adapter in S3 mode, Mongo path retained for rollback; `pushStore/index.js` selection; remove touched-path raw token/body logs | Real-router loopback smoke to coordinator + local S3 peer; respond only after durable publication; fail store errors, preserve wire shape |
| 4. Normal dispatch | Separate scheduler and weather/template cache from `controllerPush.js` and `alert.push.controller.js`; batched state under `pushCoordinator/` | UTC/day-of-week and conditional 6-hour rules preserved; no per-token weather/S3 calls for shared keys; location changes, reverse-order geocode completions and retries fenced |
| 5. KMA feed + warning dispatch | Small exporter hook in `kmaWarningCollector.js` with `kmaWarningZones.js` reuse, S3 feed module; warning campaign builder and priority lane | Golden #2609 events: bootstrap/release/revision/dedup, overlapping zones, moves in/out, latest accepted location; no broadcast on historic replay |
| 6. Recovery and operations | Campaign checkpoints, readiness, metrics, private IPC/IAM sample, `server/CONFIGURATION.md`, `.env.example`, a new S3 operations runbook | Crash and restart matrix, bounded replay/expiry, restore timing, no second active coordinator, migration/rollback drill with synthetic data |
| 7. Documentation and review | Update implemented `push-notifications.md`/diagram only when behavior exists; CI workflow/dependency lock changes narrowly scoped | Relevant regressions + independent implementation verification; prior cross-provider waiver preserved unless AK changes it |

Exact module boundaries may be refined by the implementer, but single state ownership, sparse S3 mutation and location checks must remain. Do not implement a second competing scheduler beside the old one. One runtime activation flag selects one sender path.

### Provisional acceptance profile selected by AK

On 2026-09-28 AK selected **10,000 warning recipients / 30 seconds from detection to FCM acceptance** as the provisional target, and **existing enabled regional alert registrations** as warning subscribers. Alarm-only registrations are excluded. Use existing alert windows as the initial compatibility rule; do not apply the precipitation/air six-hour cooldown to a distinct severe warning. These are not promises of physical-device receipt within 30 seconds.

Performance test: preload 100k total registrations with 10k unique eligible endpoints in affected regions; establish a 100k scheduled-alarm backlog; inject a warning event while processing continues. Synthetic peer mean latency 200ms, zero throttle/failures for the primary capacity run, declared tail distribution, warm runtime. Required: first warning admission <=1s, all 10k accepted <=30s, exact target set, zero per-recipient S3 calls, no project-rate-cap violation. Repeat with throttling/timeouts to verify recovery and report deadline misses truthfully. Test 100k/1m warnings as exploratory profiles, not release promises. Verify memory and recovery separately at device-object scale.

Proposed commands after their test files are implemented (not executed in this design turn):

```sh
node server/test/offline/push-index.test.js
node server/test/offline/push-s3-contract.test.js
node server/test/offline/push-warning-dispatch.test.js
node server/test/offline/push-coordinator-smoke.js
node server/test/offline/push-burst-benchmark.js --recipients 10000 --normal-backlog 100000 --deadline-ms 30000
```

The eventual harness must pin synthetic latency/error seeds and environment, count every target outcome and emit p50/p95/p99/last acceptance, event-loop lag, heap/RSS, S3 call counts, retry schedule and startup duration. Tests and smokes must run on the verified deployment-compatible runtime. A local stub throughput result is not live FCM evidence. Credential-backed tests are small, authorized test-device sends only.

### Migration and rollback

1. Provision an approved private S3 prefix/IAM policy and runtime separately from this design. Do not reuse public weather assets or notice data prefixes.
2. Start coordinator in no-send shadow mode; validate registration/index counts with synthetic or authorized inputs. First warning feed bootstrap establishes a baseline, not notifications.
3. Choose re-registration-only population rebuild or an explicitly authorized one-shot Mongo/SQLite export. Re-registration-only means inactive users' registrations are absent; do not claim complete carryover. Never automatically copy production tokens into development artifacts.
4. Stop old push senders before enabling the new one. Move API mutations to the coordinator, confirm latest-location publish and S3 durability. Enable warning policy for existing alerts behind a feature flag, then controlled test devices before a broader rollout. Feature flag is a rollout safeguard, not an unresolved subscriber choice.
5. On rollback stop new sends first. Switching API reads/writes back to Mongo does **not** restore updates made only in S3. Export the latest S3 state through a verified converter if carryover is required, or explicitly accept re-registration; no implicit dual-write transaction. Preserve S3 state for recovery under the retention policy.

### Risks, blast radius and rejected alternatives

Affected: push route error behavior, current-location order, token identity, normal scheduling, warning collector export, sender capacity and operational readiness. Notices remain untouched. Riskiest behavior is stale location/zone membership during concurrent dispatch; a separate high risk is falsely treating synthetic throughput as production capacity. Tests must force interleaved updates/releases/retries and crashes, not only count successful writes.

Rejected initial alternatives: global S3 snapshot rewritten per recipient; direct writes by 10 API workers followed by asynchronous S3 event synchronization; region topics as an assumed low-latency solution; multiple independent copies of the old scheduler. Horizontal scaling and snapshot+journal recovery are capacity-triggered extensions with explicit ownership/sharding design, not hidden first-version dependencies.

Design-only gate: implementation is not started. Advance only under a subsequent implementation request, after resolving target runtime/quota, zone precision and the measured recovery budget. User-selected population/latency and subscriber policy are recorded above; no new routine permission is required merely to finish these design documents and issue comments.

### Execution amendment — authorized pre-merge

AK's later request authorizes the implementation phases above. Actual boundary:
`pushCoordinator/ipc.js` selects S3 before legacy route handling; `pushStore/index.js`
remains the Mongo/SQLite adapter. `transport.js` makes direct HTTP v1 attempts using
existing Firebase credentials, preserving raw Retry-After and bounded admission.
Run `push-s3.test.js`, real local protocol/runtime smokes and `push-s3-capacity.js`,
then the existing offline suite/worker smokes. Maintain the independent review report,
resolve Must Fix findings, push the existing branch, update #2629, verify exact-head CI
and create a merge-ready receipt with `merge_authorized: false`. No deployment occurs.
