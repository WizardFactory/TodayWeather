# Backend release automation decision (#2653)

Decision, 2026-09-30: **retain Hermes-assisted, explicit operator-approved execution for `tw-svc` and `tw-gather`**. Use deterministic scripts for preparation/verification as they become independently verified, but do not introduce backend production Actions in this issue. Hermes remains the reviewer and exception handler until equivalent checks **and rollback** are executable and verified. A bot/model's recommendation is not operator approval.

Source: [#2653](https://github.com/WizardFactory/TodayWeather/issues/2653); [release convention](github-releases.md). Repository observations are revision-bound; production inventories must be rechecked at execution. This decision neither deploys a host nor authorizes AMI/Spot/EIP mutations.

## Options and tradeoff

| Concern | Hermes-assisted approved rollout (retain now) | Deterministic scripts driven by Actions (future) |
| --- | --- | --- |
| Host drift | Can inspect/interpret unexpected files, resolved paths and host-only edits with operator review; decisions/evidence must be recorded | Must compare approved inventory/config digests and fail closed on drift; no automatic stash/reset/discard |
| PM2/env | Inspect actual process mode, instances, cwd, interpreter, saved process list, environment and provider/runtime flags before restart | Executable idempotent process/config assertions and secret-safe backup/restore, pinned runtime/dependencies and bounded restart scope |
| Service health | Review live freshness, publication times, provider availability, middleware/units and current deployed identity | Machine assertions for the same data and availability thresholds, including missing fields, stale data, errors and safe failure behavior |
| Gather health | Interpret schedule/task failures, grid coverage and database publication lag | Runtime task/env assertions and coverage/freshness over the approved grid set; a single Seoul response or process start is insufficient |
| Recovery | Explicit operator rollback of code/config/PM2 and infrastructure references, with post-rollback checks | Executable restore of exact prior identity/config/process state plus tested AMI/template/fleet/EIP recovery; timeout/cancellation/retry and partial failures covered |
| Exceptional state | Hermes advises; operator owns consequential deviations | Scripts halt; Hermes/operator reviews exception. Never bypass a guard to make CI green |

Automation improves reproducibility, credentials scope and auditability once the real invariants are captured. Today the risk is encoding an incomplete model of the hosts and declaring rollout success from PM2/HTTP 200. Hybrid preparation and verification is useful now; unverified scripts must not replace the human gate.

## Gates common to both execution models

For **each host separately**, pin full source SHA and its host-specific Release; verify AWS account, instance identity, expected role and active deployment path. Record approved window/owner and competing-writer exclusion. Inventory actual checkout/diff, runtime/dependencies, nginx/PM2 topology and process mode, resolved env (redacted), secret references, filesystem mounts, DB reachability/version, provider flags and rollback space. Preserve host-only changes and abort on unexplained drift. `SERVER_MODE` does not control route visibility; do not start gather accidentally during a service check.

Before mutation, back up previous source/package identity, PM2/env/config and startup persistence; prove restore inputs exist. Never log secret values or upload private host configuration to public Actions artifacts. Approve the host rollout explicitly; future Actions need separate `backend-tw-svc-production` and `backend-tw-gather-production` environments/roles. Serialize operations per host, preserve in-progress work on cancellation, and stop later infrastructure steps when code health is unresolved.

- **tw-svc:** assert expected service mode/cwd/interpreter/workers and nginx routing, exact deployed SHA, basic `/health`, relevant current weather/air/provider paths and contract. Verify current-observation and forecast-publication freshness against approved thresholds and compare pre/post samples; HTTP 200 with stale data is a failure. Verify provider fallback/error behavior and monitor error/restart rates in a bounded observation window. Never call `/gather/*` as a health probe.
- **tw-gather:** assert expected gather mode, enabled tasks and retry env, PM2/startup persistence, database write compatibility (`DB_DATA_VERSION`) and connectivity, provider/collector failures and publication progress. Compare planned active grids with successfully collected fresh grids across required products and cycles, including missing/duplicate/stale coverage and expected publication latency. A timer log, one town or alive PM2 process is insufficient. Record count/ratio, missing grid IDs, publication timestamp/age and accepted exceptions; thresholds/required cycles must be specified and approved before automation.
- **Both:** rollback restores the full previous source/config/env/process state without losing user/host changes or corrupting DB compatibility; then repeats the relevant health/freshness/coverage checks. Stop rather than automatically revert database state or secrets. Escalate provider-wide incidents separately; preserve evidence even when rollback does not repair upstream availability.

Relevant maintained references: [service internals](../architecture/ec2-internals.md), [collection](../architecture/weather-collection.md), [gather runtime](gather-runtime-policy.md), [provider deployment checks](visual-crossing-deploy.md), [AWS/SSH access](../architecture/ec2-access.md).

## Post-deploy AMI → isolated boot → launch template → Spot Fleet → EIP

Code rollout passing does not prove replacement capacity can boot. Keep the old serving instance, known-good AMI/template version/fleet configuration and EIP association until replacement is verified. The following is a **required guard chain**, not a claim that this checkout implements it:

1. **Post-deploy AMI:** only after host-specific health/freshness/coverage pass and operator approval, capture the exact validated host and code/config identity. Record image ID, readiness and recovery reference. Account for snapshot consistency, reboot/no-reboot semantics, data mounts, embedded credentials and provider state; capture must not silently interrupt gather or service.
2. **Isolated boot validation:** launch from that AMI with safe isolated network/permissions. Verify boot, mounts/runtime, PM2 restore/env and source identity. Gather validation must suppress production writes/duplicate schedules and service validation must not receive production traffic. Test with isolated dependencies; never assume isolation solely because the instance has a different name. Failed validation prevents template/fleet promotion.
3. **Launch template:** create/review a new version pinned to the validated AMI and approved instance/network/IAM/user-data/storage settings. Preserve the previous version; do not change default/latest implicitly. Separate approval and bounded resources are required.
4. **Spot Fleet:** request/update only the approved fleet with explicit template version/capacity constraints. Verify replacement boot, role identity, actual source/env, service freshness or gather coverage and absence of duplicate production collectors. Handle partial capacity, interruption/timeout and cancellation; keep old capacity until passing and approved cutover.
5. **EIP guard:** re-read the current EIP allocation/association and intended instance/ENI/account/region immediately before reassociation. Confirm old mapping and rollback command, target health/role and no concurrent change. Stop on unexpected association. Move only the intended EIP with explicit cutover approval; verify public routing and data health afterwards. Never detach or terminate the old target before a proven rollback path.
6. **Replacement rollback:** restore previous EIP association/template/fleet settings and known-good capacity, repeat routing/freshness/coverage verification, and record failure. AMI creation alone, template version existence or fleet `active` is not success. Do not retire old resources until the approved observation window and restore evidence pass.

The issue references `docs/operations/post-deploy-ami-spot-rollout-guide.md`. It is **absent from current master at 6ec6c68c**, verified read-only on 2026-09-30. Recover the canonical operator guide/revision and reconcile its actual commands, thresholds and resource guard rules before a later backend automation issue is implementation-ready. Do not substitute the summary above for that missing executable/operator contract or invent production topology.

## Specific prerequisites for a later Actions issue

- Recover/link the canonical AMI/Spot guide; approve current per-host and infrastructure inventories, host drift exceptions and deployment/rollback ownership.
- Version idempotent preparation, rollout, PM2/env restore and health scripts; specify exact thresholds, samples, cycles and observation windows for service freshness and gather grid coverage. Prove both normal and stale/missing/error cases independently.
- Exercise code/config rollback for **both hosts** on isolated representative environments; include DB version compatibility, partial restart, secret-safe evidence and interrupted execution. Record exact tested script/source identities.
- Exercise AMI capture, isolated boot with suppressed gather writes, pinned launch-template promotion, partial Spot capacity and expected-versus-unexpected EIP guards; demonstrate executable replacement rollback without production side effects.
- Specify explicit host/commit/run IDs, artifact/checksum provenance and deploy status distinct from Release publication; define protected per-host/code versus replacement approval gates, concurrency and replay/idempotency rules. Approval must bind the actual candidate and refreshed inventory.
- Operator separately approves environment/IAM/OIDC/SSH/network setup, least privilege, audit retention and any production pilot. Read-only code checks or adapter presence do not prove these permissions or enforcement.
- Retain Hermes for review and exception handling during pilot; migrate execution only after independent evidence covers equivalent invariants and rollback. List remaining manual gates honestly in that issue's acceptance criteria.

Cordova signing/store release stays outside this decision and follows [#2605](https://github.com/WizardFactory/TodayWeather/issues/2605).
