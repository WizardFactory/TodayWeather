# Push callback token renewal — 2026-10-16

Task: [#2626](https://github.com/WizardFactory/TodayWeather/issues/2626). AK approved simulator verification in place of physical-device verification and requested the [client fix through pre-merge](https://github.com/WizardFactory/TodayWeather/issues/2626#issuecomment-6206475707). Keep the umbrella issue open; no merge/release is authorized.

## Native reproduction before the fix

Revision `c48b29aa900d35ab50da0ca5ccc5392345817cc5`; TodayWeather1.1.0 build1, Firebasex messaging2.0.3, iOS26.5 simulator on Apple Silicon/macOS26.6.2/Xcode27.0. A test-only observation plugin used Apple's provisional notification authorization and recorded the original Firebase/Push callbacks without replacing their behavior. No fake token, synthetic notification callback or `simctl push` was used.

| Time (KST) | Actual result |
| --- | --- |
| 09:14:57 | Native token A callback; initial PUT old=null returned403. |
| 09:15:21 | Test alarm + disabled alert registered with A by POST200; server generation1. |
| 09:15:57–59 | Official unregister/reissue emitted A→null→B; PUT A/null and null/B each returned403. Existing first-token POST returned200, preserving both settings with B/generation2. |
| 09:19:00–01 | Production coordinator selected one B job, zero A jobs; one accepted transport attempt. The native callback at09:19:01.027 had the exact campaign eventId and cityIndex0. One receipt observed through cleanup. |
| 09:20–21 | Both exact test IDs deleted with HTTP200; server/app settings zero. Diagnostic app removed and simulator restored to shutdown. |

Campaign ID: `709e72e36a8e88f3bb25b8a77671f2df064059546907ff04bdb0bdc6db4fe2ca`. This is actual scheduled receipt before the fix through POST recovery, not proof that the A/B PUT succeeded or that all historical sends were deduplicated. Natural token rotation without null, manual permission UI, actual notification taps, conditional-alert delivery and Android were not tested.

## Corrected callback and automated verification

The callback now ignores non-string or blank SDK values before HTTP, token mutation and settings persistence. It retains A until B arrives. Accepted token bytes and existing first-token/error/duplicate behavior stay intact. The underlying backend validator and generation fences remain unchanged.

- Red: `node --test client/test/push-token-refresh.test.cjs` exits1 with three expected failures on the original callback: A is cleared, invalid events emit requests and initial empty-token state changes.
- Green: the six callback tests pass after the guard.
- Post-refactor: `node --test client/test/*.test.cjs` passes66/66 on Node24.19.0. No further refactor was required.
- Additional real integration: `node client/test/push-token-refresh-smoke.cjs` passes using actual client factories, loopback HTTP, production S3 middleware, Unix IPC, Registry, Engine, Dispatcher and HTTP-v1 transport. Invalid/duplicate callbacks make zero new requests; one complete A/B PUT returns200; stored B is used for one local provider submission, A for zero. Native callbacks/storage/FCM are local peers, not actual SDK/provider delivery in this smoke. Both checks are wired into the existing Node22 client CI job.

The modified native simulator build succeeds with a test-only iOS15 deployment override and standard Xcode simulator signing. The initial post-fix native attempt was **not executed**: simctl waits in Xcode's first-launch/version check (wrapper expects CoreSimulator1174.9.2; installed framework1171.7). Waiting task-owned calls were interrupted; no new production settings or notifications resulted. No global Xcode installation, permission, service or security policy was changed during that attempt. The pre-fix native receipt is not relabeled as post-fix evidence.

The first old=null PUT403 and valid-PUT failure persistence/retry behavior remain outside this guard fix. This observation does not establish that a production app update is required for delivery; the existing POST path already recovered this controlled case.

## Post-fix native simulator retry — 12:12–12:23 KST

AK requested a retry. The same diagnostic simulator build contains Push source SHA-256 `d4255f73355cc1bcf16a68f2ae7bfcfa48a956b93bdbe675227d4fcc43b6a140`, byte-identical to PR #2775 at `773c3b2aafc9a615c5518cef475f53fc4fb1f8e0`. The Xcode wrapper still waits in its first-launch/version check; the installed, signed CoreSimulator framework's own `simctl` lists and boots the existing iOS26.5 verification simulator successfully. No framework upgrade, global setting, service restart or security-policy change was made. Test-only observation and provisional authorization are unchanged.

| Time (KST) | Actual post-fix result |
| --- | --- |
| 12:12:31.755 | Real SDK token A. Initial old=null PUT403 remains the unchanged first-acquisition behavior. |
| 12:15:13 | A POST200 registers one enabled alarm and one disabled alert; server generation1. |
| 12:15:49–51 | Official unregister/reissue emits null at12:15:50.111 and different real B at12:15:51.408. Exactly one rotation PUT at12:15:51.410 carries A/B and returns200. No invalid-pair request or fallback POST occurs during rotation. |
| 12:17:45 | Server readback matches B/generation2. Both registration objects equal their pre-rotation values exactly. |
| 12:18:26 | Explicitly rescheduling the alarm to12:21 returns POST200. This later scheduling POST is separate from rotation. |
| 12:21:00–01 | Campaign has B1/A0, one accepted transport attempt. Actual native receipt at12:21:01.434 has the exact campaign eventId and cityIndex0; tap=false. One receipt observed through cleanup. |
| 12:21:54–12:23 | Both exact test IDs DELETE200; app/server settings zero. Diagnostic app removed and simulator restored to shutdown; temporary raw token/registration files removed. |

Campaign ID: `a24e3a14ba11c09495d9fd44dd37c6f1144650ff98324573d34532476c8bf8b3`. This retry verifies the fixed native rotation and real scheduled FCM/APNs receipt for this controlled simulator campaign, without synthetic tokens/callbacks or `simctl push`. It does not establish delivery for every historical request. Physical devices, Android, natural rotation without null, ordinary S09 permission UI, notification tap/banner presentation and conditional alerts remain untested. The source/test/CI code has not changed since its passing automated checks and independent reviews.
