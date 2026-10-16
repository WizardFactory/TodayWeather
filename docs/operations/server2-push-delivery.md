# Server2 conditional push delivery

Editable operator guide for S18b-2 (#2703), 2026-10-16. [PDF](server2-push-delivery.pdf)
and [sequence](../architecture/diagrams/server2-push-delivery.html).

## Capability and setup boundary

The `AlertWorker` library evaluates conditional registrations using server2's acknowledged
S3 state. It is not wired into the production entrypoint in this slice. S20 must create one
delivery owner, connect SERVICE_SERVER to server2's v000902 routes and provide the same
S18b-1 Firebase account configuration. Do not start legacy and server2 senders together.
There is no dry-run, mock or validation mode. Tests and the example inject synthetic peers.

## Selection and outcomes

The scheduler runs at UTC minutes 7, 17, 35 and 50. Registrations must be explicitly enabled
and inside their inclusive normal or overnight window. A weather or air push within the last
six hours suppresses that registration. Current precipitation and current air-grade
transitions can send; two successive wet shortest forecasts can trigger precipitation.
Air forecasts are computed but discarded, matching legacy. Overseas observations older than
30 minutes are skipped.

The worker claims the cycle in S3 before preparation and stores alert state before FCM. It
skips a registration changed by the user while weather was fetched. Each provider submission
is attempted once. Unknown outcomes and rejected submissions are not retried after restart.
An unregistered token disables all matching conditional registrations, without touching alarms.
Diagnostics omit tokens, names, coordinates and notification text.

| Outcome | Operator meaning |
| --- | --- |
| accepted | Local/provider API accepted the submission; this does not prove device delivery |
| rejected | Provider rejected it; do not resend this cycle |
| unknown | Outcome may have been delivered; do not resend |
| failed / state-not-committed | State could not be safely committed or the selected registration changed; nothing sent |
| not-needed | State was updated; no notification threshold transition |

## Local functional check

From `server2/`, run:

```sh
cargo run --locked --example conditional_alert_smoke
cargo test --locked --test delivery alerts::
```

The example creates one synthetic alert and local weather, OAuth and FCM HTTP peers. It
fetches weather, durably updates the alert, submits once and restores the S3 state into a new
service. It expects one weather GET, one local FCM submission and zero restart resends.
It reads no `.env`, real credentials or real device tokens and makes zero external calls.

![Actual local functional smoke stdout](../evidence/tasks/issue-2703-s18b2/conditional-smoke.png)

## Deployment and failures

This PR does not deploy, attach a scheduler or send live notifications. Do not infer a live
FCM credential check or native device receipt from this local example. A refused cycle claim
or alert-state journal write prevents submission. A lost result object keeps the claim and
must never be replayed as a send. Ordinary conditional evaluations preserve registration
updatedAt; legacy's obsolete updateAt cleanup typo remains a no-op.

[Selected verification](../evidence/tasks/issue-2703-s18b2/verification.md) contains source
provenance, actual commands and limitations. Google documents the
[HTTP v1 send contract](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk) and
[FCM error classes](https://firebase.google.com/docs/cloud-messaging/error-codes); observed
provider acceptance and real device delivery remain separate facts.
