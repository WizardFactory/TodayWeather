# IN-04 test design (revised 2026-11-15)

Companion to `design.md`. Scope (AK, 2026-11-15): the legacy Node server only; server2 is not considered. This is the plan for the tests; no test listed here as new has been written or run. Verification mode: TDD (each new behaviour is shown failing first), plus a conformance check of the test server models against the real server code, plus the simulator upgrade smoke.

## 1. What went wrong in the tests before

| Gap | Effect | Fix here |
| --- | --- | --- |
| One server model for three push stores | Rounds 8–10 reasoned about Mongo semantics only; the production store (S3 coordinator) was never modelled. | Three named models, section 2. |
| The model merged duplicate documents until round 8 | The duplicate class was invisible to 2,000-seed runs. | Models are checked against the real server code, section 3. |
| The reply was a status code | A list post answered 200 with a failed item counted as success. | Replies carry the answer body; section 4, class Error. |
| Scenarios were added one per review round | Each round found the next input the generator did not produce. | The scenario classes are fixed up front, section 4. |

## 2. Three store models and their oracles

The Swift test models live in `ios/Core/Tests/TWDataTests/`. They share a request reader, not a merge rule.

| Model | Identity | State the oracle reads | "Registered once under T" means |
| --- | --- | --- | --- |
| `CoordinatorModel` (S3 coordinator) | Device from `uuid` (or the `Device-Id` header); records by `(category, cityIndex, id)` | Device objects with endpoint token and generation, superseded markers | The device of `uuid` has endpoint T, not superseded, and holds every posted record once. |
| `MongoModel` (the code default and rollback) | Document key `(type, cityIndex, id, registrationId or fcmToken)`, alarms and alerts in separate collections | The documents as a **multiset** | For every record, exactly one document with token T; no key has two documents under any token the client moved onto. Documents under older tokens are reported, not failed. |
| `SQLiteModel` | `rec_key`, UNIQUE per table | Rows per table | For every record, one row with token T. |

Every answer has a status and a body. The list post's body is one item per record, `null` for a failed item.

## 3. Conformance: the models are checked against the real server code

A tool under `ios/tools/push/` (tools may read `server/`) runs **the real server modules** on recorded request transcripts and writes a golden file. A Swift test replays the same transcripts through the three models and compares every answer and the state after every request.

| Server code run | How | Status |
| --- | --- | --- |
| `server/lib/pushCoordinator/registry.js` with the route middleware's command mapping (`ipc.js`) | Plain Node, an in-memory object for the storage interface (`list`, `get`, `put`); no dependency | **Feasibility checked today:** the real `Registry` ran six requests and showed last-writer-wins and the no-op `PUT` (design evidence, section 2.1). |
| `server/lib/pushStore/mongo.js` with `route.push.update.list.js` and `routePushNotification.js` | The existing module-stubbing harness (`server/test/offline/push-harness.js`) with an array-backed model double for the Mongoose calls the adapter makes (`update` with `upsert` or `multi`, `find`, `save`, `remove`), which keeps colliding documents | A prototype exists from review round 8. The double models MongoDB primitives, not the adapter; this limit is recorded in the golden file. |
| `server/lib/pushStore/sqlite.js` | Needs the locked `sql.js` dependency (`NODE_PATH`) | Run when the dependency is present; otherwise reported as not run. Not a merge gate: SQLite is not deployed and cannot duplicate. |

Required transcripts (each must distinguish at least two models):

1. Seed under A; `POST` list B; `PUT A→B`. Coordinator: one device at B. Mongo: two documents per record under B. SQLite: one row.
2. Seed under A; `PUT A→B` lost; `POST` list B; `PUT B→A`. The live Cordova collision: Mongo two under A.
3. `PUT` from a token nobody holds: 200 everywhere, no change.
4. `POST` list B, then a stale `POST` list A: the coordinator's endpoint goes back to A; Mongo and SQLite gain rows under A.
5. A list post in which one record fails to save: 200 with `null` in that position (Mongo); 503 for the whole request (coordinator).
6. The same `(cityIndex, id)` as an alarm and as an alert: never merged.
7. A record with a truthy `registrationId`: Mongo and SQLite key by it, not by the token.
8. First token: `PUT` without an old token answers 403 before any store is touched.

The golden file records the commit and SHA-256 of each server file it ran. CI regenerates the coordinator and Mongo parts and fails on a difference, as it does for the other generated goldens.

Not modelled in the Swift models, and stated as such: two list posts whose alert `find`/`save` steps interleave inside the Mongo adapter (evidence, section 8). It is kept as one hand-built transcript that shows the duplicate, so the limit stays visible.

**The models must be able to fail.** Four deliberate changes to the models are run once against the transcripts, and each must be caught: merging Mongo duplicates; one shared key function for all three models; a coordinator model that keys by token; a SQLite model that rejects a colliding `PUT`. (The last two are the errors one design candidate made from reading alone.)

