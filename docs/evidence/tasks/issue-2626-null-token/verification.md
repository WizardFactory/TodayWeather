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

The modified native simulator build succeeds with a test-only iOS15 deployment override and standard Xcode simulator signing. A fresh native run is **not executed**: simctl waits in Xcode's first-launch/version check (wrapper expects CoreSimulator1174.9.2; installed framework1171.7). Waiting task-owned calls were interrupted; no new production settings or notifications resulted. No global Xcode installation, permission, service or security policy was changed to obtain a PASS. The pre-fix native receipt is not relabeled as post-fix evidence.

The first old=null PUT403 and valid-PUT failure persistence/retry behavior remain outside this guard fix. This observation does not establish that a production app update is required for delivery; the existing POST path already recovered this controlled case.
