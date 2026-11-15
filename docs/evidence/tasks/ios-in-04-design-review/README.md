# IN-04 design re-review — 2026-11-15

Record of the design re-review of iOS push re-registration (IN-04,
[#2953](https://github.com/WizardFactory/TodayWeather/issues/2953),
[PR #2975](https://github.com/WizardFactory/TodayWeather/pull/2975) at head `a8fd96e1`).
It is a design and a test design. **Nothing in it is implemented, and no new test was
written or run.** AK answered the proposal's open questions on the same day: the iOS app
follows the Android native app, and the proposal is not adopted. Read
[decision.md](decision.md) first.

## Why it was done

The PR's review reached the limit of ten rounds with one finding open (CODEX-IN04-15).
AK asked for the cause and then for the design and the test design to be redone before
any further implementation. The causes found:

- "Completed by the next process" (#2953) was never defined as a state of the server.
- The legacy server has three push stores with different rules. The design, the test
  model and the reviewer reasoned about the Mongo store only, which is not the store
  the dated evidence shows in production.
- The token was stored at the token event, which removed the repetition at the next
  launch that the Cordova and Android apps rely on, and made a durable log necessary.
- The test server model merged duplicate documents until round 8, and a reply was a
  status code without the answer body.

## Scope decisions (AK, 2026-11-15)

- The legacy Node server (`server/`) is the development basis.
- server2 is not considered in this work. An earlier draft compared server2's push
  state as well; that part was removed from these files.

## Files

| File | Content |
| --- | --- |
| [decision.md](decision.md) | AK's decisions and the adopted design: the Android behaviour (AN-04) on iOS, and its tests. |
| [evidence.md](evidence.md) | The facts the design rests on: the issue's requirements, the three legacy push stores per operation, what the Cordova and Android apps do, the PR's state, the review history by cause. |
| [design.md](design.md) | The proposal, not adopted: registration "completed" defined per store, the latest token plus one `reassertRequired` bit, recovery by the list post only, residual cases, alternatives and the open questions. |
| [test-design.md](test-design.md) | The proposal's tests, not adopted: three store models with their oracles, the conformance check of the models against the real server modules, fixed scenario classes, and the disposition of the existing tests. |

The store semantics are also maintained in
[push notifications](../../../architecture/push-notifications.md#registration-semantics-per-store-checked-2026-11-15).

## Method and limits

- Sources read at `origin/master` `141b6adf` for `server/`, `client/` and `docs/`; the
  cited push files are unchanged at `434ec250`. `ios/` at the PR head `a8fd96e1`.
- Three design candidates were written independently from one brief and the evidence
  file: Codex (gpt-6.1-sol, high), Gemini (4 Argon, high) and the coordinating agent's
  own sketch. A Grok seat returned no output (HTTP 429). A fresh Codex session judged
  the three without their authors' names. The judge is of the same model family as the
  selected candidate; the coordinating agent checked the judge's fact findings against
  the sources. The candidates and the verdict are kept local-only; the decision and
  its reasons are in the design's section "Synthesis decision".
- Run: the real `server/lib/pushCoordinator/registry.js` in Node with an in-memory
  storage object, on six requests. It showed one device throughout, the endpoint token
  following the last applied request, and a `PUT` from an unknown token answering
  `{n:0}` without a change.
- Not run in this review: the Mongo and SQLite stores, the iOS tests, any simulator
  or device, any request to a server.
- Not re-checked: which store production uses. That evidence is dated 2026-10-06
  ([verification](../push-reliability-2683/verification.md)) and 2026-10-16 (#2626).
