# IN-04: AK's decisions and the adopted design (2026-11-15)

AK read the proposal ([design.md](design.md)) and its four open questions and decided:

| Question | Decision (AK, 2026-11-15) |
| --- | --- |
| Acceptance level | The same as the Android native app (AN-04, #2883). |
| Background completion | The same as the Android native app. |
| Which stores gate the merge; a Mongo conformance run | Withdrawn. The iOS app is a client and uses the production API as it is. Modelling or verifying the server's stores is not part of this task. |
| Re-checking the production store on the host | Withdrawn, for the same reason. |

The proposal's `reassertRequired` bit, the verification of the list post's answer body, the three
store models and the conformance tool are therefore **not adopted**. `design.md` and
`test-design.md` stay as the record of the proposal. `evidence.md` and the store semantics in
[push notifications](../../../architecture/push-notifications.md#registration-semantics-per-store-checked-2026-11-15)
stay as facts about the server; they set no requirement for the app.

## Adopted design: the Android behaviour (AN-04) on iOS

Reference: `android/core-data/.../PushSync.kt`, `android/app/.../PushTokenWorker.kt` and the section
"Push re-registration" of `android/README.md`.

- **One registration at a time.** `PushSync` reads the stored state, builds the Cordova requests,
  sends them one after the other waiting for each answer, and then stores the token, whether or
  not a request succeeded. Tokens B then C are replaced A→B, then B→C.
- **Open:** once per open of the app, after the migration: repair the records, `PUT` for a
  changed token (a first token also posts the list), then the list post when a token exists. Not
  at a process start in the background.
- **A token that changes while the app runs** is stored as pending work in order of arrival
  before anything is sent. Android gives it to WorkManager; iOS has no such service, so it is a
  small queue file in the app's storage. The work runs in this process, or at the start of the
  next process (in the foreground or in the background) when this one ends first. It then builds the
  `PUT` from the token stored at that time, as the Android worker does.
- **Failed requests are not retried**; the token is stored anyway and the next open posts the list.
- Requests (path, headers, body), `Device-Id`, `type: "ios"` and the record repairs stay as the PR
  has them.

Removed from PR #2975: the replacement log and its recovery rounds, the token history, the ordered
recovery, and the Cordova timing (the list post three seconds after the open, sends that are not
awaited) with its timed golden files. The timing was a Required finding of review round 1
(CODEX-IN04-1); the Android app does not reproduce it, so under AK's decision it is not an
acceptance criterion. The PR's first commit (`d3c156f3`) already had this shape (`PushSync` and
`PushTokenQueue` ported from Android) and is the starting point.

## Tests, as for Android

| #2953 criterion | Test |
| --- | --- |
| Requests equal the Cordova iOS requests (first, unchanged, changed token) | The request golden files from the Cordova `Push` service (`PushRegistrationTests`); kept. |
| The simulator upgrade test passes for both token cases | The upgrade harness with `token-a` and `token-b` against the local recorder; kept. |
| An interrupted token replacement is completed by the next process | As Android's `PushTokenWorkTest`: a token arrives, its `PUT` stays in flight, the process ends; the next process sends the `PUT` with the previous token as `oldToken` and stores the token. |

Unit tests of `PushSync` follow Android's `PushSyncTest`: consecutive tokens are replaced in order;
a token that arrives during the open's registration waits for it; nothing is sent or stored
without a server URL or `Device-Id`; a store that cannot be written fails nothing.

Review scope under this decision: an outcome on the server that the Android app has as well is
not a Required finding for the iOS app.

Not implemented yet. The next review of PR #2975 needs AK's go-ahead, because the task's ten review
rounds are used.
