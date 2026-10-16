Task: issue-2702-s17; owner: Claude builder (S17 worktree); revision/base: 1d60f728; date: 2026-10-15.
Inputs: [spec](../specs/issue-2702.md), [issue #2702](https://github.com/WizardFactory/TodayWeather/issues/2702).
Declaration: [S17a.json](../server2/config/tasks/S17a.json). Design stage: skipped with reason; the
request flow is the existing S10 gateway/S15 backend sequence with one router list per version.

# Plan

## S17a scenarios

| ID | User and goal | Steps | Expected / failure | Proof |
| --- | --- | --- | --- | --- |
| A1 | Android user on the unversioned path opens Seoul weather | Gateway `/weather/coord/{lat,lon}` with the native `kma-v000901` switch | Golden `gateway-default-domestic` bytes and headers; legacy default and rollback unchanged | `kma_gateway::native_v000901_and_v000902_reproduce_s02_gateway_goldens_and_roll_back` |
| A2 | Old app on `/weather/v000901` or `/weather/v000902` | Gateway with one version native, then both | Each version switches alone; goldens hold in every phase | same test |
| A3 | v000901 user with air data and forecasts | makeAirInfo/AirForecast paths: AirKorea and KAQ forecasts, empty, 태하리, unknown source, error, stale first station, dust forecasts | Same bytes as legacy (`airInfo`, upper-case icons) | `kma_parity::all_v000901_and_v000902_oracle_scenarios_match_legacy_bytes` |
| A4 | Users in other regions, locales, clock and history states | 85 S15 scenarios on v000901, 29 on v000902 | Byte parity, calls in legacy order; two declared forwards | same test; `s02_v000901_and_v000902_goldens_equal_recorded_oracle_bodies` |
| A5 | Cell the source cannot supply | Source forwards | Same request takes the legacy hop; no invented body | `listed_versions_are_selected_and_a_source_without_inputs_forwards` |
| A6 | Operator enables the entries | `SERVER2_NATIVE_FAMILIES=kma-v000901,kma-v000902` on the release binary | Listed versions answer natively (S3 reads, loopback acquisitions, no legacy KMA hop); v000903 stays legacy; legacy phases return identical bytes; bad lists refused | `tools/kma_smoke.py`, `kma_version_entries_are_separate_routing_switches` |
| A7 | Reviewer checks placement | Placement gate with S17a.json | Only declared paths | `check_placement.py`, `test_placement.py` |

## Order

1. Intake declaration comment; record the oracle (both routers), check S02 goldens.
2. Red: `tests/legacy_versions` against the base (missing version-aware API).
3. Green: router lists, `makeAirInfo`, `AirForecast`, upper-case icons, version parsing and
   registration, routing entries. Mutation checks (wrong icon case, list air steps) fail parity.
4. fmt, clippy, full workspace tests, release smoke, placement, artifact policy; docs.
5. Commit, push, PR, CI, Codex review loop, issue status. S17b and S17c follow in their own PRs.

## Checks

`cargo +1.99.0 fmt --check`; `cargo +1.99.0 clippy --locked --workspace --all-targets -- -D warnings`;
`cargo +1.99.0 test --locked --workspace`; `python3 server2/tools/kma_smoke.py --binary <release>`;
`python3 server2/tools/check_placement.py --root . --declaration server2/config/tasks/S17a.json --base <merge-base>`;
`python3 server2/tools/test_placement.py`; `python3 scripts/check-artifact-policy.py --staged`.

## Rollback and blast radius

A library change selected only by `kma-v000901`/`kma-v000902`; v000903 is unchanged (its router
list is the same table). Since S15b-4a the listed versions answer natively from S3 with request-time
acquisition of missing forecast inputs, as `kma` does.
Revert the PR or remove the entries to roll back. Production switches remain S20.

## S17b scenarios

| ID | User and goal | Steps | Expected / failure | Proof |
| --- | --- | --- | --- | --- |
| B1 | Old app calls `/v000901/kma/addr` or `/v000903/kma/addr` directly | `kma-v000901`/`kma` listed; GET, revalidate with the ETag, HEAD | Golden status, body and headers; 304 with Express headers; HEAD without body; no legacy hop | `kma_direct::listed_direct_routes_reproduce_the_s02_goldens_natively` |
| B2 | Old app calls `/v000803/town` | `town` listed; GET and revalidation | `domestic-v000803(-304)` on the wire | same test; `kma_parity::all_town_oracle_scenarios_match_legacy_status_and_bytes` |
| B3 | Very old app calls `/v000705/town` (and sub-routes) | `town` listed | 200 `application/json` empty body without ETag (`domestic-v000705`); sub-route outcomes as legacy | same tests; `town_status_replies_and_declared_forwards` |
| B4 | Request with a non-Korean region | `/v000803/town/중국/...` | 400 text as legacy | `town_status_replies_and_declared_forwards` |
| B5 | The native assembly still yields `Outcome::Legacy` (a town absent from the town list, the S15 `next(err)` cases) | Source or assembly forwards | Legacy reply passes unchanged (status, headers, body, 304) | `forwarded_direct_requests_return_the_legacy_reply_unchanged` (a source answering Forward) |
| B6 | Operator leaves the entries unlisted | Default list | Paths stay unclaimed (404 as before), no S3 read | `unlisted_direct_routes_keep_the_previous_reply`, `tools/kma_smoke.py` |

Order: town recording and S02 cross-check; Red (tests against S17a: missing `api`,
`parse_town_path`, `Outcome::Undefined`); town lists, `getSummary`, `dataToFixed`, the
`rn1Str` `+`; direct routes, envelope and hop; runtime entry; fmt, clippy, tests, smokes,
placement, artifact policy; PR stacked on S17a; Codex review; CI.
