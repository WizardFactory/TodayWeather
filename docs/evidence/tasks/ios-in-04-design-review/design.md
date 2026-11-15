# IN-04 design, revised: latest intent and one reassertion bit (2026-11-15)

Status: **proposed, not implemented.** Scope (AK, 2026-11-15): the legacy Node server (`server/`) is the development basis; server2 is not considered in this work. It replaces the design note of IN-04 in `plans/ios-native.md` (that section is on the PR branch) once AK has answered the open questions at the end. Evidence: `evidence.md`. Tests: `test-design.md`. PR #2975 (head a8fd96e1) stays as it is until then.

## Problem

Keep the device's alarms and alerts registered on the server under its current FCM token, across the app's open, token changes while it runs, and a process that ends at any point.

What made the earlier design fail review ten times:

- "Completed by the next process" (issue #2953) was never defined as a server state. The design replayed requests and called an empty log completion.
- The legacy server has three push stores with different rules (`evidence.md`, section 2). Only one was modelled, and not the one in production.
- One request has the same meaning on all three when its effects are applied one request at a time: **the list post with the current token** leaves every posted record registered under that token. The token replacement (`PUT`) has no such property. In the Mongo store it can double records, and on the S3 coordinator a late one sets the token back.

Constraints that stay: the Cordova live timeline (15 timed goldens), the legacy server as it is (no server change), no removal by the client, no test mode in app code.

## Completed, defined

For the device UUID `U`, the current token `T` and the local records `R`:

| Server | The registration is complete when |
| --- | --- |
| S3 coordinator (production) | `U`'s device object has endpoint `T`, is not superseded, and holds every record of `R`. |
| Mongo store (the code default and rollback) | Every record of `R` has a document with token `T` and the posted settings; starting from no duplicate under `T`, exactly one. Documents under older tokens may remain. |
| SQLite store (rollback option) | Every record of `R` has its row with token `T`. |

It does not mean that older tokens' documents are gone, nor that a notification was delivered.

## Usage (the caller's view)

`PushService` adapts UIKit and the Firebase SDK. It holds no token, no pending work and no request logic.

```swift
// Once the migration finished and the Device-Id is known; the launch kind comes from UIKit.
await sync.start(launch: application.applicationState == .background ? .background : .foreground)

// The first activation of the process (Cordova's Push.init).
await sync.open()

// MessagingDelegate, in arrival order.
await sync.receive(token: fcmToken)

// Later sub-issues enter the same owner (IN-11, IN-12, IN-14):
try await sync.savePlace(index: index, records: edited)   // posts that place's records
try await sync.updateUnits(units)                          // posts the list
try await sync.removeCity(index: index)                    // the user's DELETE
```

No caller receives request lists or waits for replies.

## Shape

### Durable state: one file, one new field

`app_state.json` (one atomic write) keeps `push.fcmToken` and `push.records` and gains:

```swift
push.reassertRequired: Bool   // absent decodes as true
```

- `fcmToken` is the **latest accepted token** (the intent), written before the requests of that token event start. This is what the PR does today; the stored-token assertions of the goldens stay.
- `reassertRequired` means: no complete list post has been verified for the current token, records and units.
- There is no replacement log, no token history, no sequence numbers, and no second file.

### Rules

| Event | Local change (one write) | Requests |
| --- | --- | --- |
| Token event, valid and different | `fcmToken = new`, `reassertRequired = true` | As Cordova, at once and not awaited: `PUT {newToken, oldToken}`; for a first token with records also the list post. |
| Same or blank token | none | none |
| Open | repaired records if they changed (`reassertRequired = true`) | The list post 3 s after the open began, with the token current then (Cordova). |
| Start, foreground | none | none. A pending reassertion rides on the open's post, so the foreground trace is exactly the goldens. |
| Start, background | none | When `reassertRequired` and there are a token and records: one list post. |
| A list post answered completely | `reassertRequired = false`, only when no newer intent and no newer post started since | none |
| Any other answer (`PUT`, failure, `null` item, lost reply) | none | none. Nothing is repeated inside the process. |
| A failed state write | the previous state stays | No request of the new intent is sent; the next event tries again. |

Two rules carry the design:

1. **Recovery is the list post only.** A later process never sends a `PUT` again and never posts an older token's list. It cannot move documents onto documents.
2. **Only a verified list post discharges the obligation.** Verified means status 200 and an answer that is an array with one non-null item per posted record. A `PUT`'s answer proves nothing about completeness, in either direction.

Before every list post the bit is set (when it was false), so a post that fails, or whose effect is unknown, leaves the obligation. An older post's success cannot clear it after a newer one started (in-memory counters of intents and posts; they are not stored).

Kept from the PR: the actor with the Cordova timeline and virtual clock, replies resumed exactly once, the ordered token observations (an SDK read that overlapped a callback is dropped; a blank value is no observation), the `isFirst` and `accepts` predicates, store and transport behind protocols for failure injection.

### Signature sketch

```swift
public actor PushSync {
    public init(repository: any PushRepository, transport: any PushTransport,
                tokens: any PushTokenProvider, clock: some Clock<Duration>,
                context: @escaping @Sendable (AppState) -> PushRegistration.Context?)
    public enum Launch: Sendable { case foreground, background }
    public func start(launch: Launch)
    public func open()
    public func receive(token: String)
}
public protocol PushRepository: Sendable {          // the app's single serialized state writer
    func load() throws -> AppState?
    func update(_ change: @Sendable (inout AppState) throws -> Void) throws
}
public struct PushResponse: Sendable { public let status: Int?; public let body: Data? }
```

`PushRepository.update` is a read-modify-write on the current file, so another writer's stale copy cannot overwrite the token or the bit. IN-07's `AppStateHolder` is that writer once both are merged.

## Why it holds, per store (effects applied one request at a time)

| Case | S3 coordinator | Mongo store | SQLite store |
| --- | --- | --- | --- |
| Token change, `PUT` applied | Endpoint moves to the new token. | Documents move; the target is a token never posted before, so nothing collides (see residual 1). | Rows move. |
| Token change, `PUT` lost or failed | The next list post (the open's, or a background start's) sets the endpoint by UUID. | The next list post creates the documents under the new token. The old token's documents stay. | As Mongo. |
| Process ends after the state write, at any later point | The token and the bit are on disk. The next process's list post completes it, whether or not the `PUT` reached the server. | Same; no `PUT` is replayed, so nothing doubles. | Same. |
| Process ends before the state write | Nothing of the new token was sent. The next process gets the token from the SDK. | Same. | Same. |
| List post applied, reply lost; or the bit's write failed | The bit stays; the post is repeated by a later process and changes nothing. | Repeating finds the documents and updates them. | Upsert. |
| List post answered 200 with a failed item | (The coordinator answers 503 for the whole post.) The bit stays. | The bit stays; the next post supplies the missing record. | As Mongo. |

## Residual cases (stated, tested as known outcomes)

1. **A token value that returns while documents remain under it, Mongo store only.** `PUT A→B` fails, the list post creates B's documents, then the token returns to A and the live `PUT B→A` doubles A's records. Cordova sends the same requests. FCM does not reissue a replaced token in normal operation.
2. **Two list posts whose alert saves interleave, Mongo store only** (`find` then `save`, no unique index). Cordova's own timeline has this overlap (a slow first-token post and the open's post). A background repair overlapping the open's post is the same mechanism and is the client's own addition; it is why a foreground start sends no repair of its own.
3. **Effects out of send order, and requests of an ended process applied late.** On the S3 coordinator the last applied request decides the token until the next list post. No client-side state can fence a request already sent.
4. **Lost local state, no usable SDK token, or a process that never gets to post.** Nothing is invented; the bit stays.

