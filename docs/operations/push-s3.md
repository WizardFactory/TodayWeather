# S3 push coordinator — #2626

This is opt-in repository behavior, not a production deployment record. The default
store remains MongoDB; `PUSH_STORE=sqlite` remains the previous optional implementation.
Notice storage (#2623) is unchanged. See [design and implementation contract](../architecture/push-s3-design.md).

## Processes and configuration

Run API workers in `SERVER_MODE=service`, with `PUSH_STORE=s3` and one common absolute
`PUSH_SOCKET_PATH`, for example `/run/todayweather/push.sock`. The parent directory must
be private and owned by the service account. Run exactly one `node bin/push-coordinator`
under that account, in PM2 **fork mode, one instance**. Never use rolling/cluster
restart for the coordinator. Stop and verify the previous process before starting another.
The socket is mode 0600. An existing socket stops startup; after a crash, verify that
no owner remains before removing the stale socket. This is same-host fencing, not a
cross-host lease. Never point a second coordinator host at the same prefix.

The coordinator needs `PUSH_S3_BUCKET`, optional `PUSH_S3_PREFIX=push/v2`, `AWS_REGION`,
`API_SERVER` for off-path geocoding and `SERVICE_SERVER` for weather. Use the existing
TodayWeather Firebase service account configuration. TodayAir was confirmed retired by AK
on **2026-09-28** (confirmation date, not a known shutdown date); exclude it from
restoration and credential renewal. See [product lifecycle](../architecture/service-overview.md#product-lifecycle).
Tokens are acquired through
its credential interface; messages use direct HTTPS FCM HTTP v1 without messaging-SDK
retries. HTTP requests have a 15s abort deadline. A watchdog/ambiguous timeout does not
release an unfinished transport slot or trigger immediate retry. Authentication failure
pauses that project until operator recovery/restart. The fixed SDK dependency is not
being upgraded across the service in this change.

Read-only inspection on 2026-09-28 found Node 16.20.2, x86_64, glibc 2.17 on tw-svc.
This supersedes historical Node 10 observations for this rollout, but is not permission
to change the runtime. New coordinator CI runs on Node 16.20.2. Existing historical
Node 10 SQLite smoke remains a regression check only.

## Storage and least privilege

Use a private bucket with public access blocked and HTTPS-only access. Writes request
SSE-S3 AES256. Existing credential roles/default AWS credential chain are used; do not
embed AWS keys in process commands or commit tokens/locations.

| Principal | Prefix permissions |
| --- | --- |
| API workers | Unix socket only; no S3 access needed for push |
| Coordinator | ListBucket restricted to the chosen prefix; GetObject for all its subprefixes; PutObject only `registrations/`, `campaigns/`, `delivery-state/` |
| Existing warning collector | GetObject/PutObject `warning-feed/` only |

Objects are per-device registrations, 256 hashed delivery-state partitions, campaign
manifests/512-recipient checkpoint parts and a 24-hour warning-feed manifest. Lifecycle
expiry may remove `campaigns/` and `warning-feed/events/` after an approved retention
period longer than 24h (for example 7 days); never apply that rule to registrations,
delivery-state or `warning-feed/head.json`. Avoid retaining old token/location object
versions indefinitely. Operational lifecycle/IAM setup is not performed by this PR.

## Rollout and rollback

1. Provision the private prefix/socket directory and verify IAM with synthetic data.
   Verify each project's FCM quota, credential project ID and controlled device delivery.
   The current capacity result uses synthetic transport; it does not establish FCM quota.
2. Start the coordinator without warning sending. It lists/restores device objects,
   resolves regions through a bounded queue of eight, restores checkpoints and then
   opens its socket. Any failed initial region lookup prevents readiness. API writes
   return 503 while the coordinator is unavailable. Later accepted location changes
   remove old memberships immediately; unresolved new positions cannot receive warnings
   until the 30s retry succeeds. `unresolvedDevices` exposes that condition.
3. Switch API workers to S3. **AK decision, 2026-09-28: do not migrate existing MongoDB
   push registrations.** Begin with client registrations/re-registrations; do not add an
   import step to activation. Existing SQLite records are also not imported automatically.
   Apps re-register when opened. Inventory legacy registrationId-only clients before the
   switch: the S3 path requires an FCM token (not legacy APNs/GCM delivery). Missing UUID
   plus a new token without old-token linkage can create a new identity. Re-registration
   is the repair path accepted for registration inconsistencies.
4. Enable the existing gather collector's `PUSH_WARNING_FEED_ENABLED=true`; first export
   establishes a non-broadcast baseline. Then enable `WARNING_PUSH_ENABLED=true` on the
   coordinator after confirming mapping/audience and a controlled-device test. Target is
   enabled `category=alert` users inside their existing windows, not alarm-only users.
   All supported KMA warning types use the existing town-to-zone map; conservative
   metropolitan mappings can over-target subzones. No unknown-position nationwide send.
5. Stop all legacy `SERVER_MODE=push` and SQLite `push-worker` processes before enabling
   real sends. Do not run two sender implementations at once.

Rollback: stop the coordinator first, change API workers back to the prior store,
then restart only the chosen old sender if authorized. S3-only registrations are not
copied into Mongo/SQLite by rollback; users must re-register. Preserve the S3 prefix
for later investigation. No deployment, data migration or automatic deletion is in this PR.

## Delivery and failure contract

- Latest **accepted arrival** determines a device's current city (index 0); it never
  expires solely because of age. Fixed cities retain their own positions. A late GPS
  report can replace an earlier arrival because the existing app sends no sample order.
- Sparse commands serialize through a bounded FIFO. Success follows S3 publication;
  timeouts can still be ambiguous. Reconciliation blocks sends for affected devices.
  Multi-object token merges are not transactions, and duplicates after a crash remain possible.
- Normal minute jobs and warnings expire after five minutes. Warning source publication
  must also be recent; late historical rows update state only. Release cancels unsent
  targets, including recovered work. Already-submitted messages cannot be recalled.
- S3 is used for campaign startup and five-second checkpoints, not each recipient.
  Recovery can repeat uncheckpointed submissions; downtime can miss expired work.
  Exactly-once delivery is not promised. A missing/malformed checkpoint stops restoration.
- Same event overlapping regions deduplicate by endpoint; late additional regions join
  the existing campaign. Invalid tokens disable only the captured generation. A new
  token/re-registration restores eligibility. Conditional rain/air retains the legacy
  coupled six-hour prefilter; warnings bypass it.
- Normal weather responses are shared for the same domestic town (overseas exact coordinates), units and language for
  60 seconds. Formatting remains the existing alarm/alert code. Warning messages use
  Korean source terms for `ko`, English fallback otherwise; region names remain KMA
  names. Broader reviewed warning translations are a separate activation follow-up.
- 429 uses Retry-After (60s default), 5xx uses exponential backoff/jitter, minimum 10s,
  at most five attempts within freshness. 400/401/403/404 are not blindly retried.
  The dispatcher enforces one rate budget per actual Firebase project and reserves
  warning queue/slot capacity.

`push-metrics` logs aggregate queue, active count, results, unresolved devices and RSS
once a minute. `tick-failed`, `warning-feed-failed`, `checkpoint-failed` require attention.
Socket `GET /health` reports readiness. Do not log raw registration/FCM tokens, positions,
S3 object bodies or OAuth responses. Legacy formatter logs are suppressed in this process.

## Local evidence

`push-s3.test.js` covers contract/race cases. `push-s3-smoke.js` runs real routers,
Unix IPC and AWS SDK against local S3/FCM HTTP peers; `push-s3-runtime-smoke.js` checks
real geocode/weather formatting with synthetic OAuth. `push-s3-capacity.js` measures
10k recipients against a 100k normal backlog at 200ms synthetic transport, with S3
PUTs modeled as 3ms. Production S3 latency, project quotas, device receipt, cold recovery
at 100k/1m devices and failure-domain availability remain rollout measurements.

## Client acceptance — decision confirmed 2026-09-28

Use the existing TodayWeather client notification registration feature for final
acceptance. Local coverage executes its unchanged `client/www/js/service.push.js`
factory against real HTTP routes and Unix IPC, with local S3/FCM protocol peers.
Check new regional-alert and scheduled-alarm registration, reopening/re-registration,
current-position update, token rotation, disabling, city-zero deletion, persistence
errors and restart recovery. This does not exercise the native permission dialog,
FCM token acquisition, mobile UI or actual device receipt.

After an authorized deployment, use a controlled TodayWeather device to register
an alert/alarm and confirm receipt; move its current location and verify the updated
region, then disable/delete the setting. Do not infer end-to-end operation from a
valid service account or local protocol tests alone. Mongo registration import is
not a prerequisite and must not be performed.
