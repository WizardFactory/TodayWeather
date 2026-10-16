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

## S17c scenarios and evidence

S17c is a new functional slice following merged S17a/b. Their completed review
history is retained and is not reset. Declaration: `server2/config/tasks/S17c.json`.

| ID | User goal and actions | Expected result | Evidence |
| --- | --- | --- | --- |
| C1 | Open current nation weather | Fifteen native cities in legacy order, city air fields removed, seventeen province rows when all present | Node16 legacy nation oracle; HTTP GET/HEAD/304 smoke |
| C2 | Open old v000901 nation weather | Same-version internal calls; actual child failure gives legacy 500; healthy calls give 200 | Oracle success and child 500/404 scenarios |
| C3 | Request several regions while the national provider is slow | One national acquisition, one shared three-second deadline, available response now and saved result next time | Twelve concurrent requests and 3.2-second owned test acquisition |
| C4 | Restart with providers disabled | New memory reconstructs all seventeen province averages from S3 raw records | Two independent AirInputs instances over the loopback S3 peer |
| C5 | Stored averages are absent, stale, invalid or future | Correct representative-point fallback, freshness boundaries and safe reason/coverage | Actual legacy NationAir and observation.evaluate oracle; S3 fallback tests |
| C6 | Revalidate, use HEAD, units or malformed route parameter | Express envelope and rendered error semantics; no legacy call | Real HTTP handler; unit/error oracle; URI regression |

Provider evidence is reused from S15b-3a's actual national observation request
(2026-10-14, 672 stations, `numOfRows=1000`), because S17c adds no provider method.
The authoritative API catalog is
[AirKorea atmospheric observations](https://www.data.go.kr/data/15073861/openapi.do).
The source register and recording limits are in
`server2/tests/nation/PROVENANCE.md`. No production request, database write, push
send, AWS change or deployment is part of this slice.

S17c local verification at integrated base `80ecf56b`: Rust workspace **694 passed,
0 failed, 2 ignored** (slow image/life boundary sweeps); ten nation tests passed.
All-targets Clippy with warnings denied, formatting and the placement gate passed.
The additional actual HTTP smoke uses the public Gateway/DirectRoutes handler,
with a closed legacy origin and GET/HEAD/revalidation on both nation versions.
The thirteen-case Node16 oracle was reproduced byte-for-byte. The one-page API
manual was rendered with PyMuPDF (Poppler unavailable) and inspected; Archify
artifact checks, actual Chrome inspection and four light/dark viewport captures
were verified separately. Review and CI remain required before readiness.

S17c QA1 on `1eb3a7bf` found two Required compatibility issues: uppercase-version
child selection (S17C-R1-F01) and forwarding the parent cookie locale to children
(S17C-R1-F02). Three actual-legacy cases were added to the pinned oracle (16 total).
Both new regressions failed before the routing correction and passed afterward;
all twelve nation tests passed, including the prior ten HTTP/S3/deadline scenarios.
The earlier 694-test full-workspace result is retained as baseline evidence, not
claimed rerun for this narrow routing change. Independent QA2 remains pending.
