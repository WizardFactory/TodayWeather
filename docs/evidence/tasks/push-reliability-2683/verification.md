# Push reliability verification

Builder: OpenAI Codex, one branch based on 182f4fd7. Scope: #2683 fix, #2626
registration investigation and #2677 regression. Local runtime Node 24.19.0;
supported-runtime regression/smoke also exercised Node 16.20.2 and 22.22.2.
No live FCM, mobile build, deployment, restart or device receipt is claimed.

| Check | Actual result |
| --- | --- |
| Initial new regression, before implementation | 8 intended failures / 1 pass; permanent pause, late status and absent health |
| Additional recovery warning-priority regression | Intended failure on the normal fairness turn; corrected before commit |
| Final full offline suite | npm --prefix server run test:offline passed after warning-gate correction |
| Final transport recovery/generation suite | 13 passed |
| Existing S3 coordinator suite | 27 passed |
| Existing preparation retry suite (#2677) | 32 passed |
| Store compatibility suite | 12 passed |
| Real local combined HTTP transport/weather and Unix IPC smoke | First original attempted once and aborted; fresh admission recovered; preparation retried twice, token repair restored eligibility, warning preceded fresh alarm; 5 total submissions, 2 aborted original requests |
| Actual shared client registration and local S3 protocol smoke | Passed: registration/reopen/location/rotation/disable/delete, persistence errors and late conditional-write/restart fencing |
| Existing real runtime/weather preparation smokes | Passed: shared formatting/OAuth and local weather outage, peak origin concurrency 2, 20 unique alarms, 40 preparations |
| Node 16.20.2 and 22.22.2 | Recovery/generation regression and real combined smoke passed |
| Warning capacity baseline on combined dispatcher before final two-line warning-gate correction | 10,000 accepted with 100,000 normal backlog; last 25.324s, first 120ms, event-loop p99 lag 16ms, zero per-recipient S3 reads. Synthetic 200ms transport/3ms storage only |
| Archify | Validate/deliver/strict artifact check passed; real browser and visual-check passed after restricted Chrome pipe failure; dark 1440/light 2048 captures visually checked |

The capacity baseline has no ambiguous send and does not enter the changed recovery
gate; reuse is valid for unchanged ordinary lane/rate behavior. The final regression
and combined smoke exercise that gate specifically. First restricted store attempt
was blocked by local listen EPERM, then passed under authorized loopback execution.
The first Green attempt was interrupted after finding a hung-probe gate; later
attempts corrected it. A newly added registration fixture initially lacked alarm
time and a stale-probe test awaited a newly admitted unresolved job; both test setup/
oracle errors were corrected, not called intended Red. One final combined smoke
failed because normal fairness won the recovery gate; its specific regression was
added and passed after correction. All original failures remain in local task records.

Generated logs, state and Archify recovery metadata remain under ignored reports,
.planning and .archify. This selected record, intent/spec/plan/investigation and the
operations/design update retain essential sanitized evidence in Git; exact CI/head/
base, review findings/settings and final readiness are published durably on the PR.
Maintained docs contain no link to local-only reports. Local artifact hooks are
available but not installed; staged/outgoing checker and CI remain the actual gates.

Pending: current source-matched origin latency/campaign readback, old/new release
Firebase/APNs identity and actual older-iOS/Android receipt. The configured SSH key
and release Firebase files are absent here. See [investigation](investigation.md)
and [operation handoff](../../../operations/push-s3.md#transport-recovery--2683).
