Task: issue-2703-s18a; sources: [intent](../intent/issue-2703.md), [spec](../specs/issue-2703.md); base 1d60f728.

# Plan: server2 S18a push registration state

## Paths (declared in `server2/config/tasks/S18a.json` before dependent edits)

- Owned: `server2/src/push/`, `server2/tests/state.rs`, `server2/tests/state/`,
  `server2/tools/state/`, `server2/config/tasks/S18a.json`; additive lines in `server2/src/lib.rs`
  (`pub mod push;`) and `server2/Cargo.toml` (two `[[example]]` entries for the copy tools).
- Outside: `docs/architecture/server2.md` (push/notice state only), `intent/issue-2703.md`,
  `specs/issue-2703.md`, `plans/issue-2703.md`. `plans/issue-2614.md` is left to the root coordinator.

## Split

- S18a (this PR): registration contracts, ordered S3 state, restore, one-time copy.
- S18b: delivery (alarm minute selection, alert evaluation, message text, provider adapter with no
  hidden retries, delivery ledger, sanitized diagnostics, no resend after failure/unknown/restart,
  the push warning feed deferred by S12). Uses S18a state and the v000902 weather shapes (S17).
- S18c: notices. Legacy has no notice route or store (#2623 open). Options for AK: wait for #2623
  and port it; build `GET /v000903/notice/latest` natively from the #2623 design (S3 catalog,
  stable numeric IDs); or drop notices from S18.

## Ordered work

1. Intake, split and declaration comment on #2703.
2. Pinned legacy oracle (task evidence outside the repository; fixture and provenance committed).
3. Red: parity, durability/fault, S3 peer and copy tests under `server2/tests/state/`.
4. Build `js`, `express`, `mongoose`, `store`, `routes`, `ejson`, `durable`, `service`, `migrate`
   and the two tools.
5. Read-only production copy: export, convert, local peer import/restore/re-run, delete the files.
6. Green; `cargo fmt --check`, clippy `-D warnings`, `cargo test --locked --workspace`, release
   builds, placement gate, artifact policy; docs; PR, CI, Codex review until PASS.

## User scenarios

| ID | User / goal | Prerequisites and steps | Expected result / failure | AC |
| --- | --- | --- | --- | --- |
| U1 | App user registers alarms and alerts | `PUT` without an old token, then `push-list` with an alarm and an alert, repeat, rotate the token, delete a city | Legacy bytes: 403 `invalid body`, upsert result and saved alert document, update results, rename counts, removal counts; state equals the oracle after each step | AC1 |
| U2 | Old app or malformed client | Validation, cast and transport cases (oracle scenarios) | Same status, message and headers as legacy, including TypeError and CastError text | AC1 |
| U3 | App user after host replacement | Registered state in S3, new process with empty memory | Same records restored; registrations keep working | AC2 |
| U4 | Operator during an S3 fault | Refused, lost, committed-but-lost, unreadable and hanging writes | No success without a durable entry; legacy store-error answer; void entries; late commits applied in order | AC2, AC3 |
| U5 | Operator with overlapping writers | Importer or a second process commits first; 24 concurrent requests | Conflict caught up and planned again; contiguous journal; identical restore | AC3 |
| U6 | Operator copies legacy registrations | `mongoexport` of both collections; converter; importer twice | Malformed documents reported by position and reason; every field kept; second run unchanged | AC4 |
| U7 | Reviewer checks placement | Placement gate with S18a declaration | PASS; no legacy path read at runtime | AC5 |

## Live calls

- 2026-10-15: one read-only session to the legacy MongoDB (`buildInfo`, `count`, `find` on
  `pushes` and `alertpushes`; MongoDB 3.4.15; 42,226 and 34,216 documents). Credentials were read
  in-process from `server2/.env` and never printed. The export and converted file stayed in ignored
  `reports/` and were deleted after the local check. No push provider, AWS or production write.

