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
journal length between snapshots (at most 1,024 entries, read 8 at a time). Rejected: one S3 object per
record (76k GETs to restore), a single whole-state object (66 MB rewrite per change), local-disk
state (tokens on disk; S3 stays the source of truth).