Residual cases 1 and 2 need the Mongo store. The dated evidence has production on the S3 coordinator, where neither can occur; they matter after a rollback to the Mongo store.

## Synthesis decision

Method: `architect` with `arena`. Seats: Codex (gpt-6.1-sol, high), Gemini (4 Argon, high), and the lead's own sketch written before reading them. Grok dropped out (usage limit, HTTP 429). The judge was a fresh Codex session reading the three anonymized; it is the same model family as one candidate, which is a limit of this run. The lead read all three and the sources.

| Candidate | Shape | Decision |
| --- | --- | --- |
| Codex | Latest intent + `reassertRequired`; recovery by list post; verified by the answer body | **Base.** No factual error found; the only candidate with a per-server proof and its conditions named. |
| Gemini | `seq`/`ackedSeq` watermark + 64-token `issued` ring; live `PUT` answers advance the watermark | Rejected. Its server models were wrong (the coordinator keyed by token and city, a SQLite key error that does not exist, wrong `PUT` fields), and a `PUT`'s 200 cannot certify a registration. Taken from it: the reply carries status and body. |
| Lead sketch | Stored token = last list post started, plus a confirmed token | Rejected. The judge's traces are right: a token event before any list post is not durable, so a background start does not see it; and suppressing a returning token's `PUT` can leave the registration under the wrong token. |