## Rollback, risks, rejected alternatives

No process wiring: the routes stay on legacy until S20, so a revert has no runtime effect. Risks:
replica-set reply metadata absent from bodies (the app ignores bodies); rare exotic body shapes
beyond the oracle (documented subset of `util.inspect` and Date strings); restore time grows with
journal length between snapshots (1,024 entries, read 8 at a time; more while snapshot writes keep failing). Rejected: one S3 object per
record (76k GETs to restore), a single whole-state object (66 MB rewrite per change), local-disk
state (tokens on disk; S3 stays the source of truth).

## S18b-1 scheduled alarm delivery

Task: issue-2703-s18b-1; base 915978bb (started on a9b3a23d); date 2026-10-16; declaration
`server2/config/tasks/S18b-1.json` ([record](https://github.com/WizardFactory/TodayWeather/issues/2703#issuecomment-6205966857)).

- Paths: `server2/src/push/deliver/` (worker, weather requests, text, FCM adapter, ledger, internal
  store operations, embedded locale subset), small additions in `server2/src/push/` (`store.rs`
  query keys and `due`, `service.rs` internal operations, `js.rs` helpers, `routes.rs`
  visibility), `server2/Cargo.toml`/`Cargo.lock` (`ring`), `server2/.env.example`,
  `server2/tests/delivery.rs`, `server2/tests/delivery/`. Outside: this plan, the intent and spec,
  and the S18b-1 section of `docs/architecture/server2.md`.
- Split: S18b-2 conditional alerts (`alert.push.controller.js`), S18b-3 the S12-deferred push
  warning feed, S18c notices (`GET /v000903/notice/latest`, AK 2026-10-16), each its own PR.

| ID | User / goal | Steps | Expected | AC |
| --- | --- | --- | --- | --- |
| A1 | App user with a daily alarm | Minute with due alarms (KMA, DSF, geocoded, TodayAir) | Same weather requests, title/text and FCM request as legacy | B1 |
| A2 | App user with weekday alarms | Due alarm on an excluded local weekday | Not sent | B1 |
| A3 | User whose app was removed | FCM `NOT_FOUND` | Token's alarms disabled durably; outcome recorded | B3 |
| A4 | Operator during FCM errors | 503, timeout, reset | One request each; `rejected`/`unknown` recorded; no resend | B2 |
| A5 | Operator replacing the host | Second process at the same minute; next minute | Nothing resent; next minute delivered | B2 |
| A6 | Operator during an S3 or state fault | Refused claim; unrestored state | Nothing sent, minute skipped with a sanitized note | B2 |
| A7 | Privacy review | Read diagnostics and ledger | No token, coordinate or name | B4 |

Checks: `cargo fmt --check`, clippy `-D warnings`, `cargo test --locked --workspace`, release
build, placement gate with the S18b-1 declaration, artifact policy, Codex review until PASS, CI.

Live calls: none. The oracle runs offline (HTTPS/weather doubles); tests use loopback doubles and
the public RFC 7515 A.2 example key. No push, FCM, APNs, OAuth, AWS or weather provider call.

Rollback and risks: no process wiring, so a revert has no runtime effect. Risks: FCM may change
error bodies (classification follows firebase-admin 5.13.1 and falls back to status codes);
weather requests depend on `SERVICE_SERVER`/`API_SERVER` (legacy HTTP API) until S20 points them
at server2's routes; a minute with an unknown claim outcome that cannot be read back is skipped
(missed rather than duplicated). Rejected: per-delivery claim objects (one PUT per send; a
minute claim gives the same no-resend guarantee with one object), retries inside the minute
(D02), local-disk ledgers (tokens and state stay in memory and S3).

## S18b-2 conditional alerts

Task: issue-2703-s18b-2; base `9fed989e806408f3502867c01e111caca1188326` (stacked on S18b-1);
owner: delegated conditional-alert lane; root owns shared state, integration and merges.
Paths are declared before implementation in `server2/config/tasks/S18b-2.json`. Runtime,
fixtures and smoke stay in server2; exact outside exceptions are maintained docs, this
intent/spec/plan, operator PDF and selected sanitized evidence. No runtime reads of legacy.

| Scenario | Actions | Expected result | Verification |
| --- | --- | --- | --- |
| C1: user crossing rain/air threshold | Eligible minute, current or forecast weather and current air | Same parsed input, decision, updated state and localized message as legacy | 133 original offline actual-controller cases, six URL cases, 11 supplemental malformed-row/first-match and 12 air-filter traversal cases |
| C2: disabled or outside-window registration | Normal/overnight endpoints and either category's six-hour gate | Inclusive boundaries; no send inside cooldown | Selection regression |
| C3: overseas outage | Old (>30 min) response; exact boundary | Old observation skipped; 30 min accepted | Oracle cases |
| C4: provider failure or restart | Rejected, reset and hanging peer; restore S3 state | One attempt, durable timestamps, no resend | Worker fault/restart regressions |
| C5: unavailable S3 or concurrent user edit | Refused claim/state write; HTTP registration change during fetch | No unsafe send; newer user state preserved | Fault and concurrent HTTP regression |
| C6: operator smoke | Run synthetic example against local HTTP weather/OAuth/FCM peers, restart | One submission and weather GET, zero resends/external calls | `cargo run --locked --example conditional_alert_smoke` |

Checks: fmt, Clippy warnings denied, full Rust suite, additional local functional HTTP smoke,
placement and artifact gates, diagram finalization/browser/visual checks, manual PDF render and
visual review, independent PR review, CI. Keep required logs under ignored `reports/s18b2/`;
selected facts are in [verification](../docs/evidence/tasks/issue-2703-s18b2/verification.md).
No live push or new weather provider call: the weather API validity checks from the earlier
S13/S15b source work are reused. FCM HTTP-v1 documentation was checked read-only on 2026-10-16.

## S18b-3 execution plan (2026-10-16)

Separate task `issue-2703-s18b3`; branch `feat/2703-s18b3-warning-feed`, base
`82356a95`. Its owner is the delegated S18 agent; root owns integration. The
execution notebook is `.planning/2026-10-16-s18b-3-warning-push-feed/` locally;
tracked paths are declared in `server2/config/tasks/S18b-3.json`.

1. Record actual Node16 legacy feed/selection/message/date identities twice and
   preserve source hashes. Add failing behavior tests for silent baseline/new feed,
   time/zone selection and durable no-resend before implementing the source port.
2. Add conditional S3 feed publication and the S12 post-persistence sink. Preserve
   acknowledged state on errors and verify interrupted event/head writes separately.
3. Add the warning worker library: restore current S12 zones, baseline old feed,
   group new events, resolve configured native geocode, select enabled alert windows,
   deduplicate endpoints and claim before one FCM attempt. Keep open fresh campaigns
   for newly eligible registrations; never retry claimed attempts or resume startup.
4. Run focused delivery and warning tests only after coordinating a build slot.
   Cover releases/expiry, S3 failure/unknown writes, two workers, cancellation,
   registration changes, rejected/unknown send and restart; assert actual synthetic
   submission counts. Run a separate actual loopback HTTP functional smoke.
5. Update architecture, operator manual and visually checked PDF, plus a separate
   warning diagram (preserve the existing conditional diagram). Validate declared
   paths, dependency boundaries, staged and every outgoing artifact snapshot.
6. Independent required review/corrections, optional reviewer attempts, fresh CI,
   then a pre-merge receipt with `merge_authorized: false`. No actual push, production
   data writes or deployment. S20 alone owns startup/native-route/worker activation.

S18c follows as its own backend/API, publishing CLI and S3 state PR under #2623;
client/web popup implementation and SQLite migration are excluded from this sequence.
