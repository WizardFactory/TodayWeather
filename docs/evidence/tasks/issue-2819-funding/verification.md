# Selected geocoder funding — local verification

2026-10-18. Base `1e31ac1ee91e916f9c36162ff474c4386b36ecd4`; independent B1
correction for [#2819](https://github.com/WizardFactory/TodayWeather/issues/2819).
This is local behavior evidence, not cutover or quota qualification. The candidate
commit is bound by the PR record; runs used the uncommitted source bytes later
committed without runtime edits.

## Regression and checks

Three new tests failed on unchanged runtime before the fix: Google exhaustion
blocked complete Kakao, unused Kakao exhaustion blocked Google address lookup,
and local Kakao key0 exhaustion prevented trying key1. Each failed the expected
success assertion; compilation and peer setup succeeded. The test filter also
selected one existing passing configured-endpoint test.

After the change: 64 gateway tests and 93 library tests passed (157 total),
including S08 funding, exact response bytes, address persistence, fallback, key
rotation, cache/single-flight, waiter cancellation and HTTP/deadline coverage.
A paused-clock funding delay test stops at the existing five-second owner
deadline and observes no late HTTP. This also follows from the existing outer
owner timeout: the test does not independently establish the inner funding timeout
or remaining-time calculation. Those checks are additional source-level guards. All-target clippy `-D warnings` and Rust
format checks passed. Tests use synthetic credentials and owned peers.

Commands from `server2/` (Rust1.99.0, macOS ARM64, dev/test debug and incremental
compilation disabled for this task; shared ignored target):

```sh
cargo test --locked --offline -j2 --test gateway
cargo test --locked --offline -j2 --lib
cargo clippy --locked --offline -j2 --all-targets -- -D warnings
cargo run --locked --offline -j2 --example geocode_funding_smoke
```

## Additional integrated smoke

The [example](../../../../server2/examples/geocode_funding_smoke.rs) composes the
real Geocoder and FundedQuota with owned loopback HTTP and volatile conditional
S08 objects. Google is deliberately exhausted first using a synthetic one-unit
daily limit. A Korean lookup succeeds with the expected country/KMA projection;
the cache returns equal bytes; the foreign Google lookup is denied without HTTP.
The peer is stopped and awaited. Actual bounded report:

```json
{
  "foreign_google_denied_without_http": true,
  "google_authority_after": 1,
  "google_authority_before": 1,
  "google_http": 0,
  "kakao_authority_after": 1,
  "kakao_http": 1,
  "kma_projection_preserved": true,
  "live_provider_calls": 0,
  "production_eligible": false,
  "scope": "owned-http-volatile-budget",
  "synthetic_daily_limit": 1,
  "verdict": "PASS",
  "warm_matches_cold": true
}
```

Report SHA-256: `fc1770e4c0b4cce98c1aa3a5b989515fd10f8932a192821a60a72631da8df4a4`.
Smoke executable SHA-256: `c003789a613d5516f03351b105ce53529277989e10605e41ceb45ec2604474b7` (native macOS dev build, retained outside Cargo target).
Source maps and raw original/green/smoke output remain in ignored task evidence.
Synthetic one-unit authorities make this example's counts legible. Real S08
authority blocks can reserve multiple units; authority usage is not a wire counter.
Funding after selection is conservative and never refunded if cancellation or
deadline intervenes before send. Built-in allowance values did not change.

## Placement, docs and limits

[Funding2819 declaration](../../../../server2/config/tasks/Funding2819.json)
precedes dependent edits. Implementation remains under server2, without legacy
runtime reads, new settings or modes. Architecture, verification instructions,
plan and [illustrative contract flow](../../../architecture/diagrams/server2-geocode-funding.html)
are updated. Archify showcase artifact/browser checks pass; light1440 and
dark2048 captures were inspected separately. This is a bug correction, not a
new product feature/UI; existing PDF snapshots are not relabelled as new runs.

No live provider, production-key/account quota measurement, live S3, cloud
mutation, push send, deployment, merge or shadow run occurred. This B1 result
does not resolve B2/B3 or qualify a production/recovery release. C1 PR2820's
CI is separate; its earlier whole-run weather502 deadline failure is not
attributed to or fixed by this funding change. Current remote CI and independent
review are required before readiness.

## Review correction: existing shadow budget oracle

FUND-CLAUDE-001 identifies GW-BUDGET's old assumption that all16Kakao keys and
Google are charged per lookup. The selected correction uses one Kakao key with
64units and keeps Google configured but unused. It tests bounded per-key exhaustion
with65distinct requests, then verifies a warm result and refusal of a new cold
lookup without provider work. This preserves the purpose without treating per-key
limits as a shared16-key total. The declaration adds the existing Python tool
before dependent edits. Its original failure and corrected execution are retained
in the PR task record.

FUND-CLAUDE-002: quota-rejection metrics now count denied key admissions and can
increment even when another key succeeds. They are not failed-request counts.
FUND-CLAUDE-003's downstream integration/towns results are recorded with the
correction. FUND-CLAUDE-004's outer-timeout limitation is stated above; no
claim of an independent inner-timeout test is made.

Correction results: the unchanged old GW-BUDGET oracle failed on the new release
with65successes and0quota failures, reproducing FUND-CLAUDE-001. The corrected
single-key run passed:64successes,1quota501,64Kakao HTTP,0Google budget objects,
then1warm hit and1new quota501 with no provider work. Both runs use the same
optimized native loopback executable; only the Python scenario changed.
`cargo test --test integration` passed3tests and `cargo test --test domestic towns`
passed18tests (146filtered); together with the original157,178tests passed locally.
The filter includes both direct towns and source towns regression cases. These
macOS results do not replace current Linux CI. Raw reports, hashes and readonly
review iterations remain in the ignored task record.
The Python shadow-tool controls passed31tests. Runtime Rust source and the
contract JSON/HTML are unchanged since the original successful checks, so their
clippy, example and diagram evidence is reused by exact hashes.

A second reviewer recommendation (FUND-CLAUDE-005) exposed shared-peer test
isolation: EMPTY-RESTORE+BUDGET retained3Google objects from the first scenario,
so a whole-peer zero-object assertion failed on otherwise correct behavior.
The original order failure is retained. The final oracle compares Google object
keys against the pre-scenario set. That supported selection passes with3existing
and0new Google objects; the complete default8-scenario smoke also passes
(cold/warm, empty restore, single flight, cancellation, outages, budget, pressure,
SIGTERM drain). The existing one-key quota and no-provider-work checks remain.
These are owned loopback processes with the same retained release executable,
not a live mirror, provider call, production Spot interruption or native cutover
recovery rehearsal.

## Shared inventory oracle correction (CI-INVENTORY-001)

The current C1 and B1 Linux CI runs both reached the combined native factory
inventory and returned the established direct KMA dependency-error response where
the test required200. The setup deliberately has no weather history, real time
and unreachable recorded-provider roots. `api::native` already answers dependency
failure or its3second deadline with502 `Bad Gateway\n`; the existing public-route
regression independently verifies that response and zero legacy forwarding.

For only the four direct KMA/town read groups, the inventory now accepts the
successful native response or that exact502, including body, length, ETag,
Express/CORS headers and absence of cache-control/nosniff. Every successful-body
assertion and acknowledged-state restore check remains. It does not accept404,
arbitrary5xx or empty502 error responses. This corrects a route/error-contract test; it does
not establish weather availability, cold latency or fix D2. No production timeout,
peer mode, test-thread policy or runtime behavior changed. Original failed CI
and bounded diagnostic evidence remain retained; final current CI is still required.

Renewed local verification of the corrected inventory: runtime-services31passed/1ignored,
existing forced direct-KMA native502 regression1passed, format and all-target
clippy pass. The unchanged product sources, examples and smoke tools retain prior
functional evidence by exact hash; no new product execution is claimed.

Selected reviewer006 adds exact502 content type/length/ETag/Express/CORS and absent
cache-control/nosniff checks to the existing deterministic direct-native error test.
The successful v000705 empty200 reply remains accepted. This is wire-contract proof,
not a new latency bound; the optional per-route elapsed log was not selected.

Deterministic header correction verified locally: the existing direct-route
forced dependency-failure HTTP test passes for all retained direct goldens with
exact502 headers/body. Format and all-target clippy pass. Current remote CI and
independent reviewer confirmation remain required.
