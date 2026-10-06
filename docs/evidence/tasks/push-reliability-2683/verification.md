# Push reliability verification

Builder: OpenAI Codex, one branch based on 182f4fd7. Scope: #2683 fix, #2626
registration investigation and #2677 regression. Local runtime Node 24.19.0;
supported-runtime regression/smoke also exercised Node 16.20.2 and 22.22.2.
The original pre-merge tests below use isolated dependencies. Separately authorized
live FCM/device and read-only host follow-ups are recorded in the dated section
below. No mobile build, deployment or restart was performed in these follow-ups.

| Check | Actual result |
| --- | --- |
| Initial new regression, before implementation | 8 intended failures / 1 pass; permanent pause, late status and absent health |
| Additional recovery warning-priority regression | Intended failure on the normal fairness turn; corrected before commit |
| Final full offline suite | Node22 server/test/offline/run.js passed after F1/F2 correction; same full test list |
| Final transport recovery/generation suite | 17 passed |
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

Pending: source-matched origin latency, installed-binary/Firebase configuration
identity, APNs Console association and actual older-iOS/Android receipt. Bounded S3
campaign readback and backed-up Firebase identity comparison are complete. The
earlier SSH limitation was later resolved; expected release files remain absent
from this checkout. See the dated follow-up below, [investigation](investigation.md)
and [operation handoff](../../../operations/push-s3.md#transport-recovery--2683).

Independent review round1 reproduced Required F1 (global warning recovery starvation) and Recommended F2 (late ambiguity erased newer proof). Author added three regressions: all fail as intended on reviewed 56cea09d, then pass after correction, while all prior 13 stay green. F3 conservative pre-connect gate retained/documented; F4 settled-outage probe reset clarified. Affected combined HTTP/IPC smoke is renewed on Node16/22; final independent re-review and current CI remain required. AK-requested private S3 read-only investigation establishes backed-up Firebase input continuity without claiming current Console binding, installed binary identity or actual iOS receipt.

## Read-only S3 batch readback — 2026-10-06 UTC

Inventory selection: six manifests modified October 6, listed through 01:07:05UTC. Manifest summaries match current part status counts in all six; reads are observational, not an atomic snapshot. No production notification or S3 mutation.

| Created UTC | Kind | Jobs | Final status | Preparation reason counts | Transport attempts |
| --- | --- | --- | --- | --- | --- |
| 00:00 | alarm | 1 | failed:1 | project-paused:1 | 0 |
| 00:07 | conditional | 96 | expired:12, not-needed:84 | none recorded | 0 |
| 00:17 | conditional | 96 | expired:12, not-needed:84 | none recorded | 0 |
| 00:35 | conditional | 96 | expired:12, not-needed:84 | none recorded | 0 |
| 00:50 | conditional | 96 | expired:39, not-needed:57 | weather-timeout:16, weather-deadline:11 | 0 |
| 01:07 | conditional | 96 | expired:32, not-needed:64 | weather-timeout:11, weather-unavailable:4, weather-deadline:5 | 0 |

The 00:50 and 01:07UTC conditional campaigns have27 and 20 expired jobs with preparation weather-timeout/deadline/unavailable reasons, respectively. This extends the earlier issue observation: the #2677 retry code is present and retries are observed, but preparation still fails to finish for this bounded later cohort. Do not report all new campaigns preparation-clean. The five conditional campaigns total 480 jobs, 373 not-needed, 107 expired, 467 preparation attempts and 94 preparation failures; reasoned preparation expiries account for 47, while 60 expiries have no recorded reason. Their zero transport attempts separate these outcomes from #2683. The 00:00UTC alarm failed project-paused with one preparation and zero transport attempts. Origin-stage latency and device receipt remain unverified.

Round2 independently resolved F1-F4 and found Recommended F5: warning scans repeated during overlapping recovery/cooldown and large unrelated or preparation-waiting backlogs (20k warnings, synthetic p99 event-loop lag283–573ms). Author selected a bounded ordering correction: check cooldown and total/lane tokens before warning preference inspection. The new regression fails before this change and passes afterward; all17 regressions and actual combined smoke pass on Node16/22. Ordinary queues, preparation/S3/store behavior and diagram topology are unchanged. Independent final review and current CI remain the final pre-merge gates.

After F5 correction, the same independent20k-warning profiles were executed locally: Node16 unrelated/preparation-wait loop-lag p99=6/6ms, Node22=8/6ms; pump p99=2.51–3.62ms. Prepared same-project warning priority passes in both profiles. Synthetic local measurements establish the scoped improvement, not a production latency guarantee. Full offline evidence is from576726b0; only admission-check ordering and its regression changed afterward, with focused regression/smoke/benchmark renewed.

## Physical iOS and host follow-up — 2026-10-06 UTC

AK separately authorized bounded direct tests on the locally connected physical
iPhone12 Pro Max / iOS26.0.1 / TodayWeather1.1.0 build1 (developer-installed).
Each test sent one request to one device and received HTTP200; neither request was
replayed.

| Check | Actual result and limit |
| --- | --- |
| Foreground at02:23:24UTC | Matching app callback/event and visible notification popup confirmed receipt; callback was not a notification tap |
| Background at02:44:42UTC | Native Settings app was foregrounded; SpringBoard reported remote notification delivery and notification-list insertion for the exact bundle/timestamp of the sole targeted send |
| Background visual/sound | No banner observed; Focus icon visible, suppression cause unproven. Payload had no sound; audible alert not tested |
| Current registration | Live token matched S3 generation1, three enabled rows, no current-generation fence; new-token rotation not proven |
| Lock screen/tap/city navigation | Not tested: touch-control surfaces returned `cgWindowNotFound` and AK could not operate the device |

Both direct FCM tests bypassed the deployed coordinator/weather preparation. They
prove receipt on this developer-installed build, not scheduled batch success,
deployed #2683 recovery, #2677 preparation completion or all older iOS registrations.
The app was restored to the foreground. Temporary credential/token files and
approved LocalStorage copies were deleted after extracting push fields; device
identifiers and personal content are excluded from maintained evidence.

Read-only host verification at03:38–03:43UTC compared five deployed push files by
SHA256. Engine/registry/runtime match PR head83dc948d and base182f4fd7;
transport/dispatcher match the base. One coordinator process was online. Retained
logs contain7,381 aggregate metrics records, two startup records and no raw FCM
response/token audit. The same-token fence and newer-generation eligibility
observations are recorded in [investigation](investigation.md#registration-and-host-follow-up--2026-10-06-utc)
and [#2626](https://github.com/WizardFactory/TodayWeather/issues/2626#issuecomment-6008851814).
No host/S3 state mutation, notification, restart or deployment occurred during the
host investigation.

Independent review round3 was PASS at83dc948d, with Required/selected F1–F5
resolved and optional F6 unselected. CI was20/20SUCCESS at that head. This follow-up
changes only maintained investigation/verification evidence. Those historical
results are not a renewed review of the subsequent documentation commit; AK's
requested review will assess the updated PR. Missing raw historical responses,
device-specific changed-token re-registration, lock-screen/tap, origin latency and
scheduled production receipt remain explicit verification limits.

## Required F9 queue cleanup correction — 2026-10-06 UTC

[Review5426084684](https://github.com/WizardFactory/TodayWeather/pull/2684#pullrequestreview-5426084684)
identified a coverage gap at24ef769d: three unresolved warning requests fill the
warning lane at concurrency4, preventing unsent other-project work from expiring
or observing changed registration. The author independently reproduced this on
Node16/22, plus full global concurrency starvation, and withdrew pre-merge readiness.

Four new intended regressions failed before the fix while the prior17 passed.
The dispatcher now checks at most1024 live items cyclically before physical
admission, removing expired/superseded queued entries without changing surviving
FIFO order or releasing unfinished physical requests. Retry reason/stage is retained.

| Renewed check | Actual result |
| --- | --- |
| Node16.20.2 / Node22.22.2 recovery/generation | 21/21 each, including warning/global saturation, guard invalidation, retry metadata and bounded cleanup/FIFO across batches |
| Real HTTP/weather/Unix IPC smoke, both runtimes | Passed: prior integrated flow plus three HTTP requests held open beyond watchdog; another project's unsent work ended expired/superseded with zero attempts, queue emptied and all three physical slots remained charged |
| Full offline suite, Node22 | Passed on corrected dispatcher/test content; legacy provider/DB suites excluded by the existing runner |
| Node16 S3 / preparation / store | 27/27, 32/32, 12/12 |
| Node16 warning capacity with100k normal backlog | 10,000 accepted; first58ms, final25.255s, synthetic event-loop p99 lag7ms; zero per-recipient S3 reads |
| Diagram | Regenerated with Archify: validation, strict artifact and real-browser checks pass; light/dark1440/2048 captures visually inspected |

The first Green run stalled only in the large FIFO test: its frozen-clock fixture
had too few rate tokens to drain all surviving work. Both task-owned processes were
stopped; increasing that fixture's rate allowed21/21 to complete on both runtimes.
This is a fixture correction, not a passed first run. No source correction was
needed after Green. The smoke now has8 HTTP submissions: the earlier5 plus3
long-open original/probe requests, with no submission for the cleanup targets.

F9 is author-applied, awaiting reviewer confirmation on the pushed correction.
Earlier review PASS/CI records remain revision-bound; they do not approve this
change. No merge, deployment, restart, real FCM call or registration mutation occurred.