**Limit of the Mongo run.** The array-backed double stands in for MongoDB itself. Running the real adapter against a disposable MongoDB needs a container and the locked server dependencies; it is not run unless AK allows that (design, open question 3), and is then reported as not run rather than passed.

## 4. Scenario classes

Each scenario runs on all three models unless noted, with each request's effects applied completely before the next (the condition of the design's proof). The test harness schedules three things independently: when a request's effect is applied, when its reply arrives, and when the process ends. A request of an ended process can still be applied. `T` tokens are A, B, C; records are one alert and one alarm in one place plus a current-position record.

| Class | Scenarios | Expected |
| --- | --- | --- |
| Normal | First token over nil and over ""; unchanged token; changed token at the open; token 1 s and 4 s after the open; two tokens before the post; no records | The 15 timed goldens unchanged (send times, order, paths, headers, bodies). The oracle of section 2 holds after the last request. |
| Error | `PUT` answered 403, 500, 503, or never; list post answered 403, 503, never, 200 with `null`, 200 with a wrong item count, 200 with a body that is not JSON | No acknowledgement without a complete answer; no request is repeated inside the process. The three timed goldens with failed requests keep their request lists: in `failed-requests` the bit stays set; in `failed-put-before-post` and `slow-failed-put` the later list post succeeds and clears it, although the `PUT` failed. |
| Boundary | Blank and whitespace tokens (callback and SDK read); tokens that differ only in UTF-16 code units; a token event exactly at the post's deadline; an SDK read that returns after the deadline; more than 64 token changes | JavaScript semantics as now; no capacity effect. |
| Retry and duplicate | The same pending state recovered by two and by three successive processes; the list post applied but its reply lost; the acknowledgement write failing; `start` and `open` called twice | One recovery post per process at most; repeating it changes no count in any model. |
| Transition | Process end at every operation (each state write, each send) of: a changed token at the open, a first token, a token after the post, A→B→C, A→B→A. Then the next process as a foreground open and as a background start. | After the next process's list post is answered completely: the oracle holds, nothing was removed, and recovery sent no `PUT`. |
| Concurrency | A callback during the open's SDK read (older value dropped); a blank callback during the read (read kept); a token event while a list post is unanswered; an older post's success arriving after a newer intent | The newest token wins; an old answer never clears a newer pending state. |
| Launch kind | Pending state with a foreground launch: no extra request before the open's post at 3 s. Pending state with a background launch: one list post. Background launch, then the open | The foreground trace equals the goldens; the background start completes without an open. These run through `start` and `open` together, as `PushService` calls them: a test that calls only `open` would not see an extra post at the start. |
| Shared state | Another writer saves the app state (units, a place) while a token event or an acknowledgement is being written | The token and the bit survive: every writer goes through the repository's read-modify-write. |

### Known outcomes that are asserted, not hidden

These run on `MongoModel` and assert the outcome the design accepts, with the same request sequence the Cordova code produces (taken from the timed goldens or built from the Cordova rules):

- Transcript 2 (a token value that returns while documents remain under it).
- A live `PUT` applied after a later list post (out of send order).

If the maintainer decides these must not happen, the tests fail by design and the decision reopens the design.

## 5. Property generator

Kept, with these changes:

- It runs per model, and reports which model a failing seed belongs to.
- Its oracle is the table of section 2.
- Its event sources are fixed here and not grown per review round: token changes and callbacks at any time; launches with and without FCM's callback; blank values; SDK read latency; single failed reads and writes of the app state; replies lost, late or failed, including a list post answered with `null`; process ends at any operation; foreground and background launches.
- Seeds that failed in rounds 5–9 stay as fixed regression inputs.

## 6. Existing tests

| Test | Disposition |
| --- | --- |
| `PushRegistrationTests` (request goldens), `PushTimingTests` (15 timed goldens), `HTTPPushTransportTests`, `PushReplyTests` | Keep. The reply gains the answer body. |
| `PushSyncTests`, `PushRecoveryTests` | Keep the crash-injection technique (`ProcessEnd`) and the reviewer reproductions as scenarios; rewrite the assertions that name the replacement log. |
| `PushPropertyTests` | Keep, per section 5. |
| `ServerModel` | Replaced by the three models. |
| `PushReplacementLogTests` | Removed with the log. |
| `PushServiceTests`, `PushUpgradeTests`, the upgrade harness | Keep. The recorder must answer a list post with a result array, as the servers do; today it answers `{}`, so no post would count as acknowledged. |

## 7. Smoke (unchanged in kind)

The simulator upgrade test in both storage modes with an unchanged and a changed token, against the local recorder: every migrated alarm and alert registered once with the same `Device-Id` and `type: "ios"`, no request to a production host. Added: the recorder's state is read as the coordinator model reads it (one device, the endpoint token), since that is the production store.

## 8. Not covered

- Real APNs and FCM tokens on a device (IN-14, IN-19).
- The production coordinator itself; the evidence of its deployment is dated 2026-10-06 and 2026-10-16.
- Requests reordered by the network, beyond the two asserted outcomes above.
