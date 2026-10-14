# Execution plan: S13c (server2 side of #2745)
Owner: Claude (Anthropic), main context. Inputs: [spec](../specs/issue-2745-s13c.md), legacy records `intent/issue-2745.md` in [PR #2746](https://github.com/WizardFactory/TodayWeather/pull/2746). Endpoint: pre-merge (no merge, no deployment).

## Ordered work
1. Declaration ([issue comment](https://github.com/WizardFactory/TodayWeather/issues/2745#issuecomment-6171093382), amended for the recorded fixture before its edit) and `server2/config/tasks/S13c.json`.
2. Red: update the two tests that asserted "quota stops" and add five tests in `server2/tests/formats/legacy_sources.rs`; `KeyRing::exhausted` as a stub. Result: 7 of 16 AirKorea tests failed.
3. `server2/src/domestic/acquire.rs`: per-entry exhaustion, KST day end, key loop and per-page recheck. Green: 16/16.
4. fmt, fresh clippy, `cargo test --locked --workspace`, placement gate, artifact policy.
5. Live: one 서울 station request with the operator keys through the acquirer and the local S3 peer (temporary uncommitted test target).
6. `docs/architecture/server2.md` (S13b keys paragraph, S13c section). Commit, push, PR, CI, Codex review loop; stop at merge-ready.

## User scenarios
| ID | User / goal | Steps → expected | Covered by |
| --- | --- | --- | --- |
| S1 | S14 capture job: acquire AirKorea data although the selected key is at quota | last key answers 429/22 → key exhausted until KST midnight → previous key completes, is remembered | `airkorea_quota_moves_to_the_next_key_and_is_remembered`, `airkorea_every_quota_form_moves_to_the_next_key` |
| S2 | Capture job when every key is at quota | one call per key → `Provider(Quota)`; later calls that KST day spend no units; next day probes | `airkorea_all_keys_at_quota_wait_for_the_next_kst_day` |
| S3 | Mixed credential and quota failures | exhausted key skipped, credential failures rotate → `Provider(Quota)`; all-credential stays `Auth` | first test above; `airkorea_keys_follow_legacy_with_keys` |
| S4 | Quota during pagination, or caused by a parallel acquisition | restart at page 1 with the next key; no repeated page; no further funding of the exhausted key | `airkorea_quota_on_a_later_page_restarts_with_the_next_key`, `airkorea_key_exhausted_by_a_parallel_call_is_not_used_for_later_pages` |
| S5 | Per-second limit | code 23 stops without rotation | `airkorea_every_quota_form_moves_to_the_next_key` |

## Rollback and blast radius
Library only (no route or scheduler wires AirKorea acquisition yet). Rollback: revert the commit. Riskiest point: exhaustion must never block a key past its KST day (tested at `KST_MIDNIGHT - 1` and `KST_MIDNIGHT`).
