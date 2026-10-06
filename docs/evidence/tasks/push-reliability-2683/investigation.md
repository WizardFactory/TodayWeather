# Push reliability investigation — 2026-10-06

Evidence at repository base 182f4fd7, with GitHub issue observations fetched on
2026-10-06 UTC. Deployment/user reports below are attributed observations, not new
live checks. No production mutation or actual notification was performed.

## #2683 confirmed defect

The old dispatcher watchdog set `budget.paused=true` and never cleared it, even
when the original request later settled. Both dispatcher and HTTP transport
started 15s timers; the watchdog starts first. The original regression produced
an ambiguous result followed by failure of a fresh job after settlement.

[Issue #2683](https://github.com/WizardFactory/TodayWeather/issues/2683) records two
ambiguous sends then 25 project-paused failures at 07:40 KST and three jobs with zero
transport attempts at 08:00. These are bounded issue/operations findings. Why those
FCM requests were slow remains unknown. The corrected flow uses a 20s watchdog,
15s HTTP abort/close settlement, a 30s fresh-job recovery gate, retained physical
slots and at most two probes while ambiguous sends remain unresolved. Original
jobs are never replayed. Late auth/429 and stale-probe races are covered. Integrated smoke additionally
reproduced a normal-fairness turn taking the single recovery gate before a warning;
the regression and correction now give pending warnings that gate. Normal fairness
and reservations resume after recovery.

## #2626 registration and release identity

`service.push.js` updates via PUT old/new token and posts saved lists at startup,
settings save and first-token arrival. `service.firebase.js` obtains tokens through
FirebasexMessaging and registers the token refresh callback. Backend IPC forwards
PUT to `Registry.rotate`, which advances endpoint generation. A changed-token POST
also advances generation. `Engine.eligible` rejects a delivery-state disabled
marker only when it matches the current generation.

Verified locally: enabled registration plus disabled matching generation is
ineligible; reposting the same invalid token stays fenced; new-token PUT and
changed-token POST restore new-generation eligibility. Revision guards keep stale
queued work from sending. This validates backend behavior, without matching AK's
device or explaining why its token became invalid. Do not clear invalid-token fences.

Cordova PR #2608 was merged as 39a3336f; its modular Firebasex configuration and
permission/first-token paths are present. `copy-firebase-config.mjs` copies ignored
Firebase files from `TW_RELEASE_LOCAL_DIR`; it does not create APNs keys or FCM
tokens. This worktree and the documented base checkout lack the configured SSH
key/credentials; the expected local Firebase JSON/plist files are also absent.
No key/token replacement can be asserted from source or plugin version alone.
After authorized access, compare old/new Firebase project ID, sender/project
number, app ID and iOS bundle ID, plus Firebase APNs key ID/team/environment metadata.
Compare privately; record equality/change and validity, never key/token values.

AK reports actual scheduled-weather receipt on the older iOS app early last week.
Exact timestamp/version/token is unknown. The current disabled cohort is not
identified as AK's device. iOS has worked at least once; an app update is not an
established repair requirement. Native 1.1.0 token/permission/tap/receipt needs a
separate physical-device acceptance check. No speculative iOS fix or new issue.

## #2677 weather preparation and unresolved origin latency

PR #2680 is already merged/deployed per the issue records. October 6 source-matched
operations evidence in #2677 confirms preparation retries and no terminal weather
preparation failure in the inspected new campaigns. The inspected transport failures
belong to #2683. The original 46 HTTP499 responses at +5s establish cancellation at
the coordinator's timeout, without identifying the slow origin stage.

Source tracing: the alarm runtime uses `/v000902/kma/addr/...` after town resolution.
That router invokes `ControllerTown24h`'s inherited `getAllDataFromDb`, whose town
and mid-weather branches run in parallel but each collection group uses
`async.mapSeries`. DB_DATA_VERSION 2.0 current/short/shortest readers execute sorted
Mongo queries, followed by the route's merge, history, air, life-index and rise/set
middleware. This identifies timing boundaries to inspect; it does not show which
stage was slow on the deployed revision. No blanket weather-timeout increase.

Live read-only SSH probe could not proceed: the configured key is absent and host
trust unavailable. No bypass of host validation was used. Current deployed file
hashes, process start/version, nginx upstream timings and campaign/S3 readback could
not be refreshed here; supporting unpublished operations records are not in this
checkout. Existing issue evidence is sufficient for the confirmed code fix, but not
for origin root cause or current batch completeness.

After separately authorized access, correlate a bounded campaign window using
sanitized counts: coordinator prepared/transport attempts, nginx499/request_time/
upstream_response_time, stage completion timings and connection/CPU pressure.
Inspect configured DB version, selected adapters and source hashes first. Do not
invoke `/gather/*`, alter runtime or call providers to fabricate latency evidence.
Read campaign parts/manifest summary and share one controlled receipt check between
#2626/#2677. FCM acceptance alone does not prove device receipt.

See [operations and rollback](../../../operations/push-s3.md#transport-recovery--2683).
