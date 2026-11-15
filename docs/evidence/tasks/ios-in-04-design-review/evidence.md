# IN-04 design re-review: evidence (2026-11-15)

Frozen facts for the design of iOS push re-registration (IN-04, #2953, PR #2975, head a8fd96e1). Source revisions: `origin/master` 141b6adf for server and docs (the cited push files are unchanged at 434ec250); PR head a8fd96e1 for `ios/`. Paths are repository paths.

Scope (AK, 2026-11-15): the legacy Node server (`server/`) is the development basis, and server2 is not considered in this work. An earlier draft of this file also described server2's push state; that part was removed.

## 1. What the issue requires (#2953)

- When the app is opened, after the migration, do what the Cordova `Push.init` does: repair the records, replace a changed token (`PUT /v000903/push` with `newToken` and `oldToken`), then post the list (`POST /v000903/push-list`). Same `Device-Id`, `type: "ios"`.
- "A token that changes while the app runs is stored as pending work and is completed in a later process if this one ends first."
- Completion criteria:
  1. Unit tests compare native requests with Cordova iOS requests (first, unchanged, changed token).
  2. The simulator upgrade test passes for both token cases: every migrated alarm and alert is registered once with the same `Device-Id` and `type: "ios"`.
  3. "A test shows that a token replacement interrupted by the end of the process is completed by the next process."
- Constraints (#2948): the legacy server is used as it is, no server changes; the parity oracle is the Cordova iOS build; no test, mock or dry-run mode in app code.
- The issue does not define "completed" in terms of the server's stored state.

## 2. Which push stores the legacy server has

The review rounds 3–10 modelled one store only (`server/lib/pushStore/mongo.js`). The legacy server has three, selected by `PUSH_STORE`, with different semantics.

| Store | Status | Evidence |
| --- | --- | --- |
| S3 push coordinator (`PUSH_STORE=s3`, `server/lib/pushCoordinator/`) | **Production** for `/*/push` and `/*/push-list` | `docs/evidence/tasks/push-reliability-2683/verification.md` (2026-10-06: one coordinator process online on the host; a live token matched S3 generation 1); #2626 comment of 2026-10-16 ("the production coordinator"; a first-token POST "returned 200 and restored both settings with B, generation 2"). Not re-checked on the host today. |
| MongoDB (unset, the code default) and SQLite (`PUSH_STORE=sqlite`) | Code default and rollback paths | `server/lib/pushStore/index.js`, `mongo.js`, `sqlite.js`; `docs/architecture/push-notifications.md`. |

### 2.1 Semantics per operation

`T` is a token, `U` the device UUID (`uuid` in each posted record; the S3 middleware also takes it from the `Device-Id` header).

| Operation | S3 coordinator (production) | Mongo store (code default) | SQLite store |
| --- | --- | --- | --- |
| Identity of a record | Device `sha256(product, type, 'uuid', U)`; inside it `(category, cityIndex, id)`. One endpoint token per device. `registry.js` `upsert` L161–260. | Document key `(type, cityIndex, id, registrationId or else fcmToken)`. `mongo.js` `keyQuery` L26–35. | `rec_key` = the same key, UNIQUE. |
| `POST /push-list` with token T | Sets the device's endpoint token to T (generation +1 when it differs) and merges the posted records. Also merges any other device object holding T. Durable before the reply. Idempotent. | Upserts each record by its key: creates documents under T when none exist. Documents under other tokens are untouched. Alerts: find, then save or update (not atomic). | Upsert by `rec_key`. |
| Answer of `POST /push-list` | 200 with `[{n:1,nModified:1,ok:1}, …]`; validation 403; store failure or timeout 503. All records or none. `ipc.js`. | 200 with one item per record; **a record whose save failed is `null`** in the array (the batch helper logs the error and continues, `route.push.update.list.js` L52–67). | As Mongo. |
| `PUT /push {newToken, oldToken}` | Every device whose endpoint is `oldToken` gets `newToken`; when another device object already holds `newToken`, the two are merged. No device holds `oldToken`: nothing changes, 200. `registry.js` `rotate` L262–308. | Sets the token of every document holding `oldToken` (`update` with `multi: true`, `mongo.js` L52–58). **A document moved onto a key that another document already has stays beside it**: two documents, two notifications. | Every record of `oldToken`; on a key collision the newer record is kept (`sqlite.js` L138–155). |
| `PUT` without `oldToken` | 403 | 403 (`routePushNotification.js` L113–157) | 403 |
| `DELETE /push {fcmToken[, cityIndex, id, category]}` | Removes the device's matching records. | Removes matching documents of the token. | As Mongo. |
| Duplicate cleanup | Not needed (one endpoint per device). | `removeDuplicateAlarms` groups by `registrationId` and skips groups without one (`mongo.js` L66–100): **FCM-only duplicates are never removed**. | No duplicates by construction. |
| A request that arrives late (stale) | Last writer wins: a stale `POST` or `PUT` can set the endpoint back to an older token, until the next post. | A stale `POST` creates documents under its old token; a stale `PUT` can move documents onto documents. | As Mongo without duplicates. |
| Unregistered token at send time | The endpoint generation is disabled. | The token's records are disabled (`controllerPush.js` L1052, `alert.push.controller.js` L673). | As Mongo. |

### 2.2 What follows

- **Common to all three:** `POST /push-list` with the newest token is an idempotent upsert, and the state it leaves has every posted record registered under that token. No other request has this property everywhere.
- **Only in the Mongo store** can a client create duplicates: a `PUT x→T` applied while documents already exist under T (posted earlier, or left from an earlier `PUT`).
- **Only in the S3 coordinator** does request order decide the token: the last applied request wins.
- **A 200 answer of the list post is not proof in the Mongo store**; the answer body is (an array without `null`).

## 3. What the Cordova app does (`client/www/js/service.push.js`)

- `_tokenFreshCallback` (L813–828): a blank or non-string token is ignored. A token different from `pushData.fcmToken` calls `_updateFcmToken(token)`; for a first token (no stored token) with records it then posts the list and calls `savePushInfo()`.
- `_updateFcmToken` (L292–315): sends `PUT {newToken, oldToken: pushData.fcmToken}` without waiting, then sets `pushData.fcmToken = token` **in memory**. It does not persist. Failures are logged; nothing is retried.
- `Push.init` posts the whole list 3 seconds after the open, with the token current then.
- **Persistence:** on a non-first token change the stored token stays the old one until some other save (an alarm edit, a first token). So at every later launch the stored token differs from FCM's, and Cordova sends `PUT {new, old}` again and posts the list again 3 seconds later. This is how Cordova "completes" an interrupted replacement: it repeats it at each launch.
- In the Mongo store this repetition itself duplicates records when an earlier `PUT` failed and the list post succeeded (documents under both tokens, then the repeated `PUT` moves the old ones onto the new ones). Under the S3 coordinator it is harmless.
- The post body carries `uuid` and the header `Device-Id`; the `PUT` carries only the header.

## 4. What the Android app does (AN-04, merged; `android/core-data/.../PushSync.kt`)

- Registrations run one at a time under a mutex. Each reads the stored state, sends its requests, awaits them, **then** stores the token, "whether or not a request succeeded".
- A process that ends before the store leaves the old token; the next start sees a different FCM token and repeats `PUT` and the list. A queued token (`onNewToken`) is completed by WorkManager.
- No replacement log, no replay order, no removal. Reviewed PASS in two rounds.

## 5. What the iOS PR does now (a8fd96e1)

- `PushSync` actor (283 lines), `PushReplacementLog` (140 lines: entries `{id, old, new, acked}`, acknowledged-prefix trimming, capacity 64, `issued` values), ordered token observations, `inOrder`, recovery rounds; tests 1,490 lines (`PushRecoveryTests`, `PushPropertyTests`, `ServerModel`, `ProcessEnd`, …).
- The token is written to the state as soon as the replacement is logged (round 2: "the token changes when its replacement is sent"), which removed Cordova's and Android's repetition at the next launch and made a durable log necessary.
- Recovery posts the newest token's list; a `PUT` goes only to a value not in `issued`.
- Timed goldens from the Cordova code (15 cases: `PUT` at the token event, list post 3 s after the open, sends not awaited) pass. These were Required in rounds 1–2 (CODEX-IN04-1) and must keep passing.

## 6. Review history, by cause

| Rounds | Findings | Cause |
| --- | --- | --- |
| 1–2 | CODEX-IN04-1 (3 s timeline), -2, -3 | Cordova timing not modelled at first; fixed with timed goldens. |
| 3–7 | -4 … -11 | "Completed by the next process" was built as a replay log without a definition of the server state it must reach; each fix added a path. |
| 8–10 | -12 … -15 | The server was modelled as one store (Mongo adapter, and a test model that merged duplicates). The production store (S3 coordinator) and the answer body of the list post were never read. |

## 7. Other Cordova push operations (later sub-issues, same owner)

`updatePushListByCityIndex` (post one place's records, save), `removePushListByCityIndex` (`DELETE {cityIndex, fcmToken}`), `updateUnits` (post the list), `updateCityInfo` (post one place's records). IN-11, IN-12 and IN-14 add them; they use the current token.

## 8. Corrections found by the candidates (verified in source, 2026-11-15)

- **The list post is idempotent only when its effects are serialized.** In the Mongo store an alert is saved by `find` then `save` (`mongo.js` `upsertAlert`), the alert schema has no unique index on the logical key, and the list route runs its items concurrently (`async.map`). Two overlapping list posts can therefore both create the same alert. Cordova's own timeline has such an overlap (a first-token post at 1 s and the open's post at 3 s when the first is slow).
- **"All records or none" for the S3 coordinator holds for one device object.** A merge of two device objects writes them one after the other (`registry.js` `persist`); a failure between them can leave partial objects, and a 503 does not prove that nothing was written.
- **Answer shapes of the list post differ per item:** a Mongo alarm upsert and an alert update answer a write result (`{n, nModified, ok}`), a created alert answers the saved document, the S3 coordinator answers `{n:1, nModified:1, ok:1}`. A failed item is `null`.
