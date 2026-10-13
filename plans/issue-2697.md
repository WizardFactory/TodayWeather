Task: issue-2697-s12; sources: [intent](../intent/issue-2697.md), [spec](../specs/issue-2697.md); base ca8735cf.

# Plan: server2 S12 warnings

## Paths (declared in `server2/config/tasks/S12.json` before dependent edits)

- Owned: `server2/src/warnings/`, `server2/tests/warnings/`, `server2/tests/warnings.rs`,
  `server2/tools/migration/`, `server2/examples/warnings_smoke.rs`,
  `server2/config/tasks/S12.json`; additive lines in `server2/src/lib.rs`
  (`pub mod warnings;`) and `server2/Cargo.toml` (one `[[example]]` for the seed importer).
- Outside: `docs/architecture/server2.md` (warning sections only), `intent/issue-2697.md`,
  `specs/issue-2697.md`, `plans/issue-2697.md`. `plans/issue-2614.md` is left to the root coordinator.
- Not touched: `server2/src/providers/*`, `server2/src/storage/*`, `server2/src/gateway/*`,
  `server2/src/main.rs`, `server2/tools/ci.py`, `.github/workflows/server2.yml`.

## Ordered work

1. Declaration and issue comment; copy zone table and recorded provider fixtures with provenance.
2. Red: tests in `server2/tests/warnings/` (golden parity, text/zone parsers, store recovery,
   type 4 boundaries, interruption faults, collector with loopback stub, seed tool).
3. Build `text`, `zones`, `provider`, `records`, `store`, `special`, `service`, `collector`, `seed`.
4. Green, refactor, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`,
   `cargo test --locked`, placement gate and its tests.
5. Release smoke: `cargo build --release --example warnings_smoke`, then
   `python3 tests/storage/catalog_peer.py --smoke target/release/examples/warnings_smoke`.
6. Update warning sections of `docs/architecture/server2.md`; commit, push, PR, CI, Codex review loop.

## User scenarios

| ID | User / goal | Prerequisites and steps | Expected result / failure | AC |
| --- | --- | --- | --- | --- |
| U1 | App user opens the warning list after host replacement | Seeds and provider bulletins published to S3 seven days ago; empty memory; providers disabled; GET `/v000903/kma/special` with `accept-language: ko` | Same bytes/ETag as S02 `warning-week-old`; 304 for matching `if-none-match`. Failure: S3 unavailable with empty memory gives 501 | AC1 |
| U2 | App user reads a recent weather flash | Type 4 announced 2026-09-27 09:10 KST; request at actual +10 h, +19 h and +19 h + 1 ms | Flash present at +10 h and +19 h, absent at +19 h + 1 ms; bytes equal goldens | AC2 |
| U3 | App user sees town warnings | Zone seed and pwn-cd day pages in S3, empty memory; resolve `specialInfo` for 서울/종로구 | Legacy list order/fields; empty list for an unknown province | AC1, AC4 |
| U4 | Operator survives an interrupted publication | Acknowledged older bulletin; newer acquisition fails at raw PUT, descriptor PUT or catalog CAS (peer fault) | Older acknowledged bulletin still served; complete orphan group repaired or ignored; no partial group served | AC3 |
| U5 | Operator imports legacy seeds locally | mongoexport-style file; run export converter, then importer against loopback peer; non-loopback endpoint attempt | Seeds become served latest bulletins; non-loopback endpoint refused before any request | AC4 |
| U6 | Collector ports provider acquisition | Loopback stub serving recorded getPwnStatus/getWthrWrnMsg/getPwnCd/getWthrPwn/getWthrInfo/getWthrBrkNews bodies; quota error variant | Type 1-4 published once per announcement; zone state replayed; quota ends cycle without publication | AC4 |
| U7 | Reviewer checks placement | Placement gate with S12 declaration and base ca8735cf | PASS; no legacy path literals | AC5 |

## Rollback, risks, rejected alternatives

The route stays on legacy until S20 cutover; this PR adds no process wiring, so revert
has no runtime effect. Risks: provider-derived document key order is unverified against
production (S19 shadow); cold walk-back cost grows with gap length (bounded by
`lookback_days`); zone rebuild reads up to 60 day catalogs on a cold request.
Rejected: a separate latest marker object (can disagree with the serving commit);
monthly partitions (type 1 member counts can exceed the 2048-entry catalog bound);
persisting derived zone state (normalized view, not permitted).
