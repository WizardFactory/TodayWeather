# Service EIP readiness diagnostics and terminal alerts

This is the local candidate for [#2938](https://github.com/WizardFactory/TodayWeather/issues/2938), not a deployment record. The [baseline observation](../evidence/aws/service-eip-baseline-2026-11-12.json) pins the inspected Lambda. The reported November 12 KST incident is preserved in the issue; its initial weather latency remains unexplained. Later restored responses do not establish earlier readiness.

[Proposed notification flow](../architecture/diagrams/service-eip-readiness.html) ([editable source](../architecture/diagrams/service-eip-readiness.json)).

## Behavior and diagnostics

The [checker](../../infra/aws/service-eip/lambda_function.py) retains direct candidate IPv4 probes, `/health` body validation and the existing weather publication/value checks. The socket timeout remains 2 seconds and total HTTP deadline 3 seconds. One invocation has at most 18 probes with ten-second intervals, bounded by Lambda time remaining. AWS configuration allows two asynchronous retries and an event age of 1,800 seconds. No periodic readiness job runs after exhaustion.

`readiness.probe` events contain safe event/invocation/candidate/Fleet identities, probe ordinal, stage (`health` or `weather`), elapsed milliseconds, socket/deadline limits and status or classified reason. `readiness.result` reports validation outcome. `invocation.failed` summarizes exhaustion; Lambda's failed invocation record carries the sanitized summary. Search by original EC2 event ID across invocations and by Lambda request ID within one invocation. A probe failure is not proof that AWS has finished retrying.

The separate [observer](../../infra/aws/service-eip/failure_observer.py) accepts only the configured source function's terminal `RetriesExhausted` or `EventAgeExceeded` record. It publishes an allowlisted diagnostic summary to the configured SNS topic. It does not import EC2 or receive EC2 permissions. `notification.sent` means SNS accepted the publish, not that a subscriber received it. `notification.failed` identifies configuration or delivery failure without raw exception text. Duplicate terminal delivery may produce duplicate messages; `source_invocation_id` identifies repeats.

HTTP errors, invalid responses and timeouts are distinct; durations do not identify the internal slow dependency. Correlate server-side timings before attributing delay to geocoding, DB/provider work, cache preparation or boot. Raw URLs, precise lookup history, response bodies and credential values are not diagnostic fields.

## Local verification

From a clean repository root:

```sh
python3 -m unittest discover -s infra/aws/service-eip/tests -v
python3 infra/aws/service-eip/smoke.py
```

The smoke opens an ephemeral loopback server, exercises actual HTTP parsing through the checker, emits a synthetic failure-destination record to a fake SNS sink, then validates the protected success path with fake EC2. It prints request/notification/association counts and `production_calls: 0`. A sandbox must permit loopback binding. Unit tests require only the Python standard library; target runtime is Python 3.13. Tests do not prove live destination/subscriber delivery.

## Deployment prerequisites and rollback

Production execution needs separate authorization. Neither repository CI nor merging this candidate deploys it.

1. Re-read `AttachEIPToSpot` code hash/revision, complete variable map, execution role, async config and event rule. Compare with the pinned baseline and investigate drift. Preserve backups securely; never put configuration values into a public log.
2. Package and hash separate checker and observer ZIPs as described in the [implementation README](../../infra/aws/service-eip/README.md). The observer artifact bucket must have versioning; supply its exact bucket/key/version. Confirm same-account/region operator SNS topic, confirmed subscribers, topic policy, encryption/KMS requirements and alarm permissions. Existing operator alarms used SNS `WF` at inspection time; this is not subscriber-delivery evidence.
3. Review a CloudFormation change set for [notification-stack.json](../../infra/aws/service-eip/notification-stack.json). It creates an observer role with only bounded log writes and SNS publish, adds narrowly scoped observer invocation to the existing checker role, and configures OnFailure while retaining 2 retries/1,800 seconds. It does not change checker code, AMI, Fleet or EIP. Do not deploy if another stack owns the source invocation config or the observed settings changed without reconciliation.
4. The template includes alarms for source `DestinationDeliveryFailures`, observer `Errors` and observer `AsyncEventsDropped`. Verify notification subscribers and alarm action delivery. A publish success does not replace these checks. If topic encryption requires additional key rights, resolve that explicit permission change before rollout.
5. Only under the approved rollout, update checker code bound to the expected Lambda revision and preserve its complete environment. Validate using an isolated candidate and a separately approved test destination; any real EIP movement or production notification requires its own scoped authorization. Confirm source guards and notification receipt before considering the rollout verified.
6. Roll back by restoring the backed-up checker artifact/revision and previous event-invoke configuration (the inspected baseline has no failure destination), then removing only the task-owned observer policy/stack after pending destination consumers finish. Preserve source event rules, existing operator topic and unrelated role policies. Reconcile uncertain deployment results before retrying.

## Manual recheck

Start with read-only inspection: resolve the candidate's current instance/Fleet/AMI membership, IP and EIP allocation/owner from AWS. Confirm the old owner is stopped/terminating/terminated or the allocation is unassociated; a healthy current owner must retain the EIP. Check the candidate directly, without public-host routing, redirects or gather endpoints. Use `/health` and the exact deployed weather readiness path; the coordinate path in this baseline remains subject to #2606's separately owned gateway-cutover change.

Run the same publication/value validation as `ready`, not only an HTTP status check. If it fails, retain sanitized timings and investigate; do not bypass it. Immediately before any separately authorized association, re-read candidate IP/AMI/Fleet and unchanged EIP ownership and preserve the code's safety checks. Re-read the allocation after association to verify it. Never invoke the attachment Lambda merely as a read-only probe: a passing candidate can cause an EIP move.
