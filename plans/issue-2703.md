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

Task: issue-2703-s18b-1; base a9b3a23d; date 2026-10-16; declaration
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
