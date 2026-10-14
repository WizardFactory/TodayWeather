Task: issue-2747-s13d; owner: Claude builder (S13d worktree); revision/base: 05c06c67; date: 2026-10-14.
Inputs: [intent](../intent/issue-2747.md), [spec](../specs/issue-2747.md). Declaration: [S13d.json](../server2/config/tasks/S13d.json).
Design stage: skipped with reason. The change bounds existing waiters and lengthens existing owned
deadlines; the only new structure is the keyed owned-flight primitive described in the spec. The
S07 resolver sequence diagram stays valid at its level of detail.

# Plan

## Scenarios

| ID | User and goal | Steps | Expected / failure | AC and proof |
| --- | --- | --- | --- | --- |
| T1 | Operator: slow but working KMA provider | Town forecast and RSS stubs answer after 4 s; owned deadline 25 s | Both acquisitions complete with one call each (base: 3 s timeout fails) | AC1; `providers::acquire::slow_town_forecast_and_kma_page_succeed_within_legacy_timeouts` |
| T2 | Reviewer: timeout per service | Map every family path and AirKorea/KASI/zone/warnings/VC paths | Legacy values; unknown path keeps 3 s | AC1; `each_service_uses_its_legacy_attempt_timeout` |
| T3 | App user behind a slow acquisition | Resolver acquisition takes 4 s; caller deadline 9 s | Waiter returns at about 3 s; owner publishes; next request and a cold restart serve the record; one provider call (base: nothing published) | AC2/AC3; `resolver::wire::slow_acquisition_outlives_the_waiter_and_serves_the_next_request` |
| T4 | Many app users in different cells, one national dataset | 6 locations started 150 ms apart (12 concurrent in the base Red run), same scope; slow 4 s and fast 300 ms | One acquisition in both cases; slow: every waiter bounded, later each location served; fast: every waiter served (base: 12 acquisitions) | AC4; `national_scope_is_acquired_once_for_many_locations` |
| T5 | Same, at the primitive | 50 joiners on `("airkorea-station", "2026101410")`; fast variant; shorter attempt deadline; other keys; expiry, capacity and panic | One start; Pending within 3 s; retained Ready; bounded Busy/Expired | AC2-AC4; `resolver::owned::*` |
| T6 | Same, real AirKorea transport and S3 | 24 cell requests on the station list; stub 4 s; S3 test peer | All Pending within 3 s; one provider call; record read back from S3 | AC3/AC4; `formats::national::*` |
| T7 | Overseas app user, slow VC | Gateway, native `dsf`; stored records from earlier fetches; VC 4 s | 200 from stored records within the attempt; owned fetch publishes; next request byte-equal to the legacy oracle; one VC call per fetch | AC2/AC3; `air::waiter::slow_vc_answers_from_stored_records_and_the_next_request_includes_the_fetch` |
| T8 | Overseas app user, slow air, short gateway deadline | Gateway deadline 2 s; WAQI 2.5 s | 200 with `airStatus` pending before 2 s; next request carries the air data (oracle bytes); one WAQI call | AC2/AC3; `air::waiter::slow_air_is_omitted_then_included_with_one_provider_call` |
| T9 | Pollen day+3 | Row with only `twodaysaftertomorrow` | Accepted and stored byte for byte (base: invalid) | AC5; `pollen_day_three_only_row_is_accepted_and_stored` |
| T10 | Reviewer: placement | Placement gate | Only declared paths | AC6 |

## Files

- `server2/src/providers/{transport,public,mod}.rs`: per-service legacy timeouts.
- `server2/src/domestic/{family,format}.rs`: service/web attempt timeouts, owned provider time,
  pollen field.
- `server2/src/history/capture.rs`: capture deadline from the legacy attempts.
- `server2/src/resolver/{owned,flight,backend,mod}.rs`: shared owned acquisition and the bounded waiter.
- `server2/src/world/engine.rs`: 150 ms assembly margin.
- Tests listed above; `server2/tests/formats/smoke.rs` shares its S3 peer.
- Docs: this record, `docs/architecture/server2.md` (S13d section, S07/S13/S14 sentences),
  `docs/operations/server2-resolver.md` and its regenerated PDF/evidence.

## Checks

```
cargo +1.99.0 fmt --check
cargo +1.99.0 clippy --locked --workspace --all-targets -- -D warnings
cargo +1.99.0 test --locked --workspace
python3.11 server2/tools/gateway_smoke.py --binary <release>
python3.11 server2/tools/world_smoke.py --binary <release>
python3.11 server2/tools/kma_smoke.py --binary <release>
bash server2/deploy/smoke.sh --binary <release> --skip-reused
python3 server2/tests/storage/catalog_peer.py --smoke <release>/examples/resolver_smoke
python3.11 server2/tools/check_placement.py --root . --declaration server2/config/tasks/S13d.json --base <base>
python3 scripts/check-artifact-policy.py --staged / --range
```

Red evidence: the T1, T3, T4 and T9 tests were run against an unmodified `origin/master` tree
(`git archive`) and failed there.

## Rollback and blast radius

Library behavior only; no route is switched. Revert the PR to restore the fixed 3 s timeouts and
the per-response resolver acquisition.