## Tradeoffs accepted

- Older tokens' documents can remain in the Mongo store after a lost `PUT` (never removed by the client), in exchange for never doubling records in recovery.
- Two small state writes around each list post, in exchange for an obligation that survives a failed or uncertain post.
- A background start may post the list once more than strictly needed, in exchange for not depending on the next open.
- The returning-token history (`issued`) is dropped: the live `PUT` follows Cordova, in exchange for one rule instead of two and no bounded history to reason about.

## Alternatives considered

| Shape | Why it lost |
| --- | --- |
| Replay log of replacements (rounds 3–7) | The server cannot make a replayed `PUT` safe in the Mongo store; remembering what was sent cannot tell applied from lost. Two files, a prefix rule and a capacity. |
| Post the newest list, remove older tokens (round 8) | A removal can delete the only registration (a 200 with a failed item; a late removal). |
| Post the newest list, `PUT` only to tokens never issued (round 9, the PR's head) | Correct in outcome, but it keeps the log and a token history whose corruption needs its own rule (CODEX-IN04-15), for a case Cordova has too. |
| Android's order (send, await, then store the token) | Waiting for replies breaks the Cordova timeline that rounds 1–2 required. |
| No bit; rely on every open's post | Simplest. It completes only at the next open, not at a background start, and has no place to record a post that failed. |

## Migration of PR #2975

- Keep: `PushRegistration` (requests, repairs, predicates), the timeline, `PushReply`, the virtual clock, the ordered observations, the golden files, `PushService`'s token bridge.
- Change: the transport returns status and body; `PushSync` takes the repository and the launch kind; the recorder of the upgrade test answers a result array.
- Delete: `PushReplacementLog`, `PushLogStore`, `sentHere`, `inOrder`, the recovery rounds, `issued`, and their tests.
- No import of `push_replacements.json` is needed: no build with it has shipped.

## Open questions for AK

1. **Acceptance level.** Is "complete under the conditions above, with residual cases 1–3 the same as or narrower than Cordova on each legacy store" the bar? The alternative, no duplicate under any request ordering, cannot be met by any client without a server change.
2. **Background completion.** Keep the one list post at a background start (the bit), or complete only at the next open as Cordova does (no bit at all)?
3. **Stores that gate the merge.** Proposed: the S3 coordinator (production) and the Mongo store (code default) gate it, and SQLite is run when its dependency is present. For the Mongo store, may the test tooling run the real `mongo.js` against a disposable local MongoDB (a container), or is an array-backed double of the Mongoose calls, with its limit recorded, enough?
4. **Production store.** The evidence that production runs the S3 coordinator is dated 2026-10-06 and 2026-10-16. Should it be re-checked on the host (read-only) before the implementation relies on it?

## Next implementation step

After the answers: write the three store models and their conformance transcripts first (`test-design.md`, sections 2–3), then change the transport's reply, then replace `PushSync`'s recovery, each test-first.
